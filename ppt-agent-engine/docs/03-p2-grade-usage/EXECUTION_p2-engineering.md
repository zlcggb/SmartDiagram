# 执行文档：P2 工程化（对照回归 + 有限拆包）（2026-07-17）

## 需求

对照 `OPTIMIZATION_PLAN.md` 的 P1-3 / P1-4（本轮任务称「P2 工程化」）：

1. 用 `references/svg2pptx-skill/examples/*.svg` 做最小对照回归（对象数 / 不抛错）
2. 补齐可跑的 `test` 命令
3. 确认 P1 `svgCompile` 分离；`index.ts` 仍过大时再做有限拆包（禁止大爆炸）
4. 文档记录如何跑、覆盖哪些 example

## 方案与权重

| 方案 | 权重 | 说明 |
|------|------|------|
| A：只写文档 / 手工对照清单 | **40** | 无自动化护栏，改 renderer 仍不敢动 |
| B：最小可跑回归 + 小拆分 | **86** | tsx 脚本 + 导出纯编译结果；拆 `exportTypes`；成本低 |

选用 **B**。

## 本轮改动

| 文件 | 变更 |
|------|------|
| `packages/ppt-renderer/src/svgCompile.ts` | 导出 `compileSvgPreviewToSlide` / `SvgCompileResult`；`tryRenderSvgSlide` 复用纯逻辑 |
| `packages/ppt-renderer/src/exportTypes.ts` | **新建**：`RenderProjectPptxInput` / `Result` / `PageRenderResult` 再导出 |
| `packages/ppt-renderer/src/index.ts` | 改从 `exportTypes` 取类型；再导出可测 SVG API |
| `packages/ppt-renderer/scripts/svg-compile-regression.ts` | **新建**：读 examples → mock pptx → 断言 `rendered >= 8` |
| `packages/ppt-renderer/package.json` | `"test"` / `"test:svg-regression"`；devDep `tsx` |
| 根 `package.json` | `"test:svg-regression"` → filter ppt-renderer test |

### 有意不做

- 像素级 / OOXML 与 `ppt-master` 对照
- vitest 全量接入（tsx + `node:assert` 已够）
- `irRender.ts` / themes 全拆（本轮只抽 `exportTypes`；`svgCompile` 已在 P1 分离）

## 怎么跑回归

在 `ppt-agent-engine` 根目录：

```bash
corepack pnpm test:svg-regression
```

或：

```bash
corepack pnpm --filter @ppt-agent/ppt-renderer test
```

### 路径约定

- 脚本解析目录：`../references/svg2pptx-skill/examples/`（相对 `ppt-agent-engine`）
- 绝对示例：`/…/PPT-Agent/references/svg2pptx-skill/examples/`
- **references 不存在时**：脚本 `skip` 并以 **exit 0** 结束（可选 CI 友好）

### 断言口径

| 项 | 值 |
|----|-----|
| 入口 | `compileSvgPreviewToSlide`（不强制产品 `viewBox=0 0 1280 720`） |
| 阈值 | 每个 example `rendered >= 8` |
| 失败 | `parse_failed` 或不足对象 → assert 失败、非 0 exit |

> 说明：参考仓 example 的 viewBox 为 `2048×518` / `1999×550`，不是本仓产品门禁的 `1280×720`。产品路径仍走 `tryRenderSvgSlide`（含 viewBox + 硬门禁）；回归测的是**解析/walk 能力**，不是「正式导出必过门禁」。

## 覆盖的 example

| 文件 | 本机实测 rendered | 阈值 |
|------|-------------------|------|
| `filtration_demo.svg` | 35 | ≥ 8 |
| `support_structure_demo.svg` | 82 | ≥ 8 |

共 **2** 个 SVG（目录内另有同名 `.pptx`，不纳入本回归）。

## Typecheck / 测试结果

```text
cd packages/ppt-renderer
corepack pnpm typecheck   # exit 0
corepack pnpm test        # 2/2 OK
```

## 验收对照

| 项 | 状态 |
|----|------|
| 可测 SVG 编译入口导出 | 已完成（`compileSvgPreviewToSlide`） |
| examples 对照回归可跑 | 已完成（tsx 脚本） |
| P1 svgCompile 分离确认 | 已确认；本轮再抽 `exportTypes.ts` |
| 执行文档 | 本文 |
| 像素级 ppt-master 对比 | 明确不做 |

## 已知限制

1. 参考 example 坐标空间 ≠ 1280×720，回归对象落在 slide 上的几何会「偏」，只信 count。
2. 未覆盖本仓自产 `viewBox="0 0 1280 720"` fixture（可后续加 `fixtures/`）。
3. `index.ts` 主题/IR 大块仍在；下次有触碰 IR 时再抽 `irRender.ts`。
