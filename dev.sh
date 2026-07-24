#!/bin/bash
# DeepDiagram Pro — 统一平台开发模式一键启动
# 用法: npm run dev（或 ./dev.sh），Ctrl+C 一键停止全部
#
# 启动内容（前端 Vite 热更新，API 由 Vite proxy 分流）：
#   前端     http://localhost:5173      （/ 桌面 · /diagram 思维导图 · /ppt PPT 制作）
#     ├─ /api      → SmartDiagram 后端  http://localhost:8000
#     └─ /ppt-api  → PPT Agent 后端     http://127.0.0.1:4000（+ Node 渲染侧车 :4010）
#
# 基础设施（PostgreSQL / Redis / drawio）复用 Docker 命名卷和容器。
# 镜像变化时 Compose 只替换容器，既有 pgdata 数据卷不会删除。

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

show_database_diagnostics() {
  echo -e "${YELLOW}── PostgreSQL 容器状态 ──${NC}"
  docker compose ps -a db || true
  echo -e "${YELLOW}── PostgreSQL 最近日志 ──${NC}"
  docker compose logs --tail=80 db || true
}

infrastructure_is_healthy() {
  [ "$(docker inspect -f '{{.State.Running}}' smartdiagram-db 2>/dev/null || true)" = "true" ] \
    && [ "$(docker inspect -f '{{.State.Running}}' smartdiagram-redis 2>/dev/null || true)" = "true" ] \
    && [ "$(docker inspect -f '{{.State.Running}}' smartdiagram-drawio 2>/dev/null || true)" = "true" ] \
    && docker exec smartdiagram-db pg_isready -U postgres -d smartdiagram >/dev/null 2>&1
}

start_infrastructure() {
  command -v docker >/dev/null || {
    echo -e "${RED}❌ 未安装 Docker Desktop，npm run dev 需要本地 PostgreSQL / Redis${NC}"
    exit 1
  }
  docker info >/dev/null 2>&1 || {
    echo -e "${RED}❌ Docker 未运行，请先启动 Docker Desktop 后重试${NC}"
    exit 1
  }

  if infrastructure_is_healthy; then
    echo -e "${GREEN}   ✅ 复用已就绪的基础设施容器 (db / redis / drawio)${NC}"
    return 0
  fi

  echo -e "${CYAN}🐳 启动基础设施容器 (db / redis / drawio)...${NC}"
  if ! docker compose up -d db redis drawio; then
    echo -e "${RED}❌ 基础设施启动失败${NC}"
    show_database_diagnostics
    exit 1
  fi
}

wait_for_database() {
  local timeout_seconds="${LOCAL_DB_WAIT_SECONDS:-120}"
  local started_at="$SECONDS"

  echo -e "${CYAN}⏳ 等待 PostgreSQL 就绪...${NC}"
  while (( SECONDS - started_at < timeout_seconds )); do
    if docker compose exec -T db pg_isready -U postgres -d smartdiagram >/dev/null 2>&1; then
      echo -e "${GREEN}   ✅ PostgreSQL 已就绪${NC}"
      return 0
    fi
    sleep 2
  done

  echo -e "${RED}❌ 数据库未能在 ${timeout_seconds} 秒内就绪${NC}"
  show_database_diagnostics
  exit 1
}

port_is_in_use() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
  else
    nc -z 127.0.0.1 "$port" >/dev/null 2>&1 \
      || nc -z ::1 "$port" >/dev/null 2>&1
  fi
}

check_required_ports() {
  local ports=(5173 8000 4000 4010)
  local labels=("统一前端" "SmartDiagram 后端" "PPT Agent 后端" "PPT Node 侧车")
  local conflict=0
  local index port

  for ((index = 0; index < ${#ports[@]}; index++)); do
    port="${ports[$index]}"
    if port_is_in_use "$port"; then
      echo -e "${RED}❌ ${labels[$index]}端口 ${port} 已被占用${NC}"
      if command -v lsof >/dev/null 2>&1; then
        lsof -nP -iTCP:"$port" -sTCP:LISTEN || true
      fi
      conflict=1
    fi
  done

  if [ "$conflict" -ne 0 ]; then
    echo -e "${YELLOW}请先在旧的 npm run dev 终端按 Ctrl+C，再重新运行。${NC}"
    exit 1
  fi
}

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

# Docker Compose 和本地 PPT 子进程必须共用同一个内部密钥。
# 需在第一次 Compose 调用前完成初始化并导出，否则就绪检查会被必填变量拦截。
source "$ROOT_DIR/scripts/ensure-deploy-secret.sh"
ensure_ppt_internal_api_secret "$ROOT_DIR/.env"
case "${PPT_SECRET_BOOTSTRAP_STATUS:-}" in
  generated) echo -e "${GREEN}   ✅ 已生成 PPT 内部密钥并保存到根目录 .env${NC}" ;;
  environment) echo -e "${GREEN}   ✅ 已使用环境中的 PPT 内部密钥${NC}" ;;
  file) echo -e "${GREEN}   ✅ 已加载根目录 .env 中的 PPT 内部密钥${NC}" ;;
esac

# ────────── 基础设施：db / redis / drawio ──────────
check_required_ports
start_infrastructure
wait_for_database

# ────────── 依赖准备（幂等，已就绪则秒过） ──────────
echo -e "${CYAN}📦 检查依赖...${NC}"
(cd "$BACKEND_DIR" && uv sync --quiet) && echo -e "${GREEN}   ✅ SmartDiagram 后端依赖${NC}"

echo -e "${CYAN}🗃️  初始化本地数据库（只增量建表，不删除数据）...${NC}"
(cd "$BACKEND_DIR" && uv run python scripts/migrate_database.py) \
  && echo -e "${GREEN}   ✅ SmartDiagram 数据库就绪${NC}"

if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
  (cd "$FRONTEND_DIR" && npm install --silent)
fi
echo -e "${GREEN}   ✅ 统一前端依赖${NC}"

if [ ! -d "$PPT_DIR/node_modules" ]; then
  (cd "$PPT_DIR" && corepack pnpm install --silent)
fi
(cd "$PPT_DIR" && corepack pnpm db:generate >/dev/null)
docker compose run --rm --no-deps ppt-db-init
(cd "$PPT_DIR" && corepack pnpm db:migrate) \
  && echo -e "${GREEN}   ✅ PPT Agent 数据库就绪${NC}"
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
