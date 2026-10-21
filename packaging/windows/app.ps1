# Serves the pokedex on 127.0.0.1:8080 and counts key presses.
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$SaveDir = Join-Path $env:LOCALAPPDATA "PokemonPokedex"
New-Item -ItemType Directory -Force -Path $SaveDir | Out-Null
$PressFile = Join-Path $SaveDir "key_presses.json"
if (-not (Test-Path $PressFile)) { Set-Content -Path $PressFile -Value '{"presses":0}' -Encoding ascii }

Add-Type -TypeDefinition @"
using System;
using System.IO;
using System.Runtime.InteropServices;
public static class KeyHook {
  private const int WH_KEYBOARD_LL = 13;
  private const int WM_KEYDOWN = 0x0100;
  private const int WM_SYSKEYDOWN = 0x0104;
  public delegate IntPtr HookProc(int nCode, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] public static extern IntPtr SetWindowsHookEx(int idHook, HookProc lpfn, IntPtr hMod, uint dwThreadId);
  [DllImport("user32.dll")] public static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);
  [DllImport("kernel32.dll")] public static extern IntPtr GetModuleHandle(string lpModuleName);
  public static string PressFile;
  public static int presses;
  static IntPtr hook;
  static HookProc proc;
  static int lastVk;
  static long lastMs;
  public static void Start(string pressFile) {
    PressFile = pressFile;
    try {
      var text = File.ReadAllText(pressFile);
      var marker = "\"presses\":";
      var i = text.IndexOf(marker);
      if (i >= 0) {
        var rest = text.Substring(i + marker.Length).Trim();
        var digits = "";
        foreach (var ch in rest) { if (ch >= '0' && ch <= '9') digits += ch; else break; }
        if (digits.Length > 0) presses = int.Parse(digits);
      }
    } catch {}
    proc = Callback;
    hook = SetWindowsHookEx(WH_KEYBOARD_LL, proc, GetModuleHandle(null), 0);
  }
  static IntPtr Callback(int nCode, IntPtr wParam, IntPtr lParam) {
    if (nCode >= 0 && (wParam == (IntPtr)WM_KEYDOWN || wParam == (IntPtr)WM_SYSKEYDOWN)) {
      int vk = Marshal.ReadInt32(lParam);
      long now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
      if (!(vk == lastVk && now - lastMs < 35)) {
        lastVk = vk;
        lastMs = now;
        presses++;
        try { File.WriteAllText(PressFile, "{\"presses\":" + presses + "}"); } catch {}
      }
    }
    return CallNextHookEx(hook, nCode, wParam, lParam);
  }
}
"@

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://127.0.0.1:8080/")
$listener.Start()

$rs = [runspacefactory]::CreateRunspace()
$rs.Open()
$ps = [powershell]::Create()
$ps.Runspace = $rs
[void]$ps.AddScript({
  param($listener, $root, $pressFile)
  while ($listener.IsListening) {
    try { $ctx = $listener.GetContext() } catch { break }
    try {
      $reqPath = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath)
      if ($reqPath -eq "/") { $reqPath = "/pokedex/index.html" }
      if ($reqPath -eq "/data/key_presses.json") {
        $bytes = [IO.File]::ReadAllBytes($pressFile)
        $ctx.Response.ContentType = "application/json"
        $ctx.Response.Headers.Add("Cache-Control", "no-store")
        $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
        $ctx.Response.Close()
        continue
      }
      $rel = $reqPath.TrimStart("/").Replace("/", [IO.Path]::DirectorySeparatorChar)
      $full = [IO.Path]::GetFullPath((Join-Path $root $rel))
      $rootFull = [IO.Path]::GetFullPath($root)
      if (-not $full.StartsWith($rootFull) -or -not (Test-Path $full -PathType Leaf)) {
        $ctx.Response.StatusCode = 404
        $ctx.Response.Close()
        continue
      }
      $ext = [IO.Path]::GetExtension($full).ToLower()
      $type = "application/octet-stream"
      if ($ext -eq ".html") { $type = "text/html; charset=utf-8" }
      elseif ($ext -eq ".js") { $type = "text/javascript; charset=utf-8" }
      elseif ($ext -eq ".css") { $type = "text/css; charset=utf-8" }
      elseif ($ext -eq ".json") { $type = "application/json; charset=utf-8" }
      elseif ($ext -eq ".png") { $type = "image/png" }
      $bytes = [IO.File]::ReadAllBytes($full)
      $ctx.Response.ContentType = $type
      $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
      $ctx.Response.Close()
    } catch {
      try { $ctx.Response.Abort() } catch {}
    }
  }
}).AddArgument($listener).AddArgument($Root).AddArgument($PressFile)
$handle = $ps.BeginInvoke()

[KeyHook]::Start($PressFile)

$edgeCandidates = @(
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
)
$edge = $edgeCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($edge) {
  $window = Start-Process $edge "--app=http://127.0.0.1:8080/pokedex/ --new-window" -PassThru
} else {
  Start-Process "http://127.0.0.1:8080/pokedex/"
  $window = $null
}

Add-Type -AssemblyName System.Windows.Forms
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 800
$timer.Add_Tick({
  if ($window -and $window.HasExited) {
    [System.Windows.Forms.Application]::Exit()
  }
})
$timer.Start()
[System.Windows.Forms.Application]::Run()
$timer.Stop()
$listener.Stop()
$ps.Stop()
$rs.Close()
