#!/bin/bash
# DeepDiagram Pro — 统一平台开发模式一键启动
# 用法: npm run dev（或 ./dev.sh），Ctrl+C 一键停止全部
#
# 启动内容（前端 Vite 热更新，API 由 Vite proxy 分流）：
#   前端     http://localhost:5173      （/ 桌面 · /diagram 思维导图 · /ppt PPT 制作）
#     ├─ /api      → SmartDiagram 后端  http://localhost:8000
#     └─ /ppt-api  → PPT Agent 后端     http://127.0.0.1:4000（+ Node 渲染侧车 :4010）
#
# 基础设施（PostgreSQL / Redis / drawio）复用 docker 容器，已在运行则跳过。

set -e

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
PPT_DIR="$ROOT_DIR/ppt-agent-engine"

GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

PIDS=()
cleanup() {
  echo ""
  echo -e "${YELLOW}⏹  正在停止所有服务...${NC}"
  # 后台子进程会忽略 SIGINT（非交互 bash 的默认行为），直接 kill PID 又会留下
  # npm/uvicorn --reload 派生的孙进程。整个脚本在同一进程组，用 SIGTERM 杀整组最干净。
  trap - SIGINT SIGTERM
  kill -TERM 0 2>/dev/null || kill "${PIDS[@]}" 2>/dev/null || true
  sleep 1
  echo -e "${GREEN}✅ 全部服务已停止（docker 的 db/redis/drawio 保持运行）${NC}"
  exit 0
}
trap cleanup SIGINT SIGTERM

echo -e "${CYAN}╔══════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║   ◈ DeepDiagram Pro  统一平台 Dev Mode    ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════╝${NC}"
echo ""

# ────────── 检查系统依赖 ──────────
command -v uv   >/dev/null || { echo -e "${RED}❌ 未安装 uv: curl -LsSf https://astral.sh/uv/install.sh | sh${NC}"; exit 1; }
command -v node >/dev/null || { echo -e "${RED}❌ 未安装 Node.js: https://nodejs.org/${NC}"; exit 1; }

# ────────── 检查 .env ──────────
if [ ! -f "$BACKEND_DIR/.env" ] && [ -f "$BACKEND_DIR/.env.example" ]; then
  echo -e "${YELLOW}⚠️  未检测到 backend/.env，正在从 .env.example 复制，请填入 API Key${NC}"
  cp "$BACKEND_DIR/.env.example" "$BACKEND_DIR/.env"
fi
if [ ! -f "$PPT_DIR/.env" ]; then
  echo -e "${RED}❌ 缺少 ppt-agent-engine/.env，请先运行 ppt-agent-engine/start-dev.sh 完成初始化${NC}"
  exit 1
fi

# ────────── 基础设施：db / redis / drawio（已在运行则跳过） ──────────
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

# ────────── 依赖准备（幂等，已就绪则秒过） ──────────
echo -e "${CYAN}📦 检查依赖...${NC}"
(cd "$BACKEND_DIR" && uv sync --quiet) && echo -e "${GREEN}   ✅ SmartDiagram 后端依赖${NC}"

if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
  (cd "$FRONTEND_DIR" && npm install --silent)
fi
echo -e "${GREEN}   ✅ 统一前端依赖${NC}"

if [ ! -d "$PPT_DIR/node_modules" ]; then
  (cd "$PPT_DIR" && corepack pnpm install --silent)
fi
(cd "$PPT_DIR" && corepack pnpm db:generate >/dev/null 2>&1 && corepack pnpm db:migrate >/dev/null 2>&1) \
  && echo -e "${GREEN}   ✅ PPT 数据库就绪${NC}"
(cd "$PPT_DIR" && uv sync --project apps/api-python --quiet) \
  && echo -e "${GREEN}   ✅ PPT Python 依赖${NC}"

echo ""

# ────────── 启动后端服务 ──────────
echo -e "${GREEN}🚀 SmartDiagram 后端  →  http://localhost:8000${NC}"
(cd "$BACKEND_DIR" && uv run uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload) &
PIDS+=($!)

echo -e "${GREEN}🚀 PPT Node 渲染侧车  →  http://127.0.0.1:4010${NC}"
(cd "$PPT_DIR" && corepack pnpm dev:legacy-api) &
PIDS+=($!)

echo -e "${GREEN}🚀 PPT Agent 后端     →  http://127.0.0.1:4000${NC}"
(cd "$PPT_DIR" && corepack pnpm dev:python-api) &
PIDS+=($!)

# ────────── 启动前端（Vite 热更新，/api 与 /ppt-api 已配置 proxy） ──────────
echo -e "${GREEN}🚀 统一前端 (HMR)     →  http://localhost:5173${NC}"
(cd "$FRONTEND_DIR" && npm run dev) &
PIDS+=($!)

echo ""
echo -e "${CYAN}════════════════════════════════════════════${NC}"
echo -e "${CYAN}  打开 http://localhost:5173  进入平台桌面${NC}"
echo -e "${CYAN}  按 Ctrl+C 停止所有服务${NC}"
echo -e "${CYAN}════════════════════════════════════════════${NC}"
echo ""

wait "${PIDS[@]}"
