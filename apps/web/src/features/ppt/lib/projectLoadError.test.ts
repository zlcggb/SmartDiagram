import assert from "node:assert/strict";
import test from "node:test";
import { PptApiError, shouldUseGuestProjectFallback } from "./pptApiError.ts";
import { classifyProjectLoadFailure } from "./projectLoadError.ts";

test("shouldUseGuestProjectFallback rejects auth and missing project statuses", () => {
  assert.equal(shouldUseGuestProjectFallback(404), false);
  assert.equal(shouldUseGuestProjectFallback(401), false);
  assert.equal(shouldUseGuestProjectFallback(403), false);
  assert.equal(shouldUseGuestProjectFallback(500), true);
  assert.equal(shouldUseGuestProjectFallback(0), true);
});

test("classifyProjectLoadFailure maps HTTP statuses", () => {
  assert.equal(classifyProjectLoadFailure(new PptApiError("未找到项目", 404)).kind, "not-found");
  assert.equal(classifyProjectLoadFailure(new PptApiError("缺少有效的访客会话", 401)).kind, "unauthorized");
  assert.equal(classifyProjectLoadFailure(new PptApiError("无权访问", 403)).kind, "forbidden");
  assert.equal(classifyProjectLoadFailure(new Error("Failed to fetch")).kind, "network");
});
