import fs from "node:fs";
import path from "node:path";
import { prisma } from "../apps/api/src/lib/prisma.js";

const migrationsDir = path.resolve(process.cwd(), "prisma/migrations");

function splitSqlStatements(sql: string) {
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) => statement.trim())
    .filter(Boolean);
}

async function ensureMigrationTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "_ppt_agent_migrations" (
      "name" TEXT NOT NULL PRIMARY KEY,
      "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

async function appliedMigrationNames() {
  const rows = await prisma.$queryRawUnsafe<Array<{ name: string }>>(`SELECT "name" FROM "_ppt_agent_migrations"`);
  return new Set(rows.map((row) => row.name));
}

async function applyMigration(name: string, migrationPath: string) {
  const sql = fs.readFileSync(migrationPath, "utf8");
  const statements = splitSqlStatements(sql);

  await prisma.$transaction(async (tx) => {
    for (const statement of statements) {
      await tx.$executeRawUnsafe(statement);
    }
    await tx.$executeRawUnsafe(`INSERT INTO "_ppt_agent_migrations" ("name") VALUES ($1)`, name);
  });
}

async function main() {
  fs.mkdirSync(migrationsDir, { recursive: true });
  await ensureMigrationTable();
  const applied = await appliedMigrationNames();
  const migrationNames = fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  let appliedCount = 0;
  for (const name of migrationNames) {
    if (applied.has(name)) {
      continue;
    }
    const migrationPath = path.join(migrationsDir, name, "migration.sql");
    if (!fs.existsSync(migrationPath)) {
      continue;
    }
    await applyMigration(name, migrationPath);
    appliedCount += 1;
    console.log(`Applied migration ${name}`);
  }

  console.log(appliedCount === 0 ? "Database already up to date" : `Applied ${appliedCount} migration(s)`);
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
