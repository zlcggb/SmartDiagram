import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const workspaceRoot = path.resolve(import.meta.dirname, "../../../..");

test("Prisma 只保存 Knowledge 引用和展示快照，不保存原件或全文", () => {
  const schema = fs.readFileSync(path.join(workspaceRoot, "prisma/schema.prisma"), "utf8");

  assert.match(schema, /model ProjectMaterial\s*\{/);
  assert.match(schema, /knowledgeDocumentId\s+String/);
  assert.match(schema, /knowledgeSourceId\s+String/);
  assert.match(schema, /ingestionJobId\s+String/);
  assert.match(schema, /filename\s+String/);
  assert.match(schema, /contentHash\s+String/);
  assert.doesNotMatch(schema, /model ProjectMaterial[\s\S]*?\b(?:fileBytes|rawContent|extractedText)\b/);
  assert.match(schema, /model Fact[\s\S]*?evidenceJson\s+String\?/);
});

test("ProjectMaterial 迁移是纯增量且关联删除只清理本地引用", () => {
  const migration = fs.readFileSync(
    path.join(workspaceRoot, "prisma/migrations/20260723000000_project_material_facade/migration.sql"),
    "utf8"
  );

  assert.match(migration, /CREATE TABLE "ProjectMaterial"/);
  assert.match(migration, /ALTER TABLE "Fact" ADD COLUMN\s+"evidenceJson" TEXT/);
  assert.match(migration, /ON DELETE CASCADE/);
  assert.doesNotMatch(migration, /DROP TABLE|DROP COLUMN|TRUNCATE/);
});

test("迁移账本已记录但材料表缺失时会执行幂等修复", () => {
  const repair = fs.readFileSync(
    path.join(workspaceRoot, "prisma/migrations/20260723010000_project_material_repair/migration.sql"),
    "utf8"
  );

  assert.match(repair, /CREATE TABLE IF NOT EXISTS "ProjectMaterial"/);
  assert.match(repair, /REFERENCES "Project"\("id"\)/);
  assert.match(repair, /CREATE (?:UNIQUE )?INDEX IF NOT EXISTS/);
  assert.doesNotMatch(repair, /DROP TABLE|DROP COLUMN|TRUNCATE/);
});

test("示例环境声明主 Material Gateway 和批处理预算", () => {
  const example = fs.readFileSync(path.join(workspaceRoot, ".env.example"), "utf8");
  assert.match(example, /^MATERIAL_GATEWAY_URL=/m);
  assert.match(example, /^MATERIAL_CONTEXT_BATCH_CHARS=/m);
});

test("生产启动会先执行纯增量 migration，并检查材料表已初始化", () => {
  const dockerfile = fs.readFileSync(path.join(workspaceRoot, "Dockerfile"), "utf8");
  const prismaSource = fs.readFileSync(
    path.join(workspaceRoot, "apps/service-ppt-renderer/src/lib/prisma.ts"),
    "utf8"
  );

  assert.match(dockerfile, /apply-migrations\.ts[\s\S]*?node apps\/service-ppt-renderer\/dist\/index\.js/);
  assert.match(prismaSource, /prisma\.projectMaterial\.count\(\)/);
  assert.match(prismaSource, /evidenceJson/);
});

test("本地 API 启动也会先执行 migration", () => {
  const devCommon = fs.readFileSync(path.join(workspaceRoot, "scripts/dev-common.sh"), "utf8");

  assert.match(devCommon, /prepare_ppt_stack\(\)[\s\S]*?prisma\/apply-migrations\.ts/);
});

test("Compose 首次启动会自动创建 PPT 数据库，再启动 migration", () => {
  const compose = fs.readFileSync(path.join(workspaceRoot, "docker-compose.yml"), "utf8");

  assert.match(compose, /ppt-db-init:/);
  assert.match(compose, /pg_database[\s\S]*?ppt_agent/);
  assert.match(
    compose,
    /ppt-node-api:[\s\S]*?ppt-db-init:[\s\S]*?condition:\s*service_completed_successfully/
  );
  assert.doesNotMatch(compose, /库需先建好/);
});
