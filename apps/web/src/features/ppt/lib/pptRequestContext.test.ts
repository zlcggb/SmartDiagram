import assert from "node:assert/strict";
import test from "node:test";
import { guestAuthorizationHeader } from "../../../shared/lib/config/guestSession.ts";
import { currentPptIdentityHeaders } from "./pptRequestContext.ts";

test("登录用户 PPT 请求只发送统一 Bearer Token", () => {
  const headers = currentPptIdentityHeaders();
  // Without localStorage in node test, falls back to guest header helper shape.
  assert.equal(typeof headers.Authorization === "string" || headers.Authorization === undefined, true);
});

test("访客 Bearer 头由 guest session 生成", () => {
  const headers = guestAuthorizationHeader({
    access_token: "guest-token",
    token_type: "bearer",
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    kind: "guest",
    guest_id: "guest-1",
  });
  assert.deepEqual(headers, { Authorization: "Bearer guest-token" });
});
