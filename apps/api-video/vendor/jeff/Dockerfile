FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# 从 Astral 官方镜像获取轻量 uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

# 拷贝 Jeff 源码与配置
COPY pyproject.toml README.md ./
COPY src/ ./src/

# 同步运行环境
RUN uv sync --no-dev

ENV JEFF_HOST=0.0.0.0
ENV JEFF_PORT=8001
ENV JEFF_API_KEYS=devkey
ENV JEFF_DEVICE=cpu

EXPOSE 8001

CMD ["/app/.venv/bin/jeff"]
