#!/usr/bin/env bash
# 一键准备并启动本地开发（API + Web）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

if ! command -v node >/dev/null 2>&1; then
  echo "请先安装 Node.js 20+：https://nodejs.org/"
  exit 1
fi

if ! command -v uv >/dev/null 2>&1; then
  echo "请先安装 uv：https://docs.astral.sh/uv/getting-started/installation/"
  exit 1
fi

# 启用 pnpm（Node 自带 corepack）
if command -v corepack >/dev/null 2>&1; then
  corepack enable >/dev/null 2>&1 || true
  PNPM=(corepack pnpm)
else
  if ! command -v pnpm >/dev/null 2>&1; then
    echo "未找到 corepack/pnpm，请升级 Node.js 或安装 pnpm"
    exit 1
  fi
  PNPM=(pnpm)
fi

echo "==> 安装依赖"
"${PNPM[@]}" install
uv sync --project apps/api-python

if [[ ! -f .env ]]; then
  echo "==> 创建 .env（来自 .env.example）"
  DB_PATH="$ROOT/prisma/dev.db"
  # SQLite URL：把空格编码，兼容 macOS / 中文路径
  DB_URL="file:${DB_PATH// /%20}"
  if [[ -f .env.example ]]; then
    # 用本机绝对路径覆盖示例里的 Windows DATABASE_URL
    awk -v db="$DB_URL" '
      BEGIN { done=0 }
      /^DATABASE_URL=/ {
        print "DATABASE_URL=\"" db "\""
        done=1
        next
      }
      { print }
      END {
        if (!done) print "DATABASE_URL=\"" db "\""
      }
    ' .env.example > .env
  else
    cat > .env <<EOF
DATABASE_URL="$DB_URL"
API_PORT=4000
WEB_PORT=5173
AI_PROVIDER="mock"
EOF
  fi
  echo "    已写入 .env。若要用真实 Gemini，请编辑 .env 设置："
  echo "    AI_PROVIDER=gemini"
  echo "    GEMINI_API_KEY=你的密钥"
else
  echo "==> 已存在 .env，跳过创建"
fi

echo "==> 生成 Prisma Client / 迁移数据库"
"${PNPM[@]}" db:generate
"${PNPM[@]}" db:migrate

echo "==> 启动开发服务"
echo "    Web: http://127.0.0.1:5173"
echo "    API: http://127.0.0.1:4000（FastAPI + LangGraph）"
echo "    兼容侧车: http://127.0.0.1:4010（迁移期 Node 数据/渲染服务）"
echo "    AI:  http://127.0.0.1:4000/api/ai/status"
echo "    用量: http://127.0.0.1:4000/api/ai/usage"
echo "    编排图: http://127.0.0.1:4000/api/orchestration/graph"
"${PNPM[@]}" dev
