"""Safety policy checks for rendered office artifact HTML."""

import re
from typing import TypedDict


BLOCKED_HTML_TAGS = {"script", "iframe", "object", "embed", "form"}
BLOCKED_ATTR_PREFIXES = ("on",)
MAX_HTML_CHARS = 180_000


class HtmlPolicyResult(TypedDict):
    ok: bool
    errors: list[str]
    warnings: list[str]


def validate_rendered_html_policy(html: str) -> HtmlPolicyResult:
    """Check rendered HTML for unsafe constructs before preview/export."""

    errors: list[str] = []
    warnings: list[str] = []
    lowered = html.lower()

    if len(html) > MAX_HTML_CHARS:
        errors.append("Rendered HTML is too large")

    for tag in sorted(BLOCKED_HTML_TAGS):
        if re.search(rf"<\s*/?\s*{re.escape(tag)}(?:\s|>|/)", lowered):
            errors.append(f"Rendered HTML must not contain <{tag}> tags")

    for attr_prefix in BLOCKED_ATTR_PREFIXES:
        if re.search(rf"\s{re.escape(attr_prefix)}[a-z0-9_-]*\s*=", lowered):
            errors.append(f"Rendered HTML must not contain {attr_prefix}* event attributes")

    if "javascript:" in lowered:
        errors.append("Rendered HTML must not contain javascript: URLs")
    if "data:text/html" in lowered:
        errors.append("Rendered HTML must not contain data:text/html URLs")
    if "<style" in lowered:
        warnings.append("Rendered HTML contains style blocks; inline styles are preferred for email")

    return {"ok": not errors, "errors": errors, "warnings": warnings}

