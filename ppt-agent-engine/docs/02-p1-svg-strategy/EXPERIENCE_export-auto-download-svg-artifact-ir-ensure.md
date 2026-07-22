# 经验：导出自动下载 / SVG 伪线防御 / IR ensure（2026-07-17）

## 1. 导出成功 ≠ 已下载

- API 返回 `downloadUrl` 只是「文件已生成」；前端必须显式触发下载（临时 `<a download>` / `window.location`）。
- **主按钮**职责：生成 + 下载；**次按钮**职责：重下历史版本。文案分开，避免用户以为主按钮坏了。
- 相对路径务必经 `API_BASE`（`absoluteDownloadUrl`），否则 href 会指到 Vite 源站 404。

## 2. SVG 编译：宁可缺装饰，不要垃圾线

WPS 中「从左上角拉出的蓝线」常见根因：

1. 把贝塞尔/弧线控制点当成折线顶点；
2. fill-only 图标 path 被默认 stroke 拆成线段；
3. 未应用的 transform 导致局部 path 画在原点附近再连到远处。

防御原则：

- 只编译安全子集（M/L/H/V/Z）；含 C/Q/A/S/T → **整段跳过**；
- 无可见 stroke → 不画 line；
- 检测「近原点 + 长跨度 / 近对角线贯穿」→ 丢弃该段；
- 回归用例不依赖 references：内置 synthetic SVG 即可卡住回归。

## 3. IR 链路：策略切换 ≠ 已生成

- 切换 `renderStrategy=ir` 只改决策，不写 `irJson`。
- 导出前应对 draft/ir **强制 `ensureSlideIr`**；失败再主题模板，并写 warning/notes。
- 渲染层若主题模板「永远 return true」，有 irJson 也会被盖住 → IR 策略需 `preferIr`。
- Studio 设计稿 Tab：IR 优先时应展示 IR 线框或明确「生成 IR」，不要空白假装有设计。

## 复用检查清单

- [ ] 导出成功路径是否调用了与「下载历史」相同的 URL 解析？
- [ ] path 编译是否会把曲线控制点当顶点？
- [ ] draft/ir 导出是否保证尝试生成 irJson？
- [ ] UI 策略切换是否附带生成入口或预览？
