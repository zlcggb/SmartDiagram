#!/usr/bin/env bash
# Build every TypeScript target used by the production Docker images.

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

CI=true corepack pnpm install --frozen-lockfile
corepack pnpm run test:typescript
corepack pnpm run test:python
corepack pnpm --filter @ppt-agent/slide-ir build
corepack pnpm --filter @ppt-agent/shared build
corepack pnpm --filter @ppt-agent/ppt-renderer build
corepack pnpm --filter @ppt-agent/agents build
corepack pnpm --filter @ppt-agent/api build
corepack pnpm --filter @smartdiagram/web build
