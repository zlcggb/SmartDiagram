-- 007_video_cover_url.sql: 为 videos 与 community_posts 表增加封面图字段

ALTER TABLE videos
  ADD COLUMN IF NOT EXISTS cover_url TEXT;

ALTER TABLE community_posts
  ADD COLUMN IF NOT EXISTS cover_url TEXT;
