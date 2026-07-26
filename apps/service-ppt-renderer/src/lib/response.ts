import type { ApiFailure, ApiSuccess } from "@ppt-agent/shared";

export function ok<T>(data: T, message = ""): ApiSuccess<T> {
  return { success: true, data, message };
}

export function fail<T = unknown>(message: string, data: T | null = null): ApiFailure<T> {
  return { success: false, data, message };
}
