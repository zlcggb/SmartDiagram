import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  KimiKnowledgeCatalog,
  KimiKnowledgeCatalogEntry
} from "./types.js";

const MAX_MARKDOWN_BYTES = 300_000;
const MAX_CATALOG_FILES = 256;
const catalogCache = new Map<string, KimiKnowledgeCatalog>();

function isDirectory(path: string) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function isSkillRoot(path: string) {
  return (
    isDirectory(path) &&
    existsSync(resolve(path, "SKILL.md")) &&
    isDirectory(resolve(path, "reference"))
  );
}

export function resolveKimiSkillRoot(explicitRoot?: string) {
  if ((process.env.PPT_KIMI_KNOWLEDGE_MODE ?? "auto").trim().toLowerCase() === "off") {
    return null;
  }
  if (explicitRoot?.trim()) {
    const resolvedExplicitRoot = resolve(explicitRoot.trim());
    return isSkillRoot(resolvedExplicitRoot) ? resolvedExplicitRoot : null;
  }
  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  const configured = process.env.KIMI_SLIDES_SKILL_DIR?.trim();
  const candidates = [
    configured,
    resolve(process.cwd(), "tmp/kimi-slides-skill/kimi-slides"),
    resolve(moduleDirectory, "../../../../../tmp/kimi-slides-skill/kimi-slides")
  ].filter((candidate): candidate is string => Boolean(candidate));
  return candidates.find(isSkillRoot) ?? null;
}

function markdownFiles(root: string) {
  const files: string[] = [];
  const visit = (directory: string) => {
    if (files.length >= MAX_CATALOG_FILES) return;
    for (const item of readdirSync(directory, { withFileTypes: true })) {
      if (files.length >= MAX_CATALOG_FILES) break;
      const absolutePath = resolve(directory, item.name);
      if (item.isDirectory()) {
        visit(absolutePath);
      } else if (item.isFile() && item.name.toLowerCase().endsWith(".md")) {
        files.push(absolutePath);
      }
    }
  };
  visit(root);
  return files;
}

function titleFromMarkdown(content: string, fallback: string) {
  return (
    content.match(/^#\s+(.+)$/m)?.[1]?.trim() ||
    content.match(/^name:\s*(.+)$/m)?.[1]?.trim() ||
    fallback
  );
}

function entryId(root: string, absolutePath: string) {
  const relativePath = relative(root, absolutePath).split(sep).join("/");
  const withoutExtension = relativePath.replace(/\.md$/i, "");
  return withoutExtension
    .replace(/\/design$/i, "")
    .replace(/\/en\//i, "/")
    .replace(/[^a-z0-9/_-]+/gi, "-")
    .replace(/\//g, ":")
    .replace(/-+/g, "-")
    .replace(/^[-:]+|[-:]+$/g, "")
    .toLowerCase();
}

function readEntry(
  root: string,
  absolutePath: string,
  warnings: string[]
): KimiKnowledgeCatalogEntry | null {
  try {
    const size = statSync(absolutePath).size;
    if (size > MAX_MARKDOWN_BYTES) {
      warnings.push(`跳过过大的知识文档：${relative(root, absolutePath)}`);
      return null;
    }
    const content = readFileSync(absolutePath, "utf8");
    const relativePath = relative(root, absolutePath).split(sep).join("/");
    return {
      id: entryId(root, absolutePath),
      title: titleFromMarkdown(content, relativePath),
      absolutePath,
      relativePath,
      content
    };
  } catch (error) {
    warnings.push(
      `读取知识文档失败：${relative(root, absolutePath)}（${error instanceof Error ? error.message : "未知错误"}）`
    );
    return null;
  }
}

function readOptional(path: string, warnings: string[]) {
  try {
    if (!existsSync(path) || statSync(path).size > MAX_MARKDOWN_BYTES) return "";
    return readFileSync(path, "utf8");
  } catch (error) {
    warnings.push(
      `读取知识文档失败：${path}（${error instanceof Error ? error.message : "未知错误"}）`
    );
    return "";
  }
}

export function loadKimiKnowledgeCatalog(root: string): KimiKnowledgeCatalog {
  const cached = catalogCache.get(root);
  if (cached) return cached;

  const warnings: string[] = [];
  const categoryRoot = resolve(root, "reference/slides_categories");
  const designSystemRoot = resolve(root, "reference/design_system");
  const categories = isDirectory(categoryRoot)
    ? markdownFiles(categoryRoot)
        .map((path) => readEntry(categoryRoot, path, warnings))
        .filter((entry): entry is KimiKnowledgeCatalogEntry => Boolean(entry))
        .sort((left, right) => left.id.localeCompare(right.id))
    : [];
  const designSystems = isDirectory(designSystemRoot)
    ? markdownFiles(designSystemRoot)
        .map((path) => readEntry(designSystemRoot, path, warnings))
        .filter((entry): entry is KimiKnowledgeCatalogEntry => Boolean(entry))
        .sort((left, right) => left.id.localeCompare(right.id))
    : [];

  const catalog: KimiKnowledgeCatalog = {
    root,
    generalRules: readOptional(resolve(root, "reference/slides_categories.md"), warnings),
    fontRules: readOptional(resolve(root, "reference/fonts.md"), warnings),
    categories,
    designSystems,
    warnings
  };
  catalogCache.set(root, catalog);
  return catalog;
}

export function clearKimiKnowledgeCatalogCache() {
  catalogCache.clear();
}
