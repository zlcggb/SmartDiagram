-- 游客问答配额：测验归属允许游客（user_id 可空），问答按 IP 单独每日计数
ALTER TABLE quizzes ALTER COLUMN user_id DROP NOT NULL;

CREATE TABLE IF NOT EXISTS guest_ask_usage (
  ip         TEXT        NOT NULL,
  day        DATE        NOT NULL,
  count      INT         NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (ip, day)
);
