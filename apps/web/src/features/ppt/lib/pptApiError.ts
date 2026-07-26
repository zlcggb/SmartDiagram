import type { SvgQualityFailureDto } from "@ppt-agent/shared";

export class PptApiError extends Error {
  readonly status: number;
  readonly data: unknown;

  constructor(message: string, status: number, data: unknown = null) {
    super(message);
    this.name = "PptApiError";
    this.status = status;
    this.data = data;
  }
}

export function isPptApiError(error: unknown): error is PptApiError {
  return error instanceof PptApiError;
}

export function getSvgQualityFailure(error: unknown): SvgQualityFailureDto | null {
  if (!isPptApiError(error) || !error.data || typeof error.data !== "object") {
    return null;
  }
  const data = error.data as Partial<SvgQualityFailureDto>;
  if (
    data.code !== "SVG_QUALITY_VALIDATION_FAILED" ||
    !Array.isArray(data.issues) ||
    !data.issues.every((issue) => typeof issue === "string") ||
    typeof data.svgPreview !== "string" ||
    typeof data.attemptCount !== "number"
  ) {
    return null;
  }
  return {
    code: data.code,
    issues: data.issues,
    svgPreview: data.svgPreview,
    attemptCount: data.attemptCount
  };
}

/** 访客本地缓存仅在网络/服务端异常时降级；404/401/403 表示项目不可访问 */
export function shouldUseGuestProjectFallback(status: number): boolean {
  return status !== 401 && status !== 403 && status !== 404;
}
