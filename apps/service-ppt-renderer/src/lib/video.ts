import { execSync, spawn } from "node:child_process";
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

const DEFAULT_FFMPEG_CANDIDATES = [
  "/opt/homebrew/bin/ffmpeg",
  "/usr/local/bin/ffmpeg",
  "/usr/bin/ffmpeg",
  "ffmpeg"
];

function resolveFromPath(command: string): string | null {
  try {
    const resolved = execSync(`command -v ${command}`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    return resolved || null;
  } catch {
    return null;
  }
}

function ffmpegCandidates() {
  const configured = process.env.FFMPEG_PATH?.trim();
  const fromPath = resolveFromPath("ffmpeg");
  const ordered = [
    configured,
    fromPath,
    ...DEFAULT_FFMPEG_CANDIDATES
  ].filter((candidate): candidate is string => Boolean(candidate?.trim()));

  return [...new Set(ordered)];
}

let resolvedFfmpegCommand: string | null = null;

export function ffmpegCommand() {
  if (resolvedFfmpegCommand) {
    return resolvedFfmpegCommand;
  }
  for (const candidate of ffmpegCandidates()) {
    if (candidate === "ffmpeg" || fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return "ffmpeg";
}

export async function assertFfmpegAvailable() {
  const tried: string[] = [];
  let lastError: unknown;
  for (const candidate of ffmpegCandidates()) {
    if (candidate !== "ffmpeg" && !fs.existsSync(candidate)) {
      continue;
    }
    tried.push(candidate);
    try {
      await run(candidate, ["-version"]);
      resolvedFfmpegCommand = candidate;
      return;
    } catch (error) {
      lastError = error;
    }
  }
  const detail = lastError instanceof Error ? lastError.message : "未知错误";
  throw new Error(`未找到可用的 FFmpeg（已尝试：${tried.join("、")}）。Docker 部署镜像已内置 ffmpeg；本地请安装 ffmpeg 或设置可选环境变量 FFMPEG_PATH。${detail ? ` ${detail}` : ""}`);
}

export interface SubtitleOverlay {
  imagePath: string;
  startMs: number;
  endMs: number;
}

/** 聚焦遮罩叠加层：半透明暗化 + 矩形高亮窗口。 */
export interface FocusOverlay {
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
  /** 聚焦遮罩叠加层，在字幕之前渲染（确保字幕始终在最上层）。 */
  focusOverlays?: FocusOverlay[];
}

function seconds(valueMs: number) {
  return (valueMs / 1_000).toFixed(3);
}

export function quantizeOverlayInterval(startMs: number, endMs: number, fps: number) {
  const safeFps = Math.max(1, Math.round(fps));
  const startFrame = Math.max(0, Math.floor(startMs * safeFps / 1_000));
  const endFrame = Math.max(startFrame + 1, Math.ceil(endMs * safeFps / 1_000));
  return {
    startMs: startFrame * 1_000 / safeFps,
    endMs: endFrame * 1_000 / safeFps
  };
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
  const focusLayers = input.focusOverlays || [];
  const subtitleLayers = input.subtitleOverlays || [];
  const allOverlays = [...focusLayers, ...subtitleLayers];

  for (const overlay of allOverlays) {
    args.push("-loop", "1", "-framerate", String(input.fps), "-i", overlay.imagePath);
  }
  if (allOverlays.length) {
    const placement = input.subtitlePlacement ?? { bottomRatio: SUBTITLE_BOTTOM_MARGIN, offsetXRatio: 0 };
    const subXExpr = Math.round(input.width * placement.offsetXRatio);
    const subYExpr = `H-h-${Math.round(input.height * placement.bottomRatio)}`;
    const filters = [`[0:v]${videoFilter}[base]`];
    let previous = "base";
    let inputIndex = 2; // 0=image, 1=audio, 2+=overlays

    // 先叠加聚焦遮罩（居中覆盖整个画面）
    focusLayers.forEach((overlay, index) => {
      const interval = quantizeOverlayInterval(overlay.startMs, overlay.endMs, input.fps);
      const label = `focus${index}`;
      const out = `fv${index}`;
      const durationMs = Math.max(0, interval.endMs - interval.startMs);
      const fadeMs = Math.min(200, Math.floor(durationMs / 2));
      const fadeOutStartMs = Math.max(interval.startMs, interval.endMs - fadeMs);
      const fadeFilters = fadeMs > 0
        ? `,fade=t=in:st=${seconds(interval.startMs)}:d=${seconds(fadeMs)}:alpha=1,fade=t=out:st=${seconds(fadeOutStartMs)}:d=${seconds(fadeMs)}:alpha=1`
        : "";
      filters.push(`[${inputIndex}:v]format=rgba${fadeFilters}[${label}]`);
      filters.push(`[${previous}][${label}]overlay=0:0:enable='between(t,${seconds(interval.startMs)},${seconds(interval.endMs)})'[${out}]`);
      previous = out;
      inputIndex++;
    });

    // 再叠加字幕遮罩（底部偏移）
    subtitleLayers.forEach((overlay, index) => {
      const interval = quantizeOverlayInterval(overlay.startMs, overlay.endMs, input.fps);
      const label = `subtitle${index}`;
      const out = `sv${index}`;
      filters.push(`[${inputIndex}:v]format=rgba[${label}]`);
      filters.push(`[${previous}][${label}]overlay=${subXExpr}:${subYExpr}:enable='between(t,${seconds(interval.startMs)},${seconds(interval.endMs)})'[${out}]`);
      previous = out;
      inputIndex++;
    });

    filters.push(`[${previous}]format=yuv420p[outv]`);
    args.push("-filter_complex", filters.join(";"), "-map", "[outv]", "-map", "1:a:0");
  } else {
    args.push("-vf", videoFilter);
  }
  args.push(
    "-c:v", "libx264", "-preset", "medium", "-tune", "stillimage",
    "-profile:v", "high", "-pix_fmt", "yuv420p", "-r", String(input.fps),
    "-c:a", "aac", "-b:a", "160k", "-shortest", "-movflags", "+faststart", input.outputPath
  );
  return args;
}

export async function renderNarratedClip(input: NarratedClipInput) {
  fs.mkdirSync(path.dirname(input.outputPath), { recursive: true });
  await run(ffmpegCommand(), buildNarratedClipArgs(input));
}

export async function concatVideoClips(clips: string[], outputPath: string) {
  if (!clips.length) throw new Error("没有可合并的视频片段");
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const listPath = path.join(path.dirname(outputPath), `${path.basename(outputPath, path.extname(outputPath))}-concat.txt`);
  fs.writeFileSync(listPath, clips.map((clip) => `file '${clip.replace(/'/g, "'\\''")}'`).join("\n"));
  await run(ffmpegCommand(), ["-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", "-movflags", "+faststart", outputPath]);
  fs.unlinkSync(listPath);
  return outputPath;
}

export function buildDecodeValidationArgs(inputPath: string) {
  return [
    "-y", "-hide_banner", "-loglevel", "error", "-i", inputPath,
    "-map", "0:v:0", "-map", "0:a:0", "-f", "null", "-"
  ];
}

/** Full decode is the final FFmpeg gate: missing streams and corrupt joins fail export. */
export async function validateRenderedVideo(inputPath: string) {
  await run(ffmpegCommand(), buildDecodeValidationArgs(inputPath));
}
