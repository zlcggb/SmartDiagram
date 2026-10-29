-- 004_community.sql: 学习社区（登录用户、企业内）

CREATE TABLE IF NOT EXISTS community_posts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  video_id        UUID REFERENCES videos(id) ON DELETE SET NULL,
  analysis_id     TEXT REFERENCES analyses(id) ON DELETE SET NULL,
  status          TEXT NOT NULL DEFAULT 'published'
                  CHECK (status IN ('published', 'withdrawn', 'invalid', 'outdated')),
  title           TEXT,
  tldr            TEXT,
  platform        TEXT,
  source_type     TEXT,
  like_count      INT NOT NULL DEFAULT 0,
  comment_count   INT NOT NULL DEFAULT 0,
  favorite_count  INT NOT NULL DEFAULT 0,
  published_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (video_id)
);

-- video_id 为空时表示源视频已删除，帖保留为「已失效」展示

CREATE INDEX IF NOT EXISTS idx_community_posts_status_published
  ON community_posts (published_at DESC)
  WHERE status IN ('published', 'outdated');

CREATE INDEX IF NOT EXISTS idx_community_posts_author
  ON community_posts (author_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS community_likes (
  post_id     UUID NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS community_favorites (
  post_id     UUID NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS community_comments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id     UUID NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'visible'
              CHECK (status IN ('visible', 'hidden')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_community_comments_post
  ON community_comments (post_id, created_at ASC);

CREATE TABLE IF NOT EXISTS community_blockwords (
  id          BIGSERIAL PRIMARY KEY,
  word        TEXT NOT NULL,
  match_mode  TEXT NOT NULL DEFAULT 'contains'
              CHECK (match_mode IN ('contains', 'exact')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_community_blockwords_word
  ON community_blockwords (LOWER(word));

INSERT INTO community_blockwords (word, match_mode)
SELECT v.word, v.match_mode
FROM (VALUES
  ('加微信', 'contains'),
  ('代购', 'contains'),
  ('赌博', 'contains')
) AS v(word, match_mode)
WHERE NOT EXISTS (SELECT 1 FROM community_blockwords LIMIT 1);
