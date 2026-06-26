# 访客模式（Guest Mode）— 未登录可体验，限额 5 次/24h

## 背景

当前 SmartDiagram 强制要求登录才能使用。需要增加访客模式：未登录用户可直接体验，但限制生成图表次数为 5 次，用完后引导登录。额度 24 小时后自动重置。

## 设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 身份识别 | localStorage（无后端参与） | 这是转化引导，非安全防护；KISS 原则 |
| 交互体验 | 混合方式：始终显示剩余额度 + 用完锁定输入 | 紧迫感促转化，过渡自然 |
| 额度重置 | 24h 冷却，基于首次使用时间戳 | 简单可靠 |

## Proposed Changes

### 1. 前端：访客配额管理模块

#### [NEW] [guestQuota.ts](file:///Volumes/WorkData/项目app/app/DeepDiagram-Pro/SmartDiagram/frontend/src/config/guestQuota.ts)

纯前端的访客配额管理器，基于 localStorage：

```typescript
// 存储结构：{ usedCount: number, firstUsedAt: number }
const STORAGE_KEY = 'smartdiagram.guest.quota';
const MAX_USES = 5;
const COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24h

export function getGuestQuota(): { remaining: number; resetAt: number | null; exhausted: boolean }
export function consumeGuestUse(): void      // 调用一次 +1
export function resetIfExpired(): void       // 检查并自动重置过期配额
```

---

### 2. 前端：移除强制登录门控

#### [MODIFY] [App.tsx](file:///Volumes/WorkData/项目app/app/DeepDiagram-Pro/SmartDiagram/frontend/src/App.tsx)

**当前**：`if (!authSession) return <LoginScreen />`（第 73 行）

**改为**：
- `authSession` 为 `null` 时也渲染主界面（Canvas + Chat）
- `ChatPanel` 的 `authSession` prop 改为 `AuthSession | null`
- 新增 `onLogin` prop 透传给 ChatPanel，以便从访客模式切换到登录态

---

### 3. 前端：ChatPanel 访客额度 UI

#### [MODIFY] [ChatPanel.tsx](file:///Volumes/WorkData/项目app/app/DeepDiagram-Pro/SmartDiagram/frontend/src/components/chat/ChatPanel.tsx)

**变更点**：

1. **props 变更**：`authSession: AuthSession` → `authSession: AuthSession | null`，新增 `onLogin: (session: AuthSession) => void`
2. **额度条**：在输入框上方（`<textarea>` 容器外层）添加访客额度提示条
   - 有剩余时显示：`🎯 访客体验 · 剩余 3/5 次 · 登录解锁无限使用`（带登录按钮）
   - 用完时显示：`⏰ 体验额度已用完 · XX:XX 后重置 · 立即登录解锁全部功能`（带登录/注册按钮）
3. **输入拦截**：访客额度用完时 → textarea `disabled=true`，发送按钮禁用
4. **额度消耗**：在 `sendMessage` 函数中，发送成功（收到第一个 SSE 事件后）调用 `consumeGuestUse()`
5. **登录弹窗**：点击额度条的"登录"按钮 → 弹出 LoginScreen 作为模态弹窗（复用现有组件）

---

### 4. 前端：LoginScreen 弹窗模式

#### [MODIFY] [LoginScreen.tsx](file:///Volumes/WorkData/项目app/app/DeepDiagram-Pro/SmartDiagram/frontend/src/components/auth/LoginScreen.tsx)

添加 `mode?: 'page' | 'modal'` prop：
- `page`（默认）：当前全屏展示
- `modal`：去掉左侧 showcase 区域，仅渲染右侧登录表单，适配弹窗尺寸

---

### 5. 前端：i18n 翻译键

#### [MODIFY] [i18n.ts](file:///Volumes/WorkData/项目app/app/DeepDiagram-Pro/SmartDiagram/frontend/src/i18n.ts)

新增翻译键（中/英）：
```
guest.quotaRemaining: "访客体验 · 剩余 {remaining}/{total} 次"
guest.quotaExhausted: "体验额度已用完"
guest.resetIn: "{time} 后重置"
guest.loginToUnlock: "登录解锁无限使用"
guest.loginNow: "立即登录"
guest.registerNow: "立即注册"
guest.tryFree: "免费体验"
```

---

### 6. 前端：企业上下文降级

#### [MODIFY] [enterpriseContext.ts](file:///Volumes/WorkData/项目app/app/DeepDiagram-Pro/SmartDiagram/frontend/src/config/enterpriseContext.ts)

当前 `currentEnterpriseContext()` 在无 session 时返回 `FALLBACK_ENTERPRISE_CONTEXT`，这已经是正确的降级行为（匿名用户用 `anonymous` 身份调后端）。**无需修改核心逻辑**，已天然支持。

---

## 不涉及后端修改

后端 `/api/chat/stream` 的 `build_permission_context` 已支持匿名请求（默认 `user_id: "anonymous"`, `tenant_id: "local"`）。运行时限流 `runtime_guard_service` 已基于 `tenant_id:user_id` 做 per-minute 限流。**访客的 5 次/24h 限制完全由前端控制**，后端零改动。

---

## Verification Plan

### 自动验证
1. `npm run build` — 确认 TypeScript 编译无错误
2. 手动测试流程：
   - 清除 localStorage → 刷新 → 应直接进入主界面（非登录页）
   - 输入框上方应显示 "剩余 5/5 次" 提示条
   - 发送 1 条消息 → 提示变为 "剩余 4/5 次"
   - 发送 5 条后 → 输入框禁用，显示"额度用完"和倒计时
   - 点击"登录"按钮 → 弹出登录模态弹窗
   - 登录成功 → 额度条消失，恢复正常使用
   - 已登录用户不受额度限制
