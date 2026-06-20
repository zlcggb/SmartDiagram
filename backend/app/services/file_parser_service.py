"""File parsing service for knowledge ingestion."""

from pathlib import Path
from typing import Any, Literal, TypedDict


BlockType = Literal["text", "table"]


class ParsedBlock(TypedDict, total=False):
    type: BlockType
    text: str
    page: int
    sheet: str
    row_count: int
    metadata: dict[str, Any]


class ParsedDocument(TypedDict):
    filename: str
    mime_type: str
    blocks: list[ParsedBlock]
    metadata: dict[str, Any]


def _read_text(path: Path) -> str:
    for encoding in ("utf-8", "utf-8-sig", "gb18030", "latin-1"):
        try:
            return path.read_text(encoding=encoding)
        except UnicodeDecodeError:
            continue
    return path.read_bytes().decode("utf-8", errors="replace")


def _parse_pdf(path: Path) -> list[ParsedBlock]:
    from pypdf import PdfReader

    reader = PdfReader(str(path))
    blocks: list[ParsedBlock] = []
    for index, page in enumerate(reader.pages, start=1):
        text = page.extract_text() or ""
        if text.strip():
            blocks.append({"type": "text", "text": text.strip(), "page": index})
    return blocks


def _parse_docx(path: Path) -> list[ParsedBlock]:
    from docx import Document

    document = Document(str(path))
    blocks: list[ParsedBlock] = []
    paragraph_text = "\n".join(
        paragraph.text.strip()
        for paragraph in document.paragraphs
        if paragraph.text.strip()
    )
    if paragraph_text:
        blocks.append({"type": "text", "text": paragraph_text})

    for table_index, table in enumerate(document.tables, start=1):
        rows: list[str] = []
        for row in table.rows:
            cells = [cell.text.strip() for cell in row.cells]
            if any(cells):
                rows.append(" | ".join(cells))
        if rows:
            blocks.append(
                {
                    "type": "table",
                    "text": "\n".join(rows),
                    "row_count": len(rows),
                    "metadata": {"table_index": table_index},
                }
            )
    return blocks


def _parse_spreadsheet(path: Path, suffix: str) -> list[ParsedBlock]:
    import pandas as pd

    blocks: list[ParsedBlock] = []
    if suffix == ".csv":
        frame = pd.read_csv(path)
        text = frame.to_markdown(index=False)
        return [{"type": "table", "text": text, "sheet": "csv", "row_count": len(frame)}]

    sheets = pd.read_excel(path, sheet_name=None)
    for sheet_name, frame in sheets.items():
        if frame.empty:
            continue
        blocks.append(
            {
                "type": "table",
                "text": frame.to_markdown(index=False),
                "sheet": str(sheet_name),
                "row_count": len(frame),
            }
        )
    return blocks


def parse_file(path: str | Path, mime_type: str = "", filename: str | None = None) -> ParsedDocument:
    """Parse a local file into normalized text/table blocks."""

    file_path = Path(path)
    suffix = file_path.suffix.lower()
    display_name = filename or file_path.name

    if suffix == ".pdf" or mime_type == "application/pdf":
        blocks = _parse_pdf(file_path)
    elif suffix == ".docx" or mime_type.endswith("wordprocessingml.document"):
        blocks = _parse_docx(file_path)
    elif suffix in {".xlsx", ".xls", ".csv"}:
        blocks = _parse_spreadsheet(file_path, suffix)
    else:
        text = _read_text(file_path).strip()
        blocks = [{"type": "text", "text": text}] if text else []

    return {
        "filename": display_name,
        "mime_type": mime_type,
        "blocks": blocks,
        "metadata": {
            "suffix": suffix,
            "block_count": len(blocks),
            "size_bytes": file_path.stat().st_size,
        },
    }
