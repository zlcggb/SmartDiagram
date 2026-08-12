#!/usr/bin/env node

import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const TEST_FILE_PATTERN = /\.test\.tsx?$/;

export function discoverTestFiles(rootDir) {
  const discovered = [];

  function visit(directory) {
    const entries = readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(entryPath);
      } else if (entry.isFile() && TEST_FILE_PATTERN.test(entry.name)) {
        discovered.push(entryPath);
      }
    }
  }

  visit(rootDir);
  return discovered.sort((left, right) => left.localeCompare(right));
}

export function toCliPath(filePath) {
  return filePath.replaceAll("\\", "/");
}

export function requireNonEmptyGroup(name, files) {
  if (files.length === 0) {
    throw new Error(`TypeScript test group \"${name}\" discovered 0 files`);
  }
  return files;
}

export function parseExecutedTestCount(output) {
  const match = output.match(/^(?:#|\u2139) tests (\d+)\s*$/m);
  return match ? Number.parseInt(match[1], 10) : 0;
}

function corepackInvocation() {
  if (process.platform !== "win32") return { command: "corepack", prefix: [] };

  const corepackJs = path.join(
    path.dirname(process.execPath),
    "node_modules",
    "corepack",
    "dist",
    "corepack.js",
  );
  if (!existsSync(corepackJs)) {
    throw new Error(`Could not locate Corepack next to Node.js: ${corepackJs}`);
  }
  return { command: process.execPath, prefix: [corepackJs] };
}

function runCommand(name, cwd, args, { requireTestCount = false } = {}) {
  console.log(`\n[typescript-tests] ${name}`);
  let invocation;
  try {
    invocation = corepackInvocation();
  } catch (error) {
    console.error(`[typescript-tests] ${name} could not start: ${error.message}`);
    return 1;
  }
  const result = spawnSync(invocation.command, [...invocation.prefix, "pnpm", ...args], {
    cwd,
    encoding: "utf8",
    env: process.env,
    maxBuffer: 32 * 1024 * 1024,
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  if (result.error) {
    console.error(`[typescript-tests] ${name} could not start: ${result.error.message}`);
    return 1;
  }
  if (result.status !== 0) return result.status ?? 1;

  if (requireTestCount) {
    const testCount = parseExecutedTestCount(result.stdout);
    if (testCount === 0) {
      console.error(`[typescript-tests] ${name} reported 0 executed tests`);
      return 1;
    }
    console.log(`[typescript-tests] ${name}: ${testCount} tests passed`);
  }

  return 0;
}

export const TEST_GROUPS = [
  { name: "slide-ir", directory: "packages/slide-ir" },
  { name: "shared", directory: "packages/shared" },
  { name: "agents", directory: "packages/agents" },
  { name: "ppt-renderer", directory: "packages/ppt-renderer" },
  { name: "service-ppt-renderer", directory: "apps/service-ppt-renderer" },
  { name: "web", directory: "apps/web", tsconfig: "tsconfig.app.json" },
];

export function runAllTypeScriptTests(repoRoot = REPO_ROOT) {
  let totalFiles = 0;

  for (const group of TEST_GROUPS) {
    const cwd = path.join(repoRoot, group.directory);
    const files = requireNonEmptyGroup(group.name, discoverTestFiles(path.join(cwd, "src")));
    const relativeFiles = files.map((file) => toCliPath(path.relative(cwd, file)));
    totalFiles += relativeFiles.length;
    console.log(`[typescript-tests] ${group.name}: discovered ${relativeFiles.length} files`);

    const args = ["exec", "tsx"];
    if (group.tsconfig) args.push("--tsconfig", group.tsconfig);
    args.push("--test", ...relativeFiles);
    const status = runCommand(group.name, cwd, args, { requireTestCount: true });
    if (status !== 0) return status;
  }

  const slideIrBuildStatus = runCommand(
    "slide-ir build regression",
    repoRoot,
    ["--filter", "@ppt-agent/slide-ir", "build"],
  );
  if (slideIrBuildStatus !== 0) return slideIrBuildStatus;

  const svgStatus = runCommand(
    "SVG compile regression",
    path.join(repoRoot, "packages/ppt-renderer"),
    ["exec", "tsx", "scripts/svg-compile-regression.ts"],
  );
  if (svgStatus !== 0) return svgStatus;

  console.log(`\n[typescript-tests] completed ${TEST_GROUPS.length} groups, ${totalFiles} test files, and SVG regression`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runAllTypeScriptTests();
}
