import { readAuthSession } from './auth';

export const API_BASE = import.meta.env.DEV ? 'http://localhost:8000' : '';

export const FALLBACK_ENTERPRISE_CONTEXT = {
  tenantId: 'anonymous-local',
  userId: 'anonymous',
  teamId: 'anonymous-team',
  projectId: 'anonymous-project',
  roles: ['member'],
  scopes: [
    'project:read',
    'diagram:read',
    'diagram:write',
    'artifact:read',
    'artifact:write',
    'tool:diagram',
    'tool:office',
    'knowledge:read',
    'template:read',
    'preference:read',
    'export:basic',
  ],
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
  if (!session) return FALLBACK_ENTERPRISE_CONTEXT;
  return {
    tenantId: session.user.tenant_id,
    userId: session.user.id,
    teamId: session.user.team_id,
    projectId: session.user.project_id,
    roles: session.user.roles,
    scopes: session.user.scopes,
    token: session.access_token,
  };
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
    'x-team-id': context.teamId,
    'x-roles': context.roles.join(','),
    'x-scopes': context.scopes.join(','),
  };
  if (options.includeProject && context.projectId) {
    headers['x-project-id'] = context.projectId;
  }
  if ('token' in context && context.token) {
    headers.Authorization = `Bearer ${context.token}`;
  }
  if (json) headers['Content-Type'] = 'application/json';
  return headers;
};

export const enterpriseBodyContext = (options: EnterpriseContextOptions = {}) => ({
  tenant_id: currentEnterpriseContext().tenantId,
  user_id: currentEnterpriseContext().userId,
  team_id: currentEnterpriseContext().teamId,
  ...(options.includeProject && currentEnterpriseContext().projectId
    ? { project_id: currentEnterpriseContext().projectId }
    : {}),
  roles: currentEnterpriseContext().roles,
  scopes: currentEnterpriseContext().scopes,
});

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
