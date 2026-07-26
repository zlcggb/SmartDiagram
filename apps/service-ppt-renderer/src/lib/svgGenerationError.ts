import type { SvgQualityFailureDto } from "@ppt-agent/shared";

export class SvgQualityValidationError extends Error {
  readonly issues: string[];
  readonly svgPreview: string;
  readonly attemptCount: number;

  constructor(issues: string[], svgPreview = "", attemptCount = 1) {
    super(`SVG 质量校验失败：${issues.join("；")}`);
    this.name = "SvgQualityValidationError";
    this.issues = [...issues];
    this.svgPreview = svgPreview;
    this.attemptCount = attemptCount;
  }
}

function qualityIssues(error: unknown) {
  if (error instanceof SvgQualityValidationError) {
    return {
      issues: error.issues,
      svgPreview: error.svgPreview,
      attemptCount: error.attemptCount
    };
  }
  if (
    error instanceof Error &&
    error.name === "SvgQualityValidationError" &&
    Array.isArray((error as Error & { issues?: unknown }).issues)
  ) {
    const candidate = error as Error & {
      issues: string[];
      svgPreview?: unknown;
      attemptCount?: unknown;
    };
    return {
      issues: candidate.issues,
      svgPreview: typeof candidate.svgPreview === "string" ? candidate.svgPreview : "",
      attemptCount:
        typeof candidate.attemptCount === "number" ? candidate.attemptCount : 1
    };
  }
  return null;
}

export function resolveSvgGenerationFailure(error: unknown) {
  const failure = qualityIssues(error);
  if (!failure) return null;
  const data: SvgQualityFailureDto = {
    code: "SVG_QUALITY_VALIDATION_FAILED",
    issues: [...failure.issues],
    svgPreview: failure.svgPreview,
    attemptCount: failure.attemptCount
  };
  return {
    statusCode: 422,
    message: `新设计稿有 ${failure.issues.length} 项未通过质量检查，上一版本已保留。`,
    data
  };
}
