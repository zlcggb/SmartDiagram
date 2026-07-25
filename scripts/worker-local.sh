#!/usr/bin/env bash
# 本地启动企业 worker（自动起 db/redis、加载根 .env）
#
# 用法:
#   bash scripts/worker-local.sh              # 跑一轮
#   bash scripts/worker-local.sh --loop       # 持续消费队列
#   bash scripts/worker-local.sh --queue exports --limit 5

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# shellcheck source=scripts/dev-common.sh
source "$ROOT_DIR/scripts/dev-common.sh"
dev_common_init_paths

start_infrastructure
wait_for_database

cd "$ROOT_DIR/apps/api-diagram"
exec bash "$ROOT_DIR/scripts/run-with-root-env.sh" \
  uv run python scripts/run_enterprise_workers.py "$@"
