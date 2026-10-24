"""短效 HMAC 视频播放签名令牌（供 <video> 标签免 Header 鉴权播放）。"""
from __future__ import annotations

import hashlib
import hmac
import os
import time

from auth_service import jwt_secret

PLAYBACK_TOKEN_TTL = 600  # 10 分钟
SHARE_TOKEN_TTL = 30 * 86400  # 30 天免登录只读分享有效期
_BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"


def _int_to_base62(num: int, width: int) -> str:
    chars = []
    for _ in range(width):
        num, rem = divmod(num, 62)
        chars.append(_BASE62[rem])
    return "".join(reversed(chars))


def _base62_to_int(s: str) -> int | None:
    val = 0
    for ch in s:
        idx = _BASE62.find(ch)
        if idx < 0:
            return None
        val = val * 62 + idx
    return val


def sign_playback_token(video_id: str, ttl_seconds: int = PLAYBACK_TOKEN_TTL) -> str:
    secret = jwt_secret().encode("utf-8")
    exp = int(time.time()) + ttl_seconds
    raw = f"{video_id}:{exp}".encode("utf-8")
    sig = hmac.new(secret, raw, hashlib.sha256).hexdigest()
    return f"{exp}.{sig}"


def verify_playback_token(video_id: str, token: str) -> bool:
    if not token or "." not in token:
        return False
    parts = token.split(".", 1)
    if len(parts) != 2:
        return False
    exp_str, sig = parts
    try:
        exp = int(exp_str)
    except ValueError:
        return False

    if exp < int(time.time()):
        return False

    secret = jwt_secret().encode("utf-8")
    raw = f"{video_id}:{exp}".encode("utf-8")
    expected_sig = hmac.new(secret, raw, hashlib.sha256).hexdigest()
    return hmac.compare_digest(sig, expected_sig)


def encode_short_share_code(analysis_id: str) -> str:
    """将 32 位 analysis_id 编码为 10 位自包含防伪 Base62 短码（如 1aB2cD3eF4）。"""
    clean_hex = (analysis_id or "").replace("-", "").strip().lower()[:8]
    if len(clean_hex) < 8:
        return ""
    try:
        prefix_int = int(clean_hex, 16)
    except ValueError:
        return ""
    prefix_b62 = _int_to_base62(prefix_int, 6)
    secret = jwt_secret().encode("utf-8")
    digest = hmac.new(secret, f"short_share:{clean_hex}".encode("utf-8"), hashlib.sha256).digest()
    sig_int = int.from_bytes(digest[:4], "big") % (62**4)
    sig_b62 = _int_to_base62(sig_int, 4)
    return f"{prefix_b62}{sig_b62}"


def decode_short_share_code(code: str) -> str | None:
    """校验 10 位防伪 Base62 短码并还原出 8 位 hex 前缀（失败返回 None）。"""
    c = (code or "").strip()
    if len(c) != 10:
        return None
    prefix_b62, sig_b62 = c[:6], c[6:]
    prefix_int = _base62_to_int(prefix_b62)
    if prefix_int is None or prefix_int > 0xFFFFFFFF:
        return None
    clean_hex = f"{prefix_int:08x}"
    secret = jwt_secret().encode("utf-8")
    digest = hmac.new(secret, f"short_share:{clean_hex}".encode("utf-8"), hashlib.sha256).digest()
    sig_int = int.from_bytes(digest[:4], "big") % (62**4)
    expected_sig = _int_to_base62(sig_int, 4)
    if not hmac.compare_digest(sig_b62, expected_sig):
        return None
    return clean_hex


def sign_share_token(analysis_id: str, ttl_seconds: int = SHARE_TOKEN_TTL) -> str:
    """签发 10 位极简防伪短码（同时向下兼容旧长格式）。"""
    short = encode_short_share_code(analysis_id)
    if short:
        return short
    secret = jwt_secret().encode("utf-8")
    exp = int(time.time()) + ttl_seconds
    raw = f"share:{analysis_id}:{exp}".encode("utf-8")
    sig = hmac.new(secret, raw, hashlib.sha256).hexdigest()[:32]
    return f"{exp}.{sig}"


def verify_share_token(analysis_id: str, token: str) -> bool:
    """校验免登录只读分享令牌（支持 10 位短码与旧版时间戳签名）。"""
    if not analysis_id or not token:
        return False
    t = token.strip()
    if len(t) == 10 and "." not in t:
        prefix = decode_short_share_code(t)
        clean_id = analysis_id.replace("-", "").lower()
        return bool(prefix and clean_id.startswith(prefix))
    if "." not in t:
        return False
    parts = t.split(".", 1)
    if len(parts) != 2:
        return False
    exp_str, sig = parts
    try:
        exp = int(exp_str)
    except ValueError:
        return False

    if exp < int(time.time()):
        return False

    secret = jwt_secret().encode("utf-8")
    raw = f"share:{analysis_id}:{exp}".encode("utf-8")
    expected_sig = hmac.new(secret, raw, hashlib.sha256).hexdigest()[:32]
    return hmac.compare_digest(sig, expected_sig)
