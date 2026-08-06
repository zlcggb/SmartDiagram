import assert from "node:assert/strict";
import test from "node:test";
import { buildDecodeValidationArgs, buildNarratedClipArgs, quantizeOverlayInterval, SUBTITLE_BOTTOM_MARGIN } from "./video.js";

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
  assert.ok((filter || "").includes(`overlay=0:H-h-${Math.round(1080 * SUBTITLE_BOTTOM_MARGIN)}:`));
  assert.match(filter || "", /\[sv1\]format=yuv420p\[outv\]/);
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

test("focus overlays fade and are composed below subtitles", () => {
  const args = buildNarratedClipArgs({
    imagePath: "/tmp/slide.png",
    audioPath: "/tmp/audio.mp3",
    outputPath: "/tmp/out.mp4",
    width: 1920,
    height: 1080,
    fps: 30,
    focusOverlays: [{ imagePath: "/tmp/focus.png", startMs: 1_000, endMs: 3_000 }],
    subtitleOverlays: [{ imagePath: "/tmp/subtitle.png", startMs: 1_000, endMs: 3_000 }]
  });
  const filters = args[args.indexOf("-filter_complex") + 1] ?? "";

  assert.match(filters, /fade=t=in:st=1\.000:d=0\.200:alpha=1/);
  assert.match(filters, /fade=t=out:st=2\.800:d=0\.200:alpha=1/);
  assert.ok(filters.indexOf("[focus0]") < filters.indexOf("[subtitle0]"));
  assert.match(filters, /\[fv0\]\[subtitle0\]overlay=/);
});

test("focus disabled preserves the simple image and audio path", () => {
  const args = buildNarratedClipArgs({
    imagePath: "/tmp/slide.png",
    audioPath: "/tmp/audio.mp3",
    outputPath: "/tmp/out.mp4",
    width: 1920,
    height: 1080,
    fps: 30
  });

  assert.equal(args.includes("-filter_complex"), false);
  assert.equal(args.includes("-vf"), true);
});

test("director intervals are expanded to complete output frames", () => {
  assert.deepEqual(quantizeOverlayInterval(101, 149, 30), {
    startMs: 100,
    endMs: 166.66666666666666
  });
});

test("final validation decodes both required streams", () => {
  const args = buildDecodeValidationArgs("/tmp/final.mp4");
  assert.deepEqual(args.slice(0, 5), ["-y", "-hide_banner", "-loglevel", "error", "-i"]);
  assert.ok(args.includes("0:v:0"));
  assert.ok(args.includes("0:a:0"));
  assert.deepEqual(args.slice(-3), ["-f", "null", "-"]);
});
