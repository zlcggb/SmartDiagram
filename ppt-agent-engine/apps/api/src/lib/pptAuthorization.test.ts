import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { getPptPrincipal, installPptAuthorization } from "./pptAuthorization.js";

const projects = new Map([
  [
    "project-a",
    {
      ownerType: "user",
      tenantId: "tenant-a",
      ownerKey: "user-a",
      expiresAt: null
    }
  ],
  [
    "project-b",
    {
      ownerType: "user",
      tenantId: "tenant-b",
      ownerKey: "user-b",
      expiresAt: null
    }
  ]
]);

function authFetcher(input: string | URL | Request, init?: RequestInit) {
  const token = new Headers(init?.headers).get("authorization")?.replace(/^Bearer\s+/u, "");
  const user = token === "token-a"
    ? { id: "user-a", tenant_id: "tenant-a" }
    : token === "token-b"
      ? { id: "user-b", tenant_id: "tenant-b" }
      : null;
  return Promise.resolve(
    new Response(user ? JSON.stringify({ user }) : "unauthorized", {
      status: user ? 200 : 401,
      headers: { "content-type": "application/json" }
    })
  );
}

test("统一 preHandler 允许项目所有者并把其他用户伪装成 404", async () => {
  const app = Fastify();
  installPptAuthorization(app, {
    authServiceUrl: "http://auth.test",
    fetcher: authFetcher,
    lookupProject: async (projectId) => projects.get(projectId) ?? null
  });
  app.get<{ Params: { id: string } }>("/api/projects/:id", async (request) => ({
    principal: getPptPrincipal(request)
  }));

  const own = await app.inject({
    method: "GET",
    url: "/api/projects/project-a",
    headers: { authorization: "Bearer token-a" }
  });
  assert.equal(own.statusCode, 200);
  assert.deepEqual(own.json().principal, { kind: "user", tenantId: "tenant-a", userId: "user-a" });

  const foreign = await app.inject({
    method: "GET",
    url: "/api/projects/project-b",
    headers: {
      authorization: "Bearer token-a",
      "x-user-id": "user-b",
      "x-tenant-id": "tenant-b"
    }
  });
  assert.equal(foreign.statusCode, 404);
  assert.equal(foreign.json().message, "未找到项目");
  await app.close();
});

