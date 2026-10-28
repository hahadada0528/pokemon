/* Windows x64 GUI launcher: local server, Edge app window, keydown counter.
   Cross-compile: zig cc -target x86_64-windows-gnu ... launcher.c -lws2_32 -lshell32 -lcomdlg32
   Presses are stored in %LOCALAPPDATA%\PokemonPokedex\key_presses.json (fresh profile starts at 0). */
#define WIN32_LEAN_AND_MEAN
#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#include <commdlg.h>
#include <shellapi.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define PORT_FIRST 8080
#define PORT_LAST 8089
#define WM_TRAY (WM_APP + 1)
#define WM_PICK_EXPORT (WM_APP + 20)
#define WM_PICK_IMPORT (WM_APP + 21)
#define ID_TRAY_EXIT 1
#define ID_TRAY_OPEN 2

static wchar_t g_root[1024];
static wchar_t g_press_file[1024];
static wchar_t g_progress_file[1024];
static wchar_t g_prefs_file[1024];
static wchar_t g_edge_profile[1024];
static wchar_t g_icon_path[1100];
static wchar_t g_pick_path[MAX_PATH];
static HANDLE g_pick_event;
static volatile LONG g_pick_ok;
#define PROGRESS_MAX (8 * 1024 * 1024)
static int g_presses;
static DWORD g_last_vk;
static ULONGLONG g_last_ms;
static CRITICAL_SECTION g_lock;
static volatile LONG g_press_dirty;
static volatile LONG g_keyed_window;
/* Tick of the last /data/key_presses.json fetch. The open page turns presses into balls.
   After the window is closed that fetch stops, and the tray credits progress.json itself. */
static volatile ULONGLONG g_last_page_sync;
static BYTE g_key_down[256];
static int g_keys_primed;
static SOCKET g_listen = INVALID_SOCKET;
static HANDLE g_server_thread;
static HANDLE g_key_thread;
static int g_port;
static HANDLE g_edge_process;
/* 1 while Edge has been launched but its window is not up yet. Extra tray clicks
   in that gap used to start a second page, and the two pages overwrote the save. */
static volatile LONG g_edge_opening;
static ULONGLONG g_edge_open_tick;
static HWND g_hwnd;
static HWND g_raw_hwnd; /* tiny top-level window for mouse-wheel Raw Input only */
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
  _snwprintf(g_progress_file, 1024, L"%s\\progress.json", dir);
  _snwprintf(g_prefs_file, 1024, L"%s\\save_prefs.json", dir);
  /* Bump folder name to hard-wipe Edge localStorage (coins/buffs/dex). */
  _snwprintf(g_edge_profile, 1024, L"%s\\edge-profile-v3", dir);
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

static int header_content_length(const char *headers, int *out_len) {
  const char *p = headers;
  while (*p) {
    if (_strnicmp(p, "Content-Length:", 15) == 0) {
      p += 15;
      while (*p == ' ' || *p == '\t') p++;
      int v = 0;
      int any = 0;
      while (*p >= '0' && *p <= '9') {
        any = 1;
        v = v * 10 + (*p - '0');
        p++;
      }
      if (!any) return 0;
      *out_len = v;
      return 1;
    }
    const char *nl = strstr(p, "\r\n");
    if (!nl) break;
    p = nl + 2;
  }
  *out_len = 0;
  return 1;
}

static char *read_all_file_w(const wchar_t *path, int *out_len) {
  HANDLE file = CreateFileW(path, GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE, NULL,
                            OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
  if (file == INVALID_HANDLE_VALUE) return NULL;
  LARGE_INTEGER size;
  if (!GetFileSizeEx(file, &size) || size.QuadPart < 0 || size.QuadPart > PROGRESS_MAX) {
    CloseHandle(file);
    return NULL;
  }
  int len = (int)size.QuadPart;
  char *body = (char *)malloc(len > 0 ? (size_t)len + 1 : 1);
  if (!body) {
    CloseHandle(file);
    return NULL;
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
    return NULL;
  }
  body[len] = 0;
  if (out_len) *out_len = len;
  return body;
}

static int write_all_file_w(const wchar_t *path, const char *data, int len) {
  wchar_t tmp[1100];
  _snwprintf(tmp, 1100, L"%s.tmp", path);
  HANDLE file = CreateFileW(tmp, GENERIC_WRITE, 0, NULL, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
  if (file == INVALID_HANDLE_VALUE) return 0;
  DWORD wrote = 0;
  BOOL ok = WriteFile(file, data, (DWORD)len, &wrote, NULL);
  CloseHandle(file);
  if (!ok || wrote != (DWORD)len) {
    DeleteFileW(tmp);
    return 0;
  }
  if (!MoveFileExW(tmp, path, MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)) {
    DeleteFileW(tmp);
    return 0;
  }
  return 1;
}

static void json_escape(const char *in, char *out, size_t cap) {
  size_t w = 0;
  if (!in) in = "";
  for (const unsigned char *p = (const unsigned char *)in; *p && w + 2 < cap; p++) {
    if (*p == '"' || *p == '\\') {
      if (w + 3 >= cap) break;
      out[w++] = '\\';
      out[w++] = (char)*p;
    } else if (*p < 0x20) {
      continue;
    } else {
      out[w++] = (char)*p;
    }
  }
  out[w] = 0;
}

static int json_get_string(const char *json, const char *key, char *out, size_t cap) {
  char needle[128];
  _snprintf(needle, sizeof(needle), "\"%s\"", key);
  const char *p = strstr(json, needle);
  if (!p) return 0;
  p += strlen(needle);
  while (*p == ' ' || *p == '\t' || *p == '\r' || *p == '\n') p++;
  if (*p != ':') return 0;
  p++;
  while (*p == ' ' || *p == '\t' || *p == '\r' || *p == '\n') p++;
  if (*p != '"') return 0;
  p++;
  size_t w = 0;
  while (*p && w + 1 < cap) {
    if (*p == '\\' && p[1]) {
      p++;
      out[w++] = *p++;
      continue;
    }
    if (*p == '"') break;
    out[w++] = *p++;
  }
  out[w] = 0;
  return 1;
}

static void prefs_set_path_key(const char *key, const wchar_t *wpath) {
  char export_u[MAX_PATH * 3] = "";
  char import_u[MAX_PATH * 3] = "";
  int n = 0;
  char *raw = read_all_file_w(g_prefs_file, &n);
  if (raw) {
    json_get_string(raw, "exportFile", export_u, sizeof(export_u));
    json_get_string(raw, "importFile", import_u, sizeof(import_u));
    free(raw);
  }
  char path_u[MAX_PATH * 3];
  if (!WideCharToMultiByte(CP_UTF8, 0, wpath, -1, path_u, (int)sizeof(path_u), NULL, NULL)) return;
  if (strcmp(key, "exportFile") == 0) lstrcpynA(export_u, path_u, (int)sizeof(export_u));
  else if (strcmp(key, "importFile") == 0) lstrcpynA(import_u, path_u, (int)sizeof(import_u));
  char esc_e[MAX_PATH * 4];
  char esc_i[MAX_PATH * 4];
  json_escape(export_u, esc_e, sizeof(esc_e));
  json_escape(import_u, esc_i, sizeof(esc_i));
  char body[MAX_PATH * 8 + 64];
  int len = _snprintf(body, sizeof(body),
                      "{\n  \"exportFile\": \"%s\",\n  \"importFile\": \"%s\"\n}\n", esc_e, esc_i);
  if (len > 0) write_all_file_w(g_prefs_file, body, len);
}

static int prefs_get_export_w(wchar_t *out, size_t cap) {
  int n = 0;
  char *raw = read_all_file_w(g_prefs_file, &n);
  if (!raw) return 0;
  char path_u[MAX_PATH * 3];
  int ok = json_get_string(raw, "exportFile", path_u, sizeof(path_u));
  free(raw);
  if (!ok || !path_u[0]) return 0;
  return MultiByteToWideChar(CP_UTF8, 0, path_u, -1, out, (int)cap) > 0;
}

static int read_put_body(SOCKET sock, const char *body_start, int already, int need, char **out) {
  if (need < 0 || need > PROGRESS_MAX) return 0;
  char *body = (char *)malloc(need > 0 ? (size_t)need : 1);
  if (!body) return 0;
  int got = 0;
  if (already > 0) {
    int take = already < need ? already : need;
    memcpy(body, body_start, (size_t)take);
    got = take;
  }
  while (got < need) {
    int n = recv(sock, body + got, need - got, 0);
    if (n <= 0) {
      free(body);
      return 0;
    }
    got += n;
  }
  *out = body;
  return 1;
}

/* Header scan stops at the header block so a save body cannot look like Content-Length. */
static int header_block(const char *req, const char **start, const char **end) {
  const char *e = strstr(req, "\r\n\r\n");
  if (!e) return 0;
  *start = req;
  *end = e;
  return 1;
}

static int header_has_token(const char *req, const char *key, const char *needle) {
  const char *p;
  const char *end;
  int klen = (int)strlen(key);
  int nlen = (int)strlen(needle);
  if (!header_block(req, &p, &end)) return 0;
  while (p < end) {
    if ((int)(end - p) >= klen && _strnicmp(p, key, klen) == 0) {
      const char *line = strstr(p, "\r\n");
      if (!line || line > end) line = end;
      for (const char *q = p + klen; q + nlen <= line; q++) {
        if (_strnicmp(q, needle, nlen) == 0) return 1;
      }
      return 0;
    }
    const char *nl = strstr(p, "\r\n");
    if (!nl || nl >= end) break;
    p = nl + 2;
  }
  return 0;
}

/* 1 = present, 0 = absent, -1 = malformed or larger than PROGRESS_MAX. */
static int header_length_value(const char *req, int *out_len) {
  const char *p;
  const char *end;
  if (!header_block(req, &p, &end)) return -1;
  while (p < end) {
    if ((int)(end - p) >= 15 && _strnicmp(p, "Content-Length:", 15) == 0) {
      const char *v = p + 15;
      while (v < end && (*v == ' ' || *v == '\t')) v++;
      if (v >= end || *v < '0' || *v > '9') return -1;
      int n = 0;
      while (v < end && *v >= '0' && *v <= '9') {
        if (n > PROGRESS_MAX / 10) return -1;
        n = n * 10 + (*v - '0');
        v++;
      }
      if (n > PROGRESS_MAX) return -1;
      *out_len = n;
      return 1;
    }
    const char *nl = strstr(p, "\r\n");
    if (!nl || nl >= end) break;
    p = nl + 2;
  }
  return 0;
}

typedef struct {
  SOCKET sock;
  const char *mem;
  int mem_len;
  int mem_pos;
} Rd;

static int rd_get(Rd *r, char *out, int want) {
  int got = 0;
  while (got < want) {
    if (r->mem_pos < r->mem_len) {
      int take = r->mem_len - r->mem_pos;
      if (take > want - got) take = want - got;
      memcpy(out + got, r->mem + r->mem_pos, (size_t)take);
      r->mem_pos += take;
      got += take;
      continue;
    }
    int n = recv(r->sock, out + got, want - got, 0);
    if (n <= 0) break;
    got += n;
  }
  return got;
}

static int rd_line(Rd *r, char *out, int cap) {
  int n = 0;
  while (n + 1 < cap) {
    char c;
    if (rd_get(r, &c, 1) != 1) return -1;
    out[n++] = c;
    if (c == '\n') break;
  }
  out[n] = 0;
  if (n == 0 || out[n - 1] != '\n') return -1;
  return n;
}

/* 1 ok, 0 bad, -1 too large. */
static int read_chunked(Rd *r, char **out, int *out_len) {
  char *body = NULL;
  int cap = 0;
  int len = 0;
  for (;;) {
    char line[128];
    if (rd_line(r, line, (int)sizeof(line)) < 0) {
      free(body);
      return 0;
    }
    char *cr = strchr(line, '\r');
    if (cr) *cr = 0;
    char *semi = strchr(line, ';');
    if (semi) *semi = 0;
    if (!line[0]) continue;
    char *endptr = NULL;
    long sz = strtol(line, &endptr, 16);
    if (endptr == line || *endptr != 0 || sz < 0) {
      free(body);
      return 0;
    }
    if (sz > PROGRESS_MAX || len > PROGRESS_MAX - (int)sz) {
      free(body);
      return -1;
    }
    if (sz == 0) {
      for (;;) {
        char trailer[256];
        int n = rd_line(r, trailer, (int)sizeof(trailer));
        if (n <= 0) break;
        if ((n == 2 && trailer[0] == '\r') || (n == 1 && trailer[0] == '\n')) break;
      }
      if (!body) {
        body = (char *)malloc(1);
        if (!body) return 0;
      }
      *out = body;
      *out_len = len;
      return 1;
    }
    if (cap < len + (int)sz) {
      int ncap = cap > 0 ? cap : 1024;
      while (ncap < len + (int)sz) {
        if (ncap > PROGRESS_MAX / 2) {
          ncap = len + (int)sz;
          break;
        }
        ncap *= 2;
      }
      char *nbuf = (char *)realloc(body, (size_t)ncap);
      if (!nbuf) {
        free(body);
        return 0;
      }
      body = nbuf;
      cap = ncap;
    }
    if (rd_get(r, body + len, (int)sz) != (int)sz) {
      free(body);
      return 0;
    }
    len += (int)sz;
    char crlf[2];
    if (rd_get(r, crlf, 2) != 2) {
      free(body);
      return 0;
    }
  }
}

static int read_quiet(SOCKET sock, const char *mem, int mem_len, char **out, int *out_len) {
  if (mem_len < 0) mem_len = 0;
  if (mem_len > PROGRESS_MAX) return -1;
  char *body = (char *)malloc(mem_len > 0 ? (size_t)mem_len : 1);
  if (!body) return 0;
  int len = 0;
  if (mem_len > 0 && mem) {
    memcpy(body, mem, (size_t)mem_len);
    len = mem_len;
  }
  DWORD prev = 8000;
  int optlen = (int)sizeof(prev);
  getsockopt(sock, SOL_SOCKET, SO_RCVTIMEO, (char *)&prev, &optlen);
  DWORD quick = 200;
  setsockopt(sock, SOL_SOCKET, SO_RCVTIMEO, (char *)&quick, sizeof(quick));
  for (;;) {
    if (len >= PROGRESS_MAX) {
      setsockopt(sock, SOL_SOCKET, SO_RCVTIMEO, (char *)&prev, sizeof(prev));
      free(body);
      return -1;
    }
    int room = PROGRESS_MAX - len;
    if (room > 8192) room = 8192;
    char *nbuf = (char *)realloc(body, (size_t)len + (size_t)room);
    if (!nbuf) {
      setsockopt(sock, SOL_SOCKET, SO_RCVTIMEO, (char *)&prev, sizeof(prev));
      free(body);
      return 0;
    }
    body = nbuf;
    int n = recv(sock, body + len, room, 0);
    if (n <= 0) break;
    len += n;
  }
  setsockopt(sock, SOL_SOCKET, SO_RCVTIMEO, (char *)&prev, sizeof(prev));
  *out = body;
  *out_len = len;
  return 1;
}

/* 1 ok, 0 bad, -1 too large. Empty Content-Length is ok and yields length 0. */
static int read_request_body(SOCKET sock, const char *req, const char *body_start, int already,
                             char **out, int *out_len) {
  *out = NULL;
  *out_len = 0;
  if (already < 0) already = 0;
  if (header_has_token(req, "Transfer-Encoding:", "chunked")) {
    Rd rd;
    rd.sock = sock;
    rd.mem = body_start ? body_start : "";
    rd.mem_len = already;
    rd.mem_pos = 0;
    return read_chunked(&rd, out, out_len);
  }
  int cl = 0;
  int has = header_length_value(req, &cl);
  if (has < 0) return -1;
  if (has == 1) {
    if (!read_put_body(sock, body_start, already, cl, out)) return cl > PROGRESS_MAX ? -1 : 0;
    *out_len = cl;
    return 1;
  }
  return read_quiet(sock, body_start, already, out, out_len);
}

static void path_dirname_w(const wchar_t *full, wchar_t *dir, size_t cap) {
  if (!cap) return;
  dir[0] = 0;
  if (!full || !full[0]) return;
  lstrcpynW(dir, full, (int)cap);
  wchar_t *slash = wcsrchr(dir, L'\\');
  if (!slash) slash = wcsrchr(dir, L'/');
  if (slash) *slash = 0;
  else dir[0] = 0;
}

static void path_basename_w(const wchar_t *full, wchar_t *name, size_t cap) {
  if (!cap) return;
  name[0] = 0;
  if (!full || !full[0]) return;
  const wchar_t *slash = wcsrchr(full, L'\\');
  if (!slash) slash = wcsrchr(full, L'/');
  lstrcpynW(name, slash ? slash + 1 : full, (int)cap);
}

static void do_pick_export(void) {
  OPENFILENAMEW ofn;
  wchar_t initial_dir[MAX_PATH];
  wchar_t last[MAX_PATH * 2];
  ZeroMemory(&ofn, sizeof(ofn));
  ZeroMemory(g_pick_path, sizeof(g_pick_path));
  ZeroMemory(initial_dir, sizeof(initial_dir));
  lstrcpyW(g_pick_path, L"pokedex-save.json");
  if (prefs_get_export_w(last, MAX_PATH * 2)) {
    path_basename_w(last, g_pick_path, MAX_PATH);
    if (!g_pick_path[0]) lstrcpyW(g_pick_path, L"pokedex-save.json");
    path_dirname_w(last, initial_dir, MAX_PATH);
  }
  ofn.lStructSize = sizeof(ofn);
  ofn.hwndOwner = NULL;
  ofn.lpstrFilter = L"JSON (*.json)\0*.json\0All (*.*)\0*.*\0";
  ofn.lpstrFile = g_pick_path;
  ofn.nMaxFile = MAX_PATH;
  if (initial_dir[0]) ofn.lpstrInitialDir = initial_dir;
  ofn.Flags = OFN_OVERWRITEPROMPT | OFN_PATHMUSTEXIST;
  ofn.lpstrDefExt = L"json";
  ofn.lpstrTitle = L"\u5bfc\u51fa\u56fe\u9274\u5b58\u6863\uff08\u53ef\u6539\u4f4d\u7f6e\uff0c\u786e\u8ba4\u540e\u5199\u5165\uff09";
  InterlockedExchange(&g_pick_ok, GetSaveFileNameW(&ofn) ? 1 : 0);
  if (g_pick_event) SetEvent(g_pick_event);
}

static int prefs_get_import_w(wchar_t *out, size_t cap) {
  int n = 0;
  char *raw = read_all_file_w(g_prefs_file, &n);
  if (!raw) return 0;
  char path_u[MAX_PATH * 3];
  int ok = json_get_string(raw, "importFile", path_u, sizeof(path_u));
  free(raw);
  if (!ok || !path_u[0]) return 0;
  return MultiByteToWideChar(CP_UTF8, 0, path_u, -1, out, (int)cap) > 0;
}

static void do_pick_import(void) {
  OPENFILENAMEW ofn;
  wchar_t initial_dir[MAX_PATH];
  wchar_t last[MAX_PATH * 2];
  ZeroMemory(&ofn, sizeof(ofn));
  ZeroMemory(g_pick_path, sizeof(g_pick_path));
  ZeroMemory(initial_dir, sizeof(initial_dir));
  if (prefs_get_import_w(last, MAX_PATH * 2)) {
    path_basename_w(last, g_pick_path, MAX_PATH);
    path_dirname_w(last, initial_dir, MAX_PATH);
  }
  ofn.lStructSize = sizeof(ofn);
  ofn.hwndOwner = NULL;
  ofn.lpstrFilter = L"JSON (*.json)\0*.json\0All (*.*)\0*.*\0";
  ofn.lpstrFile = g_pick_path;
  ofn.nMaxFile = MAX_PATH;
  if (initial_dir[0]) ofn.lpstrInitialDir = initial_dir;
  ofn.Flags = OFN_FILEMUSTEXIST | OFN_PATHMUSTEXIST;
  ofn.lpstrDefExt = L"json";
  ofn.lpstrTitle = L"\u5bfc\u5165\u56fe\u9274\u5b58\u6863\uff08\u786e\u8ba4\u540e\u8bfb\u53d6\uff09";
  InterlockedExchange(&g_pick_ok, GetOpenFileNameW(&ofn) ? 1 : 0);
  if (g_pick_event) SetEvent(g_pick_event);
}

static int wait_pick(UINT msg) {
  if (!g_hwnd || !g_pick_event) return 0;
  ResetEvent(g_pick_event);
  InterlockedExchange(&g_pick_ok, 0);
  if (!PostMessageW(g_hwnd, msg, 0, 0)) return 0;
  if (WaitForSingleObject(g_pick_event, 120000) != WAIT_OBJECT_0) return 0;
  return InterlockedCompareExchange(&g_pick_ok, 0, 0) == 1;
}

static void handle_prefs_get(SOCKET sock, int head_only) {
  int len = 0;
  char *body = read_all_file_w(g_prefs_file, &len);
  if (!body) {
    const char *empty = "{}";
    if (head_only) send_status(sock, 200, "OK");
    else send_bytes(sock, "application/json; charset=utf-8", empty, 2, 1);
    return;
  }
  if (head_only) send_status(sock, 200, "OK");
  else send_bytes(sock, "application/json; charset=utf-8", body, len, 1);
  free(body);
}

static void handle_prefs_put(SOCKET sock, const char *body_start, int already, int need) {
  char *body = NULL;
  if (!read_put_body(sock, body_start, already, need, &body)) {
    send_status(sock, need > PROGRESS_MAX ? 413 : 400, need > PROGRESS_MAX ? "Payload Too Large" : "Bad Request");
    return;
  }
  if (!write_all_file_w(g_prefs_file, body, need)) {
    free(body);
    send_status(sock, 500, "Error");
    return;
  }
  free(body);
  send_status(sock, 204, "No Content");
}

static void handle_backup_put(SOCKET sock, char *body, int body_len, const char *query) {
  if (!body || body_len <= 0) {
    free(body);
    {
      const char *msg = "{\"ok\":false,\"error\":\"empty\"}";
      send_bytes(sock, "application/json; charset=utf-8", msg, (int)strlen(msg), 1);
    }
    return;
  }
  wchar_t dest[MAX_PATH * 2];
  ZeroMemory(dest, sizeof(dest));
  if (query && _strnicmp(query, "path=", 5) == 0) {
    char path_u[MAX_PATH * 3];
    lstrcpynA(path_u, query + 5, (int)sizeof(path_u));
    url_decode(path_u);
    if (!MultiByteToWideChar(CP_UTF8, 0, path_u, -1, dest, MAX_PATH * 2)) {
      free(body);
      {
        const char *msg = "{\"ok\":false,\"error\":\"bad_path\"}";
        send_bytes(sock, "application/json; charset=utf-8", msg, (int)strlen(msg), 1);
      }
      return;
    }
  } else if (!prefs_get_export_w(dest, MAX_PATH * 2)) {
    free(body);
    {
      const char *msg = "{\"ok\":false,\"error\":\"no_export_path\"}";
      send_bytes(sock, "application/json; charset=utf-8", msg, (int)strlen(msg), 1);
    }
    return;
  }
  if (!write_all_file_w(dest, body, body_len)) {
    free(body);
    send_status(sock, 500, "Error");
    return;
  }
  int wrote = body_len;
  free(body);
  prefs_set_path_key("exportFile", dest);
  char path_u[MAX_PATH * 3];
  WideCharToMultiByte(CP_UTF8, 0, dest, -1, path_u, (int)sizeof(path_u), NULL, NULL);
  char esc[MAX_PATH * 4];
  json_escape(path_u, esc, sizeof(esc));
  char resp[MAX_PATH * 4 + 80];
  int rlen = _snprintf(resp, sizeof(resp), "{\"ok\":true,\"exportFile\":\"%s\",\"bytes\":%d}", esc, wrote);
  if (rlen > 0 && rlen < (int)sizeof(resp))
    send_bytes(sock, "application/json; charset=utf-8", resp, rlen, 1);
  else
    send_status(sock, 500, "Error");
}

static void handle_pick_export(SOCKET sock, char *body, int body_len) {
  if (!body || body_len <= 0) {
    free(body);
    {
      const char *msg = "{\"ok\":false,\"error\":\"empty\"}";
      send_bytes(sock, "application/json; charset=utf-8", msg, (int)strlen(msg), 1);
    }
    return;
  }
  if (!wait_pick(WM_PICK_EXPORT)) {
    free(body);
    {
      const char *msg = "{\"ok\":false,\"cancelled\":true}";
      send_bytes(sock, "application/json; charset=utf-8", msg, (int)strlen(msg), 1);
    }
    return;
  }
  /* Overwrite any 0-byte file the save dialog created with the snapshot. */
  if (!write_all_file_w(g_pick_path, body, body_len)) {
    free(body);
    send_status(sock, 500, "Error");
    return;
  }
  int wrote = body_len;
  free(body);
  prefs_set_path_key("exportFile", g_pick_path);
  char path_u[MAX_PATH * 3];
  WideCharToMultiByte(CP_UTF8, 0, g_pick_path, -1, path_u, (int)sizeof(path_u), NULL, NULL);
  char esc[MAX_PATH * 4];
  json_escape(path_u, esc, sizeof(esc));
  char resp[MAX_PATH * 4 + 80];
  int rlen = _snprintf(resp, sizeof(resp), "{\"ok\":true,\"exportFile\":\"%s\",\"bytes\":%d}", esc, wrote);
  if (rlen > 0 && rlen < (int)sizeof(resp))
    send_bytes(sock, "application/json; charset=utf-8", resp, rlen, 1);
  else
    send_status(sock, 500, "Error");
}

static void handle_pick_import(SOCKET sock) {
  if (!wait_pick(WM_PICK_IMPORT)) {
    const char *msg = "{\"ok\":false,\"cancelled\":true}";
    send_bytes(sock, "application/json; charset=utf-8", msg, (int)strlen(msg), 1);
    return;
  }
  prefs_set_path_key("importFile", g_pick_path);
  int len = 0;
  char *text = read_all_file_w(g_pick_path, &len);
  if (!text) {
    const char *msg = "{\"ok\":false,\"error\":\"read_failed\"}";
    send_bytes(sock, "application/json; charset=utf-8", msg, (int)strlen(msg), 1);
    return;
  }
  char path_u[MAX_PATH * 3];
  WideCharToMultiByte(CP_UTF8, 0, g_pick_path, -1, path_u, (int)sizeof(path_u), NULL, NULL);
  char esc[MAX_PATH * 4];
  json_escape(path_u, esc, sizeof(esc));
  /* Escape text as JSON string (may be large). */
  char *esc_text = (char *)malloc((size_t)len * 2 + 8);
  if (!esc_text) {
    free(text);
    send_status(sock, 500, "Error");
    return;
  }
  size_t w = 0;
  for (int i = 0; i < len; i++) {
    unsigned char c = (unsigned char)text[i];
    if (c == '"' || c == '\\') {
      esc_text[w++] = '\\';
      esc_text[w++] = (char)c;
    } else if (c == '\n') {
      esc_text[w++] = '\\';
      esc_text[w++] = 'n';
    } else if (c == '\r') {
      esc_text[w++] = '\\';
      esc_text[w++] = 'r';
    } else if (c == '\t') {
      esc_text[w++] = '\\';
      esc_text[w++] = 't';
    } else if (c < 0x20) {
      continue;
    } else {
      esc_text[w++] = (char)c;
    }
  }
  esc_text[w] = 0;
  free(text);
  size_t resp_cap = w + strlen(esc) + 64;
  char *resp = (char *)malloc(resp_cap);
  if (!resp) {
    free(esc_text);
    send_status(sock, 500, "Error");
    return;
  }
  int rlen = _snprintf(resp, resp_cap, "{\"ok\":true,\"importFile\":\"%s\",\"text\":\"%s\"}", esc, esc_text);
  free(esc_text);
  if (rlen > 0) send_bytes(sock, "application/json; charset=utf-8", resp, rlen, 1);
  else send_status(sock, 500, "Error");
  free(resp);
}

static int json_find_u64(const char *s, int n, const char *key, unsigned long long *out) {
  int m = (int)strlen(key);
  if (!s || n < m) return 0;
  for (int i = 0; i + m <= n; i++) {
    if (memcmp(s + i, key, (size_t)m) != 0) continue;
    int j = i + m;
    while (j < n && (s[j] == ' ' || s[j] == '\t')) j++;
    if (j >= n || s[j] < '0' || s[j] > '9') continue;
    unsigned long long v = 0;
    int any = 0;
    while (j < n && s[j] >= '0' && s[j] <= '9') {
      any = 1;
      v = v * 10ULL + (unsigned long long)(s[j] - '0');
      j++;
    }
    if (!any) continue;
    *out = v;
    return 1;
  }
  return 0;
}

static int file_has_progress(const wchar_t *path);

static void handle_progress_get(SOCKET sock, int head_only) {
  const wchar_t *path = g_progress_file;
  wchar_t prev[1100];
  _snwprintf(prev, 1100, L"%s.prev", g_progress_file);
  if (!file_has_progress(g_progress_file) && file_has_progress(prev)) {
    CopyFileW(prev, g_progress_file, FALSE);
    path = g_progress_file;
  }
  HANDLE file = CreateFileW(path, GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE,
                            NULL, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
  if (file == INVALID_HANDLE_VALUE) {
    send_status(sock, 404, "Not Found");
    return;
  }
  LARGE_INTEGER size;
  if (!GetFileSizeEx(file, &size) || size.QuadPart < 0 || size.QuadPart > PROGRESS_MAX) {
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
  else send_bytes(sock, "application/json; charset=utf-8", body, len, 1);
  free(body);
}

static int mem_has(const char *s, int n, const char *tok) {
  int m = (int)strlen(tok);
  if (n < m) return 0;
  for (int i = 0; i <= n - m; i++) {
    if (memcmp(s + i, tok, (size_t)m) == 0) return 1;
  }
  return 0;
}

static int json_num_positive(const char *s, int n, const char *key) {
  int m = (int)strlen(key);
  for (int i = 0; i + m < n; i++) {
    if (memcmp(s + i, key, (size_t)m) != 0) continue;
    int j = i + m;
    while (j < n && (s[j] == ' ' || s[j] == '\t')) j++;
    int val = 0;
    while (j < n && s[j] >= '0' && s[j] <= '9') {
      val = val * 10 + (s[j] - '0');
      if (val > 0) return 1;
      j++;
    }
  }
  return 0;
}

static int buffer_has_progress(const char *s, int n) {
  if (!s || n <= 0) return 0;
  if (mem_has(s, n, "\"seen\":true")) return 1;
  if (json_num_positive(s, n, "\"coins\":")) return 1;
  if (json_num_positive(s, n, "\"balls\":")) return 1;
  if (json_num_positive(s, n, "\"caught\":")) return 1;
  if (json_num_positive(s, n, "\"level\":")) return 1;
  if (json_num_positive(s, n, "\"evo\":")) return 1;
  if (json_num_positive(s, n, "\"upgrade\":")) return 1;
  if (json_num_positive(s, n, "\"legendUpgrade\":")) return 1;
  return 0;
}

static int file_has_progress(const wchar_t *path) {
  HANDLE file = CreateFileW(path, GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE,
                            NULL, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
  if (file == INVALID_HANDLE_VALUE) return 0;
  LARGE_INTEGER size;
  if (!GetFileSizeEx(file, &size) || size.QuadPart <= 0 || size.QuadPart > PROGRESS_MAX) {
    CloseHandle(file);
    return 0;
  }
  int len = (int)size.QuadPart;
  char *buf = (char *)malloc((size_t)len);
  if (!buf) {
    CloseHandle(file);
    return 0;
  }
  int off = 0;
  while (off < len) {
    DWORD n = 0;
    if (!ReadFile(file, buf + off, (DWORD)(len - off), &n, NULL) || n == 0) break;
    off += (int)n;
  }
  CloseHandle(file);
  int has = off == len && buffer_has_progress(buf, len);
  free(buf);
  return has;
}

static void handle_progress_put(SOCKET sock, const char *body_start, int already, int need) {
  if (need < 0 || need > PROGRESS_MAX) {
    send_status(sock, 413, "Payload Too Large");
    return;
  }
  char *body = (char *)malloc(need > 0 ? (size_t)need : 1);
  if (!body) {
    send_status(sock, 500, "Error");
    return;
  }
  int got = 0;
  if (already > 0) {
    int take = already < need ? already : need;
    memcpy(body, body_start, (size_t)take);
    got = take;
  }
  while (got < need) {
    int n = recv(sock, body + got, need - got, 0);
    if (n <= 0) {
      free(body);
      send_status(sock, 400, "Bad Request");
      return;
    }
    got += n;
  }
  wchar_t tmp[1100];
  _snwprintf(tmp, 1100, L"%s.tmp", g_progress_file);
  HANDLE file = CreateFileW(tmp, GENERIC_WRITE, 0, NULL, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
  if (file == INVALID_HANDLE_VALUE) {
    free(body);
    send_status(sock, 500, "Error");
    return;
  }
  DWORD wrote = 0;
  BOOL ok = WriteFile(file, body, (DWORD)need, &wrote, NULL);
  CloseHandle(file);
  if (!ok || wrote != (DWORD)need) {
    free(body);
    DeleteFileW(tmp);
    send_status(sock, 500, "Error");
    return;
  }
  /* Blank Edge profile (another localhost port) must not erase a real save. */
  if (file_has_progress(g_progress_file) && !buffer_has_progress(body, need)) {
    free(body);
    DeleteFileW(tmp);
    send_status(sock, 409, "Conflict");
    return;
  }
  /* Two open pages each PUT a full snapshot. The one that loaded an older
     updatedAt must not replace the save the other page already wrote. */
  {
    unsigned long long base = 0;
    if (json_find_u64(body, need, "\"baseUpdatedAt\":", &base)) {
      int dlen = 0;
      char *disk = read_all_file_w(g_progress_file, &dlen);
      unsigned long long cur = 0;
      int stale = disk && json_find_u64(disk, dlen, "\"updatedAt\":", &cur) && cur != 0 && base != cur;
      free(disk);
      if (stale) {
        free(body);
        DeleteFileW(tmp);
        send_status(sock, 409, "Conflict");
        return;
      }
    }
  }
  free(body);
  if (file_has_progress(g_progress_file)) {
    wchar_t prev[1100];
    _snwprintf(prev, 1100, L"%s.prev", g_progress_file);
    CopyFileW(g_progress_file, prev, FALSE);
  }
  if (!MoveFileExW(tmp, g_progress_file, MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)) {
    DeleteFileW(tmp);
    send_status(sock, 500, "Error");
    return;
  }
  send_status(sock, 204, "No Content");
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
  char *hdr_end = strstr(req, "\r\n\r\n");
  if (!hdr_end) return;
  int header_bytes = (int)(hdr_end - req) + 4;
  int is_put = strncmp(req, "PUT ", 4) == 0;
  int is_post = strncmp(req, "POST ", 5) == 0;
  int is_get = strncmp(req, "GET ", 4) == 0;
  int is_head = strncmp(req, "HEAD ", 5) == 0;
  if (!is_put && !is_post && !is_get && !is_head) {
    send_status(sock, 405, "Method Not Allowed");
    return;
  }
  int head_only = is_head;
  char *path = req + (is_put ? 4 : (is_post ? 5 : (head_only ? 5 : 4)));
  char *end = strchr(path, ' ');
  if (!end) {
    send_status(sock, 400, "Bad Request");
    return;
  }
  *end = 0;
  char *query = NULL;
  char *q = strchr(path, '?');
  if (q) {
    *q = 0;
    query = q + 1;
  }
  if (!url_decode(path) || unsafe_path(path)) {
    send_status(sock, 400, "Bad Request");
    return;
  }
  if (is_post && strcmp(path, "/data/pick-export") == 0) {
    char *body = NULL;
    int body_len = 0;
    int rc = read_request_body(sock, req, req + header_bytes, got - header_bytes, &body, &body_len);
    if (rc != 1) {
      free(body);
      send_status(sock, rc < 0 ? 413 : 400, rc < 0 ? "Payload Too Large" : "Bad Request");
      return;
    }
    handle_pick_export(sock, body, body_len);
    return;
  }
  if (is_post) {
    int content_len = 0;
    header_content_length(req, &content_len);
    if (content_len > 0) {
      char *discard = NULL;
      if (!read_put_body(sock, req + header_bytes, got - header_bytes, content_len, &discard)) {
        send_status(sock, 400, "Bad Request");
        return;
      }
      free(discard);
    }
    if (strcmp(path, "/data/pick-import") == 0) {
      handle_pick_import(sock);
      return;
    }
    send_status(sock, 405, "Method Not Allowed");
    return;
  }
  if (is_put && strcmp(path, "/data/backup-save") == 0) {
    char *body = NULL;
    int body_len = 0;
    int rc = read_request_body(sock, req, req + header_bytes, got - header_bytes, &body, &body_len);
    if (rc != 1) {
      free(body);
      send_status(sock, rc < 0 ? 413 : 400, rc < 0 ? "Payload Too Large" : "Bad Request");
      return;
    }
    handle_backup_put(sock, body, body_len, query);
    return;
  }
  if (is_put) {
    int content_len = 0;
    if (!header_content_length(req, &content_len)) {
      send_status(sock, 400, "Bad Request");
      return;
    }
    if (strcmp(path, "/data/progress.json") == 0) {
      handle_progress_put(sock, req + header_bytes, got - header_bytes, content_len);
      return;
    }
    if (strcmp(path, "/data/save_prefs.json") == 0) {
      handle_prefs_put(sock, req + header_bytes, got - header_bytes, content_len);
      return;
    }
    send_status(sock, 405, "Method Not Allowed");
    return;
  }
  if (strcmp(path, "/data/key_presses.json") == 0) {
    g_last_page_sync = GetTickCount64();
    char body[64];
    EnterCriticalSection(&g_lock);
    int len = _snprintf(body, sizeof(body), "{\"presses\":%d}", g_presses);
    LeaveCriticalSection(&g_lock);
    if (head_only) send_status(sock, 200, "OK");
    else if (len > 0) send_bytes(sock, "application/json; charset=utf-8", body, len, 1);
    return;
  }
  if (strcmp(path, "/data/progress.json") == 0) {
    handle_progress_get(sock, head_only);
    return;
  }
  if (strcmp(path, "/data/save_prefs.json") == 0) {
    handle_prefs_get(sock, head_only);
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
  else {
    int nostore = 0;
    const wchar_t *dot = wcsrchr(full, L'.');
    if (dot && (!_wcsicmp(dot, L".html") || !_wcsicmp(dot, L".htm") || !_wcsicmp(dot, L".js") ||
                !_wcsicmp(dot, L".css") || !_wcsicmp(dot, L".json")))
      nostore = 1;
    send_bytes(sock, content_type(full), body, len, nostore);
  }
  free(body);
}

static DWORD WINAPI server_thread(LPVOID unused) {
  (void)unused;
  while (!g_stop) {
    SOCKET client = accept(g_listen, NULL, NULL);
    if (client == INVALID_SOCKET) break;
    /* Long enough for the save dialog; 8s used to be only a socket op timeout,
       but a short window made a slow body look finished. */
    DWORD timeout = 180000;
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

static int open_window(void) {
  wchar_t edge[MAX_PATH];
  wchar_t url[256];
  _snwprintf(url, 256, L"http://127.0.0.1:%d/pokedex/?v=83", g_port);
  if (find_edge(edge, MAX_PATH)) {
    wchar_t cmd[2048];
    /* App window only: --app=URL (no --new-window — that opens a normal browser).
       URL has no spaces; leave --app= unquoted. CreateProcessW(NULL, cmd). */
    _snwprintf(cmd, 2048,
               L"\"%s\" --app=%s --no-first-run --disable-features=msEdgeSidebar "
               L"--user-data-dir=\"%s\"",
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
      return 1;
    }
  }
  return (INT_PTR)ShellExecuteW(NULL, L"open", url, NULL, NULL, SW_SHOWNORMAL) > 32;
}

static int is_pokedex_edge_window(HWND hwnd) {
  if (hwnd == g_hwnd || hwnd == g_raw_hwnd) return 0;
  if (!IsWindowVisible(hwnd)) return 0;
  /* Folder windows are often titled "宝可梦图鉴" when that folder is open in
     Explorer — must not treat them as the Edge app, or we never relaunch. */
  wchar_t cls[256];
  if (GetClassNameW(hwnd, cls, 256) <= 0) return 0;
  if (!_wcsicmp(cls, L"CabinetWClass") || !_wcsicmp(cls, L"ExploreWClass")) return 0;
  if (!wcsstr(cls, L"Chrome_WidgetWin")) return 0;
  wchar_t title[256];
  if (GetWindowTextW(hwnd, title, 256) <= 0) return 0;
  if (!wcsstr(title, L"\u5b9d\u53ef\u68a6\u56fe\u9274")) return 0;
  return 1;
}

static BOOL CALLBACK focus_app_window(HWND hwnd, LPARAM param) {
  int *found = (int *)param;
  if (!is_pokedex_edge_window(hwnd)) return TRUE;
  ShowWindow(hwnd, SW_RESTORE);
  SetForegroundWindow(hwnd);
  *found = 1;
  return FALSE;
}

static BOOL CALLBACK find_app_window(HWND hwnd, LPARAM param) {
  int *found = (int *)param;
  if (!is_pokedex_edge_window(hwnd)) return TRUE;
  *found = 1;
  return FALSE;
}

static int app_window_exists(void) {
  int found = 0;
  EnumWindows(find_app_window, (LPARAM)&found);
  return found;
}

static void open_or_show_window(void) {
  int found = 0;
  EnumWindows(focus_app_window, (LPARAM)&found);
  if (found) {
    InterlockedExchange(&g_edge_opening, 0);
    return;
  }
  ULONGLONG now = GetTickCount64();
  if (InterlockedCompareExchange(&g_edge_opening, 1, 0) != 0) {
    if (now - g_edge_open_tick < 8000) return;
  }
  g_edge_open_tick = now;
  InterlockedExchange(&g_edge_opening, 1);
  if (!open_window()) InterlockedExchange(&g_edge_opening, 0);
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

/* Mark keyboard / mouse-button down for the current 10s window (debounce for poll). */
static void note_key_down(DWORD vk) {
  if (vk == 0 || vk > 255 || vk == 0xFF) return;
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

static void note_activity(void) {
  InterlockedExchange(&g_keyed_window, 1);
}

/* GetAsyncKeyState on a dedicated thread (not WM_TIMER). LL hooks fail with Genshin;
   message-only HWND + timer also stalls under exclusive fullscreen. Keyboard and mouse
   button down-edges mark the current 10s window; wheel uses Raw Input (WM_INPUT).
   Cursor movement is ignored. settle_key_window grants +10 if any activity fired. */
static void poll_key_presses(void) {
  if (!g_keys_primed) {
    for (int vk = 1; vk < 256; vk++) {
      g_key_down[vk] = (BYTE)((GetAsyncKeyState(vk) & 0x8000) ? 1 : 0);
    }
    g_keys_primed = 1;
    return;
  }
  for (int vk = 1; vk < 256; vk++) {
    int down = (GetAsyncKeyState(vk) & 0x8000) != 0;
    int was = g_key_down[vk];
    g_key_down[vk] = (BYTE)(down ? 1 : 0);
    if (!down || was) continue;
    note_key_down((DWORD)vk);
  }
}

#ifndef HID_USAGE_PAGE_GENERIC
#define HID_USAGE_PAGE_GENERIC 0x01
#endif
#ifndef HID_USAGE_GENERIC_MOUSE
#define HID_USAGE_GENERIC_MOUSE 0x02
#endif
#ifndef HID_USAGE_GENERIC_KEYBOARD
#define HID_USAGE_GENERIC_KEYBOARD 0x06
#endif

static void register_mouse_raw_input(HWND hwnd) {
  /* INPUTSINK: still delivered after the Edge window is closed and only the tray remains. */
  RAWINPUTDEVICE rid[2];
  ZeroMemory(rid, sizeof(rid));
  rid[0].usUsagePage = HID_USAGE_PAGE_GENERIC;
  rid[0].usUsage = HID_USAGE_GENERIC_MOUSE;
  rid[0].dwFlags = RIDEV_INPUTSINK;
  rid[0].hwndTarget = hwnd;
  rid[1].usUsagePage = HID_USAGE_PAGE_GENERIC;
  rid[1].usUsage = HID_USAGE_GENERIC_KEYBOARD;
  rid[1].dwFlags = RIDEV_INPUTSINK;
  rid[1].hwndTarget = hwnd;
  RegisterRawInputDevices(rid, 2, sizeof(rid[0]));
}

static void handle_raw_mouse(HRAWINPUT hraw) {
  UINT size = 0;
  if (GetRawInputData(hraw, RID_INPUT, NULL, &size, sizeof(RAWINPUTHEADER)) == (UINT)-1 || size == 0)
    return;
  RAWINPUT *raw = (RAWINPUT *)malloc(size);
  if (!raw) return;
  if (GetRawInputData(hraw, RID_INPUT, raw, &size, sizeof(RAWINPUTHEADER)) == size) {
    if (raw->header.dwType == RIM_TYPEMOUSE) {
      USHORT flags = raw->data.mouse.usButtonFlags;
      /* Buttons + wheel. Movement is ignored. */
      if (flags & (RI_MOUSE_LEFT_BUTTON_DOWN | RI_MOUSE_RIGHT_BUTTON_DOWN | RI_MOUSE_MIDDLE_BUTTON_DOWN |
                   RI_MOUSE_BUTTON_4_DOWN | RI_MOUSE_BUTTON_5_DOWN | RI_MOUSE_WHEEL | RI_MOUSE_HWHEEL))
        note_activity();
    } else if (raw->header.dwType == RIM_TYPEKEYBOARD) {
      if ((raw->data.keyboard.Flags & RI_KEY_BREAK) == 0) note_key_down(raw->data.keyboard.VKey);
    }
  }
  free(raw);
}

static DWORD WINAPI key_poll_thread(LPVOID unused) {
  (void)unused;
  while (!g_stop) {
    poll_key_presses();
    Sleep(10);
  }
  return 0;
}

static int json_read_int_after(const char *s, const char *key, int *out) {
  const char *p = strstr(s, key);
  if (!p) return 0;
  p += strlen(key);
  while (*p == ' ' || *p == '\t') p++;
  int neg = 0;
  if (*p == '-') {
    neg = 1;
    p++;
  }
  if (*p < '0' || *p > '9') return 0;
  long v = 0;
  while (*p >= '0' && *p <= '9') {
    v = v * 10 + (*p - '0');
    if (v > 2000000000L) break;
    p++;
  }
  *out = neg ? (int)-v : (int)v;
  return 1;
}

static int json_replace_int(char **buf, int *len, const char *key, int value) {
  char *s = *buf;
  char *p = strstr(s, key);
  if (!p) return 0;
  p += strlen(key);
  while (*p == ' ' || *p == '\t') p++;
  char *start = p;
  if (*p == '-') p++;
  if (*p < '0' || *p > '9') return 0;
  while (*p >= '0' && *p <= '9') p++;
  char num[32];
  int nlen = _snprintf(num, sizeof(num), "%d", value);
  if (nlen <= 0) return 0;
  int oldlen = (int)(p - start);
  int newlen = *len + nlen - oldlen;
  if (newlen < 0 || newlen > PROGRESS_MAX) return 0;
  char *out = (char *)malloc((size_t)newlen + 1);
  if (!out) return 0;
  int head = (int)(start - s);
  memcpy(out, s, (size_t)head);
  memcpy(out + head, num, (size_t)nlen);
  memcpy(out + head + nlen, p, (size_t)(*len - (int)(p - s)));
  out[newlen] = 0;
  free(*buf);
  *buf = out;
  *len = newlen;
  return 1;
}

static ULONGLONG unix_ms_now(void) {
  FILETIME ft;
  GetSystemTimeAsFileTime(&ft);
  ULARGE_INTEGER u;
  u.LowPart = ft.dwLowDateTime;
  u.HighPart = ft.dwHighDateTime;
  return u.QuadPart / 10000ULL - 11644473600000ULL;
}

static int progress_ball_multiplier(const char *json) {
  int mult_num = 1;
  int mult_den = 1;
  const char *buffs = strstr(json, "\"buffs\":");
  if (buffs) {
    const char *bend = strchr(buffs, '}');
    const char *b = bend ? strstr(buffs, "\"balls\":") : NULL;
    if (b && b < bend) {
      b += 8;
      while (*b == ' ' || *b == '\t') b++;
      unsigned long long until = 0;
      while (*b >= '0' && *b <= '9') {
        until = until * 10ULL + (unsigned long long)(*b - '0');
        b++;
      }
      if (until > unix_ms_now()) mult_num *= 2;
    }
  }
  const char *daily = strstr(json, "\"daily\":");
  if (daily) {
    daily += 8;
    while (*daily == ' ' || *daily == '\t') daily++;
    if (strncmp(daily, "null", 4) != 0) {
      SYSTEMTIME st;
      GetLocalTime(&st);
      char today[16];
      _snprintf(today, sizeof(today), "%04u-%02u-%02u", st.wYear, st.wMonth, st.wDay);
      char daykey[32];
      _snprintf(daykey, sizeof(daykey), "\"day\":\"%s\"", today);
      const char *end = strstr(daily, "}");
      if (end && strstr(daily, "\"kind\":\"balls\"") && strstr(daily, daykey) &&
          strstr(daily, "\"kind\":\"balls\"") < end && strstr(daily, daykey) < end) {
        mult_num *= 3;
        mult_den *= 2;
      }
    }
  }
  return mult_num * 1000 + mult_den;
}

/* Page is closed: turn new presses into balls inside progress.json (same rules as the page). */
static void credit_balls_offline(int presses) {
  ULONGLONG last = g_last_page_sync;
  if (last != 0 && GetTickCount64() - last < 4000) return;
  int len = 0;
  char *body = read_all_file_w(g_progress_file, &len);
  if (!body || len <= 0) {
    free(body);
    return;
  }
  int cursor = 0;
  int balls = 0;
  if (!json_read_int_after(body, "\"ballCursor\":", &cursor) || cursor <= 0) {
    free(body);
    return;
  }
  if (!json_read_int_after(body, "\"balls\":", &balls)) {
    free(body);
    return;
  }
  if (presses <= cursor) {
    free(body);
    return;
  }
  int gained = presses - cursor;
  int packed = progress_ball_multiplier(body);
  int mult_num = packed / 1000;
  int mult_den = packed % 1000;
  if (mult_den < 1) mult_den = 1;
  gained = (int)(((long long)gained * mult_num) / mult_den);
  long long next = (long long)balls + gained;
  if (next > 2000000000LL) next = 2000000000LL;
  if (!json_replace_int(&body, &len, "\"balls\":", (int)next)) {
    free(body);
    return;
  }
  if (!json_replace_int(&body, &len, "\"ballCursor\":", presses)) {
    free(body);
    return;
  }
  write_all_file_w(g_progress_file, body, len);
  free(body);
}

static void settle_key_window(void) {
  if (InterlockedExchange(&g_keyed_window, 0) == 0) return;
  int presses;
  EnterCriticalSection(&g_lock);
  g_presses += 10;
  presses = g_presses;
  LeaveCriticalSection(&g_lock);
  InterlockedExchange(&g_press_dirty, 1);
  credit_balls_offline(presses);
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

static LRESULT CALLBACK raw_wnd_proc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam) {
  if (msg == WM_INPUT) {
    handle_raw_mouse((HRAWINPUT)lParam);
    return 0;
  }
  return DefWindowProcW(hwnd, msg, wParam, lParam);
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
  if (msg == WM_PICK_EXPORT) {
    do_pick_export();
    return 0;
  }
  if (msg == WM_PICK_IMPORT) {
    do_pick_import();
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
      if (g_edge_opening && app_window_exists()) InterlockedExchange(&g_edge_opening, 0);
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
  g_pick_event = CreateEventW(NULL, TRUE, FALSE, NULL);
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
  /* Message-only host: tray + timers. Keyboard/mouse buttons via poll thread.
     Do NOT register Raw Input on HWND_MESSAGE (often fails / floods). */
  g_hwnd = CreateWindowExW(0, wc.lpszClassName, L"PokemonPokedexHost", 0,
                            0, 0, 0, 0, HWND_MESSAGE, NULL, instance, NULL);
  if (!g_hwnd) {
    show_error(L"\u65e0\u6cd5\u521b\u5efa\u4e3b\u7a97\u53e3\u3002");
    return 1;
  }

  /* Separate tiny top-level hwnd solely as Raw Input target for wheel (not move). */
  WNDCLASSW raw_wc;
  ZeroMemory(&raw_wc, sizeof(raw_wc));
  raw_wc.lpfnWndProc = raw_wnd_proc;
  raw_wc.hInstance = instance;
  raw_wc.lpszClassName = L"PokemonPokedexRawInput";
  RegisterClassW(&raw_wc);
  g_raw_hwnd = CreateWindowExW(
      WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE, raw_wc.lpszClassName, L"",
      WS_POPUP, 0, 0, 1, 1, NULL, NULL, instance, NULL);
  if (g_raw_hwnd) {
    ShowWindow(g_raw_hwnd, SW_HIDE);
    register_mouse_raw_input(g_raw_hwnd);
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
