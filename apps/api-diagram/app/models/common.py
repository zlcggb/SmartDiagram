"""Shared model helpers."""

from datetime import datetime, timezone
from uuid import uuid4


def new_id() -> str:
    """Return a stable string id suitable for public API references."""

    return uuid4().hex


def utc_now() -> datetime:
    """Return a UTC timestamp compatible with SQLModel's naive DateTime columns."""

    return datetime.now(timezone.utc).replace(tzinfo=None)
