#!/usr/bin/env python3
"""Serve the pokedex tree. /data/key_presses.json is read from a writable file."""

import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit


class Handler(SimpleHTTPRequestHandler):
    presses_path = ""

    def end_headers(self):
        path = urlsplit(self.path).path
        if path.endswith((".json", ".js", ".html", ".css")):
            self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()

    def do_GET(self):
        if urlsplit(self.path).path == "/data/key_presses.json":
            self.serve_presses()
            return
        super().do_GET()

    def serve_presses(self):
        try:
            with open(self.presses_path, "rb") as handle:
                data = handle.read()
        except OSError:
            data = b'{"presses":0}'
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, fmt, *args):
        return


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True)
    parser.add_argument("--presses", required=True)
    parser.add_argument("--port", type=int, default=8080)
    args = parser.parse_args()
    Handler.presses_path = args.presses
    handler = partial(Handler, directory=args.root)
    server = ThreadingHTTPServer(("127.0.0.1", args.port), handler)
    server.serve_forever()


if __name__ == "__main__":
    main()
