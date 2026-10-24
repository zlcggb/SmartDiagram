-- 游客模式：分析记录允许无归属用户（user_id 可空），并按 IP 记录每日免费配额
ALTER TABLE videos ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE analyses ALTER COLUMN user_id DROP NOT NULL;

CREATE TABLE IF NOT EXISTS guest_usage (
  ip         TEXT        NOT NULL,
  day        DATE        NOT NULL,
  count      INT         NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (ip, day)
);
