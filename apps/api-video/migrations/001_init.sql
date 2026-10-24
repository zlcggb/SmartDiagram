-- 001_init.sql: VidGrab PostgreSQL 16 初始表结构

-- 1. 用户账号表
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user'   CHECK (role IN ('user', 'admin')),
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  display_name  TEXT,
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower ON users (LOWER(email));

-- 2. 视频记录表（URL 链接与上传视频）
CREATE TABLE IF NOT EXISTS videos (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_type       TEXT NOT NULL CHECK (source_type IN ('url', 'upload')),
  source_url        TEXT,
  platform          TEXT,
  title             TEXT,
  original_filename TEXT,
  duration_sec      REAL,
  storage_status    TEXT NOT NULL DEFAULT 'link_only'
                    CHECK (storage_status IN ('link_only', 'pending', 'transcoding', 'ready', 'failed', 'skipped')),
  storage_path      TEXT,
  original_bytes    BIGINT,
  storage_bytes     BIGINT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_videos_user_created ON videos(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_videos_storage_status ON videos(storage_status);

-- 3. AI 总结与研报分析表 (id 与 summary task_id 1:1 对应)
CREATE TABLE IF NOT EXISTS analyses (
  id          TEXT PRIMARY KEY,
  video_id    UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status      TEXT NOT NULL,
  target_lang TEXT NOT NULL DEFAULT 'zh',
  prompt      TEXT,
  result      JSONB,
  error       TEXT,
  error_code  TEXT,
  timing      JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_analyses_video ON analyses(video_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analyses_user ON analyses(user_id, created_at DESC);

-- 4. AI 测验卷面表 (标准答案保留在服务端)
CREATE TABLE IF NOT EXISTS quizzes (
  id                TEXT PRIMARY KEY,
  analysis_id       TEXT NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title             TEXT NOT NULL,
  estimated_minutes INT NOT NULL DEFAULT 15,
  questions         JSONB NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_quizzes_analysis ON quizzes(analysis_id);
CREATE INDEX IF NOT EXISTS idx_quizzes_user ON quizzes(user_id, created_at DESC);

-- 5. 测验提交与答题记录表
CREATE TABLE IF NOT EXISTS quiz_attempts (
  id         BIGSERIAL PRIMARY KEY,
  quiz_id    TEXT NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  answers    JSONB NOT NULL,
  result     JSONB NOT NULL,
  score      REAL NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_quiz_attempts_quiz_user ON quiz_attempts(quiz_id, user_id, created_at DESC);

-- 6. 会员商业化体系：客户表
CREATE TABLE IF NOT EXISTS billing_users (
  user_id            UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  email              TEXT NOT NULL,
  stripe_customer_id TEXT UNIQUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 7. 会员商业化体系：订阅合约表
CREATE TABLE IF NOT EXISTS billing_subscriptions (
  stripe_subscription_id TEXT PRIMARY KEY,
  user_id                UUID NOT NULL REFERENCES billing_users(user_id) ON DELETE CASCADE,
  plan                   TEXT NOT NULL CHECK (plan IN ('monthly', 'yearly')),
  status                 TEXT NOT NULL,
  current_period_end     BIGINT,
  cancel_at_period_end   INT NOT NULL DEFAULT 0,
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_billing_sub_user ON billing_subscriptions(user_id);

-- 8. 会员商业化体系：Webhook 幂等排他表
CREATE TABLE IF NOT EXISTS billing_webhook_events (
  event_id     TEXT PRIMARY KEY,
  event_type   TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
