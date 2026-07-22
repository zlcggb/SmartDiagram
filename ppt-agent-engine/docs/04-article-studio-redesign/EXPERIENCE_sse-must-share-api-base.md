# EXPERIENCE · SSE 必须与业务 API 共用 base URL

## 症状

「业务成功、控制台 404」——尤其是 `.../progress` 打到前端开发端口（如 5173）。

## 根因模式

1. 业务用 `VITE_API_BASE_URL`，旁路 SSE 另写一套 `VITE_API_BASE` / 空字符串  
2. 相对路径 `/api/...` 在 Vite 下打到前端，不是后端  
3. `EventSource` 失败会自动重连 → 每次 `busy` 刷屏  

## 做法

- 只暴露一个 `getApiBase()`，业务与 SSE 共用  
- SSE 失败立刻 `close()`，不要依赖「HEAD 预检」（Vite SPA 可能对未知路径返回 200 HTML）  
- 进度类旁路失败不得阻断主请求  

## 自检

控制台 Network 里 progress 的 host 是否等于 API（如 `:4000`），而不是 `:5173`。
