"""User-profile validation and avatar storage helpers."""

from __future__ import annotations

import hashlib
import io
import re
import unicodedata
import warnings
from typing import Any
from urllib.parse import quote

from PIL import Image, ImageOps, UnidentifiedImageError


MAX_DISPLAY_NAME_LENGTH = 40
MAX_AVATAR_UPLOAD_BYTES = 5 * 1024 * 1024
MAX_AVATAR_PIXELS = 20_000_000
AVATAR_EDGE_PX = 512

_ALLOWED_AVATAR_TYPES = {
    "image/jpeg": "JPEG",
    "image/png": "PNG",
    "image/webp": "WEBP",
}
_FORMAT_TO_CONTENT_TYPE = {value: key for key, value in _ALLOWED_AVATAR_TYPES.items()}


def validate_display_name(value: str) -> str:
    """Return a clean display name or raise a stable validation error."""

    normalized = value.strip()
    if not normalized:
        raise ValueError("display_name_required")
    if len(normalized) > MAX_DISPLAY_NAME_LENGTH:
        raise ValueError("display_name_too_long")
    if any(unicodedata.category(character).startswith("C") for character in normalized):
        raise ValueError("display_name_contains_control_characters")
    return normalized


def normalize_avatar_image(content: bytes, declared_content_type: str) -> tuple[bytes, dict[str, Any]]:
    """Validate, crop and re-encode an uploaded avatar as metadata-free WebP."""

    content_type = declared_content_type.split(";", 1)[0].strip().lower()
    if content_type not in _ALLOWED_AVATAR_TYPES:
        raise ValueError("avatar_type_not_supported")
    if not content:
        raise ValueError("avatar_empty")
    if len(content) > MAX_AVATAR_UPLOAD_BYTES:
        raise ValueError("avatar_too_large")

    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(content)) as uploaded:
                source_format = str(uploaded.format or "").upper()
                actual_content_type = _FORMAT_TO_CONTENT_TYPE.get(source_format)
                if actual_content_type != content_type:
                    raise ValueError("avatar_content_type_mismatch")
                width, height = uploaded.size
                if width < 1 or height < 1 or width * height > MAX_AVATAR_PIXELS:
                    raise ValueError("avatar_dimensions_invalid")

                oriented = ImageOps.exif_transpose(uploaded)
                has_alpha = "A" in oriented.getbands() or (
                    oriented.mode == "P" and "transparency" in oriented.info
                )
                converted = oriented.convert("RGBA" if has_alpha else "RGB")
                avatar = ImageOps.fit(
                    converted,
                    (AVATAR_EDGE_PX, AVATAR_EDGE_PX),
                    method=Image.Resampling.LANCZOS,
                    centering=(0.5, 0.5),
                )
                output = io.BytesIO()
                avatar.save(output, format="WEBP", quality=88, method=6)
    except ValueError:
        raise
    except (Image.DecompressionBombError, Image.DecompressionBombWarning, UnidentifiedImageError, OSError) as exc:
        raise ValueError("avatar_invalid_image") from exc

    normalized = output.getvalue()
    checksum = hashlib.sha256(normalized).hexdigest()
    return normalized, {
        "checksum": checksum,
        "content_type": "image/webp",
        "size_bytes": len(normalized),
        "width": AVATAR_EDGE_PX,
        "height": AVATAR_EDGE_PX,
    }


def profile_preferences(preferences: dict[str, Any] | None) -> dict[str, Any]:
    source = preferences if isinstance(preferences, dict) else {}
    profile = source.get("profile")
    return dict(profile) if isinstance(profile, dict) else {}


def preferences_with_profile(
    preferences: dict[str, Any] | None,
    profile: dict[str, Any],
) -> dict[str, Any]:
    updated = dict(preferences) if isinstance(preferences, dict) else {}
    updated["profile"] = dict(profile)
    return updated


def avatar_url_from_preferences(user_id: str, preferences: dict[str, Any] | None) -> str | None:
    profile = profile_preferences(preferences)
    storage_key = str(profile.get("avatar_storage_key") or "")
    checksum = str(profile.get("avatar_checksum") or "")
    if not storage_key or not checksum:
        return None
    return f"/api/auth/avatar/{quote(user_id, safe='')}/{quote(checksum, safe='')}.webp"


def avatar_storage_key(tenant_id: str, user_id: str, checksum: str) -> str:
    def safe_segment(value: str) -> str:
        normalized = re.sub(r"[^A-Za-z0-9._-]+", "_", value.strip())
        return normalized or "unknown"

    return (
        f"tenants/{safe_segment(tenant_id)}/users/{safe_segment(user_id)}"
        f"/avatar/{safe_segment(checksum)}.webp"
    )
