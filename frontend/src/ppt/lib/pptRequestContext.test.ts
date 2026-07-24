import assert from "node:assert/strict";
import test from "node:test";
import { pptIdentityHeaders } from "./pptRequestContext.ts";

test("登录用户 PPT 请求只发送统一 Bearer Token，不信任客户端用户头", () => {
  const headers = pptIdentityHeaders(
    { access_token: "verified-session-token" },
    () => "unused-guest-token"
  );
  assert.deepEqual(headers, { Authorization: "Bearer verified-session-token" });
  assert.equal("x-user-id" in headers, false);
  assert.equal("x-tenant-id" in headers, false);
});

test("未登录 PPT 请求发送浏览器私有访客令牌", () => {
  const headers = pptIdentityHeaders(null, () => `ppt_guest_${"cd".repeat(32)}`);
  assert.deepEqual(headers, { "X-PPT-Guest-Token": `ppt_guest_${"cd".repeat(32)}` });
});

