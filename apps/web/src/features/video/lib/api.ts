import { readAuthSession } from '@/shared/lib/config/auth';
import { readGuestSession } from '@/shared/lib/config/guestSession';
import type {
  ChatRouterMeta,
  CommunityActivityResponse,
  CommunityComment,
  CommunityCommentReport,
  CommunityPost,
  CommunityUserProfile,
  QuizData,
  QuizScoreResult,
  UploadMeta,
  VideoGuestQuota,
  VideoInfo,
} from './types';

export const VIDEO_API_PREFIX = '/video-api';
const BASE = `${VIDEO_API_PREFIX}/api`;

function getAuthHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const headers: Record<string, string> = { ...extra };
  const session = readAuthSession();
  if (session?.access_token) {
    headers.Authorization = `Bearer ${session.access_token}`;
    return headers;
  }
  const guest = readGuestSession();
  if (guest?.access_token) {
    headers.Authorization = `Bearer ${guest.access_token}`;
  }
  return headers;
}

export function resolveVideoMediaUrl(src?: string | null): string {
  if (!src) return '';
  if (src.startsWith('/video-api/')) return src;
  if (src.startsWith('/api/')) return `${VIDEO_API_PREFIX}${src}`;
  return src;
}

async function request<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    cache: 'no-store',
    headers: getAuthHeaders({
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      ...((options.headers as Record<string, string>) || {}),
    }),
    ...options,
  });

  const isJson = (res.headers.get('content-type') || '').includes('application/json');
  const data = isJson ? await res.json() : await res.text();

  if (!res.ok) {
    const detail = isJson ? data?.detail : null;
    const msg =
      (typeof detail === 'object' && detail?.message) ||
      (typeof detail === 'string' ? detail : null) ||
      (isJson && data?.message) ||
      `请求失败 (${res.status})`;
    const err = new Error(msg) as Error & { code?: string; status?: number };
    err.code = (typeof detail === 'object' && detail?.code) || 'generic';
    err.status = res.status;
    throw err;
  }
  return data as T;
}

export function parseVideo(url: string, opts: { useCookies?: boolean; browser?: string | null } = {}): Promise<VideoInfo> {
  return request<VideoInfo>('/info', {
    method: 'POST',
    body: JSON.stringify({
      url,
      browser: opts.useCookies ? opts.browser || 'firefox' : opts.browser || null,
    }),
  });
}

export function prepareMedia(opts: {
  url?: string;
  fileId?: string;
  formatId?: string;
  browser?: string | null;
} = {}): Promise<{
  mode: string;
  src?: string;
  embed_url?: string;
  provider?: string;
  video_id?: string;
  bvid?: string;
  cid?: string | number;
  mime?: string;
  stream_type?: string;
  orientation?: string;
  warning?: string;
}> {
  const body: Record<string, any> = {};
  if (opts.fileId) body.file_id = opts.fileId;
  else if (opts.url) body.url = opts.url;
  if (opts.formatId) body.format_id = opts.formatId;
  if (opts.browser) body.browser = opts.browser;
  return request('/media/prepare', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function uploadMedia(file: File, onProgress?: (pct: number) => void): Promise<UploadMeta> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${BASE}/upload`);
    xhr.withCredentials = true;
    const authHeaders = getAuthHeaders();
    if (authHeaders.Authorization) {
      xhr.setRequestHeader('Authorization', authHeaders.Authorization);
    }
    if (xhr.upload && typeof onProgress === 'function') {
      xhr.upload.onprogress = (evt) => {
        if (evt.lengthComputable && evt.total > 0) {
          onProgress(Math.min(99, Math.round((evt.loaded / evt.total) * 100)));
        }
      };
    }
    xhr.onload = () => {
      let data: any = null;
      try {
        data = JSON.parse(xhr.responseText || '{}');
      } catch {
        data = null;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(100);
        resolve(data as UploadMeta);
        return;
      }
      const detail = data?.detail;
      const msg =
        (typeof detail === 'object' && detail?.message) ||
        (typeof detail === 'string' ? detail : null) ||
        `上传失败 (${xhr.status})`;
      const err = new Error(msg) as Error & { code?: string; status?: number };
      err.code = (typeof detail === 'object' && detail?.code) || 'upload_failed';
      err.status = xhr.status;
      reject(err);
    };
    xhr.onerror = () => {
      const err = new Error('网络中断，上传失败') as Error & { code?: string };
      err.code = 'network_error';
      reject(err);
    };
    const fd = new FormData();
    fd.append('file', file);
    xhr.send(fd);
  });
}

export function startDownload(payload: {
  url: string;
  format_id?: string;
  title?: string;
  browser?: string | null;
}): Promise<{ task_id: string }> {
  return request('/download', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function getProgress(taskId: string): Promise<{
  status: string;
  percent?: number;
  speed?: string;
  eta?: string;
  ready?: boolean;
  error?: string;
}> {
  return request(`/progress/${taskId}`);
}

export function cancelDownload(taskId: string) {
  return request(`/cancel/${taskId}`, { method: 'POST' });
}

export function pauseDownload(taskId: string) {
  return request(`/pause/${taskId}`, { method: 'POST' });
}

export function resumeDownload(taskId: string) {
  return request(`/resume/${taskId}`, { method: 'POST' });
}

export function fileDownloadUrl(taskId: string): string {
  return `${BASE}/file/${taskId}`;
}

export function startSummarize(payload: {
  url?: string;
  file_id?: string;
  target_lang?: string;
  prompt?: string;
  browser?: string | null;
  report_style?: string;
  regenerate_mode?: 'report_only' | 'full_reparse';
  source_task_id?: string;
}): Promise<{
  task_id: string;
  cached?: boolean;
  reused_transcript?: boolean;
  in_flight_reused?: boolean;
}> {
  const body: Record<string, any> = {
    target_lang: payload.target_lang || 'zh',
  };
  if (payload.prompt && payload.prompt.trim()) {
    body.prompt = payload.prompt.trim();
  }
  if (payload.report_style) {
    body.report_style = payload.report_style;
  }
  if (payload.regenerate_mode) {
    body.regenerate_mode = payload.regenerate_mode;
  }
  if (payload.source_task_id) {
    body.source_task_id = payload.source_task_id;
  }
  if (payload.file_id) {
    body.file_id = payload.file_id;
  } else if (payload.url) {
    body.url = payload.url;
    body.browser = payload.browser || null;
  }
  return request('/summarize', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function getSummary(
  taskId: string,
  shareToken?: string | null,
): Promise<{
  task_id?: string;
  status: string;
  stage?: string;
  stage_message?: string;
  percent?: number;
  result?: any;
  partial_transcript?: any[];
  timing?: any;
  error?: string;
  error_code?: string;
  source_type?: 'upload' | 'url';
  video_id?: string;
  video_title?: string;
  webpage_url?: string;
  duration?: number;
  cover_url?: string;
  share_token?: string;
  readonly_share?: boolean;
}> {
  const qs = shareToken ? `?share=${encodeURIComponent(shareToken)}` : '';
  return request(`/summary/${taskId}${qs}`);
}

export function saveVideoCover(payload: {
  coverUrl: string;
  videoId?: string;
  analysisId?: string;
  postId?: string;
}): Promise<{ ok: boolean; video_id?: string; cover_url?: string }> {
  return request('/videos/cover', {
    method: 'POST',
    body: JSON.stringify({
      cover_url: payload.coverUrl,
      video_id: payload.videoId || undefined,
      analysis_id: payload.analysisId || undefined,
      post_id: payload.postId || undefined,
    }),
  });
}

export function cancelSummarize(taskId: string) {
  return request(`/summary/${taskId}/cancel`, { method: 'POST' });
}

export function startTranslate(summaryTaskId: string, targetLang = 'zh'): Promise<{ task_id: string }> {
  return request('/translate', {
    method: 'POST',
    body: JSON.stringify({ summary_task_id: summaryTaskId, target_lang: targetLang }),
  });
}

export function getTranslation(taskId: string): Promise<{
  status: string;
  percent?: number;
  result?: any[];
  error?: string;
}> {
  return request(`/translate/${taskId}`);
}

export function askQuestion(
  summaryTaskId: string,
  question: string,
  history: Array<{ role: string; content: string }> = [],
) {
  return request('/ask', {
    method: 'POST',
    body: JSON.stringify({
      summary_task_id: summaryTaskId,
      question,
      history,
    }),
  });
}

export async function askQuestionStream(
  summaryTaskId: string,
  question: string,
  history: Array<{ role: string; content: string }> = [],
  callbacks: {
    onRouter?: (routerMeta: ChatRouterMeta | null, createdAt?: string) => void;
    onDelta?: (delta: string) => void;
    onDone?: (doneItem: any) => void;
  } = {},
) {
  const { onRouter, onDelta, onDone } = callbacks;
  const res = await fetch(`${BASE}/ask/stream`, {
    method: 'POST',
    credentials: 'include',
    headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      summary_task_id: summaryTaskId,
      question,
      history,
    }),
  });

  if (!res.ok) {
    const isJson = (res.headers.get('content-type') || '').includes('application/json');
    const data = isJson ? await res.json().catch(() => ({})) : {};
    const detail = data?.detail;
    const msg =
      (typeof detail === 'object' && detail?.message) ||
      (typeof detail === 'string' ? detail : null) ||
      `请求失败 (${res.status})`;
    const err = new Error(msg) as Error & { code?: string; status?: number };
    err.code = (typeof detail === 'object' && detail?.code) || 'ask_failed';
    err.status = res.status;
    throw err;
  }

  const reader = res.body?.getReader();
  if (!reader) {
    const fallback = await askQuestion(summaryTaskId, question, history);
    onDone?.(fallback);
    return;
  }

  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const parts = buffer.split('\n\n');
    buffer = parts.pop() || '';

    for (const part of parts) {
      const line = part.split('\n').find((l) => l.trim().startsWith('data:'));
      if (!line) continue;
      const jsonStr = line.trim().slice(5).trim();
      if (!jsonStr) continue;
      let evt: any = null;
      try {
        evt = JSON.parse(jsonStr);
      } catch {
        continue;
      }
      const evType = evt.event || evt.type;
      if (evType === 'router') {
        onRouter?.(evt.router, evt.created_at);
      } else if (evType === 'delta' && evt.delta) {
        onDelta?.(evt.delta);
      } else if (evType === 'done') {
        onDone?.(evt);
      } else if (evType === 'error') {
        throw new Error(evt.message || '回答失败');
      }
    }
  }
}

export function generateQuiz(summaryTaskId: string, count = 6): Promise<QuizData> {
  return request<QuizData>('/quiz/generate', {
    method: 'POST',
    body: JSON.stringify({ summary_task_id: summaryTaskId, count }),
  });
}

export function submitQuiz(
  quizId: string,
  answers: Array<{ question_id: string; answer: string | string[] | boolean }>,
  summaryTaskId?: string,
): Promise<QuizScoreResult> {
  return request<QuizScoreResult>('/quiz/submit', {
    method: 'POST',
    body: JSON.stringify({
      quiz_id: quizId,
      summary_task_id: summaryTaskId || undefined,
      answers,
    }),
  });
}

export function syncQuizState(payload: {
  summary_task_id: string;
  quiz_id: string;
  answers: Record<string, string | string[] | boolean>;
  revealed: Record<string, boolean>;
  current_index: number;
  view_mode: 'deck' | 'list' | 'summary';
  score_result?: QuizScoreResult | null;
}): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>('/quiz/state', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function fetchMyVideos(params: { q?: string; page?: number; pageSize?: number } = {}): Promise<{
  items: any[];
  total: number;
}> {
  const qs = new URLSearchParams();
  if (params.q) qs.set('q', params.q);
  qs.set('page', String(params.page || 1));
  qs.set('page_size', String(params.pageSize || 20));
  return request(`/library/videos?${qs.toString()}`);
}

export function deleteMyVideo(videoId: string) {
  return request(`/library/videos/${encodeURIComponent(videoId)}`, { method: 'DELETE' });
}

export function fetchAdminStats(): Promise<any> {
  return request('/admin/stats');
}

export function fetchAdminUsers(params: { q?: string; page?: number; pageSize?: number } = {}): Promise<{
  items: any[];
  total: number;
}> {
  const qs = new URLSearchParams();
  if (params.q) qs.set('q', params.q);
  qs.set('page', String(params.page || 1));
  qs.set('page_size', String(params.pageSize || 20));
  return request(`/admin/users?${qs.toString()}`);
}

export function createAdminUser(userData: {
  email: string;
  password: string;
  role?: string;
  display_name?: string;
}) {
  return request('/admin/users', {
    method: 'POST',
    body: JSON.stringify(userData),
  });
}

export function updateAdminUser(userId: string, userData: Record<string, any>) {
  return request(`/admin/users/${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    body: JSON.stringify(userData),
  });
}

export function fetchAdminVideos(params: {
  userId?: string;
  q?: string;
  page?: number;
  pageSize?: number;
} = {}): Promise<{
  items: any[];
  total: number;
}> {
  const qs = new URLSearchParams();
  if (params.userId) qs.set('user_id', params.userId);
  if (params.q) qs.set('q', params.q);
  qs.set('page', String(params.page || 1));
  qs.set('page_size', String(params.pageSize || 20));
  return request(`/admin/videos?${qs.toString()}`);
}

export function deleteAdminVideo(videoId: string) {
  return request(`/admin/videos/${encodeURIComponent(videoId)}`, { method: 'DELETE' });
}

export async function getGuestQuota(): Promise<VideoGuestQuota | null> {
  try {
    return await request<VideoGuestQuota>('/quota');
  } catch {
    return null;
  }
}

export interface VideoDocCategory {
  id: string;
  title: string;
  items: Array<{ id?: string; path: string; title: string }>;
}

export interface VideoDocContentResponse {
  id?: string;
  title: string;
  path: string;
  filename?: string;
  modified_at?: number | null;
  content: string;
}

export function fetchVideoDocsList(): Promise<{
  categories: VideoDocCategory[];
  default_doc: string;
}> {
  return request('/docs/list');
}

export function fetchVideoDocContent(docPath: string): Promise<VideoDocContentResponse> {
  return request(`/docs/content?path=${encodeURIComponent(docPath)}`);
}

// ── 认证资料与学习社区 API ──

export function fetchAuthMe(): Promise<{
  id: string;
  email: string;
  role: string;
  status: string;
  display_name?: string | null;
  avatar_url?: string | null;
}> {
  return request('/auth/me');
}

export function updateAuthProfile(payload: {
  display_name?: string | null;
  avatar_url?: string | null;
}): Promise<{
  id: string;
  email: string;
  role: string;
  status: string;
  display_name?: string | null;
  avatar_url?: string | null;
}> {
  return request('/auth/profile', {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function fetchCommunityFeed(
  params: { sort?: 'new' | 'hot'; page?: number; pageSize?: number } = {},
): Promise<{
  items: CommunityPost[];
  total: number;
  page: number;
  page_size: number;
  sort: string;
}> {
  const qs = new URLSearchParams();
  qs.set('sort', params.sort || 'new');
  qs.set('page', String(params.page || 1));
  qs.set('page_size', String(params.pageSize || 20));
  return request(`/community/posts?${qs.toString()}`);
}

export function fetchCommunityMine(
  params: { page?: number; pageSize?: number } = {},
): Promise<{
  items: CommunityPost[];
  total: number;
  page: number;
  page_size: number;
}> {
  const qs = new URLSearchParams();
  qs.set('page', String(params.page || 1));
  qs.set('page_size', String(params.pageSize || 30));
  return request(`/community/posts/mine?${qs.toString()}`);
}

export function fetchCommunityFavorites(
  params: { page?: number; pageSize?: number } = {},
): Promise<{
  items: CommunityPost[];
  total: number;
  page: number;
  page_size: number;
}> {
  const qs = new URLSearchParams();
  qs.set('page', String(params.page || 1));
  qs.set('page_size', String(params.pageSize || 30));
  return request(`/community/favorites?${qs.toString()}`);
}

export function fetchCommunityPost(postId: string): Promise<CommunityPost> {
  return request(`/community/posts/${encodeURIComponent(postId)}`);
}

export function fetchCommunityPostSummary(postId: string): Promise<{
  task_id: string;
  status: string;
  stage?: string;
  percent?: number;
  stage_message?: string | null;
  result?: any;
  error?: string | null;
  error_code?: string | null;
  partial_transcript?: any[];
  timing?: any;
  video_id?: string;
  video_title?: string;
  webpage_url?: string;
  source_type?: 'upload' | 'url';
  duration?: number;
  cover_url?: string;
  share_token?: string | null;
  readonly_share?: boolean;
  community_post_id?: string;
}> {
  return request(`/community/posts/${encodeURIComponent(postId)}/summary?_t=${Date.now()}`);
}

export function fetchCommunityPlayback(postId: string): Promise<{
  mode: string;
  stream_type?: string;
  storage_status?: string;
  src?: string;
  mime?: string;
  expires_in?: number;
  source_url?: string;
  platform?: string;
  message?: string;
}> {
  return request(`/community/posts/${encodeURIComponent(postId)}/playback`);
}

export function fetchCommunityPostByAnalysis(
  analysisId: string,
): Promise<{ post: CommunityPost | null }> {
  return request(`/community/posts/by-analysis/${encodeURIComponent(analysisId)}`);
}

export async function publishCommunityPost(
  analysisId: string,
  confirm = true,
): Promise<CommunityPost> {
  const res = await request<{ ok?: boolean; post?: CommunityPost } & CommunityPost>(
    '/community/posts',
    {
      method: 'POST',
      body: JSON.stringify({ analysis_id: analysisId, confirm }),
    },
  );
  return (res && res.post ? res.post : res) as CommunityPost;
}

export function withdrawCommunityPost(postId: string): Promise<{ ok: boolean }> {
  return request(`/community/posts/${encodeURIComponent(postId)}`, {
    method: 'DELETE',
  });
}

export async function syncCommunityPost(postId: string): Promise<CommunityPost> {
  const res = await request<{ ok?: boolean; post?: CommunityPost } & CommunityPost>(
    `/community/posts/${encodeURIComponent(postId)}/sync`,
    {
      method: 'PATCH',
    },
  );
  return (res && res.post ? res.post : res) as CommunityPost;
}

export function toggleCommunityLike(
  postId: string,
): Promise<{ liked: boolean; like_count: number }> {
  return request(`/community/posts/${encodeURIComponent(postId)}/like`, {
    method: 'POST',
  });
}

export function toggleCommunityFavorite(
  postId: string,
): Promise<{ favorited: boolean; favorite_count: number }> {
  return request(`/community/posts/${encodeURIComponent(postId)}/favorite`, {
    method: 'POST',
  });
}

export function fetchCommunityComments(
  postId: string,
): Promise<{ items: CommunityComment[] }> {
  return request(`/community/posts/${encodeURIComponent(postId)}/comments`);
}

export async function postCommunityComment(
  postId: string,
  body: string,
): Promise<CommunityComment> {
  const res = await request<{ ok?: boolean; item?: CommunityComment } & CommunityComment>(
    `/community/posts/${encodeURIComponent(postId)}/comments`,
    {
      method: 'POST',
      body: JSON.stringify({ body }),
    },
  );
  return (res && res.item ? res.item : res) as CommunityComment;
}

export function reportCommunityComment(
  commentId: string,
  reason = '',
): Promise<{ ok: boolean; report_id?: number; status?: string }> {
  return request(`/community/comments/${encodeURIComponent(commentId)}/report`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

export function fetchCommunityUserMe(): Promise<CommunityUserProfile> {
  return request('/community/users/me');
}

export function fetchCommunityUserProfile(userId: string): Promise<CommunityUserProfile> {
  return request(`/community/users/${encodeURIComponent(userId)}`);
}

export function fetchCommunityUserPosts(
  userId: string,
  params: { page?: number; pageSize?: number } = {},
): Promise<{
  items: CommunityPost[];
  total: number;
  page: number;
  page_size: number;
}> {
  const qs = new URLSearchParams();
  qs.set('page', String(params.page || 1));
  qs.set('page_size', String(params.pageSize || 20));
  return request(`/community/users/${encodeURIComponent(userId)}/posts?${qs.toString()}`);
}

export function fetchCommunityUserActivity(
  userId: string,
  weeks = 52,
): Promise<CommunityActivityResponse> {
  const qs = new URLSearchParams();
  qs.set('weeks', String(weeks));
  return request(`/community/users/${encodeURIComponent(userId)}/activity?${qs.toString()}`);
}

export function fetchAdminCommunityPosts(
  params: { page?: number; pageSize?: number; status?: string } = {},
): Promise<{
  items: CommunityPost[];
  total: number;
  page: number;
  page_size: number;
}> {
  const qs = new URLSearchParams();
  qs.set('page', String(params.page || 1));
  qs.set('page_size', String(params.pageSize || 30));
  if (params.status) qs.set('status', params.status);
  return request(`/admin/community/posts?${qs.toString()}`);
}

export function adminWithdrawCommunityPost(postId: string): Promise<{ ok: boolean }> {
  return request(`/admin/community/posts/${encodeURIComponent(postId)}/withdraw`, {
    method: 'PATCH',
  });
}

export function adminHideCommunityComment(commentId: string): Promise<{ ok: boolean }> {
  return request(`/admin/community/comments/${encodeURIComponent(commentId)}/hide`, {
    method: 'PATCH',
  });
}

export function fetchAdminCommentReports(
  params: { status?: string; page?: number; pageSize?: number } = {},
): Promise<{
  items: CommunityCommentReport[];
  total: number;
  page: number;
  page_size: number;
}> {
  const qs = new URLSearchParams();
  qs.set('status', params.status ?? 'open');
  qs.set('page', String(params.page || 1));
  qs.set('page_size', String(params.pageSize || 30));
  return request(`/admin/community/comment-reports?${qs.toString()}`);
}

export function resolveAdminCommentReport(
  reportId: number | string,
  payload: { action: 'hide' | 'dismiss'; admin_note?: string },
): Promise<{ ok: boolean; action: string }> {
  return request(`/admin/community/comment-reports/${encodeURIComponent(String(reportId))}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

