#!/usr/bin/env bash
# 生产部署后验证 Redis + worker（配合 deploy.sh --with-worker）
#
# 用法:
#   bash scripts/verify-worker-deployment.sh
#   bash scripts/verify-worker-deployment.sh --api-port 9236

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

API_PORT="${SMARTDIAGRAM_API_PORT:-9236}"

while [ $# -gt 0 ]; do
  case "$1" in
    --api-port)
      API_PORT="${2:?缺少端口号}"
      shift 2
      ;;
    -h|--help)
      echo "用法: bash scripts/verify-worker-deployment.sh [--api-port 9236]"
      exit 0
      ;;
    *)
      echo "未知参数: $1" >&2
      exit 1
      ;;
  esac
done

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m'

ok()   { echo -e "${GREEN}✅ $1${NC}"; }
fail() { echo -e "${RED}❌ $1${NC}"; exit 1; }
info() { echo -e "${CYAN}ℹ  $1${NC}"; }

info "检查 Redis 容器..."
if ! docker compose exec -T redis redis-cli ping 2>/dev/null | grep -q PONG; then
  fail "Redis 未响应 PING（确认 db/redis 已启动）"
fi
ok "Redis PING 正常"

info "检查 worker 容器..."
worker_id="$(docker compose --profile worker ps -q worker 2>/dev/null || true)"
if [ -z "$worker_id" ]; then
  fail "未找到 worker 容器；请使用 ./deploy.sh --with-worker 部署"
fi
worker_state="$(docker inspect -f '{{.State.Status}}' "$worker_id" 2>/dev/null || echo unknown)"
if [ "$worker_state" != "running" ]; then
  fail "worker 容器状态为 ${worker_state}（期望 running）"
fi
ok "worker 容器运行中 (${worker_id:0:12})"

info "检查 API 健康与 Redis 依赖..."
health_json="$(curl -fsS --max-time 10 "http://127.0.0.1:${API_PORT}/api/health" 2>/dev/null)" \
  || fail "无法访问 http://127.0.0.1:${API_PORT}/api/health"

HEALTH_JSON="$health_json" python3 - <<'PY'
import json
import os
import sys

payload = json.loads(os.environ["HEALTH_JSON"])
if payload.get("status") != "ok":
    sys.exit(f"API health status 异常: {payload!r}")
redis_state = (payload.get("dependencies") or {}).get("redis")
if redis_state != "ok":
    sys.exit(f"API 报告 Redis 不可用: {redis_state!r}")
PY

ok "API /health 报告 Redis 依赖正常"

info "检查 worker 进程..."
if ! docker compose --profile worker exec -T worker python -c \
  "from pathlib import Path; command = Path('/proc/1/cmdline').read_bytes(); raise SystemExit(0 if b'run_enterprise_workers.py' in command else 1)" \
  >/dev/null 2>&1; then
  fail "worker 容器 PID 1 不是预期的 run_enterprise_workers.py 进程"
fi
ok "worker 主进程存在"

echo ""
ok "Worker 部署验证通过（Redis 队列 + 后台 worker 就绪）"
