/* Windows x64 GUI launcher: local server, Edge app window, keydown counter.
   Cross-compile: x86_64-w64-mingw32-gcc -mwindows -O2 -static -o pokedex.exe launcher.c -lws2_32 -lshell32
   Presses are stored in %LOCALAPPDATA%\PokemonPokedex\key_presses.json (fresh profile starts at 0). */
#define WIN32_LEAN_AND_MEAN
#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#include <shellapi.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define PORT_FIRST 8080
#define PORT_LAST 8089
#define WM_TRAY (WM_APP + 1)
#define ID_TRAY_EXIT 1
#define ID_TRAY_OPEN 2

static wchar_t g_root[1024];
static wchar_t g_press_file[1024];
static wchar_t g_edge_profile[1024];
static wchar_t g_icon_path[1100];
static int g_presses;
static DWORD g_last_vk;
static ULONGLONG g_last_ms;
static CRITICAL_SECTION g_lock;
static volatile LONG g_press_dirty;
static volatile LONG g_keyed_window;
static BYTE g_key_down[256];
static int g_keys_primed;
static SOCKET g_listen = INVALID_SOCKET;
static HANDLE g_server_thread;
static HANDLE g_key_thread;
static int g_port;
static HANDLE g_edge_process;
static HWND g_hwnd;
static NOTIFYICONDATAW g_nid;
static HICON g_icon;
static volatile LONG g_stop;

static void ensure_dir(const wchar_t *path) {
  CreateDirectoryW(path, NULL);
}

static int read_press_number(const char *text) {
  const char *marker = "\"presses\":";
  const char *p = strstr(text, marker);
  if (!p) return 0;
  p += strlen(marker);
  while (*p == ' ' || *p == '\t') p++;
  int value = 0;
  int any = 0;
  while (*p >= '0' && *p <= '9') {
    any = 1;
    value = value * 10 + (*p - '0');
    p++;
  }
  return any ? value : 0;
}

static void load_presses(void) {
  HANDLE file = CreateFileW(g_press_file, GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE,
                             NULL, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
  if (file == INVALID_HANDLE_VALUE) {
    g_presses = 0;
    return;
  }
  char buf[128];
  DWORD n = 0;
  ReadFile(file, buf, sizeof(buf) - 1, &n, NULL);
  CloseHandle(file);
  buf[n] = 0;
  g_presses = read_press_number(buf);
}

static void write_presses_locked(void) {
  wchar_t tmp[1100];
  _snwprintf(tmp, 1100, L"%s.tmp", g_press_file);
  char body[64];
  int len = _snprintf(body, sizeof(body), "{\"presses\":%d}", g_presses);
  if (len <= 0) return;
  HANDLE file = CreateFileW(tmp, GENERIC_WRITE, 0, NULL, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
  if (file == INVALID_HANDLE_VALUE) return;
  DWORD wrote = 0;
  BOOL ok = WriteFile(file, body, (DWORD)len, &wrote, NULL);
  CloseHandle(file);
  if (!ok || wrote != (DWORD)len) {
    DeleteFileW(tmp);
    return;
  }
  MoveFileExW(tmp, g_press_file, MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH);
}

static void init_press_file(void) {
  wchar_t base[MAX_PATH];
  DWORD n = GetEnvironmentVariableW(L"LOCALAPPDATA", base, MAX_PATH);
  if (n == 0 || n >= MAX_PATH) {
    n = GetEnvironmentVariableW(L"USERPROFILE", base, MAX_PATH);
    if (n == 0 || n >= MAX_PATH) lstrcpyW(base, L".");
    else lstrcatW(base, L"\\AppData\\Local");
  }
  wchar_t dir[MAX_PATH];
  _snwprintf(dir, MAX_PATH, L"%s\\PokemonPokedex", base);
  ensure_dir(dir);
  _snwprintf(g_press_file, 1024, L"%s\\key_presses.json", dir);
  /* Bump folder name to hard-wipe Edge localStorage (coins/buffs/dex). */
  _snwprintf(g_edge_profile, 1024, L"%s\\edge-profile-v2", dir);
  ensure_dir(g_edge_profile);
  load_presses();
  EnterCriticalSection(&g_lock);
  write_presses_locked();
  LeaveCriticalSection(&g_lock);
}

static int hex_nibble(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  return -1;
}

static int url_decode(char *s) {
  char *r = s;
  char *w = s;
  while (*r) {
    if (*r == '%') {
      int hi = hex_nibble(r[1]);
      int lo = hex_nibble(r[2]);
      if (hi < 0 || lo < 0) return 0;
      *w++ = (char)((hi << 4) | lo);
      r += 3;
    } else {
      *w++ = *r++;
    }
  }
  *w = 0;
  return 1;
}

static int unsafe_path(const char *path) {
  if (path[0] != '/') return 1;
  for (const char *p = path; *p; p++) {
    if (*p == '\\' || *p == ':' ) return 1;
  }
  const char *s = path;
  while (*s) {
    while (*s == '/') s++;
    if (!*s) break;
    const char *e = s;
    while (*e && *e != '/') e++;
    int len = (int)(e - s);
    if (len == 1 && s[0] == '.') return 1;
    if (len == 2 && s[0] == '.' && s[1] == '.') return 1;
    s = e;
  }
  return 0;
}

static const char *content_type(const wchar_t *path) {
  const wchar_t *dot = wcsrchr(path, L'.');
  if (!dot) return "application/octet-stream";
  if (!_wcsicmp(dot, L".html") || !_wcsicmp(dot, L".htm")) return "text/html; charset=utf-8";
  if (!_wcsicmp(dot, L".js")) return "text/javascript; charset=utf-8";
  if (!_wcsicmp(dot, L".css")) return "text/css; charset=utf-8";
  if (!_wcsicmp(dot, L".json")) return "application/json; charset=utf-8";
  if (!_wcsicmp(dot, L".png")) return "image/png";
  if (!_wcsicmp(dot, L".jpg") || !_wcsicmp(dot, L".jpeg")) return "image/jpeg";
  if (!_wcsicmp(dot, L".gif")) return "image/gif";
  if (!_wcsicmp(dot, L".webp")) return "image/webp";
  if (!_wcsicmp(dot, L".svg")) return "image/svg+xml";
  if (!_wcsicmp(dot, L".csv")) return "text/csv; charset=utf-8";
  if (!_wcsicmp(dot, L".ico")) return "image/x-icon";
  return "application/octet-stream";
}

static int send_all(SOCKET sock, const char *data, int len) {
  int off = 0;
  while (off < len) {
    int n = send(sock, data + off, len - off, 0);
    if (n <= 0) return 0;
    off += n;
  }
  return 1;
}

static void send_status(SOCKET sock, int code, const char *text) {
  char hdr[256];
  int n = _snprintf(hdr, sizeof(hdr),
                    "HTTP/1.1 %d %s\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                    code, text);
  if (n > 0) send_all(sock, hdr, n);
}

static void send_bytes(SOCKET sock, const char *type, const char *body, int len, int nostore) {
  char hdr[512];
  int n = _snprintf(hdr, sizeof(hdr),
                    "HTTP/1.1 200 OK\r\nContent-Type: %s\r\nContent-Length: %d\r\n"
                    "Connection: close\r\n%s\r\n",
                    type, len, nostore ? "Cache-Control: no-store\r\n" : "");
  if (n > 0 && send_all(sock, hdr, n)) send_all(sock, body, len);
}

static int under_root(const wchar_t *full) {
  size_t n = wcslen(g_root);
  if (_wcsnicmp(full, g_root, n) != 0) return 0;
  return full[n] == L'\0' || full[n] == L'\\';
}

static int resolve_file(const char *url_path, wchar_t *full, size_t cap) {
  wchar_t rel[1024];
  int rel_n = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, url_path[0] == '/' ? url_path + 1 : url_path,
                                   -1, rel, 1024);
  if (rel_n <= 0) return 0;
  for (wchar_t *p = rel; *p; p++) {
    if (*p == L'/') *p = L'\\';
  }
  wchar_t joined[2048];
  if (rel[0] == 0) _snwprintf(joined, 2048, L"%s\\pokedex\\index.html", g_root);
  else _snwprintf(joined, 2048, L"%s\\%s", g_root, rel);
  DWORD got = GetFullPathNameW(joined, (DWORD)cap, full, NULL);
  if (got == 0 || got >= cap) return 0;
  if (!under_root(full)) return 0;
  DWORD attr = GetFileAttributesW(full);
  if (attr == INVALID_FILE_ATTRIBUTES) return 0;
  if (attr & FILE_ATTRIBUTE_DIRECTORY) {
    if (wcslen(full) + 12 >= cap) return 0;
    lstrcatW(full, L"\\index.html");
    attr = GetFileAttributesW(full);
    if (attr == INVALID_FILE_ATTRIBUTES || (attr & FILE_ATTRIBUTE_DIRECTORY)) return 0;
  }
  return 1;
}

static void handle_client(SOCKET sock) {
  char req[8192];
  int got = 0;
  while (got < (int)sizeof(req) - 1) {
    int n = recv(sock, req + got, (int)sizeof(req) - 1 - got, 0);
    if (n <= 0) return;
    got += n;
    req[got] = 0;
    if (strstr(req, "\r\n\r\n")) break;
  }
  if (strncmp(req, "GET ", 4) != 0 && strncmp(req, "HEAD ", 5) != 0) {
    send_status(sock, 405, "Method Not Allowed");
    return;
  }
  int head_only = req[0] == 'H';
  char *path = req + (head_only ? 5 : 4);
  char *end = strchr(path, ' ');
  if (!end) {
    send_status(sock, 400, "Bad Request");
    return;
  }
  *end = 0;
  char *q = strchr(path, '?');
  if (q) *q = 0;
  if (!url_decode(path) || unsafe_path(path)) {
    send_status(sock, 400, "Bad Request");
    return;
  }
  if (strcmp(path, "/data/key_presses.json") == 0) {
    char body[64];
    EnterCriticalSection(&g_lock);
    int len = _snprintf(body, sizeof(body), "{\"presses\":%d}", g_presses);
    LeaveCriticalSection(&g_lock);
    if (head_only) send_status(sock, 200, "OK");
    else if (len > 0) send_bytes(sock, "application/json; charset=utf-8", body, len, 1);
    return;
  }
  if (strcmp(path, "/") == 0) {
    lstrcpynA(path, "/pokedex/index.html", 32);
  }
  wchar_t full[2048];
  if (!resolve_file(path, full, 2048)) {
    send_status(sock, 404, "Not Found");
    return;
  }
  HANDLE file = CreateFileW(full, GENERIC_READ, FILE_SHARE_READ, NULL, OPEN_EXISTING,
                             FILE_ATTRIBUTE_NORMAL, NULL);
  if (file == INVALID_HANDLE_VALUE) {
    send_status(sock, 404, "Not Found");
    return;
  }
  LARGE_INTEGER size;
  if (!GetFileSizeEx(file, &size) || size.QuadPart < 0 || size.QuadPart > 32 * 1024 * 1024) {
    CloseHandle(file);
    send_status(sock, 500, "Error");
    return;
  }
  int len = (int)size.QuadPart;
  char *body = (char *)malloc(len > 0 ? (size_t)len : 1);
  if (!body) {
    CloseHandle(file);
    send_status(sock, 500, "Error");
    return;
  }
  int off = 0;
  while (off < len) {
    DWORD n = 0;
    if (!ReadFile(file, body + off, (DWORD)(len - off), &n, NULL) || n == 0) break;
    off += (int)n;
  }
  CloseHandle(file);
  if (off != len) {
    free(body);
    send_status(sock, 500, "Error");
    return;
  }
  if (head_only) send_status(sock, 200, "OK");
  else send_bytes(sock, content_type(full), body, len, 0);
  free(body);
}

static DWORD WINAPI server_thread(LPVOID unused) {
  (void)unused;
  while (!g_stop) {
    SOCKET client = accept(g_listen, NULL, NULL);
    if (client == INVALID_SOCKET) break;
    DWORD timeout = 8000;
    setsockopt(client, SOL_SOCKET, SO_RCVTIMEO, (char *)&timeout, sizeof(timeout));
    setsockopt(client, SOL_SOCKET, SO_SNDTIMEO, (char *)&timeout, sizeof(timeout));
    handle_client(client);
    closesocket(client);
  }
  return 0;
}

static int start_server(void) {
  WSADATA wsa;
  if (WSAStartup(MAKEWORD(2, 2), &wsa) != 0) return 0;
  for (int port = PORT_FIRST; port <= PORT_LAST; port++) {
    SOCKET sock = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (sock == INVALID_SOCKET) continue;
    BOOL opt = 1;
    setsockopt(sock, SOL_SOCKET, SO_REUSEADDR, (char *)&opt, sizeof(opt));
    struct sockaddr_in addr;
    ZeroMemory(&addr, sizeof(addr));
    addr.sin_family = AF_INET;
    addr.sin_port = htons((unsigned short)port);
    addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    if (bind(sock, (struct sockaddr *)&addr, sizeof(addr)) != 0 || listen(sock, 32) != 0) {
      closesocket(sock);
      continue;
    }
    g_listen = sock;
    g_port = port;
    g_server_thread = CreateThread(NULL, 0, server_thread, NULL, 0, NULL);
    return g_server_thread != NULL;
  }
  return 0;
}

static int file_exists(const wchar_t *path) {
  DWORD attr = GetFileAttributesW(path);
  return attr != INVALID_FILE_ATTRIBUTES && !(attr & FILE_ATTRIBUTE_DIRECTORY);
}

static int find_edge(wchar_t *out, size_t cap) {
  const wchar_t *envs[] = {L"ProgramFiles", L"ProgramFiles(x86)", L"LocalAppData"};
  for (int i = 0; i < 3; i++) {
    wchar_t base[MAX_PATH];
    DWORD n = GetEnvironmentVariableW(envs[i], base, MAX_PATH);
    if (n == 0 || n >= MAX_PATH) continue;
    _snwprintf(out, cap, L"%s\\Microsoft\\Edge\\Application\\msedge.exe", base);
    if (file_exists(out)) return 1;
  }
  const wchar_t *fallbacks[] = {
      L"C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
      L"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"};
  for (int i = 0; i < 2; i++) {
    if (file_exists(fallbacks[i])) {
      lstrcpynW(out, fallbacks[i], (int)cap);
      return 1;
    }
  }
  return 0;
}

static void open_window(void) {
  wchar_t edge[MAX_PATH];
  wchar_t url[256];
  _snwprintf(url, 256, L"http://127.0.0.1:%d/pokedex/", g_port);
  if (find_edge(edge, MAX_PATH)) {
    wchar_t cmd[2048];
    /* URL has no spaces — leave --app= unquoted. CreateProcessW(NULL, cmd)
       with a quoted exe path; nested --app="..." breaks Edge (blank window). */
    _snwprintf(cmd, 2048,
               L"\"%s\" --app=%s --new-window --no-first-run --user-data-dir=\"%s\"",
               edge, url, g_edge_profile);
    STARTUPINFOW si;
    PROCESS_INFORMATION pi;
    ZeroMemory(&si, sizeof(si));
    ZeroMemory(&pi, sizeof(pi));
    si.cb = sizeof(si);
    if (CreateProcessW(NULL, cmd, NULL, NULL, FALSE, 0, NULL, NULL, &si, &pi)) {
      CloseHandle(pi.hThread);
      if (g_edge_process) CloseHandle(g_edge_process);
      g_edge_process = pi.hProcess;
      return;
    }
  }
  ShellExecuteW(NULL, L"open", url, NULL, NULL, SW_SHOWNORMAL);
}

static BOOL CALLBACK focus_app_window(HWND hwnd, LPARAM param) {
  int *found = (int *)param;
  if (hwnd == g_hwnd) return TRUE;
  wchar_t title[256];
  if (GetWindowTextW(hwnd, title, 256) <= 0) return TRUE;
  if (!wcsstr(title, L"\u5b9d\u53ef\u68a6\u56fe\u9274")) return TRUE;
  ShowWindow(hwnd, SW_RESTORE);
  SetForegroundWindow(hwnd);
  *found = 1;
  return FALSE;
}

static void open_or_show_window(void) {
  int found = 0;
  EnumWindows(focus_app_window, (LPARAM)&found);
  if (found) return;
  open_window();
}

static void update_tray_tip(void) {
  if (!g_nid.cbSize) return;
  EnterCriticalSection(&g_lock);
  int presses = g_presses;
  LeaveCriticalSection(&g_lock);
  _snwprintf(g_nid.szTip, 64, L"\u5b9d\u53ef\u68a6\u56fe\u9274 \u00b7 \u6309\u952e %d", presses);
  Shell_NotifyIconW(NIM_MODIFY, &g_nid);
}

static HICON load_app_icon(HINSTANCE instance) {
  HICON icon = (HICON)LoadImageW(instance, MAKEINTRESOURCEW(1), IMAGE_ICON, 0, 0, LR_DEFAULTSIZE);
  if (icon) return icon;
  _snwprintf(g_icon_path, 1100, L"%s\\app.ico", g_root);
  icon = (HICON)LoadImageW(NULL, g_icon_path, IMAGE_ICON, 0, 0, LR_LOADFROMFILE | LR_DEFAULTSIZE);
  if (icon) return icon;
  return LoadIconW(NULL, (LPCWSTR)IDI_APPLICATION);
}

static void flush_presses_if_dirty(void) {
  if (InterlockedCompareExchange(&g_press_dirty, 0, 1) != 1) return;
  EnterCriticalSection(&g_lock);
  write_presses_locked();
  LeaveCriticalSection(&g_lock);
}

static int is_mouse_vk(int vk) {
  return vk == VK_LBUTTON || vk == VK_RBUTTON || vk == VK_MBUTTON ||
         vk == VK_XBUTTON1 || vk == VK_XBUTTON2;
}

/* Mark a key-down for the current 10s window (debounce for poll). */
static void note_key_down(DWORD vk) {
  if (vk == 0 || vk > 255 || is_mouse_vk((int)vk) || vk == 0xFF) return;
  ULONGLONG now = GetTickCount64();
  EnterCriticalSection(&g_lock);
  if (vk == g_last_vk && now - g_last_ms < 35) {
    LeaveCriticalSection(&g_lock);
    return;
  }
  g_last_vk = vk;
  g_last_ms = now;
  LeaveCriticalSection(&g_lock);
  InterlockedExchange(&g_keyed_window, 1);
}

/* GetAsyncKeyState on a dedicated thread (not WM_TIMER). LL hooks fail with Genshin;
   message-only HWND + timer also stalls under exclusive fullscreen. Keys only mark
   the current 10s window; settle_key_window grants +20 if any key fired. */
static void poll_key_presses(void) {
  if (!g_keys_primed) {
    for (int vk = 1; vk < 256; vk++) {
      if (is_mouse_vk(vk)) continue;
      g_key_down[vk] = (BYTE)((GetAsyncKeyState(vk) & 0x8000) ? 1 : 0);
    }
    g_keys_primed = 1;
    return;
  }
  for (int vk = 1; vk < 256; vk++) {
    if (is_mouse_vk(vk)) continue;
    int down = (GetAsyncKeyState(vk) & 0x8000) != 0;
    int was = g_key_down[vk];
    g_key_down[vk] = (BYTE)(down ? 1 : 0);
    if (!down || was) continue;
    note_key_down((DWORD)vk);
  }
}

static DWORD WINAPI key_poll_thread(LPVOID unused) {
  (void)unused;
  while (!g_stop) {
    poll_key_presses();
    Sleep(10);
  }
  return 0;
}

static void settle_key_window(void) {
  if (InterlockedExchange(&g_keyed_window, 0) == 0) return;
  EnterCriticalSection(&g_lock);
  g_presses += 20;
  LeaveCriticalSection(&g_lock);
  InterlockedExchange(&g_press_dirty, 1);
}

static void quit_app(void) {
  g_stop = 1;
  if (g_listen != INVALID_SOCKET) {
    closesocket(g_listen);
    g_listen = INVALID_SOCKET;
  }
  if (g_nid.cbSize) {
    Shell_NotifyIconW(NIM_DELETE, &g_nid);
    g_nid.cbSize = 0;
  }
  PostQuitMessage(0);
}

static LRESULT CALLBACK wnd_proc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam) {
  if (msg == WM_TRAY) {
    if (lParam == WM_LBUTTONUP || lParam == WM_LBUTTONDBLCLK) {
      open_or_show_window();
      return 0;
    }
    if (lParam == WM_RBUTTONUP || lParam == WM_CONTEXTMENU) {
      HMENU menu = CreatePopupMenu();
      AppendMenuW(menu, MF_STRING, ID_TRAY_OPEN, L"\u6253\u5f00\u56fe\u9274");
      AppendMenuW(menu, MF_STRING, ID_TRAY_EXIT, L"\u9000\u51fa");
      POINT pt;
      GetCursorPos(&pt);
      SetForegroundWindow(hwnd);
      TrackPopupMenu(menu, TPM_RIGHTBUTTON, pt.x, pt.y, 0, hwnd, NULL);
      DestroyMenu(menu);
    }
    return 0;
  }
  if (msg == WM_COMMAND) {
    if (LOWORD(wParam) == ID_TRAY_OPEN) {
      open_or_show_window();
      return 0;
    }
    if (LOWORD(wParam) == ID_TRAY_EXIT) {
      quit_app();
      return 0;
    }
  }
  if (msg == WM_TIMER) {
    if (wParam == 3) {
      settle_key_window();
      flush_presses_if_dirty();
      update_tray_tip();
      return 0;
    }
    if (wParam == 1) {
      update_tray_tip();
      return 0;
    }
    return 0;
  }
  if (msg == WM_DESTROY) {
    quit_app();
    return 0;
  }
  return DefWindowProcW(hwnd, msg, wParam, lParam);
}

static void show_error(const wchar_t *text) {
  MessageBoxW(NULL, text, L"\u5b9d\u53ef\u68a6\u56fe\u9274", MB_ICONERROR | MB_OK);
}

int WINAPI WinMain(HINSTANCE instance, HINSTANCE prev, LPSTR cmd, int show) {
  (void)prev;
  (void)cmd;
  (void)show;
  HANDLE mutex = CreateMutexW(NULL, TRUE, L"Local\\PokemonPokedexLauncher");
  if (GetLastError() == ERROR_ALREADY_EXISTS) {
    /* Already running in tray: reopen Edge instead of silent no-op ("打不开了"). */
    HWND existing = FindWindowW(L"PokemonPokedexHost", L"PokemonPokedexHost");
    if (existing) PostMessageW(existing, WM_COMMAND, MAKEWPARAM(ID_TRAY_OPEN, 0), 0);
    if (mutex) CloseHandle(mutex);
    return 0;
  }

  InitializeCriticalSection(&g_lock);
  DWORD n = GetModuleFileNameW(NULL, g_root, 1024);
  if (n == 0 || n >= 1024) {
    show_error(L"\u65e0\u6cd5\u5b9a\u4f4d\u7a0b\u5e8f\u76ee\u5f55\u3002");
    return 1;
  }
  wchar_t *slash = wcsrchr(g_root, L'\\');
  if (!slash) {
    show_error(L"\u65e0\u6cd5\u5b9a\u4f4d\u7a0b\u5e8f\u76ee\u5f55\u3002");
    return 1;
  }
  *slash = 0;
  wchar_t index_path[1100];
  _snwprintf(index_path, 1100, L"%s\\pokedex\\index.html", g_root);
  if (!file_exists(index_path)) {
    show_error(L"\u627e\u4e0d\u5230 pokedex\\index.html\u3002\u8bf7\u628a\u672c\u7a0b\u5e8f\u548c pokedex\u3001data \u653e\u5728\u540c\u4e00\u4e2a\u6587\u4ef6\u5939\u91cc\u3002");
    return 1;
  }

  init_press_file();
  if (!start_server()) {
    show_error(L"\u65e0\u6cd5\u5728 127.0.0.1:8080 \u542f\u52a8\u672c\u5730\u670d\u52a1\u3002");
    return 1;
  }

  g_icon = load_app_icon(instance);

  WNDCLASSW wc;
  ZeroMemory(&wc, sizeof(wc));
  wc.lpfnWndProc = wnd_proc;
  wc.hInstance = instance;
  wc.hIcon = g_icon;
  wc.lpszClassName = L"PokemonPokedexHost";
  RegisterClassW(&wc);
  /* Message-only host: tray + timers; key counting runs on key_poll_thread. */
  g_hwnd = CreateWindowExW(0, wc.lpszClassName, L"PokemonPokedexHost", 0,
                            0, 0, 0, 0, HWND_MESSAGE, NULL, instance, NULL);
  if (!g_hwnd) {
    show_error(L"\u65e0\u6cd5\u521b\u5efa\u4e3b\u7a97\u53e3\u3002");
    return 1;
  }

  ZeroMemory(&g_nid, sizeof(g_nid));
  g_nid.cbSize = sizeof(g_nid);
  g_nid.hWnd = g_hwnd;
  g_nid.uID = 1;
  g_nid.uFlags = NIF_MESSAGE | NIF_ICON | NIF_TIP;
  g_nid.uCallbackMessage = WM_TRAY;
  g_nid.hIcon = g_icon;
  _snwprintf(g_nid.szTip, 64, L"\u5b9d\u53ef\u68a6\u56fe\u9274");
  Shell_NotifyIconW(NIM_ADD, &g_nid);

  g_key_thread = CreateThread(NULL, 0, key_poll_thread, NULL, 0, NULL);

  open_or_show_window();
  SetTimer(g_hwnd, 1, 1000, NULL);
  SetTimer(g_hwnd, 3, 10000, NULL);

  MSG msg;
  while (GetMessageW(&msg, NULL, 0, 0) > 0) {
    TranslateMessage(&msg);
    DispatchMessageW(&msg);
  }

  KillTimer(g_hwnd, 1);
  KillTimer(g_hwnd, 3);
  settle_key_window();
  flush_presses_if_dirty();
  g_stop = 1;
  if (g_listen != INVALID_SOCKET) closesocket(g_listen);
  if (g_key_thread) {
    WaitForSingleObject(g_key_thread, 2000);
    CloseHandle(g_key_thread);
    g_key_thread = NULL;
  }
  if (g_server_thread) {
    WaitForSingleObject(g_server_thread, 2000);
    CloseHandle(g_server_thread);
  }
  if (g_edge_process) CloseHandle(g_edge_process);
  if (g_nid.cbSize) Shell_NotifyIconW(NIM_DELETE, &g_nid);
  WSACleanup();
  if (mutex) CloseHandle(mutex);
  return 0;
}
