#!/usr/bin/env bash
# 启动并等待 PostgreSQL 就绪（与 dev.sh 相同逻辑）
set -e

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PIDS=()

# shellcheck source=scripts/dev-common.sh
source "$ROOT_DIR/scripts/dev-common.sh"
dev_common_init_paths

start_infrastructure
wait_for_database

echo -e "${GREEN}✅ 数据库已就绪${NC}"
