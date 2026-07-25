import { isPptApiError } from "./pptApiError";

export type ProjectLoadFailureKind = "not-found" | "unauthorized" | "forbidden" | "network" | "unknown";

export interface ProjectLoadFailure {
  kind: ProjectLoadFailureKind;
  message: string;
}

export function classifyProjectLoadFailure(
  error: unknown,
  options?: { isGuest?: boolean }
): ProjectLoadFailure {
  const guest = options?.isGuest ?? false;

  if (isPptApiError(error)) {
    if (error.status === 404) {
      return {
        kind: "not-found",
        message: guest
          ? "该项目不存在、已过期，或属于其他账号。访客项目有效期有限，请重新创建。"
          : "未找到该项目，可能已被删除或您没有访问权限。"
      };
    }
    if (error.status === 401) {
      return {
        kind: "unauthorized",
        message: "请先登录后再访问此项目，或返回桌面打开其他内容。"
      };
    }
    if (error.status === 403) {
      return {
        kind: "forbidden",
        message: "您没有权限访问此项目。"
      };
    }
    return { kind: "unknown", message: error.message || "项目加载失败" };
  }

  const message = error instanceof Error ? error.message : "项目加载失败";
  if (/fetch|network|连接|Failed to fetch/i.test(message)) {
    return { kind: "network", message: "无法连接 PPT 服务，请确认后端已启动后重试。" };
  }
  return { kind: "unknown", message };
}

export const projectLoadFailureTitles: Record<ProjectLoadFailureKind, string> = {
  "not-found": "页面不存在",
  unauthorized: "需要登录",
  forbidden: "无权访问",
  network: "连接失败",
  unknown: "无法打开"
};
