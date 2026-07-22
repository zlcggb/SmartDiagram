export interface SubtitleCue {
  startMs: number;
  endMs: number;
  text: string;
}

function splitLongSegment(segment: string, maxChars: number) {
  if (segment.length <= maxChars) return [segment];
  const clauses = segment.match(/[^,，、:：]+[,，、:：]?/gu) || [segment];
  const chunks: string[] = [];
  let current = "";
  for (const clause of clauses) {
    if (current && current.length + clause.length > maxChars) {
      chunks.push(current);
      current = "";
    }
    if (clause.length > maxChars) {
      if (current) chunks.push(current);
      current = "";
      for (let index = 0; index < clause.length; index += maxChars) {
        chunks.push(clause.slice(index, index + maxChars));
      }
    } else {
      current += clause;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

export function splitSubtitleText(text: string, maxChars = 36) {
  const normalized = text.replace(/\s+/gu, " ").trim();
  if (!normalized) return [];
  const sentences = normalized.match(/[^。！？!?；;]+[。！？!?；;]?/gu) || [normalized];
  return sentences.flatMap((sentence) => splitLongSegment(sentence.trim(), maxChars)).filter(Boolean);
}

export function buildSubtitleCues(text: string, durationMs: number, offsetMs = 0): SubtitleCue[] {
  const segments = splitSubtitleText(text);
  if (!segments.length || durationMs <= 0) return [];
  const totalWeight = segments.reduce((sum, segment) => sum + Math.max(segment.length, 1), 0);
  let elapsedWeight = 0;
  return segments.map((segment, index) => {
    const startMs = offsetMs + Math.round((elapsedWeight / totalWeight) * durationMs);
    elapsedWeight += Math.max(segment.length, 1);
    const endMs = index === segments.length - 1
      ? offsetMs + durationMs
      : offsetMs + Math.round((elapsedWeight / totalWeight) * durationMs);
    return { startMs, endMs, text: segment };
  });
}

function srtTimestamp(valueMs: number) {
  const safe = Math.max(0, Math.round(valueMs));
  const hours = Math.floor(safe / 3_600_000);
  const minutes = Math.floor((safe % 3_600_000) / 60_000);
  const seconds = Math.floor((safe % 60_000) / 1_000);
  const milliseconds = safe % 1_000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(milliseconds).padStart(3, "0")}`;
}

export function subtitleCuesToSrt(cues: SubtitleCue[]) {
  return cues.map((cue, index) => [
    String(index + 1),
    `${srtTimestamp(cue.startMs)} --> ${srtTimestamp(cue.endMs)}`,
    cue.text,
    ""
  ].join("\n")).join("\n");
}
