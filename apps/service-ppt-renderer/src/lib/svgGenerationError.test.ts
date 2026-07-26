import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveSvgGenerationFailure,
  SvgQualityValidationError
} from "./svgGenerationError.js";

test("SVG 质量门禁错误映射为 422，并说明上一版本仍被保留", () => {
  const rejectedSvg = '<svg viewBox="0 0 1280 720"><text x="80" y="120">风险项</text></svg>';
  const failure = resolveSvgGenerationFailure(
    new SvgQualityValidationError([
      "含禁止的可编译特性：style",
      "content-zone-1 检测到附着式整高强调色条"
    ], rejectedSvg, 2)
  );

  assert.deepEqual(failure, {
    statusCode: 422,
    message:
      "新设计稿有 2 项未通过质量检查，上一版本已保留。",
    data: {
      code: "SVG_QUALITY_VALIDATION_FAILED",
      issues: [
        "含禁止的可编译特性：style",
        "content-zone-1 检测到附着式整高强调色条"
      ],
      svgPreview: rejectedSvg,
      attemptCount: 2
    }
  });
});

test("普通模型或网络异常不伪装成质量门禁错误", () => {
  assert.equal(resolveSvgGenerationFailure(new Error("upstream unavailable")), null);
});
