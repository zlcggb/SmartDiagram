import assert from "node:assert/strict";
import test from "node:test";
import {
  KnowledgeGatewayError,
  MAX_MATERIAL_BYTES,
  createKnowledgeGateway,
  normalizeKnowledgeMaterialStatus
} from "./knowledgeGateway.js";

async function multipartPayload(
  content: BlobPart,
  options: { filename?: string; mimeType?: string; extra?: Record<string, string> } = {}
) {
  const form = new FormData();
  form.append(
    "file",
    new Blob([content], { type: options.mimeType ?? "text/plain" }),
    options.filename ?? "demo.txt"
  );
  for (const [key, value] of Object.entries(options.extra ?? {})) {
    form.append(key, value);
  }
  const request = new Request("http://ppt.local/upload", { method: "POST", body: form });
  return {
    contentType: request.headers.get("content-type") ?? "",
    rawBody: new Uint8Array(await request.arrayBuffer())
  };
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" }
  });
}

test("上传覆盖可信 origin/project 字段，同时完整保留文件正文", async () => {
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  const fetchImpl: typeof fetch = async (input, init) => {
    capturedUrl = String(input);
    capturedInit = init;
    return jsonResponse({
      document_id: "doc-1",
      source_id: "source-1",
      job_id: "job-1",
      original_filename: "demo.txt",
      mime_type: "text/plain",
      size_bytes: 12,
      content_hash: "abc123",
      status: "uploaded",
      ingestion: { status: "queued", stage: "uploaded", progress: 0 }
    });
  };
  const payload = await multipartPayload("hello gateway", {
    extra: {
      project_id: "client-forged-project",
      source_name: "可信资料名",
      classification: "internal",
      origin_system: "client-forged-origin"
    }
  });
  const gateway = createKnowledgeGateway({ baseUrl: "http://knowledge.local", fetchImpl });

  const result = await gateway.uploadMaterial({
    projectId: "ppt-project-1",
    materialId: "material-1",
    routeMode: "auto",
    parseProfile: "deep",
    contentType: payload.contentType,
    rawBody: payload.rawBody,
    requestHeaders: {
      authorization: "Bearer session-token",
      "x-tenant-id": "client-forged-tenant",
      "x-user-id": "client-forged-user",
      "x-roles": "owner",
      "x-scopes": "knowledge:write"
    }
  });

  assert.equal(capturedUrl, "http://knowledge.local/api/knowledge/documents");
  const headers = new Headers(capturedInit?.headers);
  assert.equal(headers.get("x-project-id"), "ppt-project-1");
  assert.equal(headers.get("x-origin-system"), "ppt-agent-engine");
  assert.equal(headers.get("x-origin-project-id"), "ppt-project-1");
  assert.equal(headers.get("x-origin-material-id"), "material-1");
  assert.equal(headers.get("x-parse-profile"), "deep");
  assert.equal(headers.get("x-ingestion-mode"), "background");
  assert.equal(headers.get("authorization"), "Bearer session-token");
  assert.equal(headers.get("x-tenant-id"), null, "客户端身份头不能作为内部可信身份透传");
  assert.equal(headers.get("x-user-id"), null);
  assert.equal(headers.get("x-roles"), null);
  assert.equal(headers.get("x-scopes"), null);
  assert.equal(headers.get("content-type"), null, "fetch 必须为重建后的 FormData 生成 boundary");

  const forwarded = capturedInit?.body as FormData;
  const forwardedFile = forwarded.get("file");
  assert.ok(forwardedFile instanceof Blob);
  assert.equal(await forwardedFile.text(), "hello gateway");
  assert.equal(forwarded.get("source_name"), "可信资料名");
  assert.equal(forwarded.get("classification"), "internal");
  assert.equal(forwarded.get("project_id"), null, "不应把客户端伪造 project_id 转发为表单字段");
  assert.equal(forwarded.get("origin_system"), null);
  assert.equal(result.jobId, "job-1");
});

test("单文件超过 15 MiB 时在请求上游前拒绝", async () => {
  let called = false;
  const fetchImpl: typeof fetch = async () => {
    called = true;
    return jsonResponse({});
  };
  const payload = await multipartPayload(new Uint8Array(MAX_MATERIAL_BYTES + 1));
  const gateway = createKnowledgeGateway({ baseUrl: "http://knowledge.local", fetchImpl });

  await assert.rejects(
    gateway.uploadMaterial({
      projectId: "p1",
      materialId: "m1",
      routeMode: "auto",
      parseProfile: "auto",
      contentType: payload.contentType,
      rawBody: payload.rawBody,
      requestHeaders: {}
    }),
    (error: unknown) => error instanceof KnowledgeGatewayError && error.statusCode === 413
  );
  assert.equal(called, false);
});

test("上游结构化 4xx 被转换为稳定的 Gateway 错误", async () => {
  const payload = await multipartPayload("bad file");
  const gateway = createKnowledgeGateway({
    baseUrl: "http://knowledge.local",
    fetchImpl: async () => jsonResponse({ detail: { code: "mime_mismatch", message: "文件类型与内容不一致" } }, 422)
  });

  await assert.rejects(
    gateway.uploadMaterial({
      projectId: "p1",
      materialId: "m1",
      routeMode: "auto",
      parseProfile: "auto",
      contentType: payload.contentType,
      rawBody: payload.rawBody,
      requestHeaders: {}
    }),
    (error: unknown) =>
      error instanceof KnowledgeGatewayError &&
      error.statusCode === 422 &&
      error.code === "mime_mismatch" &&
      error.message === "文件类型与内容不一致"
  );
});

test("文档未就绪时保留上游的解析错误，不降级成泛化 409", async () => {
  const gateway = createKnowledgeGateway({
    baseUrl: "http://knowledge.local",
    fetchImpl: async () => jsonResponse({
      detail: {
        code: "document_not_ready",
        status: "failed",
        stage: "parsing",
        progress: 1,
        error_message: "PPTX 文件已损坏"
      }
    }, 409)
  });

  await assert.rejects(
    gateway.getDocumentChunks("doc-1", {
      projectId: "p1",
      requestHeaders: {}
    }),
    (error: unknown) =>
      error instanceof KnowledgeGatewayError &&
      error.statusCode === 409 &&
      error.code === "document_not_ready" &&
      error.message === "PPTX 文件已损坏"
  );
});

test("上游超时被识别为 504，而不是普通 500", async () => {
  const payload = await multipartPayload("slow file");
  const gateway = createKnowledgeGateway({
    baseUrl: "http://knowledge.local",
    fetchImpl: async () => {
      throw new DOMException("timed out", "TimeoutError");
    }
  });

  await assert.rejects(
    gateway.uploadMaterial({
      projectId: "p1",
      materialId: "m1",
      routeMode: "auto",
      parseProfile: "auto",
      contentType: payload.contentType,
      rawBody: payload.rawBody,
      requestHeaders: {}
    }),
    (error: unknown) =>
      error instanceof KnowledgeGatewayError && error.statusCode === 504 && error.code === "gateway_timeout"
  );
});

test("Knowledge 文档和任务状态被归一成前端四态", () => {
  assert.deepEqual(normalizeKnowledgeMaterialStatus("uploaded", { status: "queued", progress: 0 }), {
    status: "processing",
    progress: 0,
    errorMessage: undefined
  });
  assert.deepEqual(normalizeKnowledgeMaterialStatus("indexed", { status: "completed", progress: 1 }), {
    status: "ready",
    progress: 1,
    errorMessage: undefined
  });
  assert.deepEqual(
    normalizeKnowledgeMaterialStatus("failed", { status: "failed", progress: 0.5, error_message: "解析损坏" }),
    { status: "failed", progress: 0.5, errorMessage: "解析损坏" }
  );
  assert.deepEqual(
    normalizeKnowledgeMaterialStatus("vision_required", { status: "completed", progress: 1 }),
    {
      status: "failed",
      progress: 1,
      errorMessage: "该资料需要视觉/OCR 解析，当前环境尚未启用此能力"
    },
    "未启用 OCR 时必须终止轮询并明确失败，不能永久显示解析中"
  );
});

test("文档 chunks 请求携带 project 身份并保留稳定分页游标", async () => {
  let capturedUrl = "";
  let capturedHeaders = new Headers();
  const gateway = createKnowledgeGateway({
    baseUrl: "http://knowledge.local/",
    fetchImpl: async (input, init) => {
      capturedUrl = String(input);
      capturedHeaders = new Headers(init?.headers);
      return jsonResponse({
        document_id: "doc-1",
        status: "indexed",
        chunks: [
          {
            chunk_id: "chunk-1",
            chunk_index: 0,
            text: "第一页正文",
            source_locator: "pdf:page=1",
            citation: { source_id: "source-1", document_id: "doc-1", source_locator: "pdf:page=1" }
          }
        ],
        next_cursor: 100,
        has_more: true
      });
    }
  });

  const page = await gateway.getDocumentChunks("doc-1", {
    projectId: "ppt-project-1",
    cursor: 0,
    limit: 100,
    requestHeaders: { authorization: "Bearer token" }
  });

  assert.equal(capturedUrl, "http://knowledge.local/api/knowledge/documents/doc-1/chunks?cursor=0&limit=100");
  assert.equal(capturedHeaders.get("x-project-id"), "ppt-project-1");
  assert.equal(capturedHeaders.get("authorization"), "Bearer token");
  assert.equal(page.nextCursor, 100);
  assert.equal(page.chunks[0]?.sourceLocator, "pdf:page=1");
});
