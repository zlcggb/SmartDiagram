#!/usr/bin/env bash
# 本地开发启动公共逻辑 — 由 dev.sh / start-all.sh source，勿直接执行。
#
# 调用方须先设置 ROOT_DIR，再 source 本文件。

: "${ROOT_DIR:?ROOT_DIR must be set before sourcing dev-common.sh}"

dev_common_init_paths() {
  export PATH="/opt/homebrew/bin:/usr/local/bin:${PATH:-}"
  BACKEND_DIR="$ROOT_DIR/apps/api-diagram"
  FRONTEND_DIR="$ROOT_DIR/apps/web"
  PPT_API_DIR="$ROOT_DIR/apps/api-ppt"
  PPT_RENDERER_DIR="$ROOT_DIR/apps/service-ppt-renderer"
}

# shellcheck disable=SC2034
GREEN="${GREEN:-\033[0;32m}"
CYAN="${CYAN:-\033[0;36m}"
YELLOW="${YELLOW:-\033[1;33m}"
RED="${RED:-\033[0;31m}"
NC="${NC:-\033[0m}"

show_database_diagnostics() {
  echo -e "${YELLOW}── PostgreSQL 容器状态 ──${NC}"
  docker compose -f "$ROOT_DIR/docker-compose.yml" ps -a db 2>/dev/null \
    || docker compose ps -a db 2>/dev/null \
    || true
  echo -e "${YELLOW}── PostgreSQL 最近日志 ──${NC}"
  docker compose -f "$ROOT_DIR/docker-compose.yml" logs --tail=80 db 2>/dev/null \
    || docker compose logs --tail=80 db 2>/dev/null \
    || true
}

infrastructure_is_healthy() {
  [ "$(docker inspect -f '{{.State.Running}}' smartdiagram-db 2>/dev/null || true)" = "true" ] \
    && [ "$(docker inspect -f '{{.State.Running}}' smartdiagram-redis 2>/dev/null || true)" = "true" ] \
    && [ "$(docker inspect -f '{{.State.Running}}' smartdiagram-drawio 2>/dev/null || true)" = "true" ] \
    && docker exec smartdiagram-db pg_isready -U postgres -d smartdiagram >/dev/null 2>&1
}

start_infrastructure() {
  command -v docker >/dev/null || {
    echo -e "${RED}❌ 未安装 Docker Desktop，本地开发需要 PostgreSQL / Redis${NC}"
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
  if ! (cd "$ROOT_DIR" && docker compose up -d db redis drawio); then
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
    if docker exec smartdiagram-db pg_isready -U postgres -d smartdiagram >/dev/null 2>&1 \
      || (cd "$ROOT_DIR" && docker compose exec -T db pg_isready -U postgres -d smartdiagram >/dev/null 2>&1); then
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

# 用法: check_required_ports "标签1:5173" "标签2:8000" ...
check_required_ports() {
  local entry label port conflict=0

  if [ "$#" -eq 0 ]; then
    set -- "统一前端:5173" "SmartDiagram 后端:8000" "PPT Agent 后端:4000" "PPT Node 侧车:4010"
  fi

  for entry in "$@"; do
    label="${entry%%:*}"
    port="${entry##*:}"
    if port_is_in_use "$port"; then
      echo -e "${RED}❌ ${label} 端口 ${port} 已被占用${NC}"
      if command -v lsof >/dev/null 2>&1; then
        lsof -nP -iTCP:"$port" -sTCP:LISTEN || true
      fi
      conflict=1
    fi
  done

  if [ "$conflict" -ne 0 ]; then
    echo -e "${YELLOW}请先在旧终端按 Ctrl+C 停止服务，再重新运行。${NC}"
    exit 1
  fi
}

run_with_root_env() {
  (
    set -a
    # shellcheck disable=SC1091
    source "$ROOT_DIR/.env"
    set +a
    "$@"
  )
}

resolve_pnpm() {
  if command -v pnpm >/dev/null 2>&1; then
    PNPM="pnpm"
  elif command -v corepack >/dev/null 2>&1 \
    && corepack prepare pnpm@9.15.0 --activate >/dev/null 2>&1 \
    && command -v pnpm >/dev/null 2>&1; then
    PNPM="pnpm"
  else
    PNPM="npx --yes pnpm@9.15.0"
  fi
}

require_dev_tools() {
  command -v uv >/dev/null || {
    echo -e "${RED}❌ 未安装 uv: curl -LsSf https://astral.sh/uv/install.sh | sh${NC}"
    exit 1
  }
  command -v node >/dev/null || {
    echo -e "${RED}❌ 未安装 Node.js: https://nodejs.org/${NC}"
    exit 1
  }
  resolve_pnpm
}

bootstrap_root_env() {
  # shellcheck source=scripts/ensure-root-env.sh
  source "$ROOT_DIR/scripts/ensure-root-env.sh"
  # shellcheck source=scripts/ensure-deploy-secret.sh
  source "$ROOT_DIR/scripts/ensure-deploy-secret.sh"

  ROOT_ENV_STATUS="$(ensure_root_env "$ROOT_DIR")"
  case "$ROOT_ENV_STATUS" in
    created)
      echo -e "${YELLOW}⚠️  已从 .env.example 创建根目录 .env，请按 Platform/Diagram/PPT 分区填入密钥${NC}"
      ;;
    appended)
      echo -e "${YELLOW}⚠️  已向根目录 .env 追加缺失配置项，请检查并填入密钥${NC}"
      ;;
    ok)
      echo -e "${GREEN}   ✅ 根目录 .env 已就绪（Platform / Diagram / PPT）${NC}"
      ;;
    *)
      echo -e "${RED}❌ 根目录 .env 初始化失败${NC}"
      exit 1
      ;;
  esac

  ensure_ppt_internal_api_secret "$ROOT_DIR/.env"
  case "${PPT_SECRET_BOOTSTRAP_STATUS:-}" in
    generated) echo -e "${GREEN}   ✅ 已生成 PPT 内部密钥并保存到根目录 .env${NC}" ;;
    environment) echo -e "${GREEN}   ✅ 已使用环境中的 PPT 内部密钥${NC}" ;;
    file) echo -e "${GREEN}   ✅ 已加载根目录 .env 中的 PPT 内部密钥${NC}" ;;
  esac
}

prepare_diagram_backend() {
  echo -e "${CYAN}📦 检查 SmartDiagram 后端依赖...${NC}"
  (cd "$BACKEND_DIR" && uv sync --quiet) && echo -e "${GREEN}   ✅ SmartDiagram 后端依赖${NC}"

  echo -e "${CYAN}🗃️  初始化 SmartDiagram 数据库（只增量建表，不删除数据）...${NC}"
  (cd "$BACKEND_DIR" && uv run python scripts/migrate_database.py) \
    && echo -e "${GREEN}   ✅ SmartDiagram 数据库就绪${NC}"
}

prepare_frontend_deps() {
  if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
    (cd "$FRONTEND_DIR" && $PNPM install --silent)
  fi
  echo -e "${GREEN}   ✅ 统一前端依赖${NC}"
}

prepare_monorepo_deps() {
  if [ ! -d "$ROOT_DIR/node_modules" ]; then
    (cd "$ROOT_DIR" && $PNPM install --silent)
  fi
}

prepare_ppt_stack() {
  prepare_monorepo_deps

  echo -e "${CYAN}🗃️  初始化 PPT 数据库...${NC}"
  (cd "$ROOT_DIR" && docker compose run --rm --no-deps ppt-db-init)
  (cd "$ROOT_DIR" && $PNPM exec prisma generate --schema prisma/schema.prisma >/dev/null) \
    && echo -e "${GREEN}   ✅ Prisma Client 已生成${NC}"
  run_with_root_env bash -c "cd \"$ROOT_DIR\" && $PNPM exec tsx prisma/apply-migrations.ts" \
    && echo -e "${GREEN}   ✅ PPT Agent 数据库就绪${NC}"

  (cd "$PPT_API_DIR" && uv sync --quiet) \
    && echo -e "${GREEN}   ✅ PPT Python 依赖${NC}"
}

prepare_local_stack() {
  echo -e "${CYAN}📦 检查依赖与数据库...${NC}"
  prepare_diagram_backend
  prepare_frontend_deps
  prepare_ppt_stack
}

ensure_frontend_build() {
  if [ ! -f "$FRONTEND_DIR/dist/index.html" ]; then
    echo -e "${CYAN}📦 构建统一前端 (首页 / + /diagram + /ppt)...${NC}"
    (cd "$FRONTEND_DIR" && $PNPM install --silent && $PNPM run build)
  fi
  echo -e "${GREEN}   ✅ 统一前端产物就绪${NC}"
}

start_diagram_api() {
  local reload_flag="${1:-}"
  echo -e "${GREEN}🚀 SmartDiagram 后端  →  http://localhost:8000${NC}"
  if [ "$reload_flag" = "--reload" ]; then
    (cd "$BACKEND_DIR" && uv run uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload) &
  else
    (cd "$BACKEND_DIR" && uv run uvicorn app.main:app --host 0.0.0.0 --port 8000) &
  fi
  PIDS+=($!)
}

start_ppt_renderer() {
  echo -e "${GREEN}🚀 PPT Node 渲染侧车  →  http://127.0.0.1:4010${NC}"
  run_with_root_env bash -c "cd \"$PPT_RENDERER_DIR\" && API_PORT=4010 API_HOST=127.0.0.1 $PNPM dev" &
  PIDS+=($!)
}

start_ppt_api() {
  local reload_flag="${1:-}"
  echo -e "${GREEN}🚀 PPT Agent 后端     →  http://127.0.0.1:4000${NC}"
  if [ "$reload_flag" = "--reload" ]; then
    run_with_root_env bash -c "cd \"$PPT_API_DIR\" && PYTHONPATH=src uv run uvicorn ppt_agent_api.main:app --host 127.0.0.1 --port 4000 --reload" &
  else
    run_with_root_env bash -c "cd \"$PPT_API_DIR\" && PYTHONPATH=src uv run uvicorn ppt_agent_api.main:app --host 127.0.0.1 --port 4000" &
  fi
  PIDS+=($!)
}

setup_cleanup_trap() {
  cleanup() {
    echo ""
    echo -e "${YELLOW}⏹  正在停止所有服务...${NC}"
    trap - SIGINT SIGTERM
    kill -TERM 0 2>/dev/null || kill "${PIDS[@]}" 2>/dev/null || true
    sleep 1
    if [ "${KEEP_DOCKER_RUNNING:-false}" != "true" ]; then
      echo -e "${CYAN}🐳 正在停止关联容器 (db / redis / drawio)...${NC}"
      (cd "$ROOT_DIR" && docker compose stop db redis drawio >/dev/null 2>&1) || true
      docker stop smartdiagram-db smartdiagram-redis smartdiagram-drawio >/dev/null 2>&1 || true
      echo -e "${GREEN}✅ 全部服务及关联 Docker 容器已停止${NC}"
    else
      echo -e "${GREEN}✅ 全部服务已停止（docker 的 db/redis/drawio 保持运行）${NC}"
    fi
    exit 0
  }
  trap cleanup SIGINT SIGTERM
}
