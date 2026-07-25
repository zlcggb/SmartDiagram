import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { KnowledgeGatewayError, type KnowledgeGateway } from "../lib/knowledgeGateway.js";
import { buildApp } from "../app.js";
import { materialRoutes, type MaterialRoutePersistence } from "./materials.js";

function storedMaterial(overrides: Record<string, unknown> = {}) {
  return {
    id: "material-1",
    projectId: "project-1",
    knowledgeDocumentId: "document-1",
    knowledgeSourceId: "source-1",
    ingestionJobId: "job-1",
    filename: "demo.txt",
    mimeType: "text/plain",
    sizeBytes: 12,
    contentHash: "hash-1",
    routeMode: "auto",
    status: "processing",
    errorMessage: null,
    createdAt: new Date("2026-07-23T00:00:00Z"),
    updatedAt: new Date("2026-07-23T00:00:00Z"),
    ...overrides
  };
}

function fakePersistence() {
  const records = [storedMaterial()];
  const created: unknown[] = [];
  const deleted: unknown[] = [];
  const persistence: MaterialRoutePersistence = {
    project: {
      findUnique: async ({ where }) => (where.id === "missing" ? null : { id: where.id })
    },
    projectMaterial: {
      findMany: async ({ where }) => records.filter((item) => item.projectId === where.projectId),
      findFirst: async ({ where }) =>
        records.find((item) => item.id === where.id && item.projectId === where.projectId) ?? null,
      create: async ({ data }) => {
        const record = storedMaterial(data);
        records.push(record);
        created.push(data);
        return record;
      },
      deleteMany: async ({ where }) => {
        deleted.push(where);
        return { count: records.some((item) => item.id === where.id && item.projectId === where.projectId) ? 1 : 0 };
      }
    }
  };
  return { persistence, records, created, deleted };
}

function fakeGateway(overrides: Partial<KnowledgeGateway> = {}): KnowledgeGateway {
  return {
    uploadMaterial: async () => ({
      documentId: "uploaded-document",
      sourceId: "uploaded-source",
      jobId: "uploaded-job",
      filename: "uploaded.txt",
      mimeType: "text/plain",
      sizeBytes: 13,
      contentHash: "uploaded-hash",
      status: "uploaded",
      ingestion: { jobId: "uploaded-job", status: "queued", stage: "uploaded", progress: 0 }
    }),
    getDocument: async () => ({
      documentId: "document-1",
      sourceId: "source-1",
      jobId: "job-1",
      filename: "demo.txt",
      mimeType: "text/plain",
      sizeBytes: 12,
      contentHash: "hash-1",
      status: "indexed",
      ingestion: { jobId: "job-1", status: "completed", stage: "completed", progress: 1 }
    }),
    getIngestionJob: async () => ({ jobId: "job-1", status: "completed", progress: 1 }),
    getDocumentChunks: async () => ({ documentId: "document-1", status: "indexed", chunks: [], nextCursor: null, hasMore: false }),
    ...overrides
  };
}

async function multipartRequest(content = "hello material") {
  const form = new FormData();
  form.append("file", new Blob([content], { type: "text/plain" }), "demo.txt");
  const request = new Request("http://ppt.local/materials", { method: "POST", body: form });
  return {
    headers: { "content-type": request.headers.get("content-type") ?? "" },
    payload: Buffer.from(await request.arrayBuffer())
  };
}

test("POST materials 转发原始 multipart 并保存 Knowledge 引用快照", async () => {
  const { persistence, created } = fakePersistence();
  let uploadInput: Parameters<KnowledgeGateway["uploadMaterial"]>[0] | undefined;
  const gateway = fakeGateway({
    uploadMaterial: async (input) => {
      uploadInput = input;
      return fakeGateway().uploadMaterial(input);
    }
  });
  const app = Fastify();
  await app.register(materialRoutes, { persistence, gateway });
  const multipart = await multipartRequest();

  const response = await app.inject({
    method: "POST",
    url: "/api/projects/project-1/materials?routeMode=auto&parseProfile=deep",
    headers: multipart.headers,
    payload: multipart.payload
  });

  assert.equal(response.statusCode, 201);
  const payload = response.json();
  assert.equal(payload.success, true);
  assert.equal(payload.data.documentId, "uploaded-document");
  assert.equal(payload.data.status, "processing");
  assert.equal(uploadInput?.projectId, "project-1");
  assert.equal(uploadInput?.parseProfile, "deep");
  assert.ok(uploadInput?.rawBody.byteLength);
  assert.equal((created[0] as { knowledgeDocumentId?: string }).knowledgeDocumentId, "uploaded-document");
  await app.close();
});

test("GET materials 合并 Knowledge 最新状态为 ready", async () => {
  const { persistence } = fakePersistence();
  const app = Fastify();
  await app.register(materialRoutes, { persistence, gateway: fakeGateway() });

  const response = await app.inject({ method: "GET", url: "/api/projects/project-1/materials" });

  assert.equal(response.statusCode, 200);
  const payload = response.json();
  assert.equal(payload.data.length, 1);
  assert.equal(payload.data[0].status, "ready");
  assert.equal(payload.data[0].documentId, "document-1");
  await app.close();
});

test("GET 单个资料在 Knowledge 暂时不可用时回退本地状态快照", async () => {
  const { persistence } = fakePersistence();
  const app = Fastify();
  await app.register(materialRoutes, {
    persistence,
    gateway: fakeGateway({
      getDocument: async () => {
        throw new Error("network down");
      }
    })
  });

  const response = await app.inject({ method: "GET", url: "/api/projects/project-1/materials/material-1" });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().data.status, "processing");
  await app.close();
});

test("GET 资料遇到 Knowledge 鉴权或资源错误时明确标记失败", async () => {
  const { persistence } = fakePersistence();
  const app = Fastify();
  await app.register(materialRoutes, {
    persistence,
    gateway: fakeGateway({
      getDocument: async () => {
        throw new KnowledgeGatewayError("资料访问被拒绝", {
          statusCode: 403,
          code: "forbidden",
          upstreamStatus: 403
        });
      }
    })
  });

  const response = await app.inject({ method: "GET", url: "/api/projects/project-1/materials/material-1" });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().data.status, "failed");
  assert.equal(response.json().data.errorMessage, "资料访问被拒绝");
  await app.close();
});

test("DELETE materials 只解除本地关联，不调用 Knowledge 删除", async () => {
  const { persistence, deleted } = fakePersistence();
  let upstreamDeleteCalled = false;
  const gateway = Object.assign(fakeGateway(), {
    deleteDocument: async () => {
      upstreamDeleteCalled = true;
    }
  }) as KnowledgeGateway;
  const app = Fastify();
  await app.register(materialRoutes, { persistence, gateway });

  const response = await app.inject({ method: "DELETE", url: "/api/projects/project-1/materials/material-1" });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(deleted, [{ id: "material-1", projectId: "project-1" }]);
  assert.equal(upstreamDeleteCalled, false);
  await app.close();
});

test("未知项目和未知资料返回稳定 404 envelope", async () => {
  const { persistence } = fakePersistence();
  const app = Fastify();
  await app.register(materialRoutes, { persistence, gateway: fakeGateway() });

  const missingProject = await app.inject({ method: "GET", url: "/api/projects/missing/materials" });
  const missingMaterial = await app.inject({ method: "GET", url: "/api/projects/project-1/materials/missing" });

  assert.equal(missingProject.statusCode, 404);
  assert.equal(missingProject.json().success, false);
  assert.equal(missingMaterial.statusCode, 404);
  assert.equal(missingMaterial.json().success, false);
  await app.close();
});

test("正式 Fastify 应用注册 Project Materials API", async () => {
  const app = await buildApp();

  assert.equal(
    app.hasRoute({ method: "GET", url: "/api/projects/:id/materials" }),
    true
  );
  await app.close();
});
