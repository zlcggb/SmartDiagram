export class PptApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "PptApiError";
    this.status = status;
  }
}

export function isPptApiError(error: unknown): error is PptApiError {
  return error instanceof PptApiError;
}

/** 访客本地缓存仅在网络/服务端异常时降级；404/401/403 表示项目不可访问 */
export function shouldUseGuestProjectFallback(status: number): boolean {
  return status !== 401 && status !== 403 && status !== 404;
}
