# 聚合网关：nginx 按路径分流（/ → 统一前端 SPA，/api、/ppt-api → 各后端）
# 与 frontend/Dockerfile 一致，使用 ghcr.io 基础镜像 + apt 安装 nginx（避开被墙的 docker.io）
FROM ghcr.io/astral-sh/uv:python3.13-bookworm-slim

ARG CN_MIRROR=false
RUN if [ "$CN_MIRROR" = "true" ]; then \
        sed -i 's/deb.debian.org/mirrors.aliyun.com/g' /etc/apt/sources.list.d/debian.sources 2>/dev/null || \
        sed -i 's/deb.debian.org/mirrors.aliyun.com/g' /etc/apt/sources.list 2>/dev/null; \
    fi

RUN apt-get update && apt-get install -y nginx && \
    rm -rf /var/lib/apt/lists/* && \
    rm -f /etc/nginx/sites-enabled/default

COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
