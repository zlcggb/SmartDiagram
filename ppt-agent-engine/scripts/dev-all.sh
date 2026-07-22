#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PYTHON_PORT="${API_PORT:-4000}"
LEGACY_PORT="${LEGACY_API_PORT:-4010}"
WEB_DEV_PORT="${WEB_PORT:-5173}"

if command -v corepack >/dev/null 2>&1; then
  PNPM=(corepack pnpm)
else
  PNPM=(pnpm)
fi

pids=()
cleanup() {
  local pid
  for pid in "${pids[@]:-}"; do
    if kill -0 "$pid" >/dev/null 2>&1; then
      kill "$pid" >/dev/null 2>&1 || true
    fi
  done
  wait >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

echo "==> 启动 Node 兼容/渲染侧车 :${LEGACY_PORT}"
API_PORT="$LEGACY_PORT" "${PNPM[@]}" --filter @ppt-agent/api dev &
pids+=("$!")

echo "==> 启动 FastAPI + LangGraph :${PYTHON_PORT}"
LEGACY_API_URL="http://127.0.0.1:${LEGACY_PORT}" \
  uv run --project apps/api-python \
  uvicorn ppt_agent_api.main:app --reload --host 127.0.0.1 --port "$PYTHON_PORT" &
pids+=("$!")

echo "==> 启动 Web :${WEB_DEV_PORT}"
WEB_PORT="$WEB_DEV_PORT" "${PNPM[@]}" --filter @ppt-agent/web dev &
pids+=("$!")

while true; do
  for pid in "${pids[@]}"; do
    if ! kill -0 "$pid" >/dev/null 2>&1; then
      wait "$pid" || true
      echo "开发服务进程 ${pid} 已退出，正在停止其余进程"
      exit 1
    fi
  done
  sleep 2
done

