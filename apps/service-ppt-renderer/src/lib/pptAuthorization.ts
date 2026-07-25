import type { FastifyInstance, FastifyRequest } from "fastify";
import { fail } from "./response.js";
import { prisma } from "./prisma.js";
import {
  canPrincipalAccessProject,
  type PptPrincipal,
  type ProjectOwnerRecord
} from "./pptAccess.js";
import { PptAuthError, resolvePptPrincipal, type ResolvePptPrincipalOptions } from "./pptPrincipal.js";

const principals = new WeakMap<object, PptPrincipal>();

export function getPptPrincipal(request: FastifyRequest) {
  const principal = principals.get(request);
  if (!principal) throw new PptAuthError("请求身份尚未解析", 401);
  return principal;
}

function protectedApiPath(pathname: string) {
  return (
    pathname === "/api/ai/usage" ||
    pathname.startsWith("/api/projects") ||
    pathname.startsWith("/api/media")
  );
}

function projectIdFromRequest(request: FastifyRequest) {
  const params = request.params as { id?: unknown } | undefined;
  const id = String(params?.id ?? "").trim();
  return id || null;
}

export interface PptAuthorizationOptions extends ResolvePptPrincipalOptions {
  lookupProject?: (projectId: string) => Promise<ProjectOwnerRecord | null>;
}

export function installPptAuthorization(app: FastifyInstance, options: PptAuthorizationOptions = {}) {
  const lookupProject = options.lookupProject ?? (async (projectId: string) => prisma.project.findUnique({
    where: { id: projectId },
    select: { ownerType: true, tenantId: true, ownerKey: true, expiresAt: true }
  }));

  app.addHook("preHandler", async (request, reply) => {
    const pathname = request.url.split("?", 1)[0] ?? request.url;
    if (!protectedApiPath(pathname)) return;

    let principal: PptPrincipal;
    try {
      principal = await resolvePptPrincipal(request.headers, options);
    } catch (error) {
      const statusCode = error instanceof PptAuthError ? error.statusCode : 401;
      const message = error instanceof Error ? error.message : "身份验证失败";
      return reply.status(statusCode).send(fail(message));
    }
    principals.set(request, principal);

    const projectId = projectIdFromRequest(request);
    if (!projectId || principal.kind === "internal") return;
    const project = await lookupProject(projectId);
    if (!project || !canPrincipalAccessProject(principal, project)) {
      return reply.status(404).send(fail("未找到项目"));
    }
  });
}
