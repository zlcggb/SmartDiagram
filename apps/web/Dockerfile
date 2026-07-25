ARG UV_PYTHON_IMAGE=ghcr.io/astral-sh/uv:python3.13-bookworm-slim

# Build stage: 国内部署由 deploy.sh 切换为 ghcr.1ms.run。
FROM ${UV_PYTHON_IMAGE} AS build
ARG CN_MIRROR=false
RUN if [ "$CN_MIRROR" = "true" ]; then \
        sed -i 's/deb.debian.org/mirrors.aliyun.com/g' /etc/apt/sources.list.d/debian.sources 2>/dev/null || \
        sed -i 's/deb.debian.org/mirrors.aliyun.com/g' /etc/apt/sources.list 2>/dev/null; \
    fi

RUN apt-get update && apt-get install -y curl gnupg && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/*
WORKDIR /app

RUN if [ "$CN_MIRROR" = "true" ]; then npm config set registry https://registry.npmmirror.com; fi

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Runtime: 复用同一可配置基础镜像 + apt 安装 nginx。
FROM ${UV_PYTHON_IMAGE}
ARG CN_MIRROR=false
RUN if [ "$CN_MIRROR" = "true" ]; then \
        sed -i 's/deb.debian.org/mirrors.aliyun.com/g' /etc/apt/sources.list.d/debian.sources 2>/dev/null || \
        sed -i 's/deb.debian.org/mirrors.aliyun.com/g' /etc/apt/sources.list 2>/dev/null; \
    fi

RUN apt-get update && apt-get install -y nginx && \
    rm -rf /var/lib/apt/lists/* && \
    rm -f /etc/nginx/sites-enabled/default
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
