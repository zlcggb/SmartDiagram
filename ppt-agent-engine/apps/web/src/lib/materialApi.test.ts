import assert from "node:assert/strict";
import test from "node:test";
import { uploadProjectMaterialRequest } from "./api.js";

const materialPayload = {
  id: "material-1",
  projectId: "project-1",
  documentId: "document-1",
  sourceId: "source-1",
  jobId: "job-1",
  filename: "经营复盘.pdf",
  mimeType: "application/pdf",
  sizeBytes: 4,
  routeMode: "auto",
  status: "processing",
  errorMessage: null,
  createdAt: "2026-07-23T00:00:00.000Z",
  updatedAt: "2026-07-23T00:00:00.000Z"
};

test("上传原始 File 时使用 FormData 且不手工设置 Content-Type", async () => {
  const file = new File(["data"], "经营复盘.pdf", { type: "application/pdf" });
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  const fetcher: typeof fetch = async (input, init) => {
    capturedUrl = String(input);
    capturedInit = init;
    return new Response(JSON.stringify({ success: true, data: materialPayload, message: "资料已上传" }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };

  const result = await uploadProjectMaterialRequest("project-1", file, fetcher, "/ppt-api");

  assert.equal(capturedUrl, "/ppt-api/api/projects/project-1/materials");
  assert.equal(capturedInit?.method, "POST");
  assert.ok(capturedInit?.body instanceof FormData);
  const formFile = (capturedInit.body as FormData).get("file");
  assert.ok(formFile instanceof File);
  assert.equal(formFile.name, file.name);
  assert.equal(formFile.type, file.type);
  assert.equal(await formFile.text(), "data");
  assert.equal(new Headers(capturedInit.headers).has("Content-Type"), false);
  assert.deepEqual(result, materialPayload);
});

test("材料上传失败时保留服务端可理解错误", async () => {
  const file = new File(["data"], "损坏.docx");
  const fetcher: typeof fetch = async () => new Response(
    JSON.stringify({ success: false, data: null, message: "文件签名与扩展名不一致" }),
    { status: 422, headers: { "Content-Type": "application/json" } }
  );

  await assert.rejects(
    () => uploadProjectMaterialRequest("project-1", file, fetcher, "/ppt-api"),
    /文件签名与扩展名不一致/
  );
});

test("网关返回 HTML 错误页时展示 HTTP 状态，而不是 JSON SyntaxError", async () => {
  const file = new File(["data"], "过大.pptx");
  const fetcher: typeof fetch = async () => new Response(
    "<html><body>Request Entity Too Large</body></html>",
    { status: 413, statusText: "Payload Too Large", headers: { "Content-Type": "text/html" } }
  );

  await assert.rejects(
    () => uploadProjectMaterialRequest("project-1", file, fetcher, "/ppt-api"),
    /413.*Payload Too Large/
  );
});
