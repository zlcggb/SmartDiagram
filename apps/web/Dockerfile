# SmartDiagram 统一前端 SPA（pnpm monorepo 构建）
# build context: 仓库根目录（见 docker-compose.yml web.build.context）

ARG NODE_IMAGE=node:22-bookworm-slim
ARG NGINX_IMAGE=nginx:stable-alpine
ARG CN_MIRROR=false

FROM ${NODE_IMAGE} AS build

ARG CN_MIRROR
ARG VITE_PPT_MAX_MATERIAL_MB=50
ENV VITE_PPT_MAX_MATERIAL_MB=${VITE_PPT_MAX_MATERIAL_MB}
ENV PNPM_HOME=/pnpm
ENV PATH=${PNPM_HOME}:${PATH}

WORKDIR /app

RUN if [ "$CN_MIRROR" = "true" ]; then \
        sed -i 's/deb.debian.org/mirrors.aliyun.com/g' /etc/apt/sources.list.d/debian.sources 2>/dev/null || \
        sed -i 's/deb.debian.org/mirrors.aliyun.com/g' /etc/apt/sources.list 2>/dev/null; \
    fi \
    && apt-get -o Acquire::Retries=5 update \
    && apt-get -o Acquire::Retries=5 install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable \
    && corepack prepare pnpm@9.15.0 --activate

RUN if [ "$CN_MIRROR" = "true" ]; then pnpm config set registry https://registry.npmmirror.com; fi

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web/package.json ./apps/web/package.json
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/ppt-renderer/package.json ./packages/ppt-renderer/package.json

RUN --mount=type=cache,id=pnpm-store-web,target=/pnpm/store \
    pnpm install --frozen-lockfile

COPY packages/shared ./packages/shared
COPY packages/ppt-renderer ./packages/ppt-renderer
COPY apps/web ./apps/web

RUN pnpm --filter @ppt-agent/shared build \
    && pnpm --filter @ppt-agent/ppt-renderer build \
    && pnpm --filter @smartdiagram/web build

FROM ${NGINX_IMAGE} AS runtime

COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
