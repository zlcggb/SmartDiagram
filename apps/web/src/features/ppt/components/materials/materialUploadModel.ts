import type { ProjectMaterialDto, ProjectMaterialStatus } from "@ppt-agent/shared";

export type { ProjectMaterialDto } from "@ppt-agent/shared";

export const MAX_MATERIAL_FILE_BYTES = 15 * 1024 * 1024;
export const MAX_MATERIAL_FILES = 8;

export const MATERIAL_EXTENSIONS = [
  "txt",
  "md",
  "csv",
  "json",
  "html",
  "xml",
  "rtf",
  "pdf",
  "docx",
  "xlsx",
  "pptx",
  "png",
  "jpg",
  "jpeg",
  "webp"
] as const;

export const MATERIAL_ACCEPT = MATERIAL_EXTENSIONS.map((extension) => `.${extension}`).join(",");

const supportedExtensions = new Set<string>(MATERIAL_EXTENSIONS);

export type MaterialUploadStatus = "pending" | ProjectMaterialStatus;

export interface MaterialUploadItem {
  localId: string;
  file?: File;
  materialId?: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  status: MaterialUploadStatus;
  progress: number;
  routeMode?: ProjectMaterialDto["routeMode"];
  errorMessage?: string;
  retryable: boolean;
}

export interface MaterialSelectionError {
  filename: string;
  errorMessage: string;
}

export interface MaterialUploadSummary {
  pending: number;
  uploading: number;
  processing: number;
  ready: number;
  failed: number;
  total: number;
}

function defaultLocalId() {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return `material-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function fileExtension(filename: string) {
  const dot = filename.lastIndexOf(".");
  return dot >= 0 ? filename.slice(dot + 1).toLowerCase() : "";
}

function validationError(file: Pick<File, "name" | "size">): string | undefined {
  const extension = fileExtension(file.name);
  if (!supportedExtensions.has(extension)) {
    return `不支持 .${extension || "未知"} 格式，请选择文本、Office、PDF 或图片资料。`;
  }
  if (file.size <= 0) return "文件为空，请选择包含内容的资料。";
  if (file.size > MAX_MATERIAL_FILE_BYTES) return "单个文件不能超过 15 MB。";
  return undefined;
}

export function enqueueMaterialFiles(
  current: readonly MaterialUploadItem[],
  files: readonly File[],
  makeId: () => string = defaultLocalId
): { items: MaterialUploadItem[]; overflow: MaterialSelectionError[] } {
  const items = [...current];
  const overflow: MaterialSelectionError[] = [];

  for (const file of files) {
    if (items.length >= MAX_MATERIAL_FILES) {
      overflow.push({
        filename: file.name,
        errorMessage: `最多可添加 ${MAX_MATERIAL_FILES} 个文件，请先移除其他文件。`
      });
      continue;
    }

    const errorMessage = validationError(file);
    items.push({
      localId: makeId(),
      file,
      filename: file.name,
      mimeType: file.type || "application/octet-stream",
      sizeBytes: file.size,
      status: errorMessage ? "failed" : "pending",
      progress: 0,
      errorMessage,
      retryable: false
    });
  }

  return { items, overflow };
}

export function updateMaterialItem(
  items: readonly MaterialUploadItem[],
  localId: string,
  patch: Partial<MaterialUploadItem>
): MaterialUploadItem[] {
  return items.map((item) => (item.localId === localId ? { ...item, ...patch } : item));
}

export function normalizeProjectMaterialStatus(status: string): ProjectMaterialStatus {
  const normalized = status.trim().toLowerCase();
  if (["ready", "indexed", "complete", "completed"].includes(normalized)) return "ready";
  if (["failed", "error"].includes(normalized)) return "failed";
  if (normalized === "uploading") return "uploading";
  return "processing";
}

export function materialItemFromDto(material: ProjectMaterialDto): MaterialUploadItem {
  const status = normalizeProjectMaterialStatus(material.status);
  return {
    localId: `server-${material.id}`,
    materialId: material.id,
    filename: material.filename,
    mimeType: material.mimeType,
    sizeBytes: material.sizeBytes,
    routeMode: material.routeMode,
    status,
    progress: status === "uploading" ? 50 : 100,
    errorMessage: material.errorMessage,
    retryable: false
  };
}

export function mergeServerMaterials(
  current: readonly MaterialUploadItem[],
  materials: readonly ProjectMaterialDto[]
): MaterialUploadItem[] {
  const serverIds = new Set(materials.map((material) => material.id));
  const next = current.filter((item) => !item.materialId || serverIds.has(item.materialId));
  for (const material of materials) {
    const index = next.findIndex((item) => item.materialId === material.id);
    const serverItem = materialItemFromDto(material);
    if (index < 0) {
      next.push(serverItem);
    } else {
      next[index] = {
        ...next[index],
        ...serverItem,
        localId: next[index]?.localId ?? serverItem.localId,
        file: next[index]?.file
      };
    }
  }
  return next;
}

export function upsertProjectMaterial(
  materials: readonly ProjectMaterialDto[],
  material: ProjectMaterialDto
): ProjectMaterialDto[] {
  const index = materials.findIndex((item) => item.id === material.id);
  if (index < 0) return [...materials, material];
  return materials.map((item, itemIndex) => (itemIndex === index ? material : item));
}

export function materialUploadSummary(items: readonly MaterialUploadItem[]): MaterialUploadSummary {
  const summary: MaterialUploadSummary = {
    pending: 0,
    uploading: 0,
    processing: 0,
    ready: 0,
    failed: 0,
    total: items.length
  };
  for (const item of items) summary[item.status] += 1;
  return summary;
}

export function formatMaterialSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}
