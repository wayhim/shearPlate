#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$ROOT_DIR/.runtime"
PID_FILE="$LOG_DIR/shearplate.pid"
APP_BUNDLE="$ROOT_DIR/release/mac-arm64/ShearPlate.app"
APP_EXECUTABLE="$APP_BUNDLE/Contents/MacOS/ShearPlate"

mkdir -p "$LOG_DIR"

kill_existing_instances() {
  local pids=()

  if [[ -f "$PID_FILE" ]]; then
    local pid
    pid="$(cat "$PID_FILE")"
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      pids+=("$pid")
    fi
  fi

  while IFS= read -r pid; do
    [[ -n "$pid" ]] && pids+=("$pid")
  done < <(pgrep -f "Electron.*$ROOT_DIR" || true)

  while IFS= read -r pid; do
    [[ -n "$pid" ]] && pids+=("$pid")
  done < <(pgrep -f "$APP_EXECUTABLE\$" || true)

  if [[ "${#pids[@]}" -eq 0 ]]; then
    return
  fi

  local unique_pids=()
  while IFS= read -r pid; do
    [[ -n "$pid" ]] && unique_pids+=("$pid")
  done < <(printf '%s\n' "${pids[@]}" | awk '!seen[$0]++')
  pids=("${unique_pids[@]}")

  kill "${pids[@]}" 2>/dev/null || true

  for _ in {1..20}; do
    local still_running=0
    for pid in "${pids[@]}"; do
      if kill -0 "$pid" 2>/dev/null; then
        still_running=1
        break
      fi
    done
    if [[ "$still_running" -eq 0 ]]; then
      break
    fi
    sleep 0.5
  done

  for pid in "${pids[@]}"; do
    if kill -0 "$pid" 2>/dev/null; then
      kill -9 "$pid" 2>/dev/null || true
    fi
  done
}

cd "$ROOT_DIR"

kill_existing_instances
rm -f "$PID_FILE"

npm run dist:mac:dir

if [[ ! -x "$APP_EXECUTABLE" ]]; then
  echo "App executable not found: $APP_EXECUTABLE" >&2
  exit 1
fi

open "$APP_BUNDLE"

APP_PID=""
for _ in {1..20}; do
  APP_PID="$(pgrep -f "$APP_EXECUTABLE\$" | head -n 1 || true)"
  if [[ -n "$APP_PID" ]]; then
    break
  fi
  sleep 0.5
done

if [[ -z "$APP_PID" ]]; then
  echo "ShearPlate failed to start." >&2
  exit 1
fi

echo "$APP_PID" > "$PID_FILE"
echo "ShearPlate restarted successfully (pid: $APP_PID)"
