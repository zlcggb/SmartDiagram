#!/usr/bin/env bash
# SmartDiagram — 聚合网关模式一键启动（本地，无需构建 Docker 镜像）
#
# 启动内容：
#   聚合网关  http://localhost:8080
#     ├─ /         平台首页（统一 SPA，含顶部导航）
#     ├─ /diagram  图表模块（API 转发 → :8000）
#     └─ /ppt      PPT 制作模块（API 转发 → :4000）
#   SmartDiagram 后端  :8000（FastAPI，依赖 docker 里的 db/redis/drawio）
#   PPT Agent 后端     :4000（FastAPI+LangGraph）+ Node 渲染侧车 :4010
#
# 环境变量：仓库根 .env（Platform / Diagram / PPT）
# 用法: npm run dev:gateway（或 ./start-all.sh），Ctrl+C 停止全部

set -e

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
GATEWAY_PORT="${GATEWAY_PORT:-8080}"
PIDS=()

# shellcheck source=scripts/dev-common.sh
source "$ROOT_DIR/scripts/dev-common.sh"
dev_common_init_paths
setup_cleanup_trap

echo -e "${CYAN}╔══════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║   ◈ SmartDiagram  聚合工作台 (本地)       ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════╝${NC}"
echo ""

require_dev_tools
bootstrap_root_env

check_required_ports \
  "聚合网关:${GATEWAY_PORT}" \
  "SmartDiagram 后端:8000" \
  "PPT Agent 后端:4000" \
  "PPT Node 侧车:4010"

start_infrastructure
wait_for_database
prepare_local_stack
ensure_frontend_build

echo ""

start_diagram_api
start_ppt_renderer
start_ppt_api

echo -e "${GREEN}🚀 聚合网关           →  http://localhost:${GATEWAY_PORT}${NC}"
GATEWAY_PORT="$GATEWAY_PORT" node "$ROOT_DIR/gateway/dev-gateway.mjs" &
PIDS+=($!)

echo ""
echo -e "${CYAN}════════════════════════════════════════════${NC}"
echo -e "${CYAN}  打开 http://localhost:${GATEWAY_PORT}  选择模块开始使用${NC}"
echo -e "${CYAN}  环境：根 .env（Platform / Diagram / PPT）${NC}"
echo -e "${CYAN}  按 Ctrl+C 停止所有服务${NC}"
echo -e "${CYAN}════════════════════════════════════════════${NC}"
echo ""

wait "${PIDS[@]}"
