import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import {
  MaterialRouteModeSchema,
  type MaterialRouteMode,
  type ProjectMaterialDto
} from "@ppt-agent/shared";
import { z } from "zod";
import {
  KnowledgeGatewayError,
  MAX_MULTIPART_BYTES,
  createKnowledgeGateway,
  normalizeKnowledgeMaterialStatus,
  type KnowledgeDocumentSnapshot,
  type KnowledgeGateway
} from "../lib/knowledgeGateway.js";
import { prisma } from "../lib/prisma.js";
import { fail, ok } from "../lib/response.js";

type DateLike = Date | string;

export interface StoredProjectMaterial {
  id: string;
  projectId: string;
  knowledgeDocumentId: string;
  knowledgeSourceId: string;
  ingestionJobId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  contentHash: string;
  routeMode: string;
  status: string;
  errorMessage: string | null;
  createdAt: DateLike;
  updatedAt: DateLike;
}

export interface MaterialRoutePersistence {
  project: {
    findUnique(input: { where: { id: string }; select?: { id: true } }): Promise<{ id: string } | null>;
  };
  projectMaterial: {
    findMany(input: {
      where: { projectId: string };
      orderBy?: { createdAt: "asc" | "desc" };
    }): Promise<StoredProjectMaterial[]>;
    findFirst(input: { where: { id: string; projectId: string } }): Promise<StoredProjectMaterial | null>;
    create(input: { data: Omit<StoredProjectMaterial, "createdAt" | "updatedAt"> }): Promise<StoredProjectMaterial>;
    deleteMany(input: { where: { id: string; projectId: string } }): Promise<{ count: number }>;
  };
}

interface MaterialRouteOptions {
  persistence?: MaterialRoutePersistence;
  gateway?: KnowledgeGateway;
}

type ProjectParams = { id: string };
type MaterialParams = { id: string; materialId: string };

const uploadQuerySchema = z.object({
  routeMode: MaterialRouteModeSchema.optional().default("auto"),
  parseProfile: z.enum(["auto", "fast", "deep"]).optional().default("auto")
});

function toIso(value: DateLike) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function routeMode(value: string): MaterialRouteMode {
  const parsed = MaterialRouteModeSchema.safeParse(value);
  return parsed.success ? parsed.data : "auto";
}

export function formatStoredProjectMaterial(
  material: StoredProjectMaterial,
  knowledge?: KnowledgeDocumentSnapshot | null
): ProjectMaterialDto {
  const normalized = normalizeKnowledgeMaterialStatus(knowledge?.status ?? material.status, {
    status: knowledge?.ingestion.status,
    progress: knowledge?.ingestion.progress,
    errorMessage: knowledge?.ingestion.errorMessage ?? material.errorMessage ?? undefined
  });
  return {
    id: material.id,
    projectId: material.projectId,
    filename: knowledge?.filename || material.filename,
    mimeType: knowledge?.mimeType || material.mimeType,
    sizeBytes: knowledge?.sizeBytes ?? material.sizeBytes,
    routeMode: routeMode(material.routeMode),
    status: normalized.status,
    ...(normalized.errorMessage ? { errorMessage: normalized.errorMessage } : {}),
    documentId: material.knowledgeDocumentId,
    sourceId: material.knowledgeSourceId,
    jobId: material.ingestionJobId,
    createdAt: knowledge?.createdAt || toIso(material.createdAt),
    updatedAt: knowledge?.updatedAt || toIso(material.updatedAt)
  };
}

export function formatProjectMaterialGatewayFailure(
  material: StoredProjectMaterial,
  error: unknown
): ProjectMaterialDto {
  const fallback = formatStoredProjectMaterial(material);
  if (
    error instanceof KnowledgeGatewayError &&
    error.statusCode >= 400 &&
    error.statusCode < 500
  ) {
    return { ...fallback, status: "failed", errorMessage: error.message };
  }
  return fallback;
}

async function projectExists(persistence: MaterialRoutePersistence, projectId: string) {
  return Boolean(await persistence.project.findUnique({ where: { id: projectId }, select: { id: true } }));
}

async function liveMaterialDto(
  gateway: KnowledgeGateway,
  material: StoredProjectMaterial,
  requestHeaders: Record<string, string | string[] | undefined>
) {
  try {
    const knowledge = await gateway.getDocument(material.knowledgeDocumentId, {
      projectId: material.projectId,
      requestHeaders
    });
    return formatStoredProjectMaterial(material, knowledge);
  } catch (error) {
    return formatProjectMaterialGatewayFailure(material, error);
  }
}

function gatewayFailure(error: KnowledgeGatewayError) {
  return fail(error.message);
}

export async function materialRoutes(app: FastifyInstance, options: MaterialRouteOptions = {}) {
  const persistence = options.persistence ?? (prisma as unknown as MaterialRoutePersistence);
  const gateway = options.gateway ?? createKnowledgeGateway();

  app.addContentTypeParser(
    /^multipart\/form-data\b/i,
    { parseAs: "buffer", bodyLimit: MAX_MULTIPART_BYTES },
    (_request, body, done) => done(null, body)
  );

  app.post<{ Params: ProjectParams; Querystring: { routeMode?: string; parseProfile?: string } }>(
    "/api/projects/:id/materials",
    { bodyLimit: MAX_MULTIPART_BYTES },
    async (request, reply) => {
      if (!(await projectExists(persistence, request.params.id))) {
        return reply.status(404).send(fail("未找到项目"));
      }
      const query = uploadQuerySchema.safeParse(request.query ?? {});
      if (!query.success) {
        return reply.status(400).send(fail("资料处理模式无效"));
      }
      if (!Buffer.isBuffer(request.body)) {
        return reply.status(400).send(fail("未收到有效的资料文件"));
      }

      const contentType = request.headers["content-type"];
      if (typeof contentType !== "string") {
        return reply.status(415).send(fail("资料上传必须使用 multipart/form-data"));
      }

      const materialId = crypto.randomUUID();
      let knowledge: KnowledgeDocumentSnapshot;
      try {
        knowledge = await gateway.uploadMaterial({
          projectId: request.params.id,
          materialId,
          routeMode: query.data.routeMode,
          parseProfile: query.data.parseProfile,
          contentType,
          rawBody: request.body,
          requestHeaders: request.headers
        });
      } catch (error) {
        if (error instanceof KnowledgeGatewayError) {
          return reply.status(error.statusCode).send(gatewayFailure(error));
        }
        throw error;
      }

      const normalized = normalizeKnowledgeMaterialStatus(knowledge.status, {
        status: knowledge.ingestion.status,
        progress: knowledge.ingestion.progress,
        errorMessage: knowledge.ingestion.errorMessage
      });
      const stored = await persistence.projectMaterial.create({
        data: {
          id: materialId,
          projectId: request.params.id,
          knowledgeDocumentId: knowledge.documentId,
          knowledgeSourceId: knowledge.sourceId,
          ingestionJobId: knowledge.jobId,
          filename: knowledge.filename,
          mimeType: knowledge.mimeType,
          sizeBytes: knowledge.sizeBytes,
          contentHash: knowledge.contentHash,
          routeMode: query.data.routeMode,
          status: normalized.status,
          errorMessage: normalized.errorMessage ?? null
        }
      });
      return reply.status(201).send(ok(formatStoredProjectMaterial(stored, knowledge), "资料已上传，正在处理"));
    }
  );

  app.get<{ Params: ProjectParams }>("/api/projects/:id/materials", async (request, reply) => {
    if (!(await projectExists(persistence, request.params.id))) {
      return reply.status(404).send(fail("未找到项目"));
    }
    const materials = await persistence.projectMaterial.findMany({
      where: { projectId: request.params.id },
      orderBy: { createdAt: "asc" }
    });
    const data = await Promise.all(
      materials.map((material) => liveMaterialDto(gateway, material, request.headers))
    );
    return reply.send(ok(data));
  });

  app.get<{ Params: MaterialParams }>(
    "/api/projects/:id/materials/:materialId",
    async (request, reply) => {
      const material = await persistence.projectMaterial.findFirst({
        where: { id: request.params.materialId, projectId: request.params.id }
      });
      if (!material) return reply.status(404).send(fail("未找到资料"));
      return reply.send(ok(await liveMaterialDto(gateway, material, request.headers)));
    }
  );

  app.delete<{ Params: MaterialParams }>(
    "/api/projects/:id/materials/:materialId",
    async (request, reply) => {
      const result = await persistence.projectMaterial.deleteMany({
        where: { id: request.params.materialId, projectId: request.params.id }
      });
      if (result.count === 0) return reply.status(404).send(fail("未找到资料"));
      return reply.send(ok({ id: request.params.materialId }, "资料已从项目移除"));
    }
  );
}
