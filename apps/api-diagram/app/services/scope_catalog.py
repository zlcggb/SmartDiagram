"""Shared OAuth-style scope catalogs for auth and account profiles."""

MEMBER_SCOPES = [
    "project:read",
    "diagram:read",
    "diagram:write",
    "artifact:read",
    "artifact:write",
    "tool:diagram",
    "tool:office",
    "knowledge:read",
    "template:read",
    "preference:read",
    "export:basic",
]

ADMIN_SCOPES = [
    "project:read",
    "project:write",
    "diagram:read",
    "diagram:write",
    "artifact:read",
    "artifact:write",
    "tool:diagram",
    "tool:office",
    "knowledge:read",
    "knowledge:write",
    "template:read",
    "template:write",
    "preference:read",
    "preference:write",
    "export:basic",
    "export:pdf",
    "export:pptx",
    "approval:read",
    "approval:write",
    "audit:read",
]
