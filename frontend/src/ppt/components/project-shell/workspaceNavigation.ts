export function workspaceNavTarget(projectId: string | undefined, path: string): string {
  if (!projectId) return "/ppt";
  return `/ppt/p/${encodeURIComponent(projectId)}/${path}`;
}
