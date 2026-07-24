import crypto from "node:crypto";
import type { PptPrincipal } from "./pptAccess.js";

type HeaderSource = Headers | Record<string, string | string[] | undefined>;

export class PptAuthError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number
  ) {
    super(message);
    this.name = "PptAuthError";
  }
}

function headerValue(headers: HeaderSource, name: string) {
  if (headers instanceof Headers) return headers.get(name) ?? "";
  const value = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function safeSecretEqual(received: string, expected: string) {
  if (!received || !expected) return false;
  const left = Buffer.from(received);
  const right = Buffer.from(expected);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function isValidGuestToken(value: string) {
  return /^ppt_guest_[a-f0-9]{64}$/u.test(value);
}

export function hashGuestToken(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export interface ResolvePptPrincipalOptions {
  authServiceUrl?: string;
  internalSecret?: string;
  fetcher?: typeof fetch;
}

export async function resolvePptPrincipal(
  headers: HeaderSource,
  options: ResolvePptPrincipalOptions = {}
): Promise<PptPrincipal> {
  const internalSecret = options.internalSecret ?? process.env.PPT_INTERNAL_API_SECRET ?? "";
  const receivedInternalSecret = headerValue(headers, "x-ppt-internal-secret");
  if (safeSecretEqual(receivedInternalSecret, internalSecret)) {
    return { kind: "internal" };
  }

  const authorization = headerValue(headers, "authorization").trim();
  if (authorization) {
    if (!/^Bearer\s+\S+$/iu.test(authorization)) {
      throw new PptAuthError("登录凭证格式无效", 401);
    }
    const authServiceUrl = (
      options.authServiceUrl ??
      process.env.AUTH_SERVICE_URL ??
      process.env.MATERIAL_GATEWAY_URL ??
      "http://127.0.0.1:8000"
    ).replace(/\/$/u, "");
    let response: Response;
    try {
      response = await (options.fetcher ?? fetch)(`${authServiceUrl}/api/auth/me`, {
        headers: { authorization }
      });
    } catch {
      throw new PptAuthError("统一认证服务暂时不可用", 503);
    }
    if (response.status === 401 || response.status === 403) {
      throw new PptAuthError("登录已失效，请重新登录", 401);
    }
    if (!response.ok) {
      throw new PptAuthError("统一认证服务暂时不可用", 503);
    }
    const payload = (await response.json()) as {
      user?: { id?: unknown; user_id?: unknown; tenant_id?: unknown };
    };
    const userId = String(payload.user?.id ?? payload.user?.user_id ?? "").trim();
    const tenantId = String(payload.user?.tenant_id ?? "").trim();
    if (!userId || !tenantId) {
      throw new PptAuthError("统一认证服务返回了无效身份", 503);
    }
    return { kind: "user", userId, tenantId };
  }

  const guestToken = headerValue(headers, "x-ppt-guest-token").trim();
  if (!isValidGuestToken(guestToken)) {
    throw new PptAuthError("缺少有效的访客会话", 401);
  }
  return { kind: "guest", guestKey: hashGuestToken(guestToken) };
}

