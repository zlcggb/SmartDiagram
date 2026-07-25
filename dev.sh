#!/bin/bash
# SmartDiagram — 统一平台开发模式一键启动
# 用法: npm run dev（或 ./dev.sh），Ctrl+C 一键停止全部
#
# 启动内容（前端 Vite 热更新，API 由 Vite proxy 分流）：
#   前端     http://localhost:5173      （/ 桌面 · /diagram 图表 · /ppt PPT 制作）
#     ├─ /api      → api-diagram         http://localhost:8000
#     └─ /ppt-api  → api-ppt             http://127.0.0.1:4000（+ Node 渲染侧车 :4010）
#
# 环境变量：仓库根 .env（Platform / Diagram / PPT 三分区统一管理）
# 基础设施（PostgreSQL / Redis / drawio）复用 Docker 命名卷和容器。

set -e

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
PIDS=()

# shellcheck source=scripts/dev-common.sh
source "$ROOT_DIR/scripts/dev-common.sh"
dev_common_init_paths
setup_cleanup_trap

echo -e "${CYAN}╔══════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║   ◈ SmartDiagram  统一平台 Dev Mode       ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════╝${NC}"
echo ""

require_dev_tools
bootstrap_root_env

check_required_ports \
  "统一前端:5173" \
  "SmartDiagram 后端:8000" \
  "PPT Agent 后端:4000" \
  "PPT Node 侧车:4010"

start_infrastructure
wait_for_database
prepare_local_stack

echo ""

start_diagram_api --reload
start_ppt_renderer
start_ppt_api --reload

echo -e "${GREEN}🚀 统一前端 (HMR)     →  http://localhost:5173${NC}"
(cd "$FRONTEND_DIR" && $PNPM dev) &
PIDS+=($!)

echo ""
echo -e "${CYAN}════════════════════════════════════════════${NC}"
echo -e "${CYAN}  打开 http://localhost:5173  进入平台桌面${NC}"
echo -e "${CYAN}  环境：根 .env（Platform / Diagram / PPT）${NC}"
echo -e "${CYAN}  按 Ctrl+C 停止所有服务${NC}"
echo -e "${CYAN}════════════════════════════════════════════${NC}"
echo ""

wait "${PIDS[@]}"
