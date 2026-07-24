import assert from "node:assert/strict";
import test from "node:test";
import { createProtectedExportUrl, verifyProtectedExportRequest } from "./exportAccess.js";

const secret = "test-export-signing-secret";
const now = new Date("2026-07-24T08:00:00.000Z").getTime();

test("导出文件只接受未过期且未被篡改的签名链接", () => {
  const url = createProtectedExportUrl("/tmp/private deck.pptx", {
    secret,
    now,
    ttlSeconds: 60
  });

  assert.match(url, /^\/exports\/private%20deck\.pptx\?/u);
  assert.equal(verifyProtectedExportRequest(url, { secret, now: now + 30_000 }), true);
  assert.equal(verifyProtectedExportRequest(url, { secret, now: now + 61_000 }), false);
  assert.equal(
    verifyProtectedExportRequest(url.replace("private%20deck.pptx", "other.pptx"), {
      secret,
      now: now + 30_000
    }),
    false
  );
});

test("无签名和目录穿越形式的导出地址均被拒绝", () => {
  assert.equal(verifyProtectedExportRequest("/exports/private.pptx", { secret, now }), false);
  assert.equal(
    verifyProtectedExportRequest("/exports/%2E%2E%2Fprivate.pptx?expires=9999999999&signature=x", {
      secret,
      now
    }),
    false
  );
});
