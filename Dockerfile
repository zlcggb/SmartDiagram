# PPT Agent 多阶段镜像（Node 侧车 + Python 编排）
# 由 docker-compose.yml 的 ppt-node-api / ppt-python-api 引用。
# 统一前端已并入 apps/web，由独立 web 服务构建。

ARG NODE_IMAGE=node:22-bookworm-slim
ARG PYTHON_IMAGE=python:3.12-slim-bookworm
ARG UV_IMAGE=ghcr.io/astral-sh/uv:0.10.5
ARG CN_MIRROR=false

# BuildKit 不会可靠展开 COPY --from=${UV_IMAGE}，须先声明命名 stage。
FROM ${UV_IMAGE} AS uv-bin

FROM ${NODE_IMAGE} AS node-deps

ARG CN_MIRROR
ENV PNPM_HOME=/pnpm
ENV PATH=${PNPM_HOME}:${PATH}

WORKDIR /app

RUN if [ "$CN_MIRROR" = "true" ]; then \
        sed -i 's/deb.debian.org/mirrors.aliyun.com/g' /etc/apt/sources.list.d/debian.sources 2>/dev/null || \
        sed -i 's/deb.debian.org/mirrors.aliyun.com/g' /etc/apt/sources.list 2>/dev/null; \
    fi \
    && apt-get -o Acquire::Retries=5 update \
    && apt-get -o Acquire::Retries=5 install -y --no-install-recommends ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable \
    && corepack prepare pnpm@9.15.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY prisma ./prisma
COPY apps/service-ppt-renderer/package.json ./apps/service-ppt-renderer/package.json
COPY packages/agents/package.json ./packages/agents/package.json
COPY packages/ppt-renderer/package.json ./packages/ppt-renderer/package.json
COPY packages/shared/package.json ./packages/shared/package.json

RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

FROM node-deps AS node-build

COPY packages ./packages
COPY apps/service-ppt-renderer ./apps/service-ppt-renderer

RUN pnpm exec prisma generate --schema prisma/schema.prisma \
    && pnpm --filter @ppt-agent/shared build \
    && pnpm --filter @ppt-agent/ppt-renderer build \
    && pnpm --filter @ppt-agent/agents build \
    && pnpm --filter @ppt-agent/api build

FROM ${NODE_IMAGE} AS node-api

ARG CN_MIRROR
ENV NODE_ENV=production
ENV API_HOST=0.0.0.0
ENV API_PORT=4010
ENV STORAGE_DIR=/data/storage

WORKDIR /app

RUN set -eux; \
    if [ "$CN_MIRROR" = "true" ]; then \
        sed -i 's/deb.debian.org/mirrors.aliyun.com/g' /etc/apt/sources.list.d/debian.sources 2>/dev/null || \
        sed -i 's/deb.debian.org/mirrors.aliyun.com/g' /etc/apt/sources.list 2>/dev/null; \
    fi; \
    apt-get -o Acquire::Retries=5 update; \
    attempt=1; \
    until apt-get -o Acquire::Retries=5 install -y --no-install-recommends \
        ca-certificates \
        curl \
        ffmpeg \
        fontconfig \
        fonts-noto-cjk \
        openssl; do \
        if [ "$attempt" -ge 3 ]; then exit 1; fi; \
        attempt=$((attempt + 1)); \
    done; \
    rm -rf /var/lib/apt/lists/*; \
    mkdir -p /data/storage /data/langgraph; \
    chown -R node:node /data

COPY --from=node-build --chown=node:node /app /app

USER node

EXPOSE 4010

CMD ["sh", "-c", "./node_modules/.bin/tsx prisma/apply-migrations.ts && exec node apps/service-ppt-renderer/dist/index.js"]

FROM ${PYTHON_IMAGE} AS python-api

ARG CN_MIRROR

COPY --from=uv-bin /uv /uvx /bin/

ENV PYTHONUNBUFFERED=1
ENV UV_PROJECT_ENVIRONMENT=/app/apps/api-ppt/.venv
ENV PATH=/app/apps/api-ppt/.venv/bin:${PATH}

WORKDIR /app

RUN groupadd --gid 10001 app \
    && useradd --uid 10001 --gid app --create-home app \
    && mkdir -p /data/langgraph \
    && chown -R app:app /data /app

COPY --chown=app:app apps/api-ppt/pyproject.toml apps/api-ppt/uv.lock ./apps/api-ppt/

RUN --mount=type=cache,id=uv-cache,target=/root/.cache/uv \
    if [ "$CN_MIRROR" = "true" ]; then \
        export UV_INDEX_URL=https://mirrors.aliyun.com/pypi/simple; \
    fi; \
    uv sync --frozen --no-dev --no-install-project --project apps/api-ppt

COPY --chown=app:app apps/api-ppt ./apps/api-ppt

RUN --mount=type=cache,id=uv-cache,target=/root/.cache/uv \
    if [ "$CN_MIRROR" = "true" ]; then \
        export UV_INDEX_URL=https://mirrors.aliyun.com/pypi/simple; \
    fi; \
    uv sync --frozen --no-dev --project apps/api-ppt

USER app

EXPOSE 4000

CMD ["uvicorn", "ppt_agent_api.main:app", "--host", "0.0.0.0", "--port", "4000"]
