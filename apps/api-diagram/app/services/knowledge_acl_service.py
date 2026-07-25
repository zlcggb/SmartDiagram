"""Explicit ACL policy evaluation for enterprise knowledge resources."""

from collections import defaultdict
from typing import Any, Literal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.knowledge import KnowledgeACL
from app.state.agent_runtime import PermissionContext

ResourceDecision = Literal["allow", "deny", "inherit"]


def _subject_matches(rule: KnowledgeACL, permission_context: PermissionContext) -> bool:
    subject_type = rule.subject_type
    subject_id = rule.subject_id
    if subject_type in {"all", "public"}:
        return True
    if subject_type == "tenant":
        return subject_id == permission_context.get("tenant_id")
    if subject_type == "user":
        return subject_id == permission_context.get("user_id")
    if subject_type == "team":
        return subject_id == permission_context.get("team_id")
    if subject_type == "project":
        return subject_id == permission_context.get("project_id")
    if subject_type == "role":
        return subject_id in set(permission_context.get("roles", []))
    return False


def _scope_matches(rule: KnowledgeACL, required_scope: str) -> bool:
    scopes = [str(scope).strip() for scope in (rule.scopes_json or []) if str(scope).strip()]
    if not scopes:
        return True
    return (
        required_scope in scopes
        or "*" in scopes
        or "knowledge:*" in scopes
    )


def _rule_matches(
    rule: KnowledgeACL,
    permission_context: PermissionContext,
    required_scope: str,
) -> bool:
    return _subject_matches(rule, permission_context) and _scope_matches(rule, required_scope)


def _resource_decision(
    rules: list[KnowledgeACL],
    permission_context: PermissionContext,
    required_scope: str,
) -> ResourceDecision:
    """Evaluate explicit rules for one resource.

    Deny wins. If a resource has allow rules, at least one must match. If it
    only has non-matching deny rules, the resource inherits the next fallback.
    """

    matching_denies = [
        rule
        for rule in rules
        if rule.effect == "deny" and _rule_matches(rule, permission_context, required_scope)
    ]
    if matching_denies:
        return "deny"

    allow_rules = [rule for rule in rules if rule.effect == "allow"]
    if not allow_rules:
        return "inherit"
    if any(_rule_matches(rule, permission_context, required_scope) for rule in allow_rules):
        return "allow"
    return "deny"


def _base_resource_scope_allowed(
    metadata: dict[str, Any],
    permission_context: PermissionContext,
    required_scope: str,
) -> bool:
    tenant_id = permission_context.get("tenant_id")
    if tenant_id and metadata.get("tenant_id") != tenant_id:
        return False

    project_id = permission_context.get("project_id")
    if project_id and metadata.get("project_id") not in (None, project_id):
        return False

    team_id = permission_context.get("team_id")
    if team_id and metadata.get("team_id") not in (None, team_id):
        return False

    allowed_scopes = permission_context.get("allowed_knowledge_scopes", [])
    return required_scope in allowed_scopes


async def explicit_acl_allows_knowledge(
    session: AsyncSession,
    metadata: dict[str, Any],
    permission_context: PermissionContext,
    *,
    required_scope: str = "knowledge:read",
) -> bool | None:
    """Evaluate persisted KnowledgeACL records.

    Returns:
      - True when explicit ACL records allow access.
      - False when explicit ACL records deny access.
      - None when no explicit ACL records apply and callers should fall back.
    """

    if not _base_resource_scope_allowed(metadata, permission_context, required_scope):
        return False

    resources = [
        ("source", metadata.get("source_id")),
        ("document", metadata.get("document_id")),
        ("chunk", metadata.get("chunk_id")),
    ]
    resource_filters = [
        (resource_type, resource_id)
        for resource_type, resource_id in resources
        if resource_id
    ]
    if not resource_filters:
        return None

    statement = select(KnowledgeACL).where(
        KnowledgeACL.tenant_id == permission_context.get("tenant_id"),
    )
    rules = list((await session.execute(statement)).scalars().all())
    matching_rules = [
        rule
        for rule in rules
        if (rule.resource_type, rule.resource_id) in resource_filters
    ]
    if not matching_rules:
        return None

    rules_by_resource: dict[tuple[str, str], list[KnowledgeACL]] = defaultdict(list)
    for rule in matching_rules:
        rules_by_resource[(rule.resource_type, rule.resource_id)].append(rule)

    saw_allow = False
    for resource_type, resource_id in resource_filters:
        decision = _resource_decision(
            rules_by_resource.get((resource_type, resource_id), []),
            permission_context,
            required_scope,
        )
        if decision == "deny":
            return False
        if decision == "allow":
            saw_allow = True

    return True if saw_allow else None


def build_default_knowledge_acl_rules(
    permission_context: PermissionContext,
    *,
    source_id: str | None,
    document_id: str | None,
    created_by: str | None,
) -> list[KnowledgeACL]:
    """Create default explicit read ACL rules for newly uploaded knowledge."""

    tenant_id = permission_context.get("tenant_id") or "local"
    roles = permission_context.get("roles", []) or ["owner"]
    resources = [
        ("source", source_id),
        ("document", document_id),
    ]
    rules: list[KnowledgeACL] = []
    for resource_type, resource_id in resources:
        if not resource_id:
            continue
        for role in roles:
            rules.append(
                KnowledgeACL(
                    tenant_id=tenant_id,
                    resource_type=resource_type,
                    resource_id=resource_id,
                    subject_type="role",
                    subject_id=role,
                    effect="allow",
                    scopes_json=["knowledge:read"],
                    created_by=created_by,
                )
            )
    return rules
