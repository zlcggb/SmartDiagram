export type PptPrincipal =
  | { kind: "user"; tenantId: string; userId: string }
  | { kind: "guest"; guestKey: string }
  | { kind: "internal" };

export interface ProjectOwnerRecord {
  ownerType: string;
  tenantId: string | null;
  ownerKey: string | null;
  expiresAt: Date | string | null;
}

export const DEFAULT_GUEST_PROJECT_TTL_MS = 24 * 60 * 60 * 1000;

export function guestProjectTtlMs() {
  const configured = Number(process.env.PPT_GUEST_PROJECT_TTL_SECONDS ?? 86_400) * 1000;
  return Number.isFinite(configured)
    ? Math.max(5 * 60 * 1000, Math.min(7 * 24 * 60 * 60 * 1000, Math.trunc(configured)))
    : DEFAULT_GUEST_PROJECT_TTL_MS;
}

export function projectOwnerData(
  principal: Exclude<PptPrincipal, { kind: "internal" }>,
  now = new Date()
) {
  if (principal.kind === "user") {
    return {
      ownerType: "user",
      tenantId: principal.tenantId,
      ownerKey: principal.userId,
      expiresAt: null
    } as const;
  }
  return {
    ownerType: "guest",
    tenantId: null,
    ownerKey: principal.guestKey,
    expiresAt: new Date(now.getTime() + guestProjectTtlMs())
  } as const;
}

export function projectOwnerWhere(principal: Exclude<PptPrincipal, { kind: "internal" }>) {
  if (principal.kind === "user") {
    return {
      ownerType: "user",
      tenantId: principal.tenantId,
      ownerKey: principal.userId
    } as const;
  }
  return {
    ownerType: "guest",
    ownerKey: principal.guestKey,
    expiresAt: { gt: new Date() }
  } as const;
}

export function canPrincipalAccessProject(
  principal: PptPrincipal,
  project: ProjectOwnerRecord,
  now = new Date()
) {
  if (principal.kind === "internal") return true;
  if (project.ownerType === "legacy" || !project.ownerKey) return false;
  if (principal.kind === "user") {
    return (
      project.ownerType === "user" &&
      project.tenantId === principal.tenantId &&
      project.ownerKey === principal.userId
    );
  }
  const expiresAt = project.expiresAt ? new Date(project.expiresAt) : null;
  return (
    project.ownerType === "guest" &&
    project.ownerKey === principal.guestKey &&
    Boolean(expiresAt && expiresAt.getTime() > now.getTime())
  );
}

