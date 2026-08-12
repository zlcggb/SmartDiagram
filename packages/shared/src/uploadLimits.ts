export const DEFAULT_MATERIAL_UPLOAD_LIMIT_MIB = 50;
export const MATERIAL_MULTIPART_OVERHEAD_BYTES = 1024 * 1024;

export function resolveMaterialUploadLimitMib(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= DEFAULT_MATERIAL_UPLOAD_LIMIT_MIB
    ? parsed
    : DEFAULT_MATERIAL_UPLOAD_LIMIT_MIB;
}

export function materialUploadLimitBytes(value: unknown): number {
  return resolveMaterialUploadLimitMib(value) * 1024 * 1024;
}
