#!/bin/bash
# Start Kerf and open it in the browser:  ./run.sh [project_dir]
cd "$(dirname "$0")"
PORT=${PORT:-8790}
python3 serve.py "${1:-projects}" --port "$PORT" &
PID=$!
trap 'kill $PID 2>/dev/null' EXIT INT TERM
sleep 0.5
xdg-open "http://127.0.0.1:$PORT/" >/dev/null 2>&1 &
wait $PID
