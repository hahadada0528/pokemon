#!/bin/bash
ROOT="/Users/hhdd/pokemon"
cd "$ROOT" || exit 1
if ! /usr/sbin/lsof -nP -iTCP:8080 -sTCP:LISTEN >/dev/null 2>&1; then
  nohup /usr/bin/python3 -m http.server 8080 --bind 127.0.0.1 >/tmp/pokedex-server.log 2>&1 &
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    /usr/sbin/lsof -nP -iTCP:8080 -sTCP:LISTEN >/dev/null 2>&1 && break
    sleep 0.2
  done
fi
open "http://127.0.0.1:8080/pokedex/"
