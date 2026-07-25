# 执行记录：导演演讲稿实际模型 vs 界面主模型不一致

**日期**：2026-07-25  
**状态**：已修复

## 问题

界面右上角显示主模型 `gpt-5.3-codex-spark`，但用量明细里「生成演讲稿」记的是 `gemini-3.6-flash-high`。

## 方案对比

| 方案 | 做法 | 权重 |
|------|------|------|
| **A. 修正调用链（已选）** | 演讲稿固定走 `this.model`（主模型），用量同步记主模型；`generateText` 仅留给 SVG 设计 fallback | **9/10** |
| B. 改文案/徽章 | 导演步骤改称「设计模型」或双徽章 | **3/10**（与产品要求「文稿统一 5.3」冲突） |

## 根因

`generateSpeechScript` 误复用了 SVG 用的 `generateText`，后者按 `[designModel, model]` 优先打设计模型；设计模型成功即返回，故账本记 3.6。

## 执行修改

1. `openaiCompatibleAdapter.ts`：`generateSpeechScript` 改为直接 `chat(..., { model: this.model, stage: "main" })`
2. `realGeminiAdapter.ts`：`generateText` 支持显式 `options.model` 时只打该模型；演讲稿传入 `model: this.model`
3. `modelUsage.test.ts`：新增回归测试，断言请求体与 usage event 均为主模型，不会落到 designModel

## 验证

- `npx tsc --noEmit` 通过
- `node --import tsx --test src/modelUsage.test.ts`：6/6 通过

## 使用注意

- 需**重启 ppt-agent API 进程**后再生演讲稿，旧进程仍跑旧代码
- 验证：再点「生成演讲稿」后，用量明细应出现 `main` + `gpt-5.3-codex-spark`

## 经验

- 判断「到底用了谁」看用量明细的 `model`，不要只看右上角徽章
- 主模型能力（大纲/计划/演讲稿）不要复用设计模型的 fallback 列表
