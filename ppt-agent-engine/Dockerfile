# syntax=docker/dockerfile:1.7

ARG NODE_IMAGE=node:22-bookworm-slim
ARG PYTHON_IMAGE=python:3.12-slim-bookworm
ARG NGINX_IMAGE=nginx:stable-alpine

FROM ${NODE_IMAGE} AS node-deps

ENV PNPM_HOME=/pnpm
ENV PATH=${PNPM_HOME}:${PATH}

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable \
    && corepack prepare pnpm@9.15.4 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/agents/package.json ./packages/agents/package.json
COPY packages/ppt-renderer/package.json ./packages/ppt-renderer/package.json
COPY packages/shared/package.json ./packages/shared/package.json

RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

FROM node-deps AS node-build

COPY . .

RUN pnpm db:generate \
    && pnpm build:packages \
    && pnpm --filter @ppt-agent/api build

ARG VITE_API_BASE_URL=""
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
RUN pnpm --filter @ppt-agent/web build

FROM ${NODE_IMAGE} AS node-api

ENV NODE_ENV=production
ENV API_HOST=0.0.0.0
ENV API_PORT=4010
ENV DATABASE_URL=file:/data/ppt-agent.db
ENV STORAGE_DIR=/data/storage

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        ffmpeg \
        fontconfig \
        fonts-noto-cjk \
        openssl \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /data/storage /data/langgraph \
    && chown -R node:node /data

COPY --from=node-build --chown=node:node /app /app

USER node

EXPOSE 4010

CMD ["sh", "-c", "./node_modules/.bin/tsx prisma/apply-migrations.ts && exec node apps/api/dist/index.js"]

FROM ${PYTHON_IMAGE} AS python-api

COPY --from=ghcr.io/astral-sh/uv:0.10.5 /uv /uvx /bin/

ENV PYTHONUNBUFFERED=1
ENV UV_PROJECT_ENVIRONMENT=/app/apps/api-python/.venv
ENV PATH=/app/apps/api-python/.venv/bin:${PATH}

WORKDIR /app

RUN groupadd --gid 10001 app \
    && useradd --uid 10001 --gid app --create-home app \
    && mkdir -p /data/langgraph \
    && chown -R app:app /data /app

COPY --chown=app:app apps/api-python/pyproject.toml apps/api-python/uv.lock ./apps/api-python/

RUN --mount=type=cache,id=uv-cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-install-project --project apps/api-python

COPY --chown=app:app apps/api-python ./apps/api-python

RUN --mount=type=cache,id=uv-cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --project apps/api-python

USER app

EXPOSE 4000

CMD ["uvicorn", "ppt_agent_api.main:app", "--host", "0.0.0.0", "--port", "4000"]

FROM ${NGINX_IMAGE} AS web

COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=node-build /app/apps/web/dist /usr/share/nginx/html

EXPOSE 80
