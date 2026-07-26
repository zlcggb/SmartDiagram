import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildSubtitleOverlaySvg, renderSubtitleOverlayPng, wrapSubtitleOverlayLines } from "./subtitleOverlay.js";

const baseOptions = {
  width: 1920,
  fontPath: "/tmp/NotoSansCJKsc-Regular.otf",
  fontFamily: "Noto Sans CJK SC"
};

test("wrapSubtitleOverlayLines 将长字幕保持为单行", () => {
  const text = "大家好，今天我们围绕“四维数据模型实战”分享三个核心要点。";
  assert.deepEqual(wrapSubtitleOverlayLines(text), [text]);
});

test("长字幕 SVG 只渲染一个文本行", () => {
  const svg = buildSubtitleOverlaySvg("大家好，今天我们围绕“四维数据模型实战”分享三个核心要点。", {
    ...baseOptions,
    style: "soft-capsule"
  });
  assert.equal(svg.match(/<text /gu)?.length, 1);
  assert.match(svg, /height="125"/);
});

test("minimal-outline 默认使用 34px 轻描边且没有大底板", () => {
  const svg = buildSubtitleOverlaySvg("建立清晰的业务边界，让系统更好维护。", {
    ...baseOptions,
    style: "minimal-outline"
  });
  assert.match(svg, /font-size="34"/);
  assert.match(svg, /paint-order="stroke fill"/);
  assert.doesNotMatch(svg, /data-role="caption-panel"/);
});

test("soft-capsule 底板支持更长的单行字幕", () => {
  const svg = buildSubtitleOverlaySvg("建立清晰的业务边界，让系统更好维护，同时让团队协作和数据流转更高效。", {
    ...baseOptions,
    style: "soft-capsule"
  });
  const panelWidth = Number(svg.match(/data-role="caption-panel"[^>]*width="(\d+)"/)?.[1]);
  assert.ok(panelWidth > 1_000 && panelWidth <= 1_575);
  assert.match(svg, /fill-opacity="0\.58"/);
});

test("brand-accent 使用紧凑胶囊和橙色品牌短线", () => {
  const svg = buildSubtitleOverlaySvg("用 AI 让数据流转更高效。", {
    ...baseOptions,
    style: "brand-accent"
  });
  assert.match(svg, /data-role="caption-panel"/);
  assert.match(svg, /data-role="brand-accent"/);
  assert.match(svg, /fill="#F25700"/);
});

test("renderSubtitleOverlayPng 使用指定中文字体生成透明 PNG", () => {
  const outputPath = path.join(os.tmpdir(), `ppt-subtitle-${Date.now()}.png`);
  const workspaceRoot = path.resolve(import.meta.dirname, "../../..");
  const fontPath = path.join(workspaceRoot, "apps/service-ppt-renderer/assets/fonts/NotoSansCJKsc-Regular.otf");
  try {
    renderSubtitleOverlayPng("这是一段测试字幕，用来检查中文字体。", outputPath, {
      width: 1920,
      fontPath,
      fontFamily: "Noto Sans CJK SC"
    });
    const bytes = fs.readFileSync(outputPath);
    assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.ok(bytes.length > 10_000);
  } finally {
    fs.rmSync(outputPath, { force: true });
  }
});
