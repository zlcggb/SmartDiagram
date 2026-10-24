#!/usr/bin/env bash
set -e

# ==============================================================================
# Jeff (GLiFormer System One) 本地微服务启动脚本
# 默认端口: 8001 (避免与 VidGrab 主后端 8000 冲突)
# ==============================================================================

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
JEFF_DIR="$DIR/vendor/jeff"
MODEL_DIR="${JEFF_MODEL:-$DIR/models/gliformer-large-v1}"
PORT="${JEFF_PORT:-8001}"
HOST="${JEFF_HOST:-0.0.0.0}"
API_KEY="${JEFF_API_KEYS:-devkey}"
export UV_INDEX_URL="${UV_INDEX_URL:-https://pypi.tuna.tsinghua.edu.cn/simple}"
export HF_ENDPOINT="${HF_ENDPOINT:-https://hf-mirror.com}"

echo "====================================================="
echo "==> 启动 Jeff (GLiFormer System 1 决策模型微服务) <=="
echo "====================================================="
echo "工作目录: $JEFF_DIR"
echo "监听地址: http://$HOST:$PORT"
echo "模型路径: $MODEL_DIR"

if [ ! -d "$JEFF_DIR" ]; then
    echo "错误: 未找到 $JEFF_DIR，请先确认 vendor/jeff 目录完整。"
    exit 1
fi

# 检查虚拟环境
if [ ! -d "$JEFF_DIR/.venv" ]; then
    echo "==> 正在使用 uv 同步 Jeff 依赖环境..."
    cd "$JEFF_DIR"
    uv sync
fi

# 检查模型权重
if [ ! -f "$MODEL_DIR/pytorch_model.bin" ]; then
    echo "==> 未在 $MODEL_DIR 检测到完整模型权重，开始自动下载..."
    "$JEFF_DIR/.venv/bin/python" "$DIR/scripts/download_jeff_model.py" "knowledgator/gliformer-large-v1" "$MODEL_DIR"
fi

cd "$JEFF_DIR"
export JEFF_HOST="$HOST"
export JEFF_PORT="$PORT"
export JEFF_MODEL="$MODEL_DIR"
export JEFF_API_KEYS="$API_KEY"
# 自动调度 MPS / CPU (避免传递非法的 "auto" 字符串给 torch)
if [ -z "$JEFF_DEVICE" ]; then
    if "$JEFF_DIR/.venv/bin/python" -c "import torch; exit(0 if torch.backends.mps.is_available() else 1)" 2>/dev/null; then
        export JEFF_DEVICE="mps"
    else
        export JEFF_DEVICE="cpu"
    fi
fi

echo "==> 选定推理设备: $JEFF_DEVICE"
echo "==> Jeff 服务正在拉起中 (端口 $PORT)..."
exec "$JEFF_DIR/.venv/bin/jeff"
