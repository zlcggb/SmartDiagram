export interface VideoFormatItem {
  format_id: string;
  ext?: string;
  quality: string;
  height?: number;
  fps?: number;
  filesize?: number;
  vcodec?: string;
  acodec?: string;
}

export interface VideoInfo {
  title?: string;
  uploader?: string;
  extractor?: string;
  duration?: number;
  duration_string?: string;
  thumbnail?: string;
  webpage_url?: string;
  login_hint?: string;
  formats?: VideoFormatItem[];
}

export interface UploadMeta {
  file_id: string;
  filename: string;
  size?: number;
  duration?: number;
  content_type?: string;
}

export interface MediaPlaybackState {
  mode: '' | 'progressive' | 'embed' | 'external';
  src: string;
  embedUrl: string;
  provider?: string;
  videoId?: string;
  warning: string;
  loading: boolean;
  error: string;
}

export interface DownloadState {
  status: 'idle' | 'queued' | 'downloading' | 'paused' | 'processing' | 'done' | 'error' | 'cancelled';
  percent: number;
  speed: string;
  eta: string;
  taskId: string;
  ready: boolean;
  downloadUrl: string;
  error: string;
}

export interface TranscriptSegment {
  start: number;
  end?: number;
  time: string;
  text: string;
  translation?: string;
}

export interface SummaryChapter {
  time: string;
  seconds: number;
  title: string;
  summary?: string;
}

export interface ChatAction {
  type: 'download' | 'switch_tab' | 'seek';
  label?: string;
  summary_task_id?: string;
  tab?: string;
  seconds?: number;
}

export interface ChatRouterMeta {
  intent?: string;
  confidence?: number;
  latency_ms?: number;
  source?: string;
  llm_total_ms?: number;
  llm_ttft_ms?: number;
}

export interface ChatMessageItem {
  role: 'user' | 'assistant';
  content: string;
  action?: ChatAction | null;
  router?: ChatRouterMeta | null;
  streaming?: boolean;
  error?: boolean;
  created_at?: string;
}

export interface SummaryResult {
  title?: string;
  tldr?: string;
  summary?: string;
  actionable_takeaways?: string[];
  key_points?: string[];
  chapters?: SummaryChapter[];
  mindmap?: string;
  transcript?: TranscriptSegment[];
  transcript_source?: string;
  report_style?: string;
  chat_history?: ChatMessageItem[];
  quiz?: QuizData | null;
  quiz_state?: QuizSavedState | null;
}

export interface SummaryTiming {
  total_ms?: number;
  asr_ms?: number;
  llm_ms?: number;
  cached_hit?: boolean;
  reused_transcript?: boolean;
}

export interface SummaryState {
  status: 'idle' | 'queued' | 'transcribing' | 'local_asr' | 'analyzing_frames' | 'summarizing' | 'done' | 'error' | 'cancelled';
  stage: string;
  stageMessage: string;
  percent: number;
  result: SummaryResult | null;
  partial_transcript: TranscriptSegment[];
  timing: SummaryTiming | null;
  error: string;
  errorCode: string;
}

export interface TranslationState {
  status: 'idle' | 'translating' | 'done' | 'error';
  percent: number;
  result: TranscriptSegment[] | null;
  error: string;
}

export interface QuizQuestion {
  id: string;
  type: 'single_choice' | 'multiple_choice' | 'true_false' | 'fill_blank';
  dimension?: string;
  stem: string;
  options?: string[];
  correct_answer?: string | string[] | boolean;
  accepted_answers?: string[];
  explanation?: string;
  reference_time?: number;
  reference_text?: string;
  points?: number;
}

export interface QuizData {
  quiz_id: string;
  title: string;
  question_count: number;
  estimated_minutes: number;
  questions: QuizQuestion[];
}

export interface QuizScoreDetail {
  question_id: string;
  correct: boolean;
  user_answer: string | string[] | boolean;
  correct_answer: string | string[] | boolean;
  explanation: string;
  reference_text?: string;
  reference_time?: number;
}

export interface QuizScoreResult {
  score: number;
  correct_count: number;
  question_count: number;
  details: QuizScoreDetail[];
}

export interface QuizSavedState {
  quiz_id: string;
  answers: Record<string, string | string[] | boolean>;
  revealed: Record<string, boolean>;
  current_index: number;
  view_mode: 'deck' | 'list' | 'summary';
  score_result?: QuizScoreResult | null;
  updated_at?: string;
}

export interface VideoHistoryItem {
  id: string;
  title?: string;
  source_type?: 'upload' | 'url';
  source_url?: string;
  cover_url?: string | null;
  duration_seconds?: number;
  file_size_bytes?: number;
  status?: string;
  summary_status?: string;
  quiz_count?: number;
  last_score?: number | null;
  created_at?: string;
  guest?: boolean;
  summary_task_id?: string;
  file_id?: string;
  summary_result?: SummaryResult | null;
  transcript?: TranscriptSegment[];
  chapters?: SummaryChapter[];
}

export interface VideoGuestQuota {
  is_guest: boolean;
  quota_limit?: number | null;
  quota_used?: number;
  quota_remaining?: number | null;
  ask_limit?: number | null;
  ask_used?: number;
  ask_remaining?: number | null;
}

export interface AdminStats {
  user_count: number;
  video_count: number;
  quiz_count: number;
  attempt_count: number;
  avg_score: number;
}

export interface AdminUserItem {
  id: string;
  name?: string;
  email: string;
  role: string;
  video_count?: number;
  attempt_count?: number;
  avg_score?: number;
}

export interface CommunityAuthor {
  id: string;
  label: string;
  email?: string;
  avatar_url?: string | null;
}

export interface CommunityPost {
  id: string;
  video_id: string;
  analysis_id: string;
  author_id: string;
  status: 'published' | 'outdated' | 'withdrawn' | 'invalid';
  title: string;
  tldr?: string;
  cover_url?: string | null;
  source_type?: 'upload' | 'url';
  source_url?: string;
  platform?: string;
  duration_sec?: number;
  storage_status?: string;
  like_count: number;
  favorite_count: number;
  comment_count: number;
  liked?: boolean;
  favorited?: boolean;
  viewer_liked?: boolean;
  viewer_favorited?: boolean;
  is_author?: boolean;
  author_label?: string;
  author_email?: string;
  author_display_name?: string;
  author_avatar_url?: string | null;
  author?: CommunityAuthor;
  created_at?: string;
  updated_at?: string;
  published_at?: string;
}

export interface CommunityComment {
  id: string;
  post_id?: string;
  author_id?: string;
  user_id?: string;
  body: string;
  status?: string;
  author_label?: string;
  author_email?: string;
  author_display_name?: string;
  author_avatar_url?: string | null;
  author?: CommunityAuthor;
  created_at?: string;
}

export interface CommunityUserProfile {
  id: string;
  label: string;
  email: string;
  display_name?: string | null;
  avatar_url?: string | null;
  member_since?: string;
  is_self?: boolean;
  stats: {
    public_posts: number;
    comments: number;
  };
}

export interface CommunityActivityDay {
  date: string;
  total: number;
  analyses: number;
  quizzes: number;
  posts: number;
  comments: number;
  level: 0 | 1 | 2 | 3 | 4;
}

export interface CommunityActivityResponse {
  days: CommunityActivityDay[];
  start_date: string;
  end_date: string;
  weeks: number;
}

export interface CommunityCommentReport {
  id: number;
  comment_id: string;
  reporter_id?: string;
  reason?: string | null;
  status: 'open' | 'dismissed' | 'reviewed' | 'resolved_hidden';
  admin_note?: string | null;
  created_at?: string;
  resolved_at?: string | null;
  comment_body?: string;
  comment_status?: string;
  post_id?: string;
  comment_author_id?: string;
  post_title?: string;
  reporter_email?: string;
  comment_author_email?: string;
}
