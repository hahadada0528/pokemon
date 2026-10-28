#!/usr/bin/env python3
"""Serve the pokedex tree.

/data/key_presses.json — writable presses file (GET)
/data/progress.json — local authoritative save (GET/PUT)
/data/save_prefs.json — remembered export/import paths (GET/PUT)
/data/pick-export — POST body is the save; dialog, then write those bytes
/data/pick-import — POST: native open-file dialog, returns file JSON text
/data/backup-save — PUT: write non-empty body to exportFile (or ?path=)
"""

from __future__ import annotations

import argparse
import datetime
import json
import re
import socket
import subprocess
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit

PROGRESS_MAX = 8 * 1024 * 1024
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_FRAME_RANK = {"silver": 1, "gold": 2, "diamond": 3}
_RANK_FRAME = {1: "silver", 2: "gold", 3: "diamond"}
_BADGE_RANK = {"silver": 1, "gold": 2}
_RANK_BADGE = {1: "silver", 2: "gold"}


def _better_ash_day(a, b):
    def ok(value):
        return isinstance(value, str) and _DATE_RE.fullmatch(value) is not None

    today = datetime.date.today().isoformat()
    if a == today or b == today:
        return today
    if ok(a) and ok(b):
        return a if a > b else b
    if ok(a):
        return a
    if ok(b):
        return b
    return ""


def _merge_tier_map(left, right, ranks, names):
    left = left if isinstance(left, dict) else {}
    right = right if isinstance(right, dict) else {}
    out = {}
    for key in set(left) | set(right):
        best = max(ranks.get(left.get(key), 0), ranks.get(right.get(key), 0))
        name = names.get(best)
        if name:
            out[str(key)] = name
    return out


def _merge_region_tiers(left, right):
    left = left if isinstance(left, dict) else {}
    right = right if isinstance(right, dict) else {}
    out = {}
    for region in set(left) | set(right):
        row = _merge_tier_map(left.get(region), right.get(region), _BADGE_RANK, _RANK_BADGE)
        if row:
            out[str(region)] = row
    return out


def _merge_cleared(left, right):
    left = left if isinstance(left, dict) else {}
    right = right if isinstance(right, dict) else {}
    out = {}
    for region in set(left) | set(right):
        a = left.get(region) if isinstance(left.get(region), dict) else {}
        b = right.get(region) if isinstance(right.get(region), dict) else {}
        flags = {
            "normal": bool(a.get("normal") or b.get("normal")),
            "advanced": bool(a.get("advanced") or b.get("advanced")),
        }
        if flags["normal"] or flags["advanced"]:
            out[str(region)] = flags
    return out


def merge_league(disk, incoming):
    """A later save must not clear today's Ash win or downgrade a frame."""
    disk = disk if isinstance(disk, dict) else {}
    incoming = incoming if isinstance(incoming, dict) else {}
    return {
        "badges": _merge_region_tiers(disk.get("badges"), incoming.get("badges")),
        "frames": _merge_tier_map(disk.get("frames"), incoming.get("frames"), _FRAME_RANK, _RANK_FRAME),
        "cleared": _merge_cleared(disk.get("cleared"), incoming.get("cleared")),
        "people": _merge_region_tiers(disk.get("people"), incoming.get("people")),
        "ashDay": _better_ash_day(disk.get("ashDay"), incoming.get("ashDay")),
    }


def _as_escape(s: str) -> str:
    return s.replace("\\", "\\\\").replace('"', '\\"')


def pick_export_path(last_path: str | None = None) -> str | None:
    """macOS: always show save dialog; prefill last path as default. Returns POSIX path or None."""
    if sys.platform != "darwin":
        return None
    default_name = "pokedex-save.json"
    default_dir = ""
    if last_path:
        p = Path(last_path)
        if p.name:
            default_name = p.name
        parent = p.parent
        if parent.as_posix() not in ("", "."):
            default_dir = str(parent)
    name_e = _as_escape(default_name)
    if default_dir:
        dir_e = _as_escape(default_dir)
        script = f'''
try
  set defaultLoc to POSIX file "{dir_e}"
  set theFile to choose file name with prompt "导出图鉴存档（可改位置，确认后写入）" default name "{name_e}" default location defaultLoc
  return POSIX path of theFile
on error
  return ""
end try
'''
    else:
        script = f'''
try
  set theFile to choose file name with prompt "导出图鉴存档（可改位置，确认后写入）" default name "{name_e}"
  return POSIX path of theFile
on error
  return ""
end try
'''
    try:
        out = subprocess.check_output(["osascript", "-e", script], text=True).strip()
    except (subprocess.CalledProcessError, OSError):
        return None
    return out or None


def pick_import_path(last_path: str | None = None) -> str | None:
    """macOS: always show open dialog; start near last import if known."""
    if sys.platform != "darwin":
        return None
    default_dir = ""
    if last_path:
        parent = Path(last_path).parent
        if parent.as_posix() not in ("", "."):
            default_dir = str(parent)
    if default_dir:
        dir_e = _as_escape(default_dir)
        script = f'''
try
  set defaultLoc to POSIX file "{dir_e}"
  set theFile to choose file with prompt "导入图鉴存档（确认后读取）" of type {{"public.json", "json", "txt"}} default location defaultLoc
  return POSIX path of theFile
on error
  return ""
end try
'''
    else:
        script = '''
try
  set theFile to choose file with prompt "导入图鉴存档（确认后读取）" of type {"public.json", "json", "txt"}
  return POSIX path of theFile
on error
  return ""
end try
'''
    try:
        out = subprocess.check_output(["osascript", "-e", script], text=True).strip()
    except (subprocess.CalledProcessError, OSError):
        return None
    return out or None


class Handler(SimpleHTTPRequestHandler):
    presses_path = ""
    progress_path = ""
    prefs_path = ""

    def end_headers(self):
        path = urlsplit(self.path).path.rstrip("/") or "/"
        if path.endswith((".json", ".js", ".html", ".css")) or path.endswith("/pokedex") or path == "/":
            self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()

    def _read_chunked(self) -> bytes | None:
        chunks = bytearray()
        while True:
            line = self.rfile.readline(64 * 1024)
            if not line:
                self.send_error(400, "Bad Chunk")
                return None
            piece = line.split(b";", 1)[0].strip()
            if not piece:
                continue
            try:
                size = int(piece, 16)
            except ValueError:
                self.send_error(400, "Bad Chunk")
                return None
            if size < 0 or len(chunks) + size > PROGRESS_MAX:
                self.send_error(413, "Payload Too Large")
                return None
            if size == 0:
                while True:
                    trailer = self.rfile.readline(64 * 1024)
                    if trailer in (b"\r\n", b"\n", b""):
                        break
                return bytes(chunks)
            data = self.rfile.read(size)
            if len(data) != size:
                self.send_error(400, "Bad Chunk")
                return None
            delim = self.rfile.read(2)
            if delim not in (b"\r\n", b"\n"):
                self.send_error(400, "Bad Chunk")
                return None
            chunks += data

    def _read_until_quiet(self) -> bytes | None:
        """Body arrived without Content-Length (still in the socket buffer)."""
        sock = self.connection
        prev = sock.gettimeout()
        sock.settimeout(0.2)
        chunks = []
        total = 0
        try:
            while total <= PROGRESS_MAX:
                try:
                    part = self.rfile.read1(65536)
                except (socket.timeout, TimeoutError, BlockingIOError):
                    break
                if not part:
                    break
                total += len(part)
                if total > PROGRESS_MAX:
                    self.send_error(413, "Payload Too Large")
                    return None
                chunks.append(part)
        finally:
            sock.settimeout(prev)
        return b"".join(chunks)

    def _read_body(self) -> bytes | None:
        """Read the request body. Missing length must not look like an empty body
        when bytes are already buffered — that used to create a 0-byte export."""
        if "chunked" in (self.headers.get("Transfer-Encoding") or "").lower():
            return self._read_chunked()
        raw_len = self.headers.get("Content-Length")
        if raw_len is None:
            return self._read_until_quiet()
        try:
            length = int(raw_len)
        except ValueError:
            self.send_error(400, "Bad Content-Length")
            return None
        if length < 0 or length > PROGRESS_MAX:
            self.send_error(413, "Payload Too Large")
            return None
        if length == 0:
            return b""
        data = self.rfile.read(length)
        if len(data) != length:
            self.send_error(400, "Truncated Body")
            return None
        return data

    def _write_export(self, dest: Path, body: bytes) -> None:
        if not body:
            raise ValueError("empty export")
        dest.parent.mkdir(parents=True, exist_ok=True)
        tmp = dest.with_suffix(dest.suffix + ".tmp")
        tmp.write_bytes(body)
        tmp.replace(dest)

    def _send_json(self, code: int, obj: dict):
        data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def _send_bytes(self, code: int, data: bytes, content_type: str):
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def _load_prefs(self) -> dict:
        try:
            return json.loads(Path(self.prefs_path).read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return {}

    def _save_prefs(self, prefs: dict) -> None:
        dest = Path(self.prefs_path)
        dest.parent.mkdir(parents=True, exist_ok=True)
        tmp = dest.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(prefs, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        tmp.replace(dest)

    def do_GET(self):
        path = urlsplit(self.path).path
        if path == "/data/key_presses.json":
            self.serve_presses()
            return
        if path == "/data/progress.json":
            self.serve_progress_get()
            return
        if path == "/data/save_prefs.json":
            self._send_json(200, self._load_prefs())
            return
        super().do_GET()

    def do_PUT(self):
        path = urlsplit(self.path).path
        if path == "/data/progress.json":
            self.serve_progress_put()
            return
        if path == "/data/save_prefs.json":
            body = self._read_body()
            if body is None:
                return
            try:
                prefs = json.loads(body.decode("utf-8"))
                if not isinstance(prefs, dict):
                    raise ValueError("prefs must be object")
            except (UnicodeDecodeError, json.JSONDecodeError, ValueError):
                self.send_error(400, "Bad JSON")
                return
            try:
                self._save_prefs(prefs)
            except OSError:
                self.send_error(500, "Write Failed")
                return
            self.send_response(204)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        if path == "/data/backup-save":
            self.serve_backup_put()
            return
        self.send_error(405, "Method Not Allowed")

    def do_POST(self):
        path = urlsplit(self.path).path
        body = self._read_body()
        if body is None:
            return
        if path == "/data/pick-export":
            # Dialog runs only after the snapshot is in memory, then that same
            # buffer is written. A 0-byte placeholder from the save panel is
            # replaced before we respond. An empty body never creates a file.
            if not body:
                self._send_json(400, {"ok": False, "error": "empty"})
                return
            prefs = self._load_prefs()
            last = prefs.get("exportFile") if isinstance(prefs.get("exportFile"), str) else None
            chosen = pick_export_path(last)
            if not chosen:
                self._send_json(200, {"ok": False, "cancelled": True})
                return
            try:
                dest = Path(chosen)
                self._write_export(dest, body)
                prefs["exportFile"] = str(dest)
                self._save_prefs(prefs)
            except (OSError, ValueError):
                self.send_error(500, "Write Failed")
                return
            self._send_json(200, {"ok": True, "exportFile": str(dest), "bytes": len(body)})
            return
        if path == "/data/pick-import":
            prefs = self._load_prefs()
            last = prefs.get("importFile") if isinstance(prefs.get("importFile"), str) else None
            chosen = pick_import_path(last)
            if not chosen:
                self._send_json(200, {"ok": False, "cancelled": True})
                return
            try:
                text = Path(chosen).read_text(encoding="utf-8")
            except OSError:
                self._send_json(200, {"ok": False, "error": "read_failed"})
                return
            prefs["importFile"] = chosen
            try:
                self._save_prefs(prefs)
            except OSError:
                pass
            self._send_json(200, {"ok": True, "importFile": chosen, "text": text})
            return
        self.send_error(405, "Method Not Allowed")

    def serve_presses(self):
        try:
            with open(self.presses_path, "rb") as handle:
                data = handle.read()
        except OSError:
            data = b'{"presses":0}'
        self._send_bytes(200, data, "application/json; charset=utf-8")

    def serve_progress_get(self):
        try:
            with open(self.progress_path, "rb") as handle:
                data = handle.read()
        except OSError:
            self.send_response(404)
            self.send_header("Content-Length", "0")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            return
        self._send_bytes(200, data, "application/json; charset=utf-8")

    def _body_has_progress(self, body: bytes) -> bool:
        text = body.decode("utf-8", errors="ignore")
        if '"seen":true' in text or '"seen": true' in text:
            return True
        for key in ('"coins":', '"balls":', '"caught":', '"level":', '"evo":', '"upgrade":', '"legendUpgrade":'):
            start = 0
            while True:
                i = text.find(key, start)
                if i < 0:
                    break
                j = i + len(key)
                while j < len(text) and text[j] in " \t":
                    j += 1
                n = 0
                any_digit = False
                while j < len(text) and text[j].isdigit():
                    any_digit = True
                    n = n * 10 + (ord(text[j]) - 48)
                    if n > 0:
                        return True
                    j += 1
                if any_digit and n > 0:
                    return True
                start = i + len(key)
        return False

    def _json_u64(self, text: str, key: str):
        i = text.find(key)
        if i < 0:
            return None
        j = i + len(key)
        while j < len(text) and text[j] in " \t":
            j += 1
        if j >= len(text) or not text[j].isdigit():
            return None
        n = 0
        while j < len(text) and text[j].isdigit():
            n = n * 10 + (ord(text[j]) - 48)
            j += 1
        return n

    def _merge_incoming_progress(self, dest: Path, body: bytes) -> bytes:
        try:
            incoming = json.loads(body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return body
        if not isinstance(incoming, dict):
            return body
        replace = bool(incoming.pop("replaceProgress", False))
        if not replace and dest.exists():
            try:
                disk = json.loads(dest.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                disk = None
            if isinstance(disk, dict):
                incoming["league"] = merge_league(disk.get("league"), incoming.get("league"))
        return json.dumps(incoming, ensure_ascii=False, separators=(",", ":")).encode("utf-8")

    def serve_progress_put(self):
        body = self._read_body()
        if body is None:
            return
        try:
            dest = Path(self.progress_path)
            if dest.exists() and self._body_has_progress(dest.read_bytes()) and not self._body_has_progress(body):
                self.send_error(409, "Conflict")
                return
            incoming = body.decode("utf-8", errors="ignore")
            base = self._json_u64(incoming, '"baseUpdatedAt":')
            if base is not None and dest.exists():
                disk_text = dest.read_text(encoding="utf-8", errors="ignore")
                current = self._json_u64(disk_text, '"updatedAt":')
                if current and base != current:
                    self.send_error(409, "Conflict")
                    return
            if dest.exists() and self._body_has_progress(dest.read_bytes()):
                prev = dest.with_name(dest.name + ".prev")
                prev.write_bytes(dest.read_bytes())
        except OSError:
            self.send_error(500, "Write Failed")
            return
        try:
            dest = Path(self.progress_path)
            dest.parent.mkdir(parents=True, exist_ok=True)
            body = self._merge_incoming_progress(dest, body)
            tmp = dest.with_suffix(".json.tmp")
            tmp.write_bytes(body)
            tmp.replace(dest)
        except OSError:
            self.send_error(500, "Write Failed")
            return
        self.send_response(204)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def serve_backup_put(self):
        body = self._read_body()
        if body is None:
            return
        if not body:
            # Do not replace the chosen file with a 0-byte write.
            self._send_json(400, {"ok": False, "error": "empty"})
            return
        qs = parse_qs(urlsplit(self.path).query)
        path_q = (qs.get("path") or [None])[0]
        dest_s = unquote(path_q) if path_q else self._load_prefs().get("exportFile")
        if not dest_s or not isinstance(dest_s, str):
            self._send_json(400, {"ok": False, "error": "no_export_path"})
            return
        try:
            dest = Path(dest_s)
            self._write_export(dest, body)
            prefs = self._load_prefs()
            prefs["exportFile"] = str(dest)
            self._save_prefs(prefs)
        except (OSError, ValueError):
            self.send_error(500, "Write Failed")
            return
        self._send_json(200, {"ok": True, "exportFile": str(dest), "bytes": len(body)})

    def log_message(self, fmt, *args):
        return


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True)
    parser.add_argument("--presses", required=True)
    parser.add_argument("--progress", required=True)
    parser.add_argument("--prefs", default="")
    parser.add_argument("--port", type=int, default=8080)
    args = parser.parse_args()
    Handler.presses_path = args.presses
    Handler.progress_path = args.progress
    Handler.prefs_path = args.prefs or str(Path(args.progress).with_name("save_prefs.json"))
    handler = partial(Handler, directory=args.root)
    server = ThreadingHTTPServer(("127.0.0.1", args.port), handler)
    server.serve_forever()


if __name__ == "__main__":
    main()
