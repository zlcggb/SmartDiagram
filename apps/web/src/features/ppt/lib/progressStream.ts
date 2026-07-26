import { createPptRequestHeaders } from "./pptRequestContext";

export interface PptProgressEvent {
  stage: string;
  status: string;
  message: string;
  current?: number;
  total?: number;
  delta?: string;
  chunkId?: string;
  subStage?: string;
  clearDelta?: boolean;
  timestamp?: string;
  slideId?: string;
  slideTitle?: string;
}

interface StreamProjectProgressOptions {
  apiBase: string;
  projectId: string;
  identityHeaders: Record<string, string>;
  onEvent: (event: PptProgressEvent) => void;
  signal?: AbortSignal;
  fetcher?: typeof fetch;
}

function takeSseFrames(buffer: string, flush = false) {
  const frames: string[] = [];
  let cursor = 0;
  const separator = /\r?\n\r?\n/g;
  let match: RegExpExecArray | null;

  while ((match = separator.exec(buffer)) !== null) {
    frames.push(buffer.slice(cursor, match.index));
    cursor = match.index + match[0].length;
  }
  if (flush && buffer.slice(cursor).trim()) {
    frames.push(buffer.slice(cursor));
    cursor = buffer.length;
  }
  return { frames, remaining: buffer.slice(cursor) };
}

function eventData(frame: string) {
  const lines = frame
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).replace(/^ /, ""));
  return lines.length > 0 ? lines.join("\n") : null;
}

export async function streamProjectProgress({
  apiBase,
  projectId,
  identityHeaders,
  onEvent,
  signal,
  fetcher = fetch,
}: StreamProjectProgressOptions): Promise<void> {
  const base = apiBase.replace(/\/$/, "");
  const url = `${base}/api/projects/${encodeURIComponent(projectId)}/progress`;
  const response = await fetcher(url, {
    method: "GET",
    headers: createPptRequestHeaders({
      identityHeaders,
      headers: { Accept: "text/event-stream" },
    }),
    credentials: "include",
    signal,
  });
  if (!response.ok) {
    throw new Error(`PPT progress stream failed (HTTP ${response.status})`);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("PPT progress stream has no readable body");

  const decoder = new TextDecoder();
  let buffer = "";
  const consumeFrames = (flush = false) => {
    const parsed = takeSseFrames(buffer, flush);
    buffer = parsed.remaining;
    for (const frame of parsed.frames) {
      const data = eventData(frame);
      if (!data) continue;
      try {
        onEvent(JSON.parse(data) as PptProgressEvent);
      } catch {
        // A malformed event must not stop later progress updates.
      }
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (value) buffer += decoder.decode(value, { stream: true });
      consumeFrames();
      if (done) break;
    }
    buffer += decoder.decode();
    consumeFrames(true);
  } finally {
    reader.releaseLock();
  }
}
