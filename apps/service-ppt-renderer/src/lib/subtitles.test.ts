import assert from "node:assert/strict";
import test from "node:test";
import { videoExportSchema } from "@ppt-agent/shared";
import { buildSubtitleCues, splitSubtitleText, subtitleCuesToSrt } from "./subtitles.js";

test("videoExportSchema 校验字幕样式并默认使用柔和胶囊", () => {
  assert.equal(videoExportSchema.parse({}).subtitleStyle, "soft-capsule");
  assert.equal(videoExportSchema.parse({ subtitleStyle: "brand-accent" }).subtitleStyle, "brand-accent");
  assert.throws(() => videoExportSchema.parse({ subtitleStyle: "giant-banner" }));
});

test("buildSubtitleCues 按标点分段并覆盖整段音频时长", () => {
  const cues = buildSubtitleCues(
    "大家好，欢迎来到这里。今天我们讲三个重点！最后一起总结。",
    9_000,
    1_000
  );

  assert.ok(cues.length >= 3);
  assert.equal(cues[0]?.startMs, 1_000);
  assert.equal(cues.at(-1)?.endMs, 10_000);
  assert.ok(cues.every((cue) => cue.text.length <= 36));
  assert.ok(cues.every((cue, index) => index === 0 || cue.startMs === cues[index - 1]?.endMs));
});

test("splitSubtitleText 将超过 36 字的内容切成下一条单行字幕", () => {
  const segments = splitSubtitleText("数".repeat(40));
  assert.deepEqual(segments.map((segment) => segment.length), [36, 4]);
});

test("buildSubtitleCues 对空文本返回空数组", () => {
  assert.deepEqual(buildSubtitleCues("  ", 5_000), []);
});

test("subtitleCuesToSrt 生成标准 SRT 时间码", () => {
  const srt = subtitleCuesToSrt([
    { startMs: 0, endMs: 1_234, text: "第一句" },
    { startMs: 3_723_004, endMs: 3_725_678, text: "第二句" }
  ]);

  assert.equal(srt, [
    "1",
    "00:00:00,000 --> 00:00:01,234",
    "第一句",
    "",
    "2",
    "01:02:03,004 --> 01:02:05,678",
    "第二句",
    ""
  ].join("\n"));
});
