export const API_BASE = import.meta.env.DEV ? 'http://localhost:8000' : '';

export const LOCAL_ENTERPRISE_CONTEXT = {
  tenantId: 'local',
  userId: 'anonymous',
  teamId: 'local-team',
  projectId: 'local-project',
  roles: ['owner'],
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

export const hasProjectContext = () => Boolean(LOCAL_ENTERPRISE_CONTEXT.projectId);

export const enterpriseHeaders = (json = true, options: EnterpriseContextOptions = {}): Record<string, string> => {
  const headers: Record<string, string> = {
    'x-tenant-id': LOCAL_ENTERPRISE_CONTEXT.tenantId,
    'x-user-id': LOCAL_ENTERPRISE_CONTEXT.userId,
    'x-team-id': LOCAL_ENTERPRISE_CONTEXT.teamId,
    'x-roles': LOCAL_ENTERPRISE_CONTEXT.roles.join(','),
    'x-scopes': ENTERPRISE_SCOPES.join(','),
  };
  if (options.includeProject && LOCAL_ENTERPRISE_CONTEXT.projectId) {
    headers['x-project-id'] = LOCAL_ENTERPRISE_CONTEXT.projectId;
  }
  if (json) headers['Content-Type'] = 'application/json';
  return headers;
};

export const enterpriseBodyContext = (options: EnterpriseContextOptions = {}) => ({
  tenant_id: LOCAL_ENTERPRISE_CONTEXT.tenantId,
  user_id: LOCAL_ENTERPRISE_CONTEXT.userId,
  team_id: LOCAL_ENTERPRISE_CONTEXT.teamId,
  ...(options.includeProject && LOCAL_ENTERPRISE_CONTEXT.projectId
    ? { project_id: LOCAL_ENTERPRISE_CONTEXT.projectId }
    : {}),
  roles: LOCAL_ENTERPRISE_CONTEXT.roles,
  scopes: ENTERPRISE_SCOPES,
});
