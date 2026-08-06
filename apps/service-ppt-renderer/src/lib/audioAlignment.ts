import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { NarrationAlignment, NarrationFocusTarget } from "@ppt-agent/shared";
import { ffmpegCommand } from "./video.js";

export interface NarrationAlignmentSegment {
  text: string;
  focusTargetIndexes: number[];
}

export interface DetectedSilence {
  startMs: number;
  endMs: number;
}

export interface TimedTranscriptToken {
  text: string;
  startMs: number;
  endMs: number;
  confidence?: number;
}

export const MIN_TRANSCRIPT_ALIGNMENT_COVERAGE = 0.78;

function combinedCue(segments: NarrationAlignmentSegment[]) {
  return {
    text: segments.map(({ text }) => text.trim()).filter(Boolean).join(""),
    focusTargetIndexes: [...new Set(segments.flatMap(({ focusTargetIndexes }) => focusTargetIndexes))]
  };
}

function chooseBoundaries(boundaries: number[], count: number) {
  if (boundaries.length <= count) return boundaries;
  return Array.from({ length: count }, (_, index) => {
    const sourceIndex = Math.round(((index + 1) * (boundaries.length + 1)) / (count + 1)) - 1;
    return boundaries[Math.max(0, Math.min(boundaries.length - 1, sourceIndex))]!;
  });
}

export function buildNarrationAlignment(input: {
  audioDurationMs: number;
  segments: NarrationAlignmentSegment[];
  silences: DetectedSilence[];
  minimumSilenceMs?: number;
}): NarrationAlignment {
  const audioDurationMs = Math.max(1, Math.round(input.audioDurationMs));
  const segments = input.segments
    .map((segment) => ({ ...segment, text: segment.text.trim() }))
    .filter(({ text }) => Boolean(text));
  const safeSegments = segments.length ? segments : [{ text: "旁白", focusTargetIndexes: [] }];
  const minimumSilenceMs = input.minimumSilenceMs ?? 180;
  const measuredBoundaries = [...new Set(
    input.silences
      .filter(({ startMs, endMs }) => endMs > startMs && endMs - startMs >= minimumSilenceMs)
      .filter(({ startMs, endMs }) => startMs >= minimumSilenceMs && endMs <= audioDurationMs - minimumSilenceMs)
      .map(({ startMs, endMs }) => Math.round((startMs + endMs) / 2))
      .filter((boundary) => boundary > 0 && boundary < audioDurationMs)
  )].sort((left, right) => left - right);

  if (!measuredBoundaries.length || safeSegments.length === 1) {
    const cue = combinedCue(safeSegments);
    return {
      version: 1,
      audioDurationMs,
      source: "page",
      cues: [{ startMs: 0, endMs: audioDurationMs, ...cue }]
    };
  }

  const boundaries = chooseBoundaries(measuredBoundaries, safeSegments.length - 1);
  const cueCount = boundaries.length + 1;
  const groups = Array.from({ length: cueCount }, () => [] as NarrationAlignmentSegment[]);
  for (const [index, segment] of safeSegments.entries()) {
    const groupIndex = Math.min(cueCount - 1, Math.floor(index * cueCount / safeSegments.length));
    groups[groupIndex]!.push(segment);
  }
  const times = [0, ...boundaries, audioDurationMs];
  return {
    version: 1,
    audioDurationMs,
    source: "audio-silence",
    cues: groups.map((group, index) => ({
      startMs: times[index]!,
      endMs: times[index + 1]!,
      ...combinedCue(group)
    }))
  };
}

export function buildAlignmentSegments(scriptText: string, focusTargets: NarrationFocusTarget[]): NarrationAlignmentSegment[] {
  const sentences = scriptText
    .split(/(?<=[。！？!?；;])/u)
    .map((text) => text.trim())
    .filter(Boolean);
  const normalized = (value: string) => value.normalize("NFKC").replace(/\s+/g, "");
  return (sentences.length ? sentences : [scriptText.trim()]).filter(Boolean).map((text) => ({
    text,
    focusTargetIndexes: focusTargets.flatMap((target, index) => {
      const cue = normalized(text);
      const narration = normalized(target.narrationText);
      return cue.includes(narration) || narration.includes(cue) ? [index] : [];
    })
  }));
}

interface NormalizedTranscriptSymbol {
  value: string;
  startMs: number;
  endMs: number;
  confidence?: number;
}

function normalizedSymbols(value: string) {
  return [...value.normalize("NFKC").toLowerCase()].filter((symbol) => /[\p{L}\p{N}]/u.test(symbol));
}

function transcriptSymbols(tokens: TimedTranscriptToken[]) {
  return tokens.flatMap((token): NormalizedTranscriptSymbol[] => {
    const symbols = normalizedSymbols(token.text);
    if (!symbols.length || token.endMs <= token.startMs) return [];
    return symbols.map((value) => ({
      value,
      // Preserve the ASR token's measured interval. Do not invent sub-token
      // timing by distributing its duration according to character count.
      startMs: token.startMs,
      endMs: token.endMs,
      confidence: token.confidence
    }));
  });
}

/**
 * Aligns authored narration symbols to timestamped ASR symbols.
 * Timestamps always come from the final waveform; authored text is only used
 * to correct the transcript and associate semantic focus targets.
 */
export function buildNarrationAlignmentFromTranscript(input: {
  audioDurationMs: number;
  segments: NarrationAlignmentSegment[];
  tokens: TimedTranscriptToken[];
  minimumCoverage?: number;
}): NarrationAlignment | null {
  const audioDurationMs = Math.max(1, Math.round(input.audioDurationMs));
  const segments = input.segments
    .map((segment) => ({ ...segment, text: segment.text.trim() }))
    .filter(({ text }) => Boolean(text));
  if (!segments.length) return null;

  const authored = segments.flatMap((segment, segmentIndex) =>
    normalizedSymbols(segment.text).map((value) => ({ value, segmentIndex }))
  );
  const measured = transcriptSymbols(input.tokens);
  if (!authored.length || !measured.length) return null;

  const rowWidth = measured.length + 1;
  const directions = new Uint8Array((authored.length + 1) * rowWidth);
  let previous = new Uint16Array(rowWidth);
  let current = new Uint16Array(rowWidth);
  for (let column = 1; column < rowWidth; column += 1) {
    previous[column] = column;
    directions[column] = 3; // left: transcript insertion
  }
  for (let row = 1; row <= authored.length; row += 1) {
    current[0] = row;
    directions[row * rowWidth] = 2; // up: authored deletion
    for (let column = 1; column < rowWidth; column += 1) {
      const substitution = previous[column - 1]! + (authored[row - 1]!.value === measured[column - 1]!.value ? 0 : 1);
      const deletion = previous[column]! + 1;
      const insertion = current[column - 1]! + 1;
      if (substitution <= deletion && substitution <= insertion) {
        current[column] = substitution;
        directions[row * rowWidth + column] = 1;
      } else if (deletion <= insertion) {
        current[column] = deletion;
        directions[row * rowWidth + column] = 2;
      } else {
        current[column] = insertion;
        directions[row * rowWidth + column] = 3;
      }
    }
    [previous, current] = [current, previous];
  }

  const mappedTranscriptIndex = new Int32Array(authored.length).fill(-1);
  let exactMatches = 0;
  let row = authored.length;
  let column = measured.length;
  while (row > 0 || column > 0) {
    const direction = directions[row * rowWidth + column];
    if (direction === 1 && row > 0 && column > 0) {
      mappedTranscriptIndex[row - 1] = column - 1;
      if (authored[row - 1]!.value === measured[column - 1]!.value) exactMatches += 1;
      row -= 1;
      column -= 1;
    } else if (direction === 2 && row > 0) {
      row -= 1;
    } else if (column > 0) {
      column -= 1;
    } else {
      break;
    }
  }

  const coverage = exactMatches / authored.length;
  if (coverage < (input.minimumCoverage ?? MIN_TRANSCRIPT_ALIGNMENT_COVERAGE)) return null;

  const ranges = segments.map((_segment, segmentIndex) => {
    const indexes = authored.flatMap((symbol, authoredIndex) =>
      symbol.segmentIndex === segmentIndex && mappedTranscriptIndex[authoredIndex]! >= 0
        ? [mappedTranscriptIndex[authoredIndex]!]
        : []
    );
    if (!indexes.length) return null;
    return {
      startMs: Math.min(...indexes.map((index) => measured[index]!.startMs)),
      endMs: Math.max(...indexes.map((index) => measured[index]!.endMs)),
      confidences: indexes.flatMap((index) => measured[index]!.confidence ?? [])
    };
  });
  if (ranges.some((range) => !range)) return null;

  const boundaries = [0];
  for (let index = 1; index < ranges.length; index += 1) {
    const previousRange = ranges[index - 1]!;
    const nextRange = ranges[index]!;
    const proposed = Math.round((previousRange.endMs + nextRange.startMs) / 2);
    const minimum = boundaries.at(-1)! + 1;
    const maximum = audioDurationMs - (ranges.length - index);
    if (minimum > maximum) return null;
    boundaries.push(Math.max(minimum, Math.min(maximum, proposed)));
  }
  boundaries.push(audioDurationMs);

  const confidences = ranges.flatMap((range) => range!.confidences);
  const meanConfidence = confidences.length
    ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length
    : undefined;
  return {
    version: 1,
    audioDurationMs,
    source: "transcript",
    quality: {
      coverage,
      ...(meanConfidence === undefined ? {} : { meanConfidence })
    },
    cues: segments.map((segment, index) => ({
      startMs: boundaries[index]!,
      endMs: boundaries[index + 1]!,
      text: segment.text,
      focusTargetIndexes: segment.focusTargetIndexes
    }))
  };
}

export function isFocusAlignmentTrusted(alignment: NarrationAlignment | null | undefined) {
  return alignment?.source === "transcript"
    && (alignment.quality?.coverage ?? 0) >= MIN_TRANSCRIPT_ALIGNMENT_COVERAGE;
}

function runProcess(command: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let errorText = "";
    child.stderr.on("data", (chunk) => { errorText += String(chunk); });
    child.on("error", reject);
    child.on("close", (code) => code === 0
      ? resolve()
      : reject(new Error(`${path.basename(command)} 退出码 ${code}: ${errorText.slice(-1_200)}`)));
  });
}

function configuredWhisperRuntime() {
  const command = process.env.WHISPER_CPP_PATH?.trim();
  const model = process.env.WHISPER_MODEL_PATH?.trim();
  return command && model && fs.existsSync(command) && fs.existsSync(model) ? { command, model } : null;
}

export function isTranscriptAlignmentRuntimeConfigured() {
  return configuredWhisperRuntime() !== null;
}

function parseWhisperTranscript(value: unknown): TimedTranscriptToken[] {
  const transcription = (value as { transcription?: unknown })?.transcription;
  if (!Array.isArray(transcription)) return [];
  const tokenRows = transcription.flatMap((segment): TimedTranscriptToken[] => {
    const tokens = (segment as { tokens?: unknown })?.tokens;
    if (!Array.isArray(tokens)) return [];
    return tokens.flatMap((token) => {
      const row = token as { text?: unknown; offsets?: { from?: unknown; to?: unknown }; p?: unknown };
      const text = typeof row.text === "string" ? row.text : "";
      const startMs = Number(row.offsets?.from);
      const endMs = Number(row.offsets?.to);
      if (!text.trim() || /^\[[^\]]+\]$/u.test(text.trim()) || !Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return [];
      const confidence = Number(row.p);
      return [{ text, startMs: Math.round(startMs), endMs: Math.round(endMs), ...(Number.isFinite(confidence) ? { confidence } : {}) }];
    });
  });
  if (tokenRows.length) return tokenRows;
  return transcription.flatMap((segment) => {
    const row = segment as { text?: unknown; offsets?: { from?: unknown; to?: unknown } };
    const text = typeof row.text === "string" ? row.text : "";
    const startMs = Number(row.offsets?.from);
    const endMs = Number(row.offsets?.to);
    return text.trim() && Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs
      ? [{ text, startMs: Math.round(startMs), endMs: Math.round(endMs) }]
      : [];
  });
}

async function transcribeFinalAudio(audioPath: string, languageCode?: string) {
  const runtime = configuredWhisperRuntime();
  if (!runtime) return null;
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "smartdiagram-align-"));
  const wavPath = path.join(workDir, "audio-16k.wav");
  const outputPrefix = path.join(workDir, "transcript");
  try {
    await runProcess(ffmpegCommand(), [
      "-y", "-hide_banner", "-loglevel", "error", "-i", audioPath,
      "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wavPath
    ]);
    const language = languageCode?.toLowerCase().startsWith("en") ? "en" : "zh";
    await runProcess(runtime.command, [
      "-m", runtime.model, "-f", wavPath, "-l", language,
      "-ojf", "-of", outputPrefix, "-np"
    ]);
    const outputPath = `${outputPrefix}.json`;
    return parseWhisperTranscript(JSON.parse(fs.readFileSync(outputPath, "utf8")));
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

export async function buildAudioAlignment(input: {
  audioPath: string;
  audioDurationMs: number;
  segments: NarrationAlignmentSegment[];
  languageCode?: string;
}): Promise<NarrationAlignment> {
  try {
    const tokens = await transcribeFinalAudio(input.audioPath, input.languageCode);
    if (tokens?.length) {
      const alignment = buildNarrationAlignmentFromTranscript({
        audioDurationMs: input.audioDurationMs,
        segments: input.segments,
        tokens
      });
      if (alignment) return alignment;
    }
  } catch {
    // A missing/failed optional aligner must not corrupt timestamps. The
    // conservative fallback remains valid for page subtitles, but is never
    // trusted for focus events (see isFocusAlignmentTrusted()).
  }
  const silences = await detectAudioSilences(input.audioPath, input.audioDurationMs).catch(() => []);
  return buildNarrationAlignment({
    audioDurationMs: input.audioDurationMs,
    segments: input.segments,
    silences
  });
}

export function parseSilenceDetectOutput(output: string, audioDurationMs: number): DetectedSilence[] {
  const starts: number[] = [];
  const result: DetectedSilence[] = [];
  for (const line of output.split(/\r?\n/)) {
    const start = line.match(/silence_start:\s*([\d.]+)/)?.[1];
    if (start) starts.push(Number(start) * 1_000);
    const end = line.match(/silence_end:\s*([\d.]+)/)?.[1];
    if (end && starts.length) result.push({ startMs: Math.round(starts.shift()!), endMs: Math.round(Number(end) * 1_000) });
  }
  for (const startMs of starts) result.push({ startMs: Math.round(startMs), endMs: audioDurationMs });
  return result;
}

export async function detectAudioSilences(audioPath: string, audioDurationMs: number): Promise<DetectedSilence[]> {
  return await new Promise((resolve, reject) => {
    const child = spawn(ffmpegCommand(), [
      "-hide_banner",
      "-i", audioPath,
      "-af", "silencedetect=noise=-35dB:d=0.18",
      "-f", "null",
      "-"
    ], { stdio: ["ignore", "ignore", "pipe"] });
    let output = "";
    child.stderr.on("data", (chunk) => { output += String(chunk); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(`FFmpeg 静音检测失败（${code ?? "unknown"}）`));
      else resolve(parseSilenceDetectOutput(output, audioDurationMs));
    });
  });
}
