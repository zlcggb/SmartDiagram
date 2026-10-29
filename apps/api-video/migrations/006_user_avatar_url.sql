-- 用户头像 URL（可为 https 或 data:image 小图）
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
