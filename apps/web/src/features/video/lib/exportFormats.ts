import type { TranscriptSegment } from './types';

function safeBaseName(title = 'export'): string {
  const cleaned = String(title || 'export')
    .replace(/[\\/:*?"<>|\r\n]+/g, ' ')
    .trim()
    .slice(0, 80);
  return cleaned || 'export';
}

export function triggerDownload(blobOrDataUrl: Blob | string, filename: string) {
  const a = document.createElement('a');
  let revokeUrl: string | null = null;
  if (typeof blobOrDataUrl === 'string') {
    a.href = blobOrDataUrl;
  } else {
    revokeUrl = URL.createObjectURL(blobOrDataUrl);
    a.href = revokeUrl;
  }
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  if (revokeUrl) {
    setTimeout(() => URL.revokeObjectURL(revokeUrl!), 1000);
  }
}

function downloadText(content: string, filename: string, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mime });
  triggerDownload(blob, filename);
}

function pad(n: number, width = 2): string {
  return String(Math.floor(Math.max(0, n))).padStart(width, '0');
}

function toSrtTimestamp(sec = 0): string {
  const totalMs = Math.max(0, Math.round((Number(sec) || 0) * 1000));
  const h = Math.floor(totalMs / 3600000);
  const m = Math.floor((totalMs % 3600000) / 60000);
  const s = Math.floor((totalMs % 60000) / 1000);
  const ms = totalMs % 1000;
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
}

function toVttTimestamp(sec = 0): string {
  return toSrtTimestamp(sec).replace(',', '.');
}

function toLrcTimestamp(sec = 0): string {
  const totalCs = Math.max(0, Math.round((Number(sec) || 0) * 100));
  const m = Math.floor(totalCs / 6000);
  const s = Math.floor((totalCs % 6000) / 100);
  const cs = totalCs % 100;
  return `${pad(m)}:${pad(s)}.${pad(cs)}`;
}

function toAssTimestamp(sec = 0): string {
  const totalCs = Math.max(0, Math.round((Number(sec) || 0) * 100));
  const h = Math.floor(totalCs / 360000);
  const m = Math.floor((totalCs % 360000) / 6000);
  const s = Math.floor((totalCs % 6000) / 100);
  const cs = totalCs % 100;
  return `${h}:${pad(m)}:${pad(s)}.${pad(cs)}`;
}

interface NormalizedSegment {
  start: number;
  end: number;
  time: string;
  text: string;
  translation: string;
}

function normalizeSegments(lines: TranscriptSegment[] = []): NormalizedSegment[] {
  return lines.map((item, idx) => {
    const start = Number(item.start) || 0;
    const nextStart = Number(lines[idx + 1]?.start);
    let end = Number(item.end);
    if (!Number.isFinite(end) || end <= start) {
      if (Number.isFinite(nextStart) && nextStart > start) {
        end = Math.min(nextStart, start + 8);
      } else {
        end = start + 3;
      }
    }
    return {
      start,
      end,
      time: item.time || '',
      text: (item.text || '').trim(),
      translation: (item.translation || '').trim(),
    };
  });
}

function pickLineText(seg: NormalizedSegment, bilingual: boolean, sep = '\n'): string {
  if (bilingual && seg.translation) {
    return `${seg.text}${sep}${seg.translation}`;
  }
  return seg.text;
}

export function toSrt(lines: TranscriptSegment[], { bilingual = true } = {}): string {
  const segs = normalizeSegments(lines);
  return segs
    .map(
      (s, i) =>
        `${i + 1}\n${toSrtTimestamp(s.start)} --> ${toSrtTimestamp(s.end)}\n${pickLineText(s, bilingual, '\n')}`,
    )
    .join('\n\n');
}

export function toVtt(lines: TranscriptSegment[], { bilingual = true } = {}): string {
  const segs = normalizeSegments(lines);
  const body = segs
    .map(
      (s, i) =>
        `${i + 1}\n${toVttTimestamp(s.start)} --> ${toVttTimestamp(s.end)}\n${pickLineText(s, bilingual, '\n')}`,
    )
    .join('\n\n');
  return `WEBVTT\n\n${body}\n`;
}

export function toTxt(lines: TranscriptSegment[], { bilingual = true, withTimestamp = true } = {}): string {
  const segs = normalizeSegments(lines);
  return segs
    .map((s) => {
      const prefix = withTimestamp && s.time ? `[${s.time}] ` : '';
      if (bilingual && s.translation) {
        return `${prefix}${s.text}\n${s.translation}`;
      }
      return `${prefix}${s.text}`;
    })
    .join('\n\n');
}

export function toLrc(lines: TranscriptSegment[], { bilingual = true } = {}): string {
  const segs = normalizeSegments(lines);
  return segs
    .map((s) => `[${toLrcTimestamp(s.start)}]${pickLineText(s, bilingual, ' / ')}`)
    .join('\n');
}

export function toAss(lines: TranscriptSegment[], { bilingual = true, title = 'Subtitle' } = {}): string {
  const segs = normalizeSegments(lines);
  const header = `[Script Info]
Title: ${title}
ScriptType: v4.00+
WrapStyle: 0
ScaledBorderAndShadow: yes
YCbCr Matrix: None

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,PingFang SC,20,&H00FFFFFF,&H000000FF,&H00000000,&H64000000,0,0,0,0,100,100,0,0,1,1.5,0.5,2,20,20,22,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const events = segs
    .map((s) => {
      const text = pickLineText(s, bilingual, '\\N').replace(/\r?\n/g, '\\N');
      return `Dialogue: 0,${toAssTimestamp(s.start)},${toAssTimestamp(s.end)},Default,,0,0,0,,${text}`;
    })
    .join('\n');
  return header + events + '\n';
}

export const SUBTITLE_FORMATS = [
  { id: 'srt', label: 'SRT (.srt)' },
  { id: 'vtt', label: 'WebVTT (.vtt)' },
  { id: 'txt', label: '纯文本 (.txt)' },
  { id: 'lrc', label: '歌词 (.lrc)' },
  { id: 'ass', label: 'ASS (.ass)' },
];

export function exportSubtitle(
  lines: TranscriptSegment[],
  format = 'srt',
  { bilingual = true, title = 'subtitle' } = {},
) {
  const base = safeBaseName(title);
  const suffix = bilingual ? '.bilingual' : '';
  switch (format) {
    case 'srt':
      downloadText(toSrt(lines, { bilingual }), `${base}${suffix}.srt`, 'application/x-subrip;charset=utf-8');
      break;
    case 'vtt':
      downloadText(toVtt(lines, { bilingual }), `${base}${suffix}.vtt`, 'text/vtt;charset=utf-8');
      break;
    case 'txt':
      downloadText(toTxt(lines, { bilingual, withTimestamp: true }), `${base}${suffix}.txt`);
      break;
    case 'lrc':
      downloadText(toLrc(lines, { bilingual }), `${base}${suffix}.lrc`);
      break;
    case 'ass':
      downloadText(toAss(lines, { bilingual, title: base }), `${base}${suffix}.ass`);
      break;
    default:
      throw new Error(`不支持的字幕格式：${format}`);
  }
}

export function exportMindmapMarkdown(markdown: string | undefined, title = 'mindmap') {
  if (!markdown) return;
  const base = safeBaseName(title);
  downloadText(markdown, `${base}.md`, 'text/markdown;charset=utf-8');
}

export async function exportMindmapElixirPng(mindInstance: any, title = 'mindmap') {
  if (!mindInstance || typeof mindInstance.exportPng !== 'function') return;
  const base = safeBaseName(title);
  try {
    const blob = await mindInstance.exportPng(false);
    if (blob) triggerDownload(blob, `${base}.png`);
  } catch (e) {
    console.error('[exportMindmapElixirPng]', e);
  }
}

export function exportMindmapElixirSvg(mindInstance: any, title = 'mindmap') {
  if (!mindInstance || typeof mindInstance.exportSvg !== 'function') return;
  const base = safeBaseName(title);
  try {
    const blob = mindInstance.exportSvg(false);
    if (blob) triggerDownload(blob, `${base}.svg`);
  } catch (e) {
    console.error('[exportMindmapElixirSvg]', e);
  }
}
