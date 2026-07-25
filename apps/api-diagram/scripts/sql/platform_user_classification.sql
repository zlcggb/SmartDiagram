-- 平台用户中心：正式用户 vs 历史访客 分类诊断
-- 在 smartdiagram 库执行（只读）

-- 1) 汇总
SELECT
  CASE
    WHEN password_hash IS NOT NULL AND password_hash <> '' THEN 'registered'
    WHEN id IN ('user-member', 'local-admin') THEN 'registered_demo'
    ELSE 'legacy_guest'
  END AS bucket,
  COUNT(*) AS cnt
FROM users
GROUP BY 1
ORDER BY 1;

-- 2) 历史访客（旧 anonymous / ensure_principals 注入）
SELECT id, email, display_name, tenant_id, status, created_at
FROM users
WHERE (password_hash IS NULL OR password_hash = '')
  AND id NOT IN ('user-member', 'local-admin')
ORDER BY created_at DESC;

-- 3) 新访客会话表（方案 B）
SELECT COUNT(*) AS guest_session_count FROM guest_sessions;
SELECT COUNT(*) AS guest_usage_event_count FROM guest_usage_events;
