import type { ApiFailure, ApiSuccess } from "@ppt-agent/shared";

export function ok<T>(data: T, message = ""): ApiSuccess<T> {
  return { success: true, data, message };
}

export function fail(message: string): ApiFailure {
  return { success: false, data: null, message };
}
