#!/bin/bash
# SmartDiagram AI — 一键启动前后端开发服务器
# 用法: ./dev.sh 或 npm run dev
#
# 自动完成:
#   1. 检查 uv / node 依赖
#   2. 检查 .env 配置
#   3. 创建 Python 虚拟环境 + 安装后端依赖 (uv sync)
#   4. 安装前端依赖 (npm install)
#   5. 启动后端 (FastAPI :8000) + 前端 (Vite :5173)

set -e

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"

# 颜色定义
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

cleanup() {
  echo ""
  echo -e "${YELLOW}⏹  正在停止所有服务...${NC}"
  kill $BACKEND_PID $FRONTEND_PID 2>/dev/null
  wait $BACKEND_PID $FRONTEND_PID 2>/dev/null
  docker stop smartdiagram-drawio 2>/dev/null || true
  echo -e "${GREEN}✅ 所有服务已停止${NC}"
  exit 0
}

trap cleanup SIGINT SIGTERM

echo -e "${CYAN}╔══════════════════════════════════════╗${NC}"
echo -e "${CYAN}║    🧠 SmartDiagram AI  Dev Server    ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════╝${NC}"
echo ""

# ────────── 检查系统依赖 ──────────
if ! command -v uv &>/dev/null; then
  echo -e "${RED}❌ 未安装 uv，请先安装: curl -LsSf https://astral.sh/uv/install.sh | sh${NC}"
  exit 1
fi

if ! command -v node &>/dev/null; then
  echo -e "${RED}❌ 未安装 Node.js，请先安装: https://nodejs.org/${NC}"
  exit 1
fi

# ────────── 检查 .env ──────────
if [ ! -f "$BACKEND_DIR/.env" ]; then
  if [ -f "$BACKEND_DIR/.env.example" ]; then
    echo -e "${YELLOW}⚠️  未检测到 backend/.env，正在从 .env.example 复制...${NC}"
    cp "$BACKEND_DIR/.env.example" "$BACKEND_DIR/.env"
    echo -e "${YELLOW}   请编辑 backend/.env 填入 API Key${NC}"
  else
    echo -e "${RED}❌ 未找到 backend/.env 或 .env.example${NC}"
    exit 1
  fi
fi

# ────────── 后端依赖（uv sync 幂等，已安装则秒完成） ──────────
echo -e "${CYAN}📦 检查后端 Python 依赖...${NC}"
(cd "$BACKEND_DIR" && uv sync --quiet 2>&1) && echo -e "${GREEN}   ✅ 后端依赖就绪${NC}" || {
  echo -e "${RED}❌ 后端依赖安装失败，请检查 pyproject.toml${NC}"
  exit 1
}

# ────────── 前端依赖（按需安装） ──────────
if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
  echo -e "${CYAN}📦 首次运行，安装前端依赖...${NC}"
  (cd "$FRONTEND_DIR" && npm install --silent)
  echo -e "${GREEN}   ✅ 前端依赖就绪${NC}"
else
  echo -e "${GREEN}   ✅ 前端依赖就绪（已存在）${NC}"
fi

echo ""

# ────────── 启动 Draw.io 自托管容器 ──────────
if command -v docker &>/dev/null; then
  if docker ps --format '{{.Names}}' | grep -q 'smartdiagram-drawio'; then
    echo -e "${GREEN}   ✅ Draw.io 自托管已运行 → http://localhost:9022${NC}"
  else
    echo -e "${CYAN}🐳 启动 Draw.io 自托管容器 (端口 9022)...${NC}"
    docker rm -f smartdiagram-drawio 2>/dev/null || true
    docker run -d --name smartdiagram-drawio -p 9022:8080 -e DRAWIO_OFFLINE=true --restart always jgraph/drawio:latest >/dev/null 2>&1
    echo -e "${GREEN}   ✅ Draw.io 就绪 → http://localhost:9022${NC}"
  fi
else
  echo -e "${YELLOW}⚠️  未安装 Docker，Draw.io 编辑器将使用在线版本（可能加载较慢）${NC}"
fi

# ────────── 启动后端 ──────────
echo -e "${GREEN}🚀 启动后端  →  http://localhost:8000${NC}"
(cd "$BACKEND_DIR" && uv run uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload) &
BACKEND_PID=$!

# ────────── 启动前端 ──────────
echo -e "${GREEN}🚀 启动前端  →  http://localhost:5173${NC}"
(cd "$FRONTEND_DIR" && npm run dev) &
FRONTEND_PID=$!

echo ""
echo -e "${CYAN}按 Ctrl+C 停止所有服务${NC}"
echo ""

wait $BACKEND_PID $FRONTEND_PID
