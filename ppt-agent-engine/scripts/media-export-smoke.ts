import fs from "node:fs";
import path from "node:path";
import { renderSlidePng } from "../packages/ppt-renderer/src/index.js";
import type { SlideDto } from "../packages/shared/src/index.js";
import { renderNarratedClip } from "../apps/api/src/lib/video.js";

const audioPath = process.argv[2];
const outputDir = process.argv[3] || "/private/tmp/ppt-agent-media-smoke";
if (!audioPath || !fs.existsSync(audioPath)) {
  throw new Error("用法：tsx scripts/media-export-smoke.ts <audio-path> [output-dir]");
}

const slide: SlideDto = {
  id: "media-smoke-slide",
  projectId: "media-smoke-project",
  sortOrder: 1,
  title: "PPT 演讲视频链路验证",
  slideGoal: "验证页面、配音与视频合成",
  keyMessage: "SVG/IR 页面可以与真实 TTS 音频稳定合成为 MP4。",
  contentPoints: ["Resvg 输出清晰页面", "TTS 提供中文配音", "FFmpeg 按音频时长合成"],
  recommendedLayout: "generic-cards",
  status: "planned",
  isContentLocked: false,
  isLayoutLocked: false,
  sourceFactIds: [],
  generationStatus: "draft-ready",
  renderStrategy: "svg",
  strategyLocked: false
};

fs.mkdirSync(outputDir, { recursive: true });
const imagePath = path.join(outputDir, "slide.png");
const videoPath = path.join(outputDir, "narrated-slide.mp4");
renderSlidePng(slide, imagePath, { width: 1920, theme: "white-blue" });
await renderNarratedClip({ imagePath, audioPath, outputPath: videoPath, width: 1920, height: 1080, fps: 30 });
console.log(JSON.stringify({ imagePath, videoPath }, null, 2));
