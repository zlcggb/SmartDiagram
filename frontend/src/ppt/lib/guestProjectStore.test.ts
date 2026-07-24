import assert from "node:assert/strict";
import test from "node:test";
import {
  createGuestProjectRepository,
  type GuestProjectRecord,
  type GuestProjectStorage
} from "./guestProjectStore.ts";

function memoryDatabase(): GuestProjectStorage {
  const records = new Map<string, GuestProjectRecord>();
  return {
    async get(id) {
      return records.get(id) ?? null;
    },
    async getAll() {
      return [...records.values()];
    },
    async put(record) {
      records.set(record.projectId, record);
    },
    async delete(id) {
      records.delete(id);
    }
  };
}

function detail(id: string, updatedAt: string) {
  return {
    project: {
      id,
      name: `项目 ${id}`,
      reportType: "汇报",
      audience: "管理层",
      purpose: "说明进展",
      pageCount: 6,
      theme: "white-blue",
      mode: "paste" as const,
      topic: null,
      briefJson: null,
      researchJson: null,
      createdAt: updatedAt,
      updatedAt
    },
    latestSourceText: null,
    facts: [],
    slides: [],
    exports: [],
    materials: []
  };
}

test("访客项目列表来自浏览器仓库并按更新时间排序", async () => {
  const repository = createGuestProjectRepository(memoryDatabase());
  await repository.save(detail("older", "2026-07-23T10:00:00.000Z"));
  await repository.save(detail("newer", "2026-07-24T10:00:00.000Z"));

  assert.deepEqual(
    (await repository.list()).map((project) => project.id),
    ["newer", "older"]
  );
  assert.equal((await repository.get("older"))?.project.name, "项目 older");
});

