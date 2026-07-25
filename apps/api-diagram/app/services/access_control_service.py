"""Enterprise access-control helpers for project-scoped resources."""

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.project import Project, ProjectMember
from app.models.tenant import TeamMember
from app.state.agent_runtime import PermissionContext


ADMIN_ROLES = {"owner", "admin"}
PROJECT_ROLE_SCOPES = {
    "owner": {"project:read", "project:write", "diagram:read", "diagram:write", "knowledge:read", "knowledge:write", "template:read", "template:write", "preference:read", "preference:write", "export:basic", "export:pdf", "export:pptx", "approval:read", "approval:write"},
    "admin": {"project:read", "project:write", "diagram:read", "diagram:write", "knowledge:read", "knowledge:write", "template:read", "template:write", "preference:read", "preference:write", "export:basic", "export:pdf", "export:pptx", "approval:read", "approval:write"},
    "editor": {"project:read", "project:write", "diagram:read", "diagram:write", "knowledge:read", "knowledge:write", "template:read", "template:write", "preference:read", "preference:write", "export:basic", "export:pdf", "approval:read", "approval:write"},
    "member": {"project:read", "diagram:read", "diagram:write", "knowledge:read", "template:read", "preference:read", "export:basic"},
    "viewer": {"project:read", "diagram:read", "knowledge:read", "template:read", "preference:read", "export:basic"},
}


def _roles(permission_context: PermissionContext) -> list[str]:
    return [str(role).strip() for role in permission_context.get("roles", []) if str(role).strip()]


def is_tenant_admin(permission_context: PermissionContext) -> bool:
    """Return whether the request-level role is tenant-admin-like."""

    return bool(set(_roles(permission_context)) & ADMIN_ROLES)


def _scopes_for_member(member: ProjectMember) -> set[str]:
    explicit = {str(scope).strip() for scope in (member.scopes_json or []) if str(scope).strip()}
    if explicit:
        return explicit
    return set(PROJECT_ROLE_SCOPES.get(member.role, {"project:read"}))


async def get_project(session: AsyncSession, project_id: str | None) -> Project | None:
    """Load a project if an id is present."""

    if not project_id:
        return None
    return await session.get(Project, project_id)


async def get_project_member(
    session: AsyncSession,
    tenant_id: str,
    project_id: str,
    user_id: str,
) -> ProjectMember | None:
    """Load a project membership row."""

    statement = select(ProjectMember).where(
        ProjectMember.tenant_id == tenant_id,
        ProjectMember.project_id == project_id,
        ProjectMember.user_id == user_id,
    )
    return (await session.execute(statement)).scalar_one_or_none()


async def ensure_project_membership(
    session: AsyncSession,
    permission_context: PermissionContext,
    project_id: str | None = None,
    role: str | None = None,
    scopes: list[str] | None = None,
) -> ProjectMember | None:
    """Create or extend membership for a resource creator."""

    target_project_id = project_id or permission_context.get("project_id")
    tenant_id = permission_context.get("tenant_id") or "local"
    user_id = permission_context.get("user_id") or "anonymous"
    if not target_project_id or not user_id:
        return None

    member = await get_project_member(session, tenant_id, target_project_id, user_id)
    if member:
        if scopes:
            merged = sorted(_scopes_for_member(member) | set(scopes))
            member.scopes_json = merged
        return member

    member_role = role or (_roles(permission_context) or ["owner"])[0]
    member_scopes = scopes or sorted(
        set(permission_context.get("scopes", []))
        | PROJECT_ROLE_SCOPES.get(member_role, {"project:read"})
    )
    member = ProjectMember(
        tenant_id=tenant_id,
        project_id=target_project_id,
        user_id=user_id,
        role=member_role,
        scopes_json=member_scopes,
    )
    session.add(member)
    await session.flush()
    return member


async def ensure_team_membership(
    session: AsyncSession,
    permission_context: PermissionContext,
    role: str | None = None,
) -> TeamMember | None:
    """Create a team membership for local project creators."""

    tenant_id = permission_context.get("tenant_id") or "local"
    team_id = permission_context.get("team_id")
    user_id = permission_context.get("user_id") or "anonymous"
    if not team_id or not user_id:
        return None

    statement = select(TeamMember).where(
        TeamMember.tenant_id == tenant_id,
        TeamMember.team_id == team_id,
        TeamMember.user_id == user_id,
    )
    member = (await session.execute(statement)).scalar_one_or_none()
    if member:
        return member

    member = TeamMember(
        tenant_id=tenant_id,
        team_id=team_id,
        user_id=user_id,
        role=role or (_roles(permission_context) or ["member"])[0],
    )
    session.add(member)
    await session.flush()
    return member


async def can_access_project(
    session: AsyncSession,
    permission_context: PermissionContext,
    project_id: str | None,
    required_scope: str = "project:read",
) -> bool:
    """Check project membership and scope for a project-scoped resource."""

    if not project_id:
        return True

    tenant_id = permission_context.get("tenant_id") or "local"
    user_id = permission_context.get("user_id") or "anonymous"
    project = await get_project(session, project_id)
    if not project or project.tenant_id != tenant_id:
        return False

    if is_tenant_admin(permission_context):
        return True

    member = await get_project_member(session, tenant_id, project_id, user_id)
    if not member:
        return False

    member_scopes = _scopes_for_member(member)
    return required_scope in member_scopes or "project:write" in member_scopes


def serialize_project_access(permission_context: PermissionContext, project_id: str | None) -> dict[str, Any]:
    """Return a safe audit payload for project access decisions."""

    return {
        "tenant_id": permission_context.get("tenant_id"),
        "user_id": permission_context.get("user_id"),
        "project_id": project_id,
        "roles": permission_context.get("roles", []),
        "scopes": permission_context.get("scopes", []),
    }
