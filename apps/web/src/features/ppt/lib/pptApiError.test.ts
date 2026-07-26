import assert from "node:assert/strict";
import test from "node:test";
import { getSvgQualityFailure, PptApiError } from "./pptApiError.js";

test("extracts structured SVG quality diagnostics from an API error", () => {
  const data = {
    code: "SVG_QUALITY_VALIDATION_FAILED" as const,
    issues: ["第 2 个 text 内容高度超过 data-h"],
    svgPreview: '<svg viewBox="0 0 1280 720" />',
    attemptCount: 2
  };

  assert.deepEqual(
    getSvgQualityFailure(new PptApiError("quality failed", 422, data)),
    data
  );
});

test("ignores unrelated or malformed API error data", () => {
  assert.equal(
    getSvgQualityFailure(new PptApiError("network failed", 502, null)),
    null
  );
  assert.equal(
    getSvgQualityFailure(
      new PptApiError("bad payload", 422, {
        code: "SVG_QUALITY_VALIDATION_FAILED",
        issues: "not-an-array"
      })
    ),
    null
  );
});
