import crypto from "node:crypto";
import path from "node:path";
import type { FastifyInstance } from "fastify";

const DEFAULT_TTL_SECONDS = 10 * 60;

interface ExportAccessOptions {
  secret?: string;
  now?: number;
  ttlSeconds?: number;
}

function signingSecret(explicit?: string) {
  const secret = explicit
    ?? process.env.PPT_EXPORT_SIGNING_SECRET
    ?? process.env.PPT_INTERNAL_API_SECRET;
  if (!secret) {
    throw new Error("PPT_EXPORT_SIGNING_SECRET 或 PPT_INTERNAL_API_SECRET 未配置");
  }
  return secret;
}

function signatureFor(filename: string, expires: number, secret: string) {
  return crypto
    .createHmac("sha256", secret)
    .update(`${filename}\n${expires}`)
    .digest("base64url");
}

function safeFilenameFromUrl(rawUrl: string) {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl, "http://ppt.local");
  } catch {
    return null;
  }
  if (!parsed.pathname.startsWith("/exports/")) return null;

  let filename: string;
  try {
    filename = decodeURIComponent(parsed.pathname.slice("/exports/".length));
  } catch {
    return null;
  }
  if (!filename || path.posix.basename(filename) !== filename || path.win32.basename(filename) !== filename) {
    return null;
  }
  return { parsed, filename };
}

export function createProtectedExportUrl(filePath: string, options: ExportAccessOptions = {}) {
  const filename = path.basename(filePath);
  const expires = Math.floor((options.now ?? Date.now()) / 1000)
    + (options.ttlSeconds ?? DEFAULT_TTL_SECONDS);
  const signature = signatureFor(filename, expires, signingSecret(options.secret));
  const query = new URLSearchParams({ expires: String(expires), signature });
  return `/exports/${encodeURIComponent(filename)}?${query.toString()}`;
}

export function verifyProtectedExportRequest(rawUrl: string, options: ExportAccessOptions = {}) {
  const resource = safeFilenameFromUrl(rawUrl);
  if (!resource) return false;

  const expiresRaw = resource.parsed.searchParams.get("expires") ?? "";
  const provided = resource.parsed.searchParams.get("signature") ?? "";
  if (!/^\d{1,12}$/u.test(expiresRaw) || !/^[A-Za-z0-9_-]{43}$/u.test(provided)) return false;

  const expires = Number(expiresRaw);
  const currentSeconds = Math.floor((options.now ?? Date.now()) / 1000);
  if (!Number.isSafeInteger(expires) || expires < currentSeconds) return false;

  const expected = signatureFor(resource.filename, expires, signingSecret(options.secret));
  return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

export function installProtectedExports(app: FastifyInstance) {
  app.addHook("onRequest", async (request, reply) => {
    const pathname = request.url.split("?", 1)[0] ?? request.url;
    if (!pathname.startsWith("/exports/")) return;
    if (!verifyProtectedExportRequest(request.url)) {
      return reply.status(404).send({ ok: false, message: "未找到文件" });
    }
  });
}
