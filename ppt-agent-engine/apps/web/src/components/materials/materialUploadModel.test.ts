import assert from "node:assert/strict";
import test from "node:test";
import {
  MATERIAL_ACCEPT,
  MAX_MATERIAL_FILE_BYTES,
  MAX_MATERIAL_FILES,
  enqueueMaterialFiles,
  materialUploadSummary,
  mergeServerMaterials,
  normalizeProjectMaterialStatus,
  updateMaterialItem,
  upsertProjectMaterial,
  type MaterialUploadItem,
  type ProjectMaterialDto
} from "./materialUploadModel.js";

function fakeFile(name: string, size: number, type = "application/octet-stream"): File {
  return { name, size, type } as File;
}

function pendingItem(localId: string): MaterialUploadItem {
  const file = fakeFile(`${localId}.txt`, 12, "text/plain");
  return {
    localId,
    file,
    filename: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
    status: "pending",
    progress: 0,
    retryable: false
  };
}

function material(id: string, status: ProjectMaterialDto["status"]): ProjectMaterialDto {
  return {
    id,
    projectId: "project-1",
    documentId: `document-${id}`,
    sourceId: `source-${id}`,
    jobId: `job-${id}`,
    filename: `${id}.pdf`,
    mimeType: "application/pdf",
    sizeBytes: 1024,
    routeMode: "auto",
    status,
    createdAt: "2026-07-23T00:00:00.000Z",
    updatedAt: "2026-07-23T00:00:00.000Z"
  };
}

test("资料白名单覆盖文本、Office、PDF 和常见图片", () => {
  for (const extension of [".txt", ".md", ".csv", ".json", ".html", ".xml", ".rtf", ".pdf", ".docx", ".xlsx", ".pptx", ".png", ".jpg", ".jpeg", ".webp"]) {
    assert.match(MATERIAL_ACCEPT, new RegExp(extension.replace(".", "\\.")));
  }
  assert.equal(MAX_MATERIAL_FILE_BYTES, 15 * 1024 * 1024);
  assert.equal(MAX_MATERIAL_FILES, 8);
});

test("前端白名单与网关一致，不接受 markdown 和 htm 别名", () => {
  const accepted = MATERIAL_ACCEPT.split(",");
  assert.equal(accepted.includes(".markdown"), false);
  assert.equal(accepted.includes(".htm"), false);
});

test("选择资料时逐项保留格式与大小错误，不吞掉同批成功文件", () => {
  let sequence = 0;
  const result = enqueueMaterialFiles(
    [],
    [
      fakeFile("经营复盘.PDF", 2048, "application/pdf"),
      fakeFile("脚本.exe", 32),
      fakeFile("超大方案.pptx", MAX_MATERIAL_FILE_BYTES + 1)
    ],
    () => `local-${++sequence}`
  );

  assert.equal(result.items.length, 3);
  assert.equal(result.items[0]?.status, "pending");
  assert.equal(result.items[1]?.status, "failed");
  assert.match(result.items[1]?.errorMessage ?? "", /不支持/);
  assert.equal(result.items[1]?.retryable, false);
  assert.equal(result.items[2]?.status, "failed");
  assert.match(result.items[2]?.errorMessage ?? "", /15 MB/);
  assert.deepEqual(result.overflow, []);
});

test("最多保留八个待处理项，超出的文件逐项返回名称和原因", () => {
  const current = Array.from({ length: 7 }, (_, index) => pendingItem(`existing-${index}`));
  let sequence = 0;
  const result = enqueueMaterialFiles(
    current,
    [fakeFile("第八份.docx", 100), fakeFile("第九份.xlsx", 100)],
    () => `new-${++sequence}`
  );

  assert.equal(result.items.length, 8);
  assert.equal(result.items[7]?.filename, "第八份.docx");
  assert.deepEqual(result.overflow, [
    { filename: "第九份.xlsx", errorMessage: "最多可添加 8 个文件，请先移除其他文件。" }
  ]);
});

test("单文件状态更新不会覆盖同批其他文件的状态或错误", () => {
  const original = [pendingItem("first"), pendingItem("second")];
  const next = updateMaterialItem(original, "second", {
    status: "failed",
    progress: 35,
    errorMessage: "网络连接中断",
    retryable: true
  });

  assert.equal(next[0], original[0]);
  assert.equal(next[0]?.status, "pending");
  assert.equal(next[1]?.status, "failed");
  assert.equal(next[1]?.errorMessage, "网络连接中断");
});

test("服务端状态统一映射为 processing/ready/failed", () => {
  assert.equal(normalizeProjectMaterialStatus("queued"), "processing");
  assert.equal(normalizeProjectMaterialStatus("uploaded"), "processing");
  assert.equal(normalizeProjectMaterialStatus("indexing"), "processing");
  assert.equal(normalizeProjectMaterialStatus("indexed"), "ready");
  assert.equal(normalizeProjectMaterialStatus("error"), "failed");
  assert.equal(normalizeProjectMaterialStatus("uploading"), "uploading");
});

test("服务端材料按 id 合并，更新一个材料不会删除其余材料", () => {
  const first = material("first", "processing");
  const second = material("second", "ready");
  const updated = upsertProjectMaterial([first, second], {
    ...first,
    status: "failed",
    errorMessage: "文档损坏"
  });

  assert.deepEqual(updated.map((item) => item.id), ["first", "second"]);
  assert.equal(updated[0]?.status, "failed");
  assert.equal(updated[1], second);
});

test("服务端刷新会更新对应本地行，并保留 File 供失败重试", () => {
  const file = fakeFile("first.pdf", 32, "application/pdf");
  const local: MaterialUploadItem = {
    ...pendingItem("local-first"),
    file,
    filename: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
    materialId: "first",
    status: "processing",
    progress: 100
  };

  const merged = mergeServerMaterials([local], [
    { ...material("first", "ready"), filename: file.name },
    material("second", "processing")
  ]);

  assert.equal(merged.length, 2);
  assert.equal(merged[0]?.localId, "local-first");
  assert.equal(merged[0]?.file, file);
  assert.equal(merged[0]?.status, "ready");
  assert.equal(merged[1]?.materialId, "second");
});

test("服务端空列表会清理幽灵材料，同时保留尚未上传的本地文件", () => {
  const localPending = pendingItem("local-pending");
  const staleServerItem: MaterialUploadItem = {
    ...pendingItem("stale-server"),
    materialId: "deleted-material",
    status: "processing",
    file: undefined
  };

  const merged = mergeServerMaterials([localPending, staleServerItem], []);

  assert.deepEqual(merged.map((item) => item.localId), ["local-pending"]);
});

test("状态摘要同时呈现上传、处理、成功和失败数量", () => {
  const items: MaterialUploadItem[] = [
    pendingItem("pending"),
    { ...pendingItem("uploading"), status: "uploading", progress: 20 },
    { ...pendingItem("processing"), status: "processing", progress: 100 },
    { ...pendingItem("ready"), status: "ready", progress: 100 },
    { ...pendingItem("failed"), status: "failed", errorMessage: "失败" }
  ];

  assert.deepEqual(materialUploadSummary(items), {
    pending: 1,
    uploading: 1,
    processing: 1,
    ready: 1,
    failed: 1,
    total: 5
  });
});
