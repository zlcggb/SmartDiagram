/**
 * 将 src/styles.css（Tailwind v3）编译为作用域隔离的纯 CSS，
 * 所有选择器统一加上 .ppt-root 前缀，供宿主应用（Tailwind v4）直接引入。
 *
 * 用法: node build-scoped-css.mjs
 * 产物: ../../../frontend/src/ppt/ppt.css
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import autoprefixer from "autoprefixer";
import prefixSelector from "postcss-prefix-selector";

const __dirname = dirname(fileURLToPath(import.meta.url));

const SCOPE_CLASS = ".ppt-root";
const INPUT_CSS = resolve(__dirname, "src/styles.css");
const OUTPUT_CSS = resolve(__dirname, "../../../frontend/src/ppt/ppt.css");

/** 判断规则是否位于 @keyframes 内部（其中的 from/to/百分比选择器不能加前缀） */
function isInsideKeyframes(rule) {
  let node = rule && rule.parent;
  while (node) {
    if (node.type === "atrule" && /keyframes$/i.test(node.name)) {
      return true;
    }
    node = node.parent;
  }
  return false;
}

/**
 * 作用域转换规则：
 * - :root / html / body（含 html body 组合）→ 替换为 .ppt-root
 * - 其余选择器 → 加 .ppt-root 前缀
 * - @keyframes 内部选择器 → 原样保留
 */
function transformSelector(prefix, selector, prefixedSelector, _filePath, rule) {
  if (isInsideKeyframes(rule)) {
    return selector;
  }
  const trimmed = selector.trim();
  if (trimmed === ":root" || trimmed === "html" || trimmed === "body") {
    return prefix;
  }
  // 处理 "html body"、"html xxx"、"body xxx" 这类以 html/body 开头的组合选择器
  const leadingMatch = trimmed.match(/^(html|body)(\s+(.+))?$/);
  if (leadingMatch) {
    return leadingMatch[3] ? `${prefix} ${leadingMatch[3]}` : prefix;
  }
  return prefixedSelector;
}

const sourceCss = await readFile(INPUT_CSS, "utf8");

const compileResult = await postcss([
  tailwindcss(resolve(__dirname, "tailwind.config.cjs")),
  autoprefixer()
]).process(sourceCss, { from: INPUT_CSS, to: OUTPUT_CSS });

const scopedResult = await postcss([
  prefixSelector({ prefix: SCOPE_CLASS, transform: transformSelector })
]).process(compileResult.css, { from: undefined });

const header = [
  "/* AUTO-GENERATED — 请勿手动编辑 */",
  `/* 由 ppt-agent-engine/apps/web/build-scoped-css.mjs 生成 */`,
  `/* 源文件: ppt-agent-engine/apps/web/src/styles.css */`,
  `/* 重新生成: corepack pnpm --filter @ppt-agent/web build:css */`,
  ""
].join("\n");

await mkdir(dirname(OUTPUT_CSS), { recursive: true });
await writeFile(OUTPUT_CSS, header + scopedResult.css, "utf8");

const sizeKb = (Buffer.byteLength(header + scopedResult.css, "utf8") / 1024).toFixed(1);
console.log(`Scoped CSS written to: ${OUTPUT_CSS}`);
console.log(`Size: ${sizeKb} KB`);
