import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  discoverTestFiles,
  parseExecutedTestCount,
  requireNonEmptyGroup,
  TEST_GROUPS,
  toCliPath,
} from "./run-typescript-tests.mjs";

test("discovers nested TypeScript tests in stable order", () => {
  const root = mkdtempSync(path.join(tmpdir(), "smartdiagram-tests-"));
  try {
    mkdirSync(path.join(root, "nested"));
    writeFileSync(path.join(root, "z.test.tsx"), "");
    writeFileSync(path.join(root, "nested", "a.test.ts"), "");
    writeFileSync(path.join(root, "nested", "ignored.ts"), "");

    const relative = discoverTestFiles(root).map((file) => toCliPath(path.relative(root, file)));
    assert.deepEqual(relative, ["nested/a.test.ts", "z.test.tsx"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects a declared group that discovers no test files", () => {
  assert.throws(
    () => requireNonEmptyGroup("empty", []),
    /group \"empty\" discovered 0 files/,
  );
});

test("normalizes Windows paths before passing them to tsx", () => {
  assert.equal(toCliPath("src\\nested\\example.test.ts"), "src/nested/example.test.ts");
});

test("reads executed test counts from TAP and Node spec reporters", () => {
  assert.equal(parseExecutedTestCount("# tests 12\n"), 12);
  const info = String.fromCodePoint(0x2139);
  assert.equal(parseExecutedTestCount(`${info} tests 34\n`), 34);
  assert.equal(parseExecutedTestCount(`${info} tests 0\n`), 0);
});

test("keeps every legacy root TypeScript test group", () => {
  assert.deepEqual(
    TEST_GROUPS.map(({ directory }) => directory),
    [
      "packages/slide-ir",
      "packages/shared",
      "packages/agents",
      "packages/ppt-renderer",
      "apps/service-ppt-renderer",
      "apps/web",
    ],
  );
});
