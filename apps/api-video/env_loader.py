"""从 SmartDiagram 仓库根目录 .env 或当前目录 local.env 加载环境变量（不覆盖已存在的值）。"""
from __future__ import annotations

import os
from pathlib import Path

_SERVICE_DIR = Path(__file__).resolve().parent
_MONO_ROOT = _SERVICE_DIR.parent.parent


def _load_env_file(path: Path) -> bool:
    if not path.is_file():
        return False
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return False
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].strip()
        if "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip()
        val = val.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = val
    return True


def _ensure_no_proxy() -> None:
    """确保本地微服务 (127.0.0.1:8001 Jeff) 与国内视频站直连不走海外代理。"""
    direct_hosts = [
        "127.0.0.1",
        "localhost",
        "douyin.com",
        "iesdouyin.com",
        "bilibili.com",
        "b23.tv",
    ]
    for key in ("NO_PROXY", "no_proxy"):
        cur = [h.strip() for h in os.environ.get(key, "").split(",") if h.strip()]
        for h in direct_hosts:
            if h not in cur:
                cur.append(h)
        os.environ[key] = ",".join(cur)


def load_local_env() -> bool:
    """优先加载本服务目录 .env / local.env，再回退加载 monorepo 根 .env。"""
    loaded = False
    for candidate in (
        _SERVICE_DIR / ".env",
        _SERVICE_DIR / "local.env",
        _MONO_ROOT / ".env",
    ):
        if _load_env_file(candidate):
            loaded = True
    _ensure_no_proxy()
    return loaded
