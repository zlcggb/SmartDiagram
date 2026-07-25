import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ProjectMaterialDto } from "@ppt-agent/shared";
import {
  enqueueMaterialFiles,
  materialUploadSummary,
  mergeServerMaterials,
  normalizeProjectMaterialStatus,
  updateMaterialItem,
  type MaterialSelectionError,
  type MaterialUploadItem
} from "./materialUploadModel";

const emptyMaterials: readonly ProjectMaterialDto[] = [];

interface UseMaterialUploadsOptions {
  projectId?: string;
  initialMaterials?: readonly ProjectMaterialDto[];
  autoUpload?: boolean;
  uploadFile: (file: File, projectId?: string) => Promise<ProjectMaterialDto>;
  deleteFile: (materialId: string, projectId?: string) => Promise<void>;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "资料上传失败，请重试。";
}

export function useMaterialUploads({
  projectId,
  initialMaterials = emptyMaterials,
  autoUpload = false,
  uploadFile,
  deleteFile
}: UseMaterialUploadsOptions) {
  const [items, setItems] = useState<MaterialUploadItem[]>(() => mergeServerMaterials([], initialMaterials));
  const itemsRef = useRef(items);
  const [selectionErrors, setSelectionErrors] = useState<MaterialSelectionError[]>([]);

  const commit = useCallback((next: MaterialUploadItem[] | ((current: MaterialUploadItem[]) => MaterialUploadItem[])) => {
    const value = typeof next === "function" ? next(itemsRef.current) : next;
    itemsRef.current = value;
    setItems(value);
  }, []);

  useEffect(() => {
    commit((current) => mergeServerMaterials(current, initialMaterials));
  }, [commit, initialMaterials]);

  const uploadOne = useCallback(async (localId: string, targetProjectId: string) => {
    const item = itemsRef.current.find((candidate) => candidate.localId === localId);
    if (!item?.file) return item?.status !== "failed";

    commit((current) => updateMaterialItem(current, localId, {
      status: "uploading",
      progress: 20,
      errorMessage: undefined,
      retryable: false
    }));

    try {
      const material = await uploadFile(item.file, targetProjectId);
      const status = normalizeProjectMaterialStatus(material.status);
      commit((current) => updateMaterialItem(current, localId, {
        materialId: material.id,
        filename: material.filename,
        mimeType: material.mimeType,
        sizeBytes: material.sizeBytes,
        routeMode: material.routeMode,
        status,
        progress: status === "uploading" ? 90 : 100,
        errorMessage: material.errorMessage,
        retryable: status === "failed"
      }));
      return status !== "failed";
    } catch (error) {
      commit((current) => updateMaterialItem(current, localId, {
        status: "failed",
        errorMessage: errorMessage(error),
        retryable: true
      }));
      return false;
    }
  }, [commit, uploadFile]);

  const uploadAll = useCallback(async (targetProjectId: string, localIds?: readonly string[]) => {
    const allowedIds = localIds ? new Set(localIds) : null;
    const targets = itemsRef.current.filter((item) => {
      if (allowedIds && !allowedIds.has(item.localId)) return false;
      return item.status === "pending" || (item.status === "failed" && item.retryable);
    });

    for (const item of targets) await uploadOne(item.localId, targetProjectId);
    return itemsRef.current.every((item) => item.status !== "pending" && item.status !== "uploading" && item.status !== "failed");
  }, [uploadOne]);

  const addFiles = useCallback(async (files: FileList | readonly File[]) => {
    const beforeIds = new Set(itemsRef.current.map((item) => item.localId));
    const result = enqueueMaterialFiles(itemsRef.current, Array.from(files));
    commit(result.items);
    setSelectionErrors(result.overflow);
    const newIds = result.items.filter((item) => !beforeIds.has(item.localId) && item.status === "pending").map((item) => item.localId);
    if (autoUpload && projectId && newIds.length > 0) await uploadAll(projectId, newIds);
    return result;
  }, [autoUpload, commit, projectId, uploadAll]);

  const retryItem = useCallback(async (localId: string) => {
    if (!projectId) return false;
    return uploadOne(localId, projectId);
  }, [projectId, uploadOne]);

  const removeItem = useCallback(async (localId: string) => {
    const item = itemsRef.current.find((candidate) => candidate.localId === localId);
    if (!item) return;
    if (item.materialId && projectId) {
      try {
        await deleteFile(item.materialId, projectId);
      } catch (error) {
        commit((current) => updateMaterialItem(current, localId, {
          errorMessage: errorMessage(error),
          status: "failed",
          retryable: Boolean(item.file)
        }));
        return;
      }
    }
    commit((current) => current.filter((candidate) => candidate.localId !== localId));
    setSelectionErrors([]);
  }, [commit, deleteFile, projectId]);

  const summary = useMemo(() => materialUploadSummary(items), [items]);
  const isUploading = items.some((item) => item.status === "uploading");
  const hasProcessing = items.some((item) => item.status === "uploading" || item.status === "processing");
  const hasBlockingErrors = items.some((item) => item.status === "failed");

  return {
    items,
    selectionErrors,
    summary,
    isUploading,
    hasProcessing,
    hasBlockingErrors,
    addFiles,
    uploadAll,
    retryItem,
    removeItem
  };
}
