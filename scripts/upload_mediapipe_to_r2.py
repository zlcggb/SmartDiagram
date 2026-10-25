#!/usr/bin/env python3
"""将 MediaPipe 模型与 WASM 运行时上传至 Cloudflare R2（S3 兼容存储），并校验公开访问域名与 CORS。"""

from __future__ import annotations

import ssl
import sys
from pathlib import Path
from urllib import request

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "apps" / "api-diagram"))

from app.core.config import settings  # noqa: E402
from app.services.object_storage import S3CompatibleObjectStorage, _SSL_CONTEXT  # noqa: E402

MIME_MAP = {
    ".mjs": "text/javascript",
    ".js": "application/javascript",
    ".wasm": "application/wasm",
    ".task": "application/octet-stream",
}

CACHE_CONTROL_IMMUTABLE = "public, max-age=31536000, immutable"


def resolve_content_type(file_path: Path) -> str:
    return MIME_MAP.get(file_path.suffix.lower(), "application/octet-stream")


def main() -> int:
    source_dir = REPO_ROOT / "apps" / "web" / "public" / "mediapipe"
    if not source_dir.exists():
        fallback_dir = REPO_ROOT / "backups" / "mediapipe"
        if fallback_dir.exists():
            source_dir = fallback_dir
    if len(sys.argv) > 1:
        source_dir = Path(sys.argv[1]).resolve()

    if not source_dir.exists():
        print(f"❌ 未找到本地 MediaPipe 目录: {source_dir}", file=sys.stderr)
        return 1

    settings.OBJECT_STORAGE_HTTP_TIMEOUT_SECONDS = max(settings.OBJECT_STORAGE_HTTP_TIMEOUT_SECONDS, 120)

    storage = S3CompatibleObjectStorage(
        endpoint_url=settings.S3_ENDPOINT_URL,
        bucket=settings.S3_BUCKET,
        region=settings.S3_REGION,
        access_key_id=settings.S3_ACCESS_KEY_ID,
        secret_access_key=settings.S3_SECRET_ACCESS_KEY,
        public_base_url=settings.S3_PUBLIC_BASE_URL,
    )

    files = sorted(p for p in source_dir.rglob("*") if p.is_file())
    if not files:
        print(f"❌ 目录为空: {source_dir}", file=sys.stderr)
        return 1

    print(f"🚀 开始上传 {len(files)} 个 MediaPipe 文件至 R2 桶 '{storage.bucket}'...")
    for file_path in files:
        rel_path = file_path.relative_to(source_dir).as_posix()
        storage_key = f"mediapipe/{rel_path}"
        content_type = resolve_content_type(file_path)
        content = file_path.read_bytes()
        size_mb = len(content) / (1024 * 1024)

        print(f"  ⬆️  正在上传 {storage_key} ({size_mb:.2f} MB, {content_type}) ...", end=" ", flush=True)
        storage.put_object(
            storage_key=storage_key,
            content=content,
            content_type=content_type,
            cache_control=CACHE_CONTROL_IMMUTABLE,
        )
        public_url = storage.get_public_url(storage_key)
        print(f"✅ 完成 -> {public_url or storage_key}")

    # 校验公开域名与 CORS
    if storage.public_base_url:
        test_key = "mediapipe/vision_bundle.mjs"
        test_url = storage.get_public_url(test_key)
        if test_url:
            print(f"\n🔍 正在校验公开域名与 CORS: {test_url}")
            req = request.Request(
                test_url,
                headers={
                    "Origin": "http://localhost:5173",
                    "User-Agent": "SmartDiagram-R2-Verifier/1.0",
                },
                method="HEAD",
            )
            with request.urlopen(req, timeout=15, context=_SSL_CONTEXT) as resp:
                cors_origin = resp.headers.get("Access-Control-Allow-Origin")
                cache_hdr = resp.headers.get("Cache-Control")
                ct_hdr = resp.headers.get("Content-Type")
                print(f"  • HTTP 状态: {resp.status}")
                print(f"  • Content-Type: {ct_hdr}")
                print(f"  • Cache-Control: {cache_hdr}")
                print(f"  • Access-Control-Allow-Origin: {cors_origin or '⚠️ 未检测到 (请在 Cloudflare R2 桶设置中添加 CORS Policy)'}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
