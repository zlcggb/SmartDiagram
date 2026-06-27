# Build stage: ghcr.io 基础镜像 + NodeSource 安装 Node.js（避开被墙的 docker.io）
FROM ghcr.io/astral-sh/uv:python3.13-bookworm-slim AS build
RUN apt-get update && apt-get install -y curl gnupg && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/*
WORKDIR /app

ARG CN_MIRROR=false
RUN if [ "$CN_MIRROR" = "true" ]; then npm config set registry https://registry.npmmirror.com; fi

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Runtime: ghcr.io 基础镜像 + apt 安装 nginx（避开被墙的 docker.io）
FROM ghcr.io/astral-sh/uv:python3.13-bookworm-slim
RUN apt-get update && apt-get install -y nginx && \
    rm -rf /var/lib/apt/lists/* && \
    rm -f /etc/nginx/sites-enabled/default
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
