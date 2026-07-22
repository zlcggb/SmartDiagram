"""Safe staging and deterministic type validation for uploaded materials."""

from __future__ import annotations

import hashlib
import re
import tempfile
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Final

from fastapi import UploadFile


MAX_MATERIAL_BYTES: Final[int] = 15 * 1024 * 1024
_READ_CHUNK_BYTES: Final[int] = 1024 * 1024
_MAX_ARCHIVE_ENTRIES: Final[int] = 10_000
_MAX_ARCHIVE_UNCOMPRESSED_BYTES: Final[int] = 100 * 1024 * 1024
_MAX_ARCHIVE_RATIO: Final[int] = 250


@dataclass(frozen=True)
class MaterialPolicy:
    mime_type: str
    declared_mime_types: frozenset[str]
    kind: str
    route_mode: str


_OCTET_STREAM = "application/octet-stream"
MATERIAL_POLICIES: Final[dict[str, MaterialPolicy]] = {
    ".pdf": MaterialPolicy("application/pdf", frozenset({"application/pdf"}), "pdf", "full-context"),
    ".docx": MaterialPolicy(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        frozenset(
            {
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                "application/msword",
                "application/zip",
            }
        ),
        "docx",
        "full-context",
    ),
    ".xlsx": MaterialPolicy(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        frozenset(
            {
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "application/vnd.ms-excel",
                "application/zip",
            }
        ),
        "xlsx",
        "full-context",
    ),
    ".pptx": MaterialPolicy(
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        frozenset(
            {
                "application/vnd.openxmlformats-officedocument.presentationml.presentation",
                "application/vnd.ms-powerpoint",
                "application/zip",
            }
        ),
        "pptx",
        "full-context",
    ),
    ".txt": MaterialPolicy("text/plain", frozenset({"text/plain"}), "text", "text"),
    ".md": MaterialPolicy("text/markdown", frozenset({"text/markdown", "text/plain"}), "text", "text"),
    ".csv": MaterialPolicy(
        "text/csv",
        frozenset({"text/csv", "application/csv", "application/vnd.ms-excel", "text/plain"}),
        "text",
        "text",
    ),
    ".json": MaterialPolicy(
        "application/json",
        frozenset({"application/json", "text/json", "text/plain"}),
        "text",
        "text",
    ),
    ".html": MaterialPolicy(
        "text/html",
        frozenset({"text/html", "application/xhtml+xml", "text/plain"}),
        "text",
        "text",
    ),
    ".xml": MaterialPolicy(
        "application/xml",
        frozenset({"application/xml", "text/xml", "text/plain"}),
        "text",
        "text",
    ),
    ".rtf": MaterialPolicy(
        "application/rtf",
        frozenset({"application/rtf", "text/rtf", "application/x-rtf", "text/plain"}),
        "text",
        "text",
    ),
    ".png": MaterialPolicy("image/png", frozenset({"image/png"}), "image", "vision"),
    ".jpg": MaterialPolicy("image/jpeg", frozenset({"image/jpeg"}), "image", "vision"),
    ".jpeg": MaterialPolicy("image/jpeg", frozenset({"image/jpeg"}), "image", "vision"),
    ".webp": MaterialPolicy("image/webp", frozenset({"image/webp"}), "image", "vision"),
}


class MaterialValidationError(ValueError):
    """A stable validation error that API routes can map to a structured 4xx."""

    def __init__(self, code: str, message: str, status_code: int = 422) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


@dataclass
class StagedMaterial:
    path: Path
    safe_filename: str
    suffix: str
    mime_type: str
    size_bytes: int
    content_hash: str
    kind: str
    route_mode: str
    processing_status: str

    def cleanup(self) -> None:
        self.path.unlink(missing_ok=True)


def sanitize_material_filename(filename: str | None, max_chars: int = 180) -> str:
    """Return a Unicode-preserving basename safe for storage metadata."""

    basename = (filename or "uploaded-file").replace("\\", "/").rsplit("/", 1)[-1]
    basename = "".join(character for character in basename if ord(character) >= 32 and ord(character) != 127)
    basename = re.sub(r"\s+", "_", basename.strip())
    basename = re.sub(r"[^\w.()\-]+", "_", basename, flags=re.UNICODE)
    basename = basename.strip("._") or "uploaded-file"
    suffix = Path(basename).suffix
    if len(basename) > max_chars:
        stem_budget = max(1, max_chars - len(suffix))
        basename = f"{Path(basename).stem[:stem_budget]}{suffix}"
    return basename


def _policy_for_filename(filename: str) -> tuple[str, MaterialPolicy]:
    suffix = Path(filename).suffix.lower()
    policy = MATERIAL_POLICIES.get(suffix)
    if not policy:
        raise MaterialValidationError(
            "unsupported_file_type",
            f"Unsupported material file type: {suffix or 'missing extension'}",
            415,
        )
    return suffix, policy


def _validate_declared_mime(declared_mime: str, policy: MaterialPolicy) -> None:
    normalized = (declared_mime or "").split(";", 1)[0].strip().lower()
    if normalized in {"", _OCTET_STREAM}:
        return
    if normalized not in policy.declared_mime_types:
        raise MaterialValidationError(
            "mime_type_mismatch",
            f"Declared MIME type {normalized} does not match the file extension.",
            415,
        )


def _validate_ooxml(path: Path, required_member: str) -> None:
    try:
        if not zipfile.is_zipfile(path):
            raise MaterialValidationError(
                "file_signature_mismatch",
                "The file content does not match its Office extension.",
                415,
            )
        with zipfile.ZipFile(path) as archive:
            infos = archive.infolist()
            if len(infos) > _MAX_ARCHIVE_ENTRIES:
                raise MaterialValidationError("unsafe_archive", "Office archive has too many entries.", 422)
            total_uncompressed = sum(info.file_size for info in infos)
            total_compressed = sum(max(1, info.compress_size) for info in infos)
            if total_uncompressed > _MAX_ARCHIVE_UNCOMPRESSED_BYTES:
                raise MaterialValidationError("unsafe_archive", "Office archive expands beyond the safety limit.", 422)
            if total_uncompressed > total_compressed * _MAX_ARCHIVE_RATIO:
                raise MaterialValidationError("unsafe_archive", "Office archive compression ratio is unsafe.", 422)
            if required_member not in set(archive.namelist()):
                raise MaterialValidationError(
                    "file_signature_mismatch",
                    "The Office package type does not match its extension.",
                    415,
                )
    except MaterialValidationError:
        raise
    except (OSError, zipfile.BadZipFile) as exc:
        raise MaterialValidationError("corrupt_document", "The Office document is corrupt.", 422) from exc


def _validate_signature(path: Path, suffix: str, policy: MaterialPolicy) -> None:
    with path.open("rb") as stream:
        header = stream.read(4096)
    if suffix == ".pdf":
        valid = header.startswith(b"%PDF-")
    elif suffix == ".png":
        valid = header.startswith(b"\x89PNG\r\n\x1a\n")
    elif suffix in {".jpg", ".jpeg"}:
        valid = header.startswith(b"\xff\xd8\xff")
    elif suffix == ".webp":
        valid = len(header) >= 12 and header[:4] == b"RIFF" and header[8:12] == b"WEBP"
    elif suffix == ".docx":
        _validate_ooxml(path, "word/document.xml")
        return
    elif suffix == ".xlsx":
        _validate_ooxml(path, "xl/workbook.xml")
        return
    elif suffix == ".pptx":
        _validate_ooxml(path, "ppt/presentation.xml")
        return
    else:
        valid = b"\x00" not in header
        if valid and suffix == ".rtf":
            valid = header.lstrip().startswith(b"{\\rtf")

    if not valid:
        raise MaterialValidationError(
            "file_signature_mismatch",
            f"The file content does not match {policy.kind}.",
            415,
        )


async def stage_material_upload(
    upload: UploadFile,
    *,
    max_bytes: int = MAX_MATERIAL_BYTES,
    temp_dir: str | Path | None = None,
) -> StagedMaterial:
    """Stream an upload to a bounded temporary file and validate its type."""

    safe_filename = sanitize_material_filename(upload.filename)
    suffix, policy = _policy_for_filename(safe_filename)
    _validate_declared_mime(upload.content_type or "", policy)
    directory = Path(temp_dir) if temp_dir is not None else None
    if directory is not None:
        directory.mkdir(parents=True, exist_ok=True)
    temporary = tempfile.NamedTemporaryFile(
        mode="wb",
        prefix="smartdiagram-material-",
        suffix=suffix,
        dir=directory,
        delete=False,
    )
    path = Path(temporary.name)
    digest = hashlib.sha256()
    size_bytes = 0
    try:
        with temporary:
            while True:
                chunk = await upload.read(_READ_CHUNK_BYTES)
                if not chunk:
                    break
                size_bytes += len(chunk)
                if size_bytes > max_bytes:
                    raise MaterialValidationError(
                        "file_too_large",
                        f"Material exceeds the {max_bytes}-byte upload limit.",
                        413,
                    )
                digest.update(chunk)
                temporary.write(chunk)
        if size_bytes == 0:
            raise MaterialValidationError("empty_file", "Uploaded material is empty.", 422)
        _validate_signature(path, suffix, policy)
        return StagedMaterial(
            path=path,
            safe_filename=safe_filename,
            suffix=suffix,
            mime_type=policy.mime_type,
            size_bytes=size_bytes,
            content_hash=digest.hexdigest(),
            kind=policy.kind,
            route_mode=policy.route_mode,
            processing_status="vision_required" if policy.route_mode == "vision" else "uploaded",
        )
    except Exception:
        path.unlink(missing_ok=True)
        raise
