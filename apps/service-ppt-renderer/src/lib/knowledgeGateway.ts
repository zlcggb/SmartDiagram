import {
  MATERIAL_MULTIPART_OVERHEAD_BYTES,
  materialUploadLimitBytes,
  resolveMaterialUploadLimitMib,
  type MaterialRouteMode,
  type ProjectMaterialStatus
} from "@ppt-agent/shared";

export const MAX_MATERIAL_MIB = resolveMaterialUploadLimitMib(process.env.VITE_PPT_MAX_MATERIAL_MB);
export const MAX_MATERIAL_BYTES = materialUploadLimitBytes(MAX_MATERIAL_MIB);
export const MAX_MULTIPART_BYTES = MAX_MATERIAL_BYTES + MATERIAL_MULTIPART_OVERHEAD_BYTES;

type HeaderSource = Headers | Record<string, string | string[] | undefined>;
type FetchLike = typeof fetch;

const forwardedRequestHeaders = [
  "authorization",
  "cookie",
  "x-request-id"
] as const;

const forwardedFormFields = ["source_id", "source_name", "classification"] as const;

export class KnowledgeGatewayError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly upstreamStatus?: number;

  constructor(
    message: string,
    options: { statusCode: number; code: string; upstreamStatus?: number }
  ) {
    super(message);
    this.name = "KnowledgeGatewayError";
    this.statusCode = options.statusCode;
    this.code = options.code;
    this.upstreamStatus = options.upstreamStatus;
  }
}

export interface KnowledgeIngestionState {
  jobId?: string;
  status?: string;
  stage?: string;
  progress?: number;
  errorMessage?: string;
  stats?: Record<string, unknown>;
}

export interface KnowledgeDocumentSnapshot {
  documentId: string;
  sourceId: string;
  jobId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  contentHash: string;
  status: string;
  createdAt?: string;
  updatedAt?: string;
  ingestion: KnowledgeIngestionState;
}

export interface KnowledgeChunk {
  chunkId: string;
  chunkIndex: number;
  text: string;
  summary: string;
  headingPath: string;
  sourceLocator: string;
  tokenCount: number;
  citation: {
    sourceId?: string;
    documentId?: string;
    sourceLocation?: string;
  };
  metadata: Record<string, unknown>;
}

export interface KnowledgeChunkPage {
  documentId: string;
  status: string;
  chunks: KnowledgeChunk[];
  nextCursor: number | null;
  hasMore: boolean;
}

export interface UploadMaterialInput {
  projectId: string;
  materialId: string;
  routeMode: MaterialRouteMode;
  parseProfile: "auto" | "fast" | "deep";
  contentType: string;
  rawBody: Uint8Array;
  requestHeaders: HeaderSource;
}

export interface KnowledgeRequestContext {
  projectId: string;
  requestHeaders: HeaderSource;
}

interface GatewayOptions {
  baseUrl?: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

function compactBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, "");
}

function stringValue(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function numberValue(value: unknown, fallback = 0) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function objectValue(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function headerSource(source: HeaderSource): Headers {
  if (source instanceof Headers) return new Headers(source);
  const headers = new Headers();
  for (const [key, value] of Object.entries(source)) {
    if (Array.isArray(value)) {
      if (value.length > 0) headers.set(key, value.join(", "));
    } else if (typeof value === "string") {
      headers.set(key, value);
    }
  }
  return headers;
}

function trustedHeaders(source: HeaderSource, projectId: string) {
  const input = headerSource(source);
  const output = new Headers();
  for (const name of forwardedRequestHeaders) {
    const value = input.get(name);
    if (value) output.set(name, value);
  }
  output.set("x-project-id", projectId);
  return output;
}

async function rebuiltUploadForm(input: UploadMaterialInput) {
  if (!/^multipart\/form-data\b/i.test(input.contentType)) {
    throw new KnowledgeGatewayError("资料上传必须使用 multipart/form-data", {
      statusCode: 415,
      code: "unsupported_media_type"
    });
  }
  if (input.rawBody.byteLength > MAX_MULTIPART_BYTES) {
    throw new KnowledgeGatewayError(`上传内容超过 ${MAX_MATERIAL_MIB} MiB 限制`, {
      statusCode: 413,
      code: "material_too_large"
    });
  }

  let incoming: FormData;
  try {
    const requestBody = new ArrayBuffer(input.rawBody.byteLength);
    new Uint8Array(requestBody).set(input.rawBody);
    const request = new Request("http://ppt-material.local/upload", {
      method: "POST",
      headers: { "content-type": input.contentType },
      body: requestBody
    });
    incoming = await request.formData();
  } catch {
    throw new KnowledgeGatewayError("无法解析资料上传内容", {
      statusCode: 400,
      code: "invalid_multipart"
    });
  }

  const file = incoming.get("file");
  if (!(file instanceof Blob)) {
    throw new KnowledgeGatewayError("请选择要上传的资料文件", {
      statusCode: 400,
      code: "missing_file"
    });
  }
  if (file.size === 0) {
    throw new KnowledgeGatewayError("不能上传空文件", {
      statusCode: 400,
      code: "empty_file"
    });
  }
  if (file.size > MAX_MATERIAL_BYTES) {
    throw new KnowledgeGatewayError(`单个资料文件不能超过 ${MAX_MATERIAL_MIB} MiB`, {
      statusCode: 413,
      code: "material_too_large"
    });
  }

  const outgoing = new FormData();
  const filename = stringValue((file as Blob & { name?: string }).name, "uploaded-file");
  outgoing.append("file", file, filename);
  for (const field of forwardedFormFields) {
    const value = incoming.get(field);
    if (typeof value === "string" && value.trim()) outgoing.append(field, value.trim());
  }
  return outgoing;
}

function errorDetails(payload: unknown) {
  const object = objectValue(payload);
  const detail = objectValue(object.detail);
  if (Object.keys(detail).length > 0) {
    return {
      code: stringValue(detail.code, "knowledge_request_failed"),
      message: stringValue(
        detail.message,
        stringValue(detail.error_message, stringValue(detail.detail, "资料服务拒绝了请求"))
      )
    };
  }
  return {
    code: stringValue(object.code, "knowledge_request_failed"),
    message: stringValue(object.message, stringValue(object.detail, "资料服务请求失败"))
  };
}

async function responsePayload(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { message: text.slice(0, 500) };
  }
}

function asGatewayError(error: unknown) {
  if (error instanceof KnowledgeGatewayError) return error;
  if (
    error instanceof DOMException &&
    (error.name === "TimeoutError" || error.name === "AbortError")
  ) {
    return new KnowledgeGatewayError("资料服务响应超时", {
      statusCode: 504,
      code: "gateway_timeout"
    });
  }
  return new KnowledgeGatewayError(
    `资料服务暂时不可用：${error instanceof Error ? error.message : "未知网络错误"}`,
    { statusCode: 502, code: "gateway_unavailable" }
  );
}

function normalizeIngestion(value: unknown, fallbackJobId = ""): KnowledgeIngestionState {
  const object = objectValue(value);
  return {
    jobId: stringValue(object.job_id, fallbackJobId) || undefined,
    status: stringValue(object.status) || undefined,
    stage: stringValue(object.stage) || undefined,
    progress: object.progress === undefined ? undefined : numberValue(object.progress),
    errorMessage: stringValue(object.error_message) || undefined,
    stats: Object.keys(objectValue(object.stats)).length > 0 ? objectValue(object.stats) : undefined
  };
}

function normalizeDocument(value: unknown): KnowledgeDocumentSnapshot {
  const object = objectValue(value);
  const jobId = stringValue(object.job_id, stringValue(object.ingestion_job_id));
  const ingestion = normalizeIngestion(object.ingestion, jobId);
  return {
    documentId: stringValue(object.document_id),
    sourceId: stringValue(object.source_id),
    jobId: jobId || ingestion.jobId || "",
    filename: stringValue(object.original_filename, stringValue(object.title, "uploaded-file")),
    mimeType: stringValue(object.mime_type, "application/octet-stream"),
    sizeBytes: numberValue(object.size_bytes),
    contentHash: stringValue(object.content_hash),
    status: stringValue(object.status, ingestion.status ?? "processing"),
    createdAt: stringValue(object.created_at) || undefined,
    updatedAt: stringValue(object.updated_at) || undefined,
    ingestion
  };
}

function normalizeChunk(value: unknown): KnowledgeChunk {
  const object = objectValue(value);
  const citation = objectValue(object.citation);
  return {
    chunkId: stringValue(object.chunk_id),
    chunkIndex: numberValue(object.chunk_index),
    text: stringValue(object.text),
    summary: stringValue(object.summary),
    headingPath: stringValue(object.heading_path),
    sourceLocator: stringValue(object.source_locator),
    tokenCount: numberValue(object.token_count),
    citation: {
      sourceId: stringValue(citation.source_id) || undefined,
      documentId: stringValue(citation.document_id) || undefined,
      sourceLocation: stringValue(citation.source_locator) || undefined
    },
    metadata: objectValue(object.metadata)
  };
}

export function normalizeKnowledgeMaterialStatus(
  documentStatus: string | undefined,
  job: { status?: string; progress?: number; error_message?: string; errorMessage?: string } = {}
): { status: ProjectMaterialStatus; progress: number | undefined; errorMessage: string | undefined } {
  const document = (documentStatus ?? "").toLowerCase();
  const jobStatus = (job.status ?? "").toLowerCase();
  const rawProgress = numberValue(job.progress, 0);
  const progress = Math.max(0, Math.min(1, rawProgress > 1 ? rawProgress / 100 : rawProgress));
  const errorMessage = job.errorMessage || job.error_message || undefined;

  if ([document, jobStatus].some((value) => ["failed", "error", "cancelled"].includes(value))) {
    return { status: "failed", progress, errorMessage };
  }
  if (document === "vision_required") {
    return {
      status: "failed",
      progress,
      errorMessage: errorMessage ?? "该资料需要视觉/OCR 解析，当前环境尚未启用此能力"
    };
  }
  if (
    [document, jobStatus].some((value) =>
      ["indexed", "ready", "completed", "complete", "succeeded", "success"].includes(value)
    )
  ) {
    return { status: "ready", progress, errorMessage: undefined };
  }
  return { status: "processing", progress, errorMessage: undefined };
}

export function createKnowledgeGateway(options: GatewayOptions = {}) {
  const baseUrl = compactBaseUrl(
    options.baseUrl ?? process.env.MATERIAL_GATEWAY_URL ?? "http://127.0.0.1:8000"
  );
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = Math.max(1_000, options.timeoutMs ?? 120_000);

  async function send(path: string, init: RequestInit): Promise<unknown> {
    try {
      const response = await fetchImpl(`${baseUrl}${path}`, {
        ...init,
        signal: init.signal ?? AbortSignal.timeout(timeoutMs)
      });
      const payload = await responsePayload(response);
      if (!response.ok) {
        const details = errorDetails(payload);
        throw new KnowledgeGatewayError(details.message, {
          statusCode: response.status >= 500 ? 502 : response.status,
          code: details.code,
          upstreamStatus: response.status
        });
      }
      return payload;
    } catch (error) {
      throw asGatewayError(error);
    }
  }

  return {
    async uploadMaterial(input: UploadMaterialInput): Promise<KnowledgeDocumentSnapshot> {
      const form = await rebuiltUploadForm(input);
      const headers = trustedHeaders(input.requestHeaders, input.projectId);
      headers.set("x-origin-system", "ppt-agent-engine");
      headers.set("x-origin-project-id", input.projectId);
      headers.set("x-origin-material-id", input.materialId);
      headers.set("x-ingestion-mode", "background");
      headers.set("x-parse-profile", input.parseProfile);
      headers.set("x-route-mode", input.routeMode);
      const payload = await send("/api/knowledge/documents", {
        method: "POST",
        headers,
        body: form
      });
      const document = normalizeDocument(payload);
      if (!document.documentId || !document.sourceId || !document.jobId) {
        throw new KnowledgeGatewayError("资料服务返回缺少 document/source/job 标识", {
          statusCode: 502,
          code: "invalid_gateway_response"
        });
      }
      return document;
    },

    async getDocument(
      documentId: string,
      context: KnowledgeRequestContext
    ): Promise<KnowledgeDocumentSnapshot> {
      const payload = await send(`/api/knowledge/documents/${encodeURIComponent(documentId)}`, {
        method: "GET",
        headers: trustedHeaders(context.requestHeaders, context.projectId)
      });
      return normalizeDocument(payload);
    },

    async getIngestionJob(jobId: string, context: KnowledgeRequestContext): Promise<KnowledgeIngestionState> {
      const payload = objectValue(
        await send(`/api/knowledge/ingestion-jobs/${encodeURIComponent(jobId)}`, {
          method: "GET",
          headers: trustedHeaders(context.requestHeaders, context.projectId)
        })
      );
      return normalizeIngestion(payload, jobId);
    },

    async getDocumentChunks(
      documentId: string,
      input: KnowledgeRequestContext & { cursor?: number; limit?: number }
    ): Promise<KnowledgeChunkPage> {
      const cursor = Math.max(0, Math.trunc(input.cursor ?? 0));
      const limit = Math.max(1, Math.min(200, Math.trunc(input.limit ?? 100)));
      const query = new URLSearchParams({ cursor: String(cursor), limit: String(limit) });
      const payload = objectValue(
        await send(
          `/api/knowledge/documents/${encodeURIComponent(documentId)}/chunks?${query.toString()}`,
          {
            method: "GET",
            headers: trustedHeaders(input.requestHeaders, input.projectId)
          }
        )
      );
      const chunks = Array.isArray(payload.chunks) ? payload.chunks.map(normalizeChunk) : [];
      return {
        documentId: stringValue(payload.document_id, documentId),
        status: stringValue(payload.status),
        chunks,
        nextCursor: payload.next_cursor === null || payload.next_cursor === undefined
          ? null
          : numberValue(payload.next_cursor),
        hasMore: payload.has_more === true
      };
    }
  };
}

export type KnowledgeGateway = ReturnType<typeof createKnowledgeGateway>;
