import assert from "node:assert/strict";
import test from "node:test";
import type { ProjectDto, ProjectMaterialDto } from "@ppt-agent/shared";
import { api } from "../lib/api.js";
import { useWorkbenchStore } from "./workbenchStore.js";

const project: ProjectDto = {
  id: "project-1",
  name: "资料测试",
  reportType: "汇报",
  audience: "管理层",
  purpose: "同步",
  pageCount: 8,
  theme: "white-blue",
  mode: "topic",
  createdAt: "2026-07-23T00:00:00.000Z",
  updatedAt: "2026-07-23T00:00:00.000Z"
};

function material(id: string, status: ProjectMaterialDto["status"] = "processing"): ProjectMaterialDto {
  return {
    id,
    projectId: project.id,
    documentId: `document-${id}`,
    sourceId: `source-${id}`,
    jobId: `job-${id}`,
    filename: `${id}.pdf`,
    mimeType: "application/pdf",
    sizeBytes: 32,
    routeMode: "auto",
    status
  };
}

type MaterialStoreState = {
  materials: ProjectMaterialDto[];
  error: string | null;
  uploadMaterial(file: File, projectId?: string): Promise<ProjectMaterialDto>;
  deleteMaterial(materialId: string, projectId?: string): Promise<void>;
  extractFacts(): Promise<void>;
};

test("store 上传成功按 id 合并，单文件失败不覆盖既有材料", async (context) => {
  const originalUpload = api.uploadMaterial;
  context.after(() => {
    api.uploadMaterial = originalUpload;
  });

  useWorkbenchStore.setState({ project, materials: [], error: null } as never);
  api.uploadMaterial = async () => material("first");
  const state = () => useWorkbenchStore.getState() as unknown as MaterialStoreState;

  await state().uploadMaterial(new File(["one"], "first.pdf"));
  assert.deepEqual(state().materials.map((item) => item.id), ["first"]);

  api.uploadMaterial = async () => {
    throw new Error("第二份上传失败");
  };
  await assert.rejects(() => state().uploadMaterial(new File(["two"], "second.pdf")), /第二份上传失败/);
  assert.deepEqual(state().materials.map((item) => item.id), ["first"]);
  assert.equal(state().error, null);
});

test("store 删除资料只移除目标材料", async (context) => {
  const originalDelete = api.deleteMaterial;
  context.after(() => {
    api.deleteMaterial = originalDelete;
  });

  useWorkbenchStore.setState({ project, materials: [material("first"), material("second")] } as never);
  api.deleteMaterial = async (_projectId, materialId) => ({ id: materialId });
  const state = () => useWorkbenchStore.getState() as unknown as MaterialStoreState;

  await state().deleteMaterial("first");
  assert.deepEqual(state().materials.map((item) => item.id), ["second"]);
});

test("提取事实传递项目全部材料 id，由服务端对未就绪材料返回 409", async (context) => {
  const originalExtract = api.extractFacts;
  const originalEventSource = globalThis.EventSource;
  Object.defineProperty(globalThis, "EventSource", {
    configurable: true,
    writable: true,
    value: class {
      onopen = null;
      onmessage = null;
      onerror = null;
      close() {}
    }
  });
  context.after(() => {
    api.extractFacts = originalExtract;
    Object.defineProperty(globalThis, "EventSource", {
      configurable: true,
      writable: true,
      value: originalEventSource
    });
  });

  let receivedIds: string[] | undefined;
  api.extractFacts = async (_projectId, materialIds) => {
    receivedIds = materialIds;
    return [];
  };
  useWorkbenchStore.setState({
    project,
    sourceText: "",
    materials: [material("ready", "ready"), material("processing", "processing"), material("failed", "failed")],
    error: null
  } as never);
  const state = () => useWorkbenchStore.getState() as unknown as MaterialStoreState;

  await state().extractFacts();
  assert.deepEqual(receivedIds, ["ready", "processing", "failed"]);
});
