import assert from "node:assert/strict";
import test from "node:test";
import { buildNarratedClipArgs } from "./video.js";

test("buildNarratedClipArgs 为字幕 PNG 生成按时间显示的 overlay 滤镜", () => {
  const args = buildNarratedClipArgs({
    imagePath: "/tmp/slide.png",
    audioPath: "/tmp/audio.mp3",
    outputPath: "/tmp/clip.mp4",
    width: 1920,
    height: 1080,
    fps: 30,
    subtitleOverlays: [
      { imagePath: "/tmp/subtitle-1.png", startMs: 100, endMs: 1_500 },
      { imagePath: "/tmp/subtitle-2.png", startMs: 1_500, endMs: 3_000 }
    ]
  });

  const filter = args[args.indexOf("-filter_complex") + 1];
  assert.match(filter || "", /\[2:v\]format=rgba\[subtitle0\]/);
  assert.match(filter || "", /enable='between\(t,0\.100,1\.500\)'/);
  assert.match(filter || "", /overlay=0:H-h-70:/);
  assert.match(filter || "", /\[video1\]format=yuv420p\[outv\]/);
  assert.deepEqual(args.slice(-4), ["-shortest", "-movflags", "+faststart", "/tmp/clip.mp4"]);
});

test("buildNarratedClipArgs 关闭字幕时保留原有单图音频链路", () => {
  const args = buildNarratedClipArgs({
    imagePath: "/tmp/slide.png",
    audioPath: "/tmp/audio.mp3",
    outputPath: "/tmp/clip.mp4",
    width: 1280,
    height: 720,
    fps: 25
  });

  assert.ok(args.includes("-vf"));
  assert.ok(!args.includes("-filter_complex"));
});
