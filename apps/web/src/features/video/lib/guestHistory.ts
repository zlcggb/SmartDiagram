import type { QuizData, QuizSavedState, VideoHistoryItem } from './types';

const STORAGE_KEY = 'vidgrab_guest_history_v1';
const MAX_ITEMS = 30;

function readStorage(): VideoHistoryItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeStorage(list: VideoHistoryItem[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, MAX_ITEMS)));
  } catch {
    // ignore storage quota errors
  }
}

export function listGuestVideos(query = ''): VideoHistoryItem[] {
  const list = readStorage();
  const q = (query || '').trim().toLowerCase();
  if (!q) return list;
  return list.filter(
    (item) =>
      (item.title || '').toLowerCase().includes(q) ||
      (item.source_url || '').toLowerCase().includes(q),
  );
}

export function getGuestVideo(id: string): VideoHistoryItem | null {
  if (!id) return null;
  const list = readStorage();
  return list.find((item) => item.id === id) || null;
}

export function saveGuestVideo(record: Partial<VideoHistoryItem> & { title?: string }): VideoHistoryItem | null {
  if (!record || (!record.summary_result && !record.title)) return null;
  const list = readStorage();
  const id =
    record.id ||
    (record.summary_task_id ? `guest_${record.summary_task_id}` : `guest_${Date.now()}`);

  const existingIdx = list.findIndex(
    (item) =>
      item.id === id ||
      (record.summary_task_id && item.summary_task_id === record.summary_task_id),
  );

  const entry: VideoHistoryItem = {
    id,
    guest: true,
    title: record.title || '未命名视频',
    source_type: record.source_type || (record.source_url ? 'url' : 'upload'),
    source_url: record.source_url || '',
    file_id: record.file_id || '',
    duration_seconds: Number(record.duration_seconds) || 0,
    file_size_bytes: Number(record.file_size_bytes) || 0,
    status: 'ready',
    summary_status: record.summary_result ? 'done' : record.summary_status || 'done',
    summary_task_id: record.summary_task_id || '',
    summary_result: record.summary_result || null,
    transcript: record.transcript || record.summary_result?.transcript || [],
    chapters: record.chapters || record.summary_result?.chapters || [],
    quiz_count: Number(record.quiz_count) || 0,
    last_score: record.last_score ?? null,
    created_at:
      existingIdx >= 0 && list[existingIdx].created_at
        ? list[existingIdx].created_at
        : new Date().toISOString().replace('T', ' ').slice(0, 19),
  };

  if (existingIdx >= 0) {
    list.splice(existingIdx, 1);
  }
  list.unshift(entry);
  writeStorage(list);
  return entry;
}

export function removeGuestVideo(id: string) {
  if (!id) return;
  const list = readStorage().filter((item) => item.id !== id);
  writeStorage(list);
}

export function clearGuestVideos() {
  writeStorage([]);
}

export function updateGuestVideoQuiz(
  summaryTaskId: string,
  quiz: QuizData,
  quizState?: QuizSavedState | null,
) {
  if (!summaryTaskId) return;
  const list = readStorage();
  const idx = list.findIndex(
    (item) => item.summary_task_id === summaryTaskId || item.id === `guest_${summaryTaskId}` || item.id === summaryTaskId,
  );
  if (idx < 0) return;
  const target = list[idx];
  const prevResult = target.summary_result || {};
  target.summary_result = {
    ...prevResult,
    quiz,
    quiz_state: quizState ?? prevResult.quiz_state ?? null,
  };
  target.quiz_count = Math.max(1, Number(target.quiz_count) || 1);
  if (quizState?.score_result?.score !== undefined) {
    target.last_score = quizState.score_result.score;
  }
  writeStorage(list);
}
