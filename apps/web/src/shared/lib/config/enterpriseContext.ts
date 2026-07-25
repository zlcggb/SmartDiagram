import { readAuthSession } from './auth.ts';
import { guestAuthorizationHeader, readGuestSession } from './guestSession.ts';

export const API_BASE = import.meta.env?.DEV ? 'http://localhost:8000' : '';

export const GUEST_ENTERPRISE_CONTEXT = {
  tenantId: 'guest-pool',
  userId: '',
  teamId: '',
  projectId: '',
  roles: ['guest'],
  scopes: ['diagram:read', 'diagram:write', 'tool:diagram', 'export:basic'],
};

export const ENTERPRISE_SCOPES = [
  'project:read',
  'project:write',
  'diagram:read',
  'diagram:write',
  'tool:diagram',
  'knowledge:read',
  'knowledge:write',
  'template:read',
  'template:write',
  'preference:read',
  'preference:write',
  'export:basic',
  'export:pdf',
  'export:pptx',
  'approval:read',
  'approval:write',
];

interface EnterpriseContextOptions {
  includeProject?: boolean;
}

export const currentEnterpriseContext = () => {
  const session = readAuthSession();
  if (session) {
    return {
      tenantId: session.user.tenant_id,
      userId: session.user.id,
      teamId: session.user.team_id,
      projectId: session.user.project_id,
      roles: session.user.roles,
      scopes: session.user.scopes,
      token: session.access_token,
      kind: 'user' as const,
    };
  }

  const guest = readGuestSession();
  if (guest) {
    return {
      ...GUEST_ENTERPRISE_CONTEXT,
      token: guest.access_token,
      kind: 'guest' as const,
      guestId: guest.guest_id,
    };
  }

  return { ...GUEST_ENTERPRISE_CONTEXT, kind: 'guest' as const };
};

export const hasProjectContext = () => Boolean(currentEnterpriseContext().projectId);

export const canReadOps = () => {
  const context = currentEnterpriseContext();
  const roles = new Set(context.roles);
  return (roles.has('admin') || roles.has('owner')) && context.scopes.includes('audit:read');
};

export const enterpriseHeaders = (json = true, options: EnterpriseContextOptions = {}): Record<string, string> => {
  const context = currentEnterpriseContext();
  const headers: Record<string, string> = {
    'x-tenant-id': context.tenantId,
    'x-user-id': context.userId,
    'x-roles': context.roles.join(','),
    'x-scopes': context.scopes.join(','),
  };
  if (context.teamId) headers['x-team-id'] = context.teamId;
  if (options.includeProject && context.projectId) {
    headers['x-project-id'] = context.projectId;
  }
  if ('token' in context && context.token) {
    headers.Authorization = `Bearer ${context.token}`;
  } else {
    Object.assign(headers, guestAuthorizationHeader());
  }
  if (json) headers['Content-Type'] = 'application/json';
  return headers;
};

export const enterpriseBodyContext = (options: EnterpriseContextOptions = {}) => {
  const context = currentEnterpriseContext();
  return {
    tenant_id: context.tenantId,
    user_id: context.userId,
    team_id: context.teamId || undefined,
    ...(options.includeProject && context.projectId ? { project_id: context.projectId } : {}),
    roles: context.roles,
    scopes: context.scopes,
  };
};

export const enterpriseQueryParams = (options: EnterpriseContextOptions = {}) => {
  const context = currentEnterpriseContext();
  const params = new URLSearchParams({
    tenant_id: context.tenantId,
    user_id: context.userId,
    roles: context.roles.join(','),
    scopes: context.scopes.join(','),
  });
  if (options.includeProject && context.projectId) {
    params.set('project_id', context.projectId);
  }
  return params;
};
