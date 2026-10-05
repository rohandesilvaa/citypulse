#!/bin/bash
# CityPulse (Laya Dispatch) - one-command launcher for macOS.
#   ./start.sh              -> http://localhost:8080
#   PORT=9000 ./start.sh
#   PYTHON=python3.13 ./start.sh   (choose which Python creates .venv)
cd "$(dirname "$0")" || exit 1
PORT="${PORT:-8080}"

if [ ! -x .venv/bin/python ]; then
  # Pick the first Python >= 3.12 (3.13 is the tested version), unless PYTHON is set.
  if [ -z "$PYTHON" ]; then
    for p in python3.13 python3.12 python3 python3.14; do
      if command -v "$p" >/dev/null 2>&1 && "$p" -c 'import sys; sys.exit(sys.version_info < (3, 12))' 2>/dev/null; then
        PYTHON="$p"; break
      fi
    done
  fi
  if [ -z "$PYTHON" ] || ! "$PYTHON" -c 'import sys; sys.exit(sys.version_info < (3, 12))' 2>/dev/null; then
    echo "❌ Python 3.12+ is required (python3 is $(python3 --version 2>&1))."
    echo "   Install it with:  brew install python@3.13   and run ./start.sh again."
    exit 1
  fi
  echo "▶ Creating Python environment (.venv)…"
  "$PYTHON" -m venv .venv || exit 1
  .venv/bin/python -m pip install -q --upgrade pip
fi

# Install the locked versions; reinstall only when requirements.txt changes.
REQ_HASH="$(shasum requirements.txt | cut -d' ' -f1)"
if [ "$(cat .venv/.requirements.sha 2>/dev/null)" != "$REQ_HASH" ]; then
  echo "▶ Installing locked dependencies (requirements.txt)…"
  .venv/bin/python -m pip install -q -r requirements.txt || exit 1
  echo "$REQ_HASH" > .venv/.requirements.sha
fi

(sleep 1.5 && open "http://localhost:$PORT") &
PORT="$PORT" USE_TF=0 exec .venv/bin/python server.py
