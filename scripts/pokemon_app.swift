import AppKit
import ApplicationServices
import CoreGraphics
import Foundation
import WebKit

func bundledRoot() -> URL? {
  guard let res = Bundle.main.resourceURL else { return nil }
  let page = res.appendingPathComponent("pokedex/index.html")
  if FileManager.default.fileExists(atPath: page.path) { return res }
  return nil
}

let rootURL = bundledRoot() ?? URL(fileURLWithPath: "/Users/hhdd/pokemon", isDirectory: true)

func makePressURL() -> URL {
  if bundledRoot() != nil {
    let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("宝可梦图鉴", isDirectory: true)
    return dir.appendingPathComponent("key_presses.json")
  }
  return rootURL.appendingPathComponent("data/key_presses.json")
}

let pressURL = makePressURL()
let pageURL = URL(string: "http://127.0.0.1:8080/pokedex/?v=29")!
let logURL = URL(fileURLWithPath: "/tmp/pokemon-app.log")

var presses = 0
var keyedThisWindow = false
let pressLock = NSLock()
var listening = false
var serverProcess: Process?

func log(_ message: String) {
  let line = message + "\n"
  if let data = line.data(using: .utf8) {
    if FileManager.default.fileExists(atPath: logURL.path),
       let handle = try? FileHandle(forWritingTo: logURL) {
      handle.seekToEndOfFile()
      handle.write(data)
      try? handle.close()
    } else {
      try? data.write(to: logURL)
    }
  }
}

func loadCount() {
  guard let data = try? Data(contentsOf: pressURL),
        let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
        let saved = object["presses"] as? Int else { return }
  presses = saved
}

func writeCount() {
  let payload: [String: Int] = ["presses": presses]
  guard let data = try? JSONSerialization.data(withJSONObject: payload) else { return }
  try? FileManager.default.createDirectory(at: pressURL.deletingLastPathComponent(), withIntermediateDirectories: true)
  try? data.write(to: pressURL, options: .atomic)
}

func portListening() -> Bool {
  let proc = Process()
  proc.executableURL = URL(fileURLWithPath: "/usr/sbin/lsof")
  proc.arguments = ["-nP", "-iTCP:8080", "-sTCP:LISTEN"]
  proc.standardOutput = Pipe()
  proc.standardError = Pipe()
  do {
    try proc.run()
  } catch {
    return false
  }
  proc.waitUntilExit()
  return proc.terminationStatus == 0
}

func ensureServer() {
  let bundled = bundledRoot() != nil
  if !bundled && portListening() {
    log("reuse server on 8080")
    return
  }
  let proc = Process()
  proc.executableURL = URL(fileURLWithPath: "/usr/bin/python3")
  let scriptCandidates = [
    rootURL.appendingPathComponent("serve_pokedex.py"),
    rootURL.appendingPathComponent("scripts/serve_pokedex.py"),
  ]
  if let script = scriptCandidates.first(where: { FileManager.default.fileExists(atPath: $0.path) }) {
    proc.arguments = [
      script.path,
      "--root", rootURL.path,
      "--presses", pressURL.path,
      "--port", "8080",
    ]
  } else {
    proc.arguments = ["-m", "http.server", "8080", "--bind", "127.0.0.1"]
  }
  proc.currentDirectoryURL = rootURL
  proc.standardOutput = FileHandle.nullDevice
  proc.standardError = FileHandle.nullDevice
  do {
    try proc.run()
    serverProcess = proc
    log("started server pid \(proc.processIdentifier)")
  } catch {
    log("server start failed \(error)")
    return
  }
  for _ in 0..<25 {
    if portListening() { return }
    Thread.sleep(forTimeInterval: 0.2)
  }
  log("server did not listen")
}

func stopOldCounter() {
  let proc = Process()
  proc.executableURL = URL(fileURLWithPath: "/usr/bin/pkill")
  proc.arguments = ["-f", "按键获球.app/Contents/MacOS/keyballs"]
  proc.standardOutput = Pipe()
  proc.standardError = Pipe()
  try? proc.run()
  proc.waitUntilExit()
}

func requestAccessIfMissing() {
  if CGPreflightListenEventAccess() {
    log("listen already granted")
    return
  }
  let key = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
  let trusted = AXIsProcessTrustedWithOptions([key: true] as CFDictionary)
  log("accessibility trusted \(trusted)")
  let granted = CGRequestListenEventAccess()
  log("listen request \(granted) preflight now \(CGPreflightListenEventAccess())")
}

func startTap() -> Bool {
  let mask = CGEventMask(1 << CGEventType.keyDown.rawValue)
  guard let tap = CGEvent.tapCreate(
    tap: .cgSessionEventTap,
    place: .headInsertEventTap,
    options: .listenOnly,
    eventsOfInterest: mask,
    callback: { _, type, event, _ in
      if type == .keyDown && event.getIntegerValueField(.keyboardEventAutorepeat) == 0 {
        pressLock.lock()
        keyedThisWindow = true
        pressLock.unlock()
      }
      return Unmanaged.passUnretained(event)
    },
    userInfo: nil
  ) else {
    return false
  }
  let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
  CFRunLoopAddSource(CFRunLoopGetCurrent(), source, .commonModes)
  CGEvent.tapEnable(tap: tap, enable: true)
  return true
}

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate {
  var window: NSWindow?
  var webView: WKWebView?
  var notice: NSTextField?
  var loadAttempts = 0

  func applicationDidFinishLaunching(_ notification: Notification) {
    try? FileManager.default.removeItem(at: logURL)
    stopOldCounter()
    loadCount()
    writeCount()
    ensureServer()
    buildWindow()
    window?.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)
    listening = startTap()
    if listening && CGPreflightListenEventAccess() {
      log("listening true")
    } else if !CGPreflightListenEventAccess() {
      requestAccessIfMissing()
      listening = startTap()
      log("listening \(listening)")
      if !listening {
        NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent")!)
      }
    } else {
      log("tap failed with listen access already granted")
    }
    updateNotice()
    loadPage()
    // 每 10 秒结算一次：期间只要按过键，就记 20 个球（写入 presses，页面按差值补球）。
    Timer.scheduledTimer(withTimeInterval: 10, repeats: true) { _ in
      pressLock.lock()
      let keyed = keyedThisWindow
      keyedThisWindow = false
      if keyed {
        presses += 20
        writeCount()
      }
      pressLock.unlock()
    }
    Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] timer in
      guard let self else { return }
      if listening {
        timer.invalidate()
        return
      }
      listening = startTap()
      if listening {
        log("listening true")
        self.updateNotice()
        timer.invalidate()
      }
    }
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
    true
  }

  func applicationWillTerminate(_ notification: Notification) {
    pressLock.lock()
    if keyedThisWindow {
      keyedThisWindow = false
      presses += 20
      writeCount()
    }
    pressLock.unlock()
    serverProcess?.terminate()
  }

  func buildWindow() {
    let window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 1180, height: 820),
      styleMask: [.titled, .closable, .miniaturizable, .resizable],
      backing: .buffered,
      defer: false
    )
    window.title = "宝可梦图鉴"
    window.minSize = NSSize(width: 860, height: 640)
    window.center()
    window.backgroundColor = NSColor(srgbRed: 13 / 255, green: 26 / 255, blue: 20 / 255, alpha: 1)

    // 必须用默认持久化存储，否则 localStorage（进度 / 每日 Boss）重启就丢
    let web = WKWebView(frame: window.contentView?.bounds ?? .zero)
    web.autoresizingMask = [.width, .height]
    web.navigationDelegate = self
    web.setValue(false, forKey: "drawsBackground")
    window.contentView?.addSubview(web)
    let note = NSTextField(wrappingLabelWithString: "还不能读取按键。请在「系统设置 → 隐私与安全性 → 输入监视」里打开「宝可梦图鉴」。打开后会自动开始计数。")
    note.font = .systemFont(ofSize: 13, weight: .medium)
    note.textColor = .white
    note.backgroundColor = NSColor(srgbRed: 0.55, green: 0.25, blue: 0.12, alpha: 0.95)
    note.drawsBackground = true
    note.alignment = .center
    note.frame = NSRect(x: 0, y: (window.contentView?.bounds.height ?? 820) - 44, width: window.contentView?.bounds.width ?? 1180, height: 44)
    note.autoresizingMask = [.width, .minYMargin]
    window.contentView?.addSubview(note)
    self.window = window
    webView = web
    notice = note
  }

  func updateNotice() {
    notice?.isHidden = listening
  }

  func loadPage() {
    loadAttempts += 1
    webView?.load(URLRequest(url: pageURL))
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    log("page loaded")
  }

  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    retry(error)
  }

  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
    retry(error)
  }

  func retry(_ error: Error) {
    log("load failed \(error.localizedDescription)")
    guard loadAttempts < 8 else { return }
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
      self.loadPage()
    }
  }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.setActivationPolicy(.regular)
app.delegate = delegate
app.run()
