import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ensureSubtitleFonts, subtitleFontsSourceDir } from "./subtitleFonts.js";

test("字幕字体源位于 API 运行资产目录", () => {
  assert.equal(subtitleFontsSourceDir, path.resolve("apps/api/assets/fonts"));
  assert.ok(!subtitleFontsSourceDir.includes(`${path.sep}docs${path.sep}`));
  assert.ok(fs.existsSync(path.join(subtitleFontsSourceDir, "NotoSansCJKsc-Regular.otf")));
  assert.ok(fs.existsSync(path.join(subtitleFontsSourceDir, "NotoSansCJK_LICENSE.txt")));
});

test("ensureSubtitleFonts 将字体和许可证复制到运行时目录", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ppt-subtitle-fonts-"));
  const sourceDir = path.join(root, "source");
  const targetDir = path.join(root, "target");
  fs.mkdirSync(sourceDir);
  fs.writeFileSync(path.join(sourceDir, "NotoSansCJKsc-Regular.otf"), "font-bytes");
  fs.writeFileSync(path.join(sourceDir, "NotoSansCJK_LICENSE.txt"), "SIL OPEN FONT LICENSE Version 1.1");

  try {
    const fonts = ensureSubtitleFonts(targetDir, sourceDir);
    assert.equal(fonts[0]?.id, "noto-sans-cjk-sc");
    assert.equal(fs.readFileSync(fonts[0]!.fontPath, "utf8"), "font-bytes");
    assert.match(fs.readFileSync(fonts[0]!.licensePath, "utf8"), /OPEN FONT LICENSE/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
