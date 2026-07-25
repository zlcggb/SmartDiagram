import assert from "node:assert/strict";
import test from "node:test";
import {
  PptAuthError,
  hashGuestToken,
  resolvePptPrincipal
} from "./pptPrincipal.js";

const validGuestToken = `ppt_guest_${"ab".repeat(32)}`;

test("Bearer Token 身份只采用认证服务返回的用户和租户", async () => {
  const principal = await resolvePptPrincipal(
    new Headers({
      authorization: "Bearer valid-token",
      "x-user-id": "spoofed-user",
      "x-tenant-id": "spoofed-tenant"
    }),
    {
      authServiceUrl: "http://auth.test",
      fetcher: async (input, init) => {
        assert.equal(String(input), "http://auth.test/api/auth/me");
        assert.equal(new Headers(init?.headers).get("authorization"), "Bearer valid-token");
        return new Response(
          JSON.stringify({ user: { id: "verified-user", tenant_id: "verified-tenant" } }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
    }
  );

  assert.deepEqual(principal, {
    kind: "user",
    userId: "verified-user",
    tenantId: "verified-tenant"
  });
});

test("访客令牌被哈希后用作项目主体", async () => {
  const principal = await resolvePptPrincipal(
    new Headers({ "x-ppt-guest-token": validGuestToken }),
    { authServiceUrl: "http://auth.test", fetcher: fetch }
  );
  assert.deepEqual(principal, {
    kind: "guest",
    guestKey: hashGuestToken(validGuestToken)
  });
  assert.notEqual(hashGuestToken(validGuestToken), validGuestToken);
});

test("缺少可信身份或无效 Bearer Token 时拒绝请求", async () => {
  await assert.rejects(
    () => resolvePptPrincipal(new Headers(), { authServiceUrl: "http://auth.test", fetcher: fetch }),
    (error: unknown) => error instanceof PptAuthError && error.statusCode === 401
  );
  await assert.rejects(
    () =>
      resolvePptPrincipal(new Headers({ authorization: "Bearer invalid" }), {
        authServiceUrl: "http://auth.test",
        fetcher: async () => new Response("unauthorized", { status: 401 })
      }),
    (error: unknown) => error instanceof PptAuthError && error.statusCode === 401
  );
});

test("内部服务凭证必须精确匹配且优先于外部身份", async () => {
  const principal = await resolvePptPrincipal(
    new Headers({
      "x-ppt-internal-secret": "internal-secret",
      "x-ppt-guest-token": validGuestToken
    }),
    {
      authServiceUrl: "http://auth.test",
      internalSecret: "internal-secret",
      fetcher: fetch
    }
  );
  assert.deepEqual(principal, { kind: "internal" });
});

