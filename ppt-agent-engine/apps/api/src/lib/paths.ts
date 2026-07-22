import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentFile = fileURLToPath(import.meta.url);
const packageRoot = path.resolve(path.dirname(currentFile), "../..");

export const workspaceRoot = path.resolve(packageRoot, "../..");
export const storageRoot = process.env.STORAGE_DIR ? path.resolve(process.env.STORAGE_DIR) : path.resolve(workspaceRoot, "storage");
export const exportsDir = path.resolve(storageRoot, "exports");
export const fontsDir = path.resolve(storageRoot, "fonts");

export function ensureStorageDirs() {
  fs.mkdirSync(exportsDir, { recursive: true });
  fs.mkdirSync(fontsDir, { recursive: true });
}

export function exportDownloadUrl(pptxPath: string) {
  return `/exports/${encodeURIComponent(path.basename(pptxPath))}`;
}
