# 统一访客认证（方案 B）

## 目标

- Diagram 与 PPT 共用同一套平台身份：**正式用户 Bearer** 或 **访客 Bearer**
- 访客数据与注册用户隔离，不再向 `tenants/users` 自动注入幽灵行
- 服务端 Redis 限制访客 AI 调用次数，防止 Token 滥用
- 可选 CAPTCHA + Origin 校验，降低脚本/反代刷接口风险

## 架构

```mermaid
flowchart TB
  Browser -->|POST /api/auth/guest/session + CAPTCHA| AuthAPI
  AuthAPI --> GuestSessions[(guest_sessions)]
  AuthAPI -->|Bearer sd_guest_*| Browser
  Browser -->|Authorization Bearer| DiagramChat[/api/chat/stream]
  Browser -->|Authorization Bearer| PPT[/ppt-api via renderer]
  PPT -->|GET /api/auth/me| AuthAPI
  DiagramChat --> Redis[(Redis guest quota)]
```

## 关键文件

| 层 | 文件 |
|----|------|
| 访客表 | `apps/api-diagram/app/models/guest.py` |
| 签发/校验 | `apps/api-diagram/app/services/guest_session_service.py` |
| 配额 | `apps/api-diagram/app/services/guest_quota_service.py` |
| 请求身份 | `apps/api-diagram/app/services/identity_service.py` |
| API | `POST /api/auth/guest/session` · `GET /api/auth/guest/quota` · `GET /api/auth/me` |
| 前端 | `apps/web/src/shared/lib/config/guestSession.ts` |
| PPT | `apps/service-ppt-renderer/src/lib/pptPrincipal.ts` |

## 环境变量（根 `.env`）

```env
GUEST_SESSION_ENABLED=true
GUEST_CAPTCHA_REQUIRED=false          # 本地 dev；生产建议 true
GUEST_AI_MAX_USES=5                   # 首次种子默认值（运行时可被 DB 覆盖）
GUEST_AI_MAX_USES_PER_IP=20
GUEST_AI_WINDOW_SECONDS=86400
API_ORIGIN_CHECK_ENABLED=false        # 生产建议 true
```

> **运行时真相源**：平台用户中心 → **额度模板** → **访客用户额度**（`platform_guest_quota_settings` 表）。`.env` 仅在首次建表时作种子；改面板后即时生效，无需重启。

### 超限拦截（已实现）

| 身份 | 检查点 | 存储 | HTTP |
|------|--------|------|------|
| **访客** | `/api/chat/stream` 进入后 | Redis 滑动窗口（次数） | `429 guest_quota_exhausted` |
| **访客** | 同上，预估 Token 后 | `guest_usage_events` 日/月聚合 | `402 guest_*_quota_exceeded` |
| **正式用户** | 同上 | 租户月预算 `tenant_usage_budgets` | `402 tenant_*` |
| **正式用户** | 同上 | tier+role 模板合并 `platform_quota_profiles` | `402 user_*_quota_exceeded` |

管理 API：

- `GET/PUT /api/platform/guest-quota` — 访客统一额度
- `GET/PUT /api/platform/quota-profiles` — 正式用户按等级/角色模板

关闭「超限拦截」= 仅统计不拒绝（硬限制 off）。

**执行过程、方案决策、拦截顺序与后续规范** → [docs/plans/2026-07-26-platform-quota-management-execution.md](./plans/2026-07-26-platform-quota-management-execution.md)（文档中心索引见 [docs/README.md](./README.md)）。

## 生产建议

1. `GUEST_CAPTCHA_REQUIRED=true`（Turnstile 或 ALTCHA）
2. `API_ORIGIN_CHECK_ENABLED=true` 并配置 `CORS_ORIGINS`
3. 启用 Redis（配额依赖 Redis）
4. 平台用户中心后续可扩展展示 `guest_sessions` 统计

平台用户中心已通过 `GET /api/platform/users` 返回 `registered_summary`、`guest_summary`、`guests[]`，桌面 **平台用户中心** 窗口分区展示。

### 启动时自动归类（本地 / 云服务器一致）

`api-diagram` 在以下两个时机都会执行 **幂等** 迁移（`guest_identity_migration_service`）：

1. **应用启动** — `app/main.py` → `on_startup`
2. **部署迁移脚本** — `scripts/migrate_database.py`（`dev.sh` / 云部署同样会跑）

迁移内容：

| 步骤 | 作用 |
|------|------|
| 确保 `guest-pool` 租户存在 | 新访客会话隔离 |
| 写入 `users.preferences_json.platform_principal_kind` | `registered` / `demo` / `legacy_guest` |
| 为历史幽灵用户补 `guest_sessions` 行 | `id = legacy-{user_id}`，`status=legacy` |

归类规则与下方「历史数据分类」一致；**不删行、不改 FK**，正式用户的 `agent_runs` / 账单数据保持独立。

租户管理员用户列表（`GET /api/admin/users`）也会排除 `legacy_guest`，避免测试/匿名账号污染正式成员统计。

### 平台超管（数据库 + env 种子）

| 层 | 说明 |
|----|------|
| **env** `PLATFORM_ADMIN_EMAILS` | 仅启动/迁移时：若对应用户尚无 `platform_admin` 行，则写入 `user_platform_roles` |
| **DB** `user_platform_roles` | 运行时真相源；登录与 `/auth/me` 从此表合并 `roles[]` |
| **租户 role** `users.role` | 租户内 `member/admin/owner`，与平台超管独立 |

启动时会执行 `platform_admin_bootstrap_service`（与访客归类迁移一样，本地/云一致）。用户注册时若邮箱在 env 种子列表中，也会自动授予。

后续 tier / 内部员工等分级身份应继续扩展数据库字段与表，不再依赖 env。

### 平台超管授予 / 撤销（面板 + API）

平台超管可在 **正式用户** 卡片上点击「设为平台超管 / 撤销平台超管」，对应：

```http
PATCH /api/platform/users/{user_id}/platform-roles
Content-Type: application/json

{ "platform_admin": true }
```

规则：

| 情况 | 行为 |
|------|------|
| 已是超管 | 跳过（幂等） |
| 撤销最后一名超管 | `409 last_platform_admin` |
| 历史访客账号 | `400 legacy_guest_not_eligible` |
| **修改自己的权限** | `403 cannot_modify_self`（须由其他平台超管操作） |

写入 `user_platform_roles.source = manual`；env 种子仍只在启动时补缺失行。

### 账户分级（tier / kind → 权限 scopes）

持久化在 `users.preferences_json`：

| 字段 | 可选值 | 作用 |
|------|--------|------|
| `account_tier` | free / standard / pro / enterprise | 功能上限（scopes 基数） |
| `account_kind` | customer / internal / test / demo | 账号类型附加权限 |
| `users.role` | member / admin / owner | 租户内管理权限（可叠加 admin scopes） |

登录与 `/auth/me` 通过 `resolve_effective_scopes()` 合并后写入 session `scopes[]`。

平台超管可在面板调整，或调用：

```http
PATCH /api/platform/users/{user_id}/account
{ "account_tier": "pro", "account_kind": "internal", "tenant_role": "admin" }
```

**不能修改自己的账户权限**（`403 cannot_modify_self`），须由其他平台超管调整 tier / kind / 租户角色。

### 用量额度模板（按角色批量）

平台用户中心 **「额度模板」** Tab 可批量配置：

| 维度 | 键 | 限额字段 |
|------|-----|----------|
| 账户等级 | `free` / `standard` / `pro` / `enterprise` | 日 Token、月 Token、月金额 |
| 租户角色 | `member` / `admin` / `owner` | 同上（与等级合并取更严） |

- `0` 表示该维度不限
- 开启「超限拦截」后，AI 调用前会校验用户当日/当月用量（`402 user_*_quota_exceeded`）
- API：`GET/PUT /api/platform/quota-profiles`

启动迁移会为存量用户补默认 `standard` + `customer`（demo 账号为 `demo`）。

旧版匿名流程会在 `users` 表自动写入 **无 `password_hash`** 的幽灵行（如 `anonymous@local.smartdiagram`）。平台中心按以下规则归类，**无需手工改库**：

| 条件 | 展示分区 |
|------|----------|
| `password_hash` 非空 | 正式用户 |
| `.env` 演示账号（`user-member` / `local-admin`） | 正式用户 |
| 其余 `password_hash` 为空 | 访客用户（`source=legacy_user`） |

诊断 SQL（在 `smartdiagram` 库执行）：

```sql
-- 正式 vs 历史访客 数量
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

-- 历史访客明细（通常 email 以 @local.smartdiagram 结尾）
SELECT id, email, display_name, tenant_id, created_at
FROM users
WHERE (password_hash IS NULL OR password_hash = '')
  AND id NOT IN ('user-member', 'local-admin')
ORDER BY created_at DESC;
```

## 迁移说明

- 旧 `X-PPT-Guest-Token` 仍作 PPT renderer **短期兼容**；新前端统一走 Bearer 访客会话
- 旧 `anonymous-local` 客户端自报身份已废弃；`/api/chat/stream` 必须带有效 Bearer
