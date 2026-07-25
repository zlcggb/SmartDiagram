import assert from "node:assert/strict";
import test from "node:test";
import {
  canPrincipalAccessProject,
  projectOwnerData,
  projectOwnerWhere,
  type PptPrincipal
} from "./pptAccess.js";

const userA: PptPrincipal = {
  kind: "user",
  tenantId: "tenant-a",
  userId: "user-a"
};

test("登录用户项目按 tenant + user 双重隔离", () => {
  assert.deepEqual(projectOwnerData(userA), {
    ownerType: "user",
    tenantId: "tenant-a",
    ownerKey: "user-a",
    expiresAt: null
  });
  assert.deepEqual(projectOwnerWhere(userA), {
    ownerType: "user",
    tenantId: "tenant-a",
    ownerKey: "user-a"
  });
  assert.equal(
    canPrincipalAccessProject(userA, {
      ownerType: "user",
      tenantId: "tenant-a",
      ownerKey: "user-a",
      expiresAt: null
    }),
    true
  );
  assert.equal(
    canPrincipalAccessProject(userA, {
      ownerType: "user",
      tenantId: "tenant-b",
      ownerKey: "user-a",
      expiresAt: null
    }),
    false
  );
  assert.equal(
    canPrincipalAccessProject(userA, {
      ownerType: "user",
      tenantId: "tenant-a",
      ownerKey: "user-b",
      expiresAt: null
    }),
    false
  );
});

test("不同访客令牌互不访问且过期项目不可访问", () => {
  const now = new Date("2026-07-24T10:00:00.000Z");
  const guestA: PptPrincipal = { kind: "guest", guestKey: "guest-hash-a" };
  assert.equal(
    canPrincipalAccessProject(
      guestA,
      {
        ownerType: "guest",
        tenantId: null,
        ownerKey: "guest-hash-a",
        expiresAt: new Date("2026-07-25T10:00:00.000Z")
      },
      now
    ),
    true
  );
  assert.equal(
    canPrincipalAccessProject(
      guestA,
      {
        ownerType: "guest",
        tenantId: null,
        ownerKey: "guest-hash-b",
        expiresAt: new Date("2026-07-25T10:00:00.000Z")
      },
      now
    ),
    false
  );
  assert.equal(
    canPrincipalAccessProject(
      guestA,
      {
        ownerType: "guest",
        tenantId: null,
        ownerKey: "guest-hash-a",
        expiresAt: new Date("2026-07-24T09:59:59.000Z")
      },
      now
    ),
    false
  );
});

test("迁移后的 legacy 项目不对任何普通主体开放", () => {
  assert.equal(
    canPrincipalAccessProject(userA, {
      ownerType: "legacy",
      tenantId: null,
      ownerKey: null,
      expiresAt: null
    }),
    false
  );
});

