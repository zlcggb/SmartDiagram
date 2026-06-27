# 替换 Cloudflare Turnstile → ALTCHA（自部署 PoW 验证）+ Redis 限速

## 背景

Cloudflare Turnstile 在中国访问极慢（需连接 challenges.cloudflare.com），导致登录/注册页卡在"正在验证"。

## 方案

用 **ALTCHA**（开源 Proof-of-Work CAPTCHA）替代 Turnstile，同时加 Redis IP 限速。

- ALTCHA：浏览器端解算一个加密哈希挑战（SHA-256），服务端验证。完全自部署，零外部请求，中国秒过。
- Redis 限速：每 IP 每分钟最多 5 次 auth 请求。

## Proposed Changes

### 后端

#### [MODIFY] [auth_service.py](file:///Volumes/WorkData/项目app/app/DeepDiagram-Pro/SmartDiagram/backend/app/services/auth_service.py)
- 删除 `verify_turnstile_token()` 函数
- 新增 `create_altcha_challenge()` 和 `verify_altcha_solution()` 函数
- 使用 `pip install altcha` 库，HMAC 密钥从环境变量 `ALTCHA_HMAC_KEY` 读取

#### [MODIFY] [routes_auth.py](file:///Volumes/WorkData/项目app/app/DeepDiagram-Pro/SmartDiagram/backend/app/api/routes_auth.py)
- 新增 `GET /auth/captcha-challenge` 端点 — 返回 PoW 挑战
- `/auth/login` 和 `/auth/register` 中的 Turnstile 验证替换为 ALTCHA 验证
- `GET /auth/captcha-config` 返回 `provider: "altcha"` 和 challenge URL

#### [NEW] [rate_limit.py](file:///Volumes/WorkData/项目app/app/DeepDiagram-Pro/SmartDiagram/backend/app/services/rate_limit.py)
- 基于 Redis 的 IP 限速器：滑动窗口，每 IP 60 秒内最多 5 次 auth 请求
- `check_rate_limit(ip: str, action: str) -> bool`

#### [MODIFY] [config.py](file:///Volumes/WorkData/项目app/app/DeepDiagram-Pro/SmartDiagram/backend/app/core/config.py)
- 新增 `ALTCHA_HMAC_KEY` 配置项（替代 TURNSTILE_SECRET_KEY / TURNSTILE_SITE_KEY）
- 可选保留 Turnstile 配置用于过渡

#### [MODIFY] [requirements.txt / pyproject.toml](file:///Volumes/WorkData/项目app/app/DeepDiagram-Pro/SmartDiagram/backend)
- 新增 `altcha` 依赖

---

### 前端

#### [MODIFY] [LoginScreen.tsx](file:///Volumes/WorkData/项目app/app/DeepDiagram-Pro/SmartDiagram/frontend/src/components/auth/LoginScreen.tsx)
- 删除 `TurnstileWidget` 组件（行 36-90）
- 新增 `AltchaWidget` 组件：
  - 从 `GET /api/auth/captcha-challenge` 获取挑战
  - 使用 `altcha` Web Component 自动解算
  - 解算完成后将 payload 传给提交逻辑
- 状态变量 `turnstileToken` 重命名为 `captchaPayload`

#### [MODIFY] [auth.ts](file:///Volumes/WorkData/项目app/app/DeepDiagram-Pro/SmartDiagram/frontend/src/config/auth.ts)
- `loginWithPassword` 和 `registerWithPassword` 的参数名从 `turnstileToken` 改为 `captchaPayload`
- `captcha-config` 接口返回结构适配

---

### 配置

#### [MODIFY] [.env](file:///Volumes/WorkData/项目app/app/DeepDiagram-Pro/SmartDiagram/backend/.env)
- 新增 `ALTCHA_HMAC_KEY=<随机生成的 64 字符密钥>`
- 可删除 `TURNSTILE_SITE_KEY` 和 `TURNSTILE_SECRET_KEY`

#### [MODIFY] [docker-compose.yml](file:///Volumes/WorkData/项目app/app/DeepDiagram-Pro/SmartDiagram/docker-compose.yml)
- 无需改动（ALTCHA 完全集成在后端代码中，不需要额外容器）

## 用户体验变化

| 场景 | Turnstile（之前） | ALTCHA（之后） |
|------|-----------------|---------------|
| 中国用户 | 转圈 10-30s，经常失败 | ~1s 内自动完成 |
| 海外用户 | 秒过 | ~1s 内自动完成 |
| 用户操作 | 无需操作（但要等） | 无需操作（几乎无感） |
| 外部依赖 | challenges.cloudflare.com | 无（纯自部署） |

## Verification Plan

### Automated Tests
1. 后端：手动 curl 测试 challenge → verify 流程
2. 前端：浏览器中观察 widget 自动解算并提交

### Manual Verification
1. 部署后在中国网络环境下测试注册/登录速度
2. 验证 Rate Limit 拒绝超频请求
