# EXECUTION · 修复进度 SSE 打到 Vite 刷 404

日期：2026-07-18

## 现象

每次 AI/后端调用时控制台出现：

`GET http://127.0.0.1:5173/api/projects/.../progress 404`

业务仍能继续（Agent 日志正常）。

## 根因

| 用途 | 环境变量 | 默认 |
|------|----------|------|
| `api.ts` 业务请求 | `VITE_API_BASE_URL` | `http://127.0.0.1:4000` |
| `connectProgressSSE`（旧） | `VITE_API_BASE`（写错且常为空） | `""` → 相对路径打到 **Vite 5173** |

`busy` 一置位就连 SSE；EventSource 失败会自动重连 → 每次操作刷 404。进度是旁路，故主流程不受影响。

## 方案

| 方案 | 权重 | 说明 |
|------|------|------|
| A. SSE 改用 `getApiBase()`（与 api 同源）+ onerror 立即关闭 | **9.5** | 根治 |
| B. 关掉 SSE | 5 | 丢进度面板 |

选用 A。

## 改动

- `api.ts`：导出 `getApiBase()`
- `workbenchStore.ts`：进度 SSE 用 `getApiBase()`；去掉不可靠 HEAD 预检；连不上立刻 `close`

## 验证

- [ ] 点「搜索本页」等操作，控制台不再出现 `5173/.../progress` 404
- [ ] API 已启动时进度面板仍可收到事件（可选）
