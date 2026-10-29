-- 005: 社区评论举报

CREATE TABLE IF NOT EXISTS community_comment_reports (
  id           BIGSERIAL PRIMARY KEY,
  comment_id   UUID NOT NULL REFERENCES community_comments(id) ON DELETE CASCADE,
  reporter_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason       TEXT,
  status       TEXT NOT NULL DEFAULT 'open'
               CHECK (status IN ('open', 'reviewed', 'dismissed')),
  admin_note   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at  TIMESTAMPTZ,
  UNIQUE (comment_id, reporter_id)
);

CREATE INDEX IF NOT EXISTS idx_community_comment_reports_status
  ON community_comment_reports (status, created_at DESC);
