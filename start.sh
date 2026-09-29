#!/bin/bash
# CityPulse (Laya Dispatch) - one-command launcher for macOS.
#   ./start.sh              -> http://localhost:8080
#   PORT=9000 ./start.sh
cd "$(dirname "$0")" || exit 1
PORT="${PORT:-8080}"

if [ ! -x .venv/bin/python ]; then
  echo "▶ Creating Python environment (.venv)…"
  python3 -m venv .venv || exit 1
  .venv/bin/python -m pip install -q --upgrade pip
fi
if ! .venv/bin/python -c "import laya" 2>/dev/null; then
  echo "▶ Installing Laya (pip install laya)…"
  .venv/bin/python -m pip install -q laya || exit 1
fi

(sleep 1.5 && open "http://localhost:$PORT") &
PORT="$PORT" USE_TF=0 exec .venv/bin/python server.py
