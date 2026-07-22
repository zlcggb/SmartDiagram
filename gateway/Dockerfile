# 聚合网关：nginx 按路径分流（/ → 统一前端 SPA，/api、/ppt-api → 各后端）
# 国内部署由 deploy.sh 切换为 ghcr.1ms.run，国际环境仍使用 ghcr.io。
ARG UV_PYTHON_IMAGE=ghcr.io/astral-sh/uv:python3.13-bookworm-slim
FROM ${UV_PYTHON_IMAGE}

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
