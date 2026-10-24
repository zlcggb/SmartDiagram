ARG UV_PYTHON_IMAGE=ghcr.io/astral-sh/uv:python3.13-bookworm-slim

FROM ${UV_PYTHON_IMAGE}

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_HTTP_TIMEOUT=300

ARG CN_MIRROR=false

WORKDIR /app

RUN apt-get update \
    && apt-get install --no-install-recommends -y ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml requirements.txt ./
RUN if [ "$CN_MIRROR" = "true" ]; then \
        UV_INDEX_URL=https://mirrors.aliyun.com/pypi/simple uv pip install --system --no-cache -r requirements.txt; \
    else \
        uv pip install --system --no-cache -r requirements.txt; \
    fi

COPY . .

RUN mkdir -p /app/data/videos /app/downloads

EXPOSE 4020

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:4020/api/health', timeout=3)" || exit 1

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "4020"]
