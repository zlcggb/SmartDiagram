"""Governed enterprise diagram template services."""

import re
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.artifacts.catalog import artifact_family_for_engine, is_office_artifact
from app.models.audit import AuditEvent
from app.models.common import utc_now
from app.models.knowledge import DiagramTemplate
from app.services.access_control_service import (
    can_access_project,
    ensure_project_membership,
    ensure_team_membership,
    is_tenant_admin,
)
from app.services.audit_service import ensure_principals
from app.services.permission_service import can_read_template, can_write_template
from app.state.agent_runtime import PermissionContext


def _string_list(value: Any) -> list[str]:
    if value is None or value == "":
        return []
    if isinstance(value, str):
        return [item.strip() for item in value.split(",") if item.strip()]
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    return [str(value).strip()]


def _terms(text: str) -> set[str]:
    terms: set[str] = set()
    for token in re.findall(r"[\w\u4e00-\u9fff]+", (text or "").lower()):
        terms.add(token)
        cjk = [ch for ch in token if "\u4e00" <= ch <= "\u9fff"]
        if cjk:
            terms.update(cjk)
            terms.update("".join(cjk[index : index + 2]) for index in range(len(cjk) - 1))
    return terms


def serialize_diagram_template(template: DiagramTemplate, *, include_code: bool = True) -> dict[str, Any]:
    """Return a safe API and Agent payload."""

    metadata = template.metadata_json or {}
    artifact_family = str(metadata.get("artifact_family") or artifact_family_for_engine(template.engine_type))
    payload = {
        "template_id": template.id,
        "tenant_id": template.tenant_id,
        "team_id": template.team_id,
        "project_id": template.project_id,
        "name": template.name,
        "description": template.description,
        "engine_type": template.engine_type,
        "task_type": template.task_type,
        "visibility": template.visibility,
        "status": template.status,
        "priority": template.priority,
        "artifact_family": artifact_family,
        "tags": template.tags_json or [],
        "style": template.style_json or {},
        "metadata": metadata,
        "usage_count": template.usage_count,
        "created_by": template.created_by,
        "created_at": template.created_at.isoformat() if template.created_at else None,
        "updated_at": template.updated_at.isoformat() if template.updated_at else None,
    }
    if include_code:
        payload["template_code"] = template.template_code
    return payload


async def _can_access_template(
    session: AsyncSession,
    permission_context: PermissionContext,
    template: DiagramTemplate,
    *,
    required_scope: str,
) -> bool:
    if template.tenant_id != permission_context.get("tenant_id"):
        return False
    if template.status != "active" and required_scope == "template:read":
        return False
    if template.project_id and not await can_access_project(
        session,
        permission_context,
        template.project_id,
        required_scope,
    ):
        return False
    if template.team_id and template.team_id != permission_context.get("team_id") and not is_tenant_admin(permission_context):
        return False

    acl = template.acl_json or {}
    allowed_roles = acl.get("roles") or []
    if allowed_roles and not any(role in permission_context.get("roles", []) for role in allowed_roles):
        return False
    required_scopes = acl.get("scopes") or []
    if required_scopes and not all(scope in permission_context.get("scopes", []) for scope in required_scopes):
        return False
    return True


def _template_score(
    template: DiagramTemplate,
    *,
    query: str,
    engine_type: str,
    task_type: str,
) -> float:
    score = float(template.priority or 0)
    if engine_type and template.engine_type == engine_type:
        score += 30
    if task_type and template.task_type == task_type:
        score += 20
    query_terms = _terms(query)
    template_terms = _terms(
        " ".join(
            [
                template.name,
                template.description,
                " ".join(template.tags_json or []),
                str((template.metadata_json or {}).get("domain", "")),
            ]
        )
    )
    if query_terms:
        score += (len(query_terms & template_terms) / len(query_terms)) * 40
    score += min(template.usage_count or 0, 20) * 0.1
    return score


async def create_diagram_template(
    session: AsyncSession,
    permission_context: PermissionContext,
    payload: dict[str, Any],
) -> DiagramTemplate:
    """Create a governed template for diagrams or compatible artifact types."""

    if not can_write_template(permission_context):
        raise PermissionError("missing_template_write_scope")

    created_principals = await ensure_principals(session, permission_context, None)
    if permission_context.get("team_id"):
        await ensure_team_membership(session, permission_context)

    project_id = str(payload.get("project_id") or payload.get("projectId") or permission_context.get("project_id") or "") or None
    engine_type = str(payload.get("engine_type") or payload.get("engineType") or "").strip()
    task_type = str(payload.get("task_type") or payload.get("taskType") or "").strip()
    artifact_family = artifact_family_for_engine(engine_type)
    if project_id:
        if created_principals.get("project"):
            artifact_scope = "artifact:read" if is_office_artifact(engine_type) else "diagram:read"
            await ensure_project_membership(
                session,
                permission_context,
                project_id=project_id,
                scopes=["project:read", artifact_scope, "template:read", "template:write"],
            )
        elif not await can_access_project(session, permission_context, project_id, "template:write"):
            raise PermissionError("missing_project_access")

    name = " ".join(str(payload.get("name") or "Untitled template").split())[:120]
    metadata = payload.get("metadata") if isinstance(payload.get("metadata"), dict) else {}
    metadata = dict(metadata)
    metadata.setdefault("artifact_family", artifact_family)
    if is_office_artifact(engine_type):
        metadata.setdefault("artifact_type", engine_type)
    template = DiagramTemplate(
        tenant_id=permission_context["tenant_id"],
        team_id=str(payload.get("team_id") or payload.get("teamId") or permission_context.get("team_id") or "") or None,
        project_id=project_id,
        name=name,
        description=str(payload.get("description") or "")[:1000],
        engine_type=engine_type,
        task_type=task_type,
        visibility=str(payload.get("visibility") or ("project" if project_id else "team")).strip(),
        status=str(payload.get("status") or "active").strip(),
        priority=int(payload.get("priority") or 0),
        tags_json=_string_list(payload.get("tags")),
        template_code=str(payload.get("template_code") or payload.get("templateCode") or ""),
        style_json=payload.get("style") if isinstance(payload.get("style"), dict) else {},
        acl_json=payload.get("acl") if isinstance(payload.get("acl"), dict) else {"roles": permission_context.get("roles", [])},
        metadata_json=metadata,
        created_by=permission_context.get("user_id"),
    )
    session.add(template)
    await session.flush()
    session.add(
        AuditEvent(
            tenant_id=template.tenant_id,
            project_id=template.project_id,
            user_id=permission_context.get("user_id"),
            event_type="diagram.template.created" if artifact_family == "diagram" else "artifact.template.created",
            severity="info",
            message="Created governed artifact template.",
            metadata_json={
                "template_id": template.id,
                "name": template.name,
                "artifact_family": artifact_family,
                "engine_type": template.engine_type,
                "task_type": template.task_type,
                "visibility": template.visibility,
                "tags": template.tags_json,
            },
        )
    )
    return template


async def list_authorized_diagram_templates(
    session: AsyncSession,
    permission_context: PermissionContext,
    *,
    query: str = "",
    engine_type: str = "",
    task_type: str = "",
    limit: int = 20,
    include_code: bool = True,
) -> list[dict[str, Any]]:
    """List templates visible to the caller, ranked for a diagram or artifact request."""

    if not can_read_template(permission_context):
        raise PermissionError("missing_template_read_scope")

    statement = select(DiagramTemplate).where(
        DiagramTemplate.tenant_id == permission_context.get("tenant_id"),
        DiagramTemplate.status == "active",
    )
    if permission_context.get("project_id"):
        statement = statement.where(
            (DiagramTemplate.project_id == permission_context["project_id"])
            | (DiagramTemplate.project_id.is_(None))
        )
    if permission_context.get("team_id"):
        statement = statement.where(
            (DiagramTemplate.team_id == permission_context["team_id"])
            | (DiagramTemplate.team_id.is_(None))
        )
    if engine_type:
        statement = statement.where((DiagramTemplate.engine_type == engine_type) | (DiagramTemplate.engine_type == ""))
    if task_type:
        statement = statement.where((DiagramTemplate.task_type == task_type) | (DiagramTemplate.task_type == ""))

    rows = list((await session.execute(statement)).scalars().all())
    authorized: list[tuple[float, DiagramTemplate]] = []
    for template in rows:
        if await _can_access_template(
            session,
            permission_context,
            template,
            required_scope="template:read",
        ):
            authorized.append(
                (
                    _template_score(
                        template,
                        query=query,
                        engine_type=engine_type,
                        task_type=task_type,
                    ),
                    template,
                )
            )
    ranked = sorted(authorized, key=lambda item: (item[0], item[1].updated_at), reverse=True)[: max(1, min(limit, 100))]
    return [
        {
            **serialize_diagram_template(template, include_code=include_code),
            "match_score": round(score, 4),
        }
        for score, template in ranked
    ]


async def select_best_diagram_template(
    session: AsyncSession,
    permission_context: PermissionContext,
    *,
    query: str,
    engine_type: str,
    task_type: str,
) -> dict[str, Any] | None:
    """Return the highest-ranked authorized template and increment usage."""

    templates = await list_authorized_diagram_templates(
        session,
        permission_context,
        query=query,
        engine_type=engine_type,
        task_type=task_type,
        limit=3,
        include_code=True,
    )
    if not templates:
        return None

    template = await session.get(DiagramTemplate, templates[0]["template_id"])
    if template:
        artifact_family = artifact_family_for_engine(template.engine_type)
        template.usage_count += 1
        template.updated_at = utc_now()
        session.add(
            AuditEvent(
                tenant_id=template.tenant_id,
                project_id=template.project_id,
                user_id=permission_context.get("user_id"),
                event_type="diagram.template.selected" if artifact_family == "diagram" else "artifact.template.selected",
                severity="info",
                message="Selected governed artifact template for Agent generation.",
                metadata_json={
                    "template_id": template.id,
                    "name": template.name,
                    "artifact_family": artifact_family,
                    "engine_type": template.engine_type,
                    "task_type": template.task_type,
                    "match_score": templates[0]["match_score"],
                },
            )
        )
    return templates[0]


async def create_artifact_template(
    session: AsyncSession,
    permission_context: PermissionContext,
    payload: dict[str, Any],
) -> DiagramTemplate:
    """Compatibility wrapper for artifact template creation."""

    return await create_diagram_template(session, permission_context, payload)


async def list_authorized_artifact_templates(
    session: AsyncSession,
    permission_context: PermissionContext,
    *,
    query: str = "",
    engine_type: str = "",
    task_type: str = "",
    limit: int = 20,
    include_code: bool = True,
) -> list[dict[str, Any]]:
    """Compatibility wrapper for governed artifact template listing."""

    return await list_authorized_diagram_templates(
        session,
        permission_context,
        query=query,
        engine_type=engine_type,
        task_type=task_type,
        limit=limit,
        include_code=include_code,
    )


async def select_best_artifact_template(
    session: AsyncSession,
    permission_context: PermissionContext,
    *,
    query: str,
    engine_type: str,
    task_type: str,
) -> dict[str, Any] | None:
    """Compatibility wrapper for selecting the best governed artifact template."""

    return await select_best_diagram_template(
        session,
        permission_context,
        query=query,
        engine_type=engine_type,
        task_type=task_type,
    )
