#!/usr/bin/env bash
# DeepDiagram Pro — 统一平台一键启动（本地，无需构建 Docker 镜像）
#
# 启动内容：
#   聚合网关  http://localhost:8080
#     ├─ /         平台首页（统一 SPA，含顶部导航）
#     ├─ /diagram  思维导图模块（API 转发 → :8000）
#     └─ /ppt      PPT 制作模块（API 转发 → :4000）
#   SmartDiagram 后端  :8000（FastAPI，依赖 docker 里的 db/redis/drawio）
#   PPT Agent 后端     :4000（FastAPI+LangGraph）+ Node 渲染侧车 :4010
#
# 用法: ./start-all.sh    （Ctrl+C 停止全部）

set -e

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
PPT_DIR="$ROOT_DIR/ppt-agent-engine"
GATEWAY_PORT="${GATEWAY_PORT:-8080}"

GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

PIDS=()
cleanup() {
  echo ""
  echo -e "${YELLOW}⏹  正在停止所有服务...${NC}"
  # 后台子进程会忽略 SIGINT，且存在 npm/uvicorn 派生的孙进程；脚本与所有服务
  # 在同一进程组，kill 0 对整个进程组发 SIGTERM，一次性清干净。
  trap - SIGINT SIGTERM
  kill -TERM 0 2>/dev/null || kill "${PIDS[@]}" 2>/dev/null || true
  sleep 1
  echo -e "${GREEN}✅ 全部服务已停止（docker 的 db/redis/drawio 保持运行）${NC}"
  exit 0
}
trap cleanup SIGINT SIGTERM

echo -e "${CYAN}╔══════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║   ◈ DeepDiagram Pro  聚合工作台 (本地)    ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════╝${NC}"
echo ""

command -v uv   >/dev/null || { echo -e "${RED}❌ 未安装 uv${NC}"; exit 1; }
command -v node >/dev/null || { echo -e "${RED}❌ 未安装 Node.js${NC}"; exit 1; }

# ────────── 基础设施：db / redis / drawio（已在运行则跳过，避免 compose 等待锁） ──────────
if command -v docker >/dev/null; then
  RUNNING_CONTAINERS="$(docker ps --format '{{.Names}}' 2>/dev/null || true)"
  if echo "$RUNNING_CONTAINERS" | grep -q 'smartdiagram-db' \
    && echo "$RUNNING_CONTAINERS" | grep -q 'smartdiagram-redis' \
    && echo "$RUNNING_CONTAINERS" | grep -q 'smartdiagram-drawio'; then
    echo -e "${GREEN}   ✅ 基础设施容器已在运行 (db / redis / drawio)${NC}"
  else
    echo -e "${CYAN}🐳 启动基础设施容器 (db / redis / drawio)...${NC}"
    docker compose up -d db redis drawio >/dev/null 2>&1 \
      && echo -e "${GREEN}   ✅ 基础设施就绪${NC}" \
      || echo -e "${YELLOW}   ⚠️  docker compose 启动失败，若后端报数据库错误请手动检查${NC}"
  fi
fi

# ────────── 前端构建产物（缺失才构建；平时秒过） ──────────
# 统一 SPA：平台首页 + 思维导图 + PPT 模块都在 frontend/dist
if [ ! -f "$ROOT_DIR/frontend/dist/index.html" ]; then
  echo -e "${CYAN}📦 构建统一前端 (首页 / + /diagram + /ppt)...${NC}"
  (cd "$ROOT_DIR/frontend" && npm install --silent && npm run build)
fi
echo -e "${GREEN}   ✅ 统一前端产物就绪${NC}"

# ────────── PPT 后端准备（幂等，已执行则秒过） ──────────
if [ ! -d "$PPT_DIR/node_modules" ]; then
  echo -e "${CYAN}📦 安装 PPT 依赖...${NC}"
  (cd "$PPT_DIR" && corepack pnpm install --silent)
fi
[ -f "$PPT_DIR/.env" ] || { echo -e "${RED}❌ 缺少 $PPT_DIR/.env，请先运行 ppt-agent-engine/start-dev.sh 完成初始化${NC}"; exit 1; }
(cd "$PPT_DIR" && corepack pnpm db:generate >/dev/null 2>&1 && corepack pnpm db:migrate >/dev/null 2>&1) \
  && echo -e "${GREEN}   ✅ PPT 数据库就绪${NC}"
(cd "$PPT_DIR" && uv sync --project apps/api-python --quiet) \
  && echo -e "${GREEN}   ✅ PPT Python 依赖就绪${NC}"

echo ""

# ────────── 启动各后端 ──────────
echo -e "${GREEN}🚀 SmartDiagram 后端  →  http://localhost:8000${NC}"
(cd "$ROOT_DIR/backend" && uv run uvicorn app.main:app --host 0.0.0.0 --port 8000) &
PIDS+=($!)

echo -e "${GREEN}🚀 PPT Node 渲染侧车  →  http://127.0.0.1:4010${NC}"
(cd "$PPT_DIR" && corepack pnpm dev:legacy-api) &
PIDS+=($!)

echo -e "${GREEN}🚀 PPT Agent 后端     →  http://127.0.0.1:4000${NC}"
(cd "$PPT_DIR" && corepack pnpm dev:python-api) &
PIDS+=($!)

echo -e "${GREEN}🚀 聚合网关           →  http://localhost:${GATEWAY_PORT}${NC}"
node "$ROOT_DIR/gateway/dev-gateway.mjs" &
PIDS+=($!)

echo ""
echo -e "${CYAN}════════════════════════════════════════════${NC}"
echo -e "${CYAN}  打开 http://localhost:${GATEWAY_PORT}  选择模块开始使用${NC}"
echo -e "${CYAN}  按 Ctrl+C 停止所有服务${NC}"
echo -e "${CYAN}════════════════════════════════════════════${NC}"
echo ""

wait "${PIDS[@]}"
