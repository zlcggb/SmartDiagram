"""Object storage abstraction for export and knowledge assets."""

import hashlib
import hmac
from datetime import datetime, timezone
from pathlib import Path
from typing import Protocol, TypedDict
from urllib import request
from urllib.parse import quote, urlencode, urlparse

from app.core.config import settings


class ObjectInfo(TypedDict):
    storage_key: str
    size_bytes: int
    checksum: str
    content_type: str


class ObjectStorage(Protocol):
    backend_name: str

    def put_object(
        self,
        storage_key: str,
        content: bytes,
        content_type: str = "application/octet-stream",
    ) -> ObjectInfo:
        ...

    def get_object(self, storage_key: str) -> bytes:
        ...

    def delete_object(self, storage_key: str) -> None:
        ...

    def head_object(self, storage_key: str) -> ObjectInfo:
        ...

    def get_signed_url(self, storage_key: str, expires_in: int = 3600) -> str:
        ...


class LocalObjectStorage:
    """Filesystem-backed storage adapter for local development."""

    backend_name = "local"

    def __init__(self, root: str | Path | None = None) -> None:
        if root is None:
            root = Path(__file__).resolve().parents[2] / "storage" / "objects"
        self.root = Path(root)

    def _path_for_key(self, storage_key: str) -> Path:
        normalized = storage_key.strip().lstrip("/")
        if not normalized or ".." in Path(normalized).parts:
            raise ValueError("Invalid storage key")
        return self.root / normalized

    def put_object(
        self,
        storage_key: str,
        content: bytes,
        content_type: str = "application/octet-stream",
    ) -> ObjectInfo:
        path = self._path_for_key(storage_key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
        return {
            "storage_key": storage_key,
            "size_bytes": len(content),
            "checksum": hashlib.sha256(content).hexdigest(),
            "content_type": content_type,
        }

    def get_object(self, storage_key: str) -> bytes:
        return self._path_for_key(storage_key).read_bytes()

    def delete_object(self, storage_key: str) -> None:
        path = self._path_for_key(storage_key)
        if path.exists():
            path.unlink()

    def head_object(self, storage_key: str) -> ObjectInfo:
        path = self._path_for_key(storage_key)
        content = path.read_bytes()
        return {
            "storage_key": storage_key,
            "size_bytes": len(content),
            "checksum": hashlib.sha256(content).hexdigest(),
            "content_type": "application/octet-stream",
        }

    def get_signed_url(self, storage_key: str, expires_in: int = 3600) -> str:
        """Return a local signed-url placeholder."""

        return f"local://{quote(storage_key)}?expires_in={expires_in}"


class S3CompatibleObjectStorage:
    """S3/R2-compatible adapter using AWS Signature Version 4.

    The adapter intentionally uses the Python standard library so the project
    can support S3/R2 without pulling boto3 into the local demo. It signs basic
    PUT/GET/HEAD/DELETE requests and presigned GET URLs.
    """

    backend_name = "s3"

    def __init__(
        self,
        *,
        endpoint_url: str,
        bucket: str,
        region: str,
        access_key_id: str,
        secret_access_key: str,
        public_base_url: str = "",
    ) -> None:
        if not endpoint_url or not bucket:
            raise ValueError("S3 object storage requires endpoint URL and bucket")
        if not access_key_id or not secret_access_key:
            raise ValueError("S3 object storage requires access key and secret")
        self.endpoint_url = endpoint_url.rstrip("/")
        self.bucket = bucket.strip("/")
        self.region = region or "auto"
        self.access_key_id = access_key_id
        self.secret_access_key = secret_access_key
        self.public_base_url = public_base_url.rstrip("/")

    def _safe_key(self, storage_key: str) -> str:
        normalized = storage_key.strip().lstrip("/")
        if not normalized or ".." in Path(normalized).parts:
            raise ValueError("Invalid storage key")
        return normalized

    def _object_url(self, storage_key: str) -> str:
        key = quote(self._safe_key(storage_key), safe="/")
        return f"{self.endpoint_url}/{self.bucket}/{key}"

    def _canonical_uri(self, storage_key: str) -> str:
        return "/" + quote(f"{self.bucket}/{self._safe_key(storage_key)}", safe="/")

    def _credential_scope(self, datestamp: str) -> str:
        return f"{datestamp}/{self.region}/s3/aws4_request"

    def _signing_key(self, datestamp: str) -> bytes:
        key_date = hmac.new(
            f"AWS4{self.secret_access_key}".encode("utf-8"),
            datestamp.encode("utf-8"),
            hashlib.sha256,
        ).digest()
        key_region = hmac.new(key_date, self.region.encode("utf-8"), hashlib.sha256).digest()
        key_service = hmac.new(key_region, b"s3", hashlib.sha256).digest()
        return hmac.new(key_service, b"aws4_request", hashlib.sha256).digest()

    def _now(self) -> tuple[str, str]:
        current = datetime.now(timezone.utc)
        return current.strftime("%Y%m%dT%H%M%SZ"), current.strftime("%Y%m%d")

    def _authorization_header(
        self,
        *,
        method: str,
        storage_key: str,
        payload_hash: str,
        content_type: str = "",
    ) -> dict[str, str]:
        amz_date, datestamp = self._now()
        host = urlparse(self.endpoint_url).netloc
        headers = {
            "host": host,
            "x-amz-content-sha256": payload_hash,
            "x-amz-date": amz_date,
        }
        if content_type:
            headers["content-type"] = content_type
        signed_header_names = sorted(headers)
        canonical_headers = "".join(f"{name}:{headers[name]}\n" for name in signed_header_names)
        signed_headers = ";".join(signed_header_names)
        canonical_request = "\n".join(
            [
                method.upper(),
                self._canonical_uri(storage_key),
                "",
                canonical_headers,
                signed_headers,
                payload_hash,
            ]
        )
        credential_scope = self._credential_scope(datestamp)
        string_to_sign = "\n".join(
            [
                "AWS4-HMAC-SHA256",
                amz_date,
                credential_scope,
                hashlib.sha256(canonical_request.encode("utf-8")).hexdigest(),
            ]
        )
        signature = hmac.new(
            self._signing_key(datestamp),
            string_to_sign.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()
        return {
            "Authorization": (
                "AWS4-HMAC-SHA256 "
                f"Credential={self.access_key_id}/{credential_scope}, "
                f"SignedHeaders={signed_headers}, Signature={signature}"
            ),
            "X-Amz-Content-Sha256": payload_hash,
            "X-Amz-Date": amz_date,
            **({"Content-Type": content_type} if content_type else {}),
        }

    def _request(
        self,
        method: str,
        storage_key: str,
        *,
        content: bytes = b"",
        content_type: str = "",
    ) -> bytes:
        payload_hash = hashlib.sha256(content).hexdigest()
        headers = self._authorization_header(
            method=method,
            storage_key=storage_key,
            payload_hash=payload_hash,
            content_type=content_type,
        )
        req = request.Request(
            self._object_url(storage_key),
            data=content if method.upper() in {"PUT", "POST"} else None,
            headers=headers,
            method=method.upper(),
        )
        with request.urlopen(req, timeout=settings.OBJECT_STORAGE_HTTP_TIMEOUT_SECONDS) as response:
            return response.read()

    def put_object(
        self,
        storage_key: str,
        content: bytes,
        content_type: str = "application/octet-stream",
    ) -> ObjectInfo:
        self._request("PUT", storage_key, content=content, content_type=content_type)
        return {
            "storage_key": storage_key,
            "size_bytes": len(content),
            "checksum": hashlib.sha256(content).hexdigest(),
            "content_type": content_type,
        }

    def get_object(self, storage_key: str) -> bytes:
        return self._request("GET", storage_key)

    def delete_object(self, storage_key: str) -> None:
        self._request("DELETE", storage_key)

    def head_object(self, storage_key: str) -> ObjectInfo:
        self._request("HEAD", storage_key)
        return {
            "storage_key": storage_key,
            "size_bytes": 0,
            "checksum": "",
            "content_type": "application/octet-stream",
        }

    def get_signed_url(self, storage_key: str, expires_in: int = 3600) -> str:
        key = self._safe_key(storage_key)
        amz_date, datestamp = self._now()
        credential_scope = self._credential_scope(datestamp)
        host = urlparse(self.endpoint_url).netloc
        query = {
            "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
            "X-Amz-Credential": f"{self.access_key_id}/{credential_scope}",
            "X-Amz-Date": amz_date,
            "X-Amz-Expires": str(max(60, min(expires_in, 86400))),
            "X-Amz-SignedHeaders": "host",
        }
        canonical_query = urlencode(sorted(query.items()), quote_via=quote)
        canonical_request = "\n".join(
            [
                "GET",
                self._canonical_uri(key),
                canonical_query,
                f"host:{host}\n",
                "host",
                "UNSIGNED-PAYLOAD",
            ]
        )
        string_to_sign = "\n".join(
            [
                "AWS4-HMAC-SHA256",
                amz_date,
                credential_scope,
                hashlib.sha256(canonical_request.encode("utf-8")).hexdigest(),
            ]
        )
        signature = hmac.new(
            self._signing_key(datestamp),
            string_to_sign.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()
        return f"{self.endpoint_url}/{self.bucket}/{quote(key, safe='/')}?{canonical_query}&X-Amz-Signature={signature}"


def get_object_storage() -> ObjectStorage:
    """Return the configured object storage adapter."""

    backend = settings.OBJECT_STORAGE_BACKEND.lower()
    if backend == "local":
        return LocalObjectStorage(settings.OBJECT_STORAGE_LOCAL_ROOT or None)
    if backend in {"s3", "r2"}:
        storage = S3CompatibleObjectStorage(
            endpoint_url=settings.S3_ENDPOINT_URL,
            bucket=settings.S3_BUCKET,
            region=settings.S3_REGION,
            access_key_id=settings.S3_ACCESS_KEY_ID,
            secret_access_key=settings.S3_SECRET_ACCESS_KEY,
            public_base_url=settings.S3_PUBLIC_BASE_URL,
        )
        storage.backend_name = backend
        return storage
    raise ValueError(f"Unsupported object storage backend: {settings.OBJECT_STORAGE_BACKEND}")
