#!/usr/bin/env python3
"""下载 Jeff 所需的 GLiFormer 模型权重到本地 models/ 目录。

支持环境变量:
- JEFF_MODEL_REPO: HuggingFace 仓库名 (默认: knowledgator/gliformer-large-v1)
- JEFF_MODEL_DIR: 本地保存目录 (默认: models/gliformer-large-v1)
- HF_ENDPOINT: HuggingFace 镜像源 (默认优先用环境变量或官方)
"""
import os
import sys
from pathlib import Path

# 默认参数
DEFAULT_REPO = os.environ.get("JEFF_MODEL_REPO", "knowledgator/gliformer-large-v1")
PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_LOCAL_DIR = os.environ.get(
    "JEFF_MODEL_DIR", str(PROJECT_ROOT / "models" / "gliformer-large-v1")
)


def download_model(repo_id: str, local_dir: str):
    print(f"==> 开始检查与下载模型权重: {repo_id}")
    print(f"==> 目标本地目录: {local_dir}")
    os.makedirs(local_dir, exist_ok=True)

    try:
        from huggingface_hub import snapshot_download
    except ImportError:
        print("错误: 未安装 huggingface_hub，正在尝试使用 pip 安装...")
        import subprocess

        subprocess.check_call([sys.executable, "-m", "pip", "install", "huggingface_hub"])
        from huggingface_hub import snapshot_download

    # 下载模型快照 (自动断点续传)
    downloaded_path = snapshot_download(
        repo_id=repo_id,
        local_dir=local_dir,
        local_dir_use_symlinks=False,
        resume_download=True,
    )
    print(f"==> 模型权重下载完成: {downloaded_path}")
    return downloaded_path


if __name__ == "__main__":
    repo = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_REPO
    target_dir = sys.argv[2] if len(sys.argv) > 2 else DEFAULT_LOCAL_DIR
    download_model(repo, target_dir)
