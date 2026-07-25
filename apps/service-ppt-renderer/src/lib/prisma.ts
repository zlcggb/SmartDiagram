import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { workspaceRoot } from "./paths.js";

const apiRoot = path.resolve(workspaceRoot, "apps/service-ppt-renderer");
const defaultDatabasePath = path.resolve(workspaceRoot, "prisma/dev.db");

function stripQuotes(value: string) {
  return value.trim().replace(/^["']|["']$/g, "");
}

function loadEnvFile(filePath: string, originalKeys: Set<string>, allowOverrideLoadedValues: boolean) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separator = trimmed.indexOf("=");
    if (separator <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    const value = stripQuotes(trimmed.slice(separator + 1));
    if (!originalKeys.has(key) && (allowOverrideLoadedValues || process.env[key] === undefined)) {
      process.env[key] = value;
    }
  }
}

function toSqliteFileUrl(filePath: string) {
  return `file:${filePath.replace(/\\/g, "/")}`;
}

function isAbsoluteSqlitePath(sqlitePath: string) {
  const normalized = sqlitePath.replace(/\\/g, "/");
  return path.isAbsolute(sqlitePath) || /^[A-Za-z]:\//.test(normalized) || normalized.startsWith("/");
}

function normalizeDatabaseUrl() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    process.env.DATABASE_URL = toSqliteFileUrl(defaultDatabasePath);
    return;
  }

  if (!url.startsWith("file:")) {
    return;
  }

  const [sqlitePath = "", query = ""] = url.slice("file:".length).split("?");
  if (isAbsoluteSqlitePath(decodeURI(sqlitePath))) {
    return;
  }

  process.env.DATABASE_URL = `${toSqliteFileUrl(defaultDatabasePath)}${query ? `?${query}` : ""}`;
}

const originalEnvKeys = new Set(Object.keys(process.env));
loadEnvFile(path.join(workspaceRoot, ".env"), originalEnvKeys, false);
loadEnvFile(path.join(apiRoot, ".env"), originalEnvKeys, true);
// 统一根 .env 里 PPT 库用 PPT_DATABASE_URL；Prisma 仍读 DATABASE_URL
if (!originalEnvKeys.has("DATABASE_URL") && process.env.PPT_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.PPT_DATABASE_URL;
}
fs.mkdirSync(path.dirname(defaultDatabasePath), { recursive: true });
normalizeDatabaseUrl();

// PrismaClient 类可静态导入；DATABASE_URL 只需在 new PrismaClient() 前就绪（见上方 loadEnv）。
const globalForPrisma = globalThis as typeof globalThis & {
  __pptAgentPrisma?: PrismaClient;
};

export const prisma = globalForPrisma.__pptAgentPrisma ?? new PrismaClient();
globalForPrisma.__pptAgentPrisma = prisma;

export function databaseUrlForLog() {
  const url = process.env.DATABASE_URL ?? "";
  if (!url) {
    return "(not configured)";
  }
  if (url.startsWith("file:")) {
    return url;
  }
  return url.replace(/:\/\/([^:@]+):([^@]+)@/, "://$1:***@");
}

export async function checkDatabaseConnection() {
  await prisma.$queryRaw`SELECT 1`;
}

export async function checkDatabaseInitialization() {
  await checkDatabaseConnection();
  await prisma.project.count();
  await prisma.projectMaterial.count();
  await prisma.fact.findFirst({ select: { evidenceJson: true } });
}
