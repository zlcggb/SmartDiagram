#!/usr/bin/env bash
# 在加载根 .env 后执行命令（供 npm scripts 使用）
# 用法: bash scripts/run-with-root-env.sh pnpm exec tsx prisma/apply-migrations.ts

set -e

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

if [ ! -f "$ROOT_DIR/.env" ]; then
  echo "❌ 根目录 .env 不存在，请先运行 npm run dev 或复制 .env.example" >&2
  exit 1
fi

if [ "$#" -eq 0 ]; then
  echo "用法: bash scripts/run-with-root-env.sh <command> [args...]" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1091
source "$ROOT_DIR/.env"
set +a

exec "$@"
