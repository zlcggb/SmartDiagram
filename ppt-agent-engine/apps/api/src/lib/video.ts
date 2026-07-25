import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function run(command: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let errorText = "";
    child.stderr.on("data", (chunk) => { errorText += String(chunk); });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`${command} 退出码 ${code}: ${errorText.slice(-1200)}`)));
  });
}

export async function assertFfmpegAvailable() {
  await run(process.env.FFMPEG_PATH || "ffmpeg", ["-version"]);
}

export interface SubtitleOverlay {
  imagePath: string;
  startMs: number;
  endMs: number;
}

/** 字幕放置参数（占画面比例），与前端字幕位置预览一致。 */
export interface SubtitlePlacement {
  /** 底部边距占画面高度比例：越大字幕越往上。 */
  bottomRatio: number;
  /** 水平偏移占画面宽度比例：负向左、正向右。 */
  offsetXRatio: number;
}

export interface NarratedClipInput {
  imagePath: string;
  audioPath: string;
  outputPath: string;
  width: number;
  height: number;
  fps: number;
  subtitleOverlays?: SubtitleOverlay[];
  subtitlePlacement?: SubtitlePlacement;
}

function seconds(valueMs: number) {
  return (valueMs / 1_000).toFixed(3);
}

/** 字幕条底部安全边距（占画面高度比例）：越大字幕越往上。须与渲染端条带高度一致，避免条带在预留空间内下沉。 */
export const SUBTITLE_BOTTOM_MARGIN = 0.02;

export function buildNarratedClipArgs(input: NarratedClipInput) {
  const videoFilter = `scale=${input.width}:${input.height}:force_original_aspect_ratio=decrease,pad=${input.width}:${input.height}:(ow-iw)/2:(oh-ih)/2,format=yuv420p`;
  const args = [
    "-y", "-hide_banner", "-loglevel", "error",
    "-loop", "1", "-framerate", String(input.fps), "-i", input.imagePath,
    "-i", input.audioPath
  ];
  const overlays = input.subtitleOverlays || [];
  for (const overlay of overlays) {
    args.push("-loop", "1", "-framerate", String(input.fps), "-i", overlay.imagePath);
  }
  if (overlays.length) {
    const placement = input.subtitlePlacement ?? { bottomRatio: SUBTITLE_BOTTOM_MARGIN, offsetXRatio: 0 };
    const xExpr = Math.round(input.width * placement.offsetXRatio);
    const yExpr = `H-h-${Math.round(input.height * placement.bottomRatio)}`;
    const filters = [`[0:v]${videoFilter}[base]`];
    let previous = "base";
    overlays.forEach((overlay, index) => {
      const subtitle = `subtitle${index}`;
      const video = `video${index}`;
      filters.push(`[${index + 2}:v]format=rgba[${subtitle}]`);
      filters.push(`[${previous}][${subtitle}]overlay=${xExpr}:${yExpr}:enable='between(t,${seconds(overlay.startMs)},${seconds(overlay.endMs)})'[${video}]`);
      previous = video;
    });
    filters.push(`[${previous}]format=yuv420p[outv]`);
    args.push("-filter_complex", filters.join(";"), "-map", "[outv]", "-map", "1:a:0");
  } else {
    args.push("-vf", videoFilter);
  }
  args.push(
    "-c:v", "libx264", "-preset", "medium", "-tune", "stillimage",
    "-c:a", "aac", "-b:a", "160k", "-shortest", "-movflags", "+faststart", input.outputPath
  );
  return args;
}

export async function renderNarratedClip(input: NarratedClipInput) {
  fs.mkdirSync(path.dirname(input.outputPath), { recursive: true });
  await run(process.env.FFMPEG_PATH || "ffmpeg", buildNarratedClipArgs(input));
}

export async function concatVideoClips(clips: string[], outputPath: string) {
  if (!clips.length) throw new Error("没有可合并的视频片段");
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const listPath = path.join(path.dirname(outputPath), `${path.basename(outputPath, path.extname(outputPath))}-concat.txt`);
  fs.writeFileSync(listPath, clips.map((clip) => `file '${clip.replace(/'/g, "'\\''")}'`).join("\n"));
  await run(process.env.FFMPEG_PATH || "ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", "-movflags", "+faststart", outputPath]);
  fs.unlinkSync(listPath);
  return outputPath;
}
