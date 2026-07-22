# EXECUTION：Variant 真实坐标骨架文件（2026-07-18）

## 0. 需求摘要

在精选版式变体库之上，把每个 variant **落成 1280×720 坐标骨架 JSON**，生成链路改为「选 variant → 锁几何 → 填槽」，逼近 dashi 的 layout+props，资产仍自研。

---

## 1. 方案对比与选型

| 方案 | 做法 | 影响面 | 风险 | 工期 | 权重(1-10) | 决策 |
|------|------|--------|------|------|------------|------|
| **A. JSON 骨架文件 + fill/snap（选用）** | `frames/<variantId>.json` 为唯一真相；`fillSkeleton` / `snapIrToSkeleton`；IR 提示词注入几何 | shared / agents | 低 | 0.5 天 | **9** | **执行** |
| B. 仅在 prompt 写死坐标串 | 无资产文件、难维护 | agents | 中：漂移 | 短 | **4** | 否 |

---

## 2. 已执行

### 2.1 资产

- `packages/shared/src/skeletons/frames/*.json`：**34** 个变体帧（与 `layoutVariants` id 对齐）
- 每帧：`variantId` / `canvas` / `recommendedLayout` / `lockGeometry` / `elements[]`（含 `slot` + x/y/w/h/z）

### 2.2 运行时

- `getSkeletonFrame` / `fillSkeletonFrame` / `slotsFromSlide` / `buildIrFromSkeleton` / `snapIrToSkeleton`
- `formatSkeletonGeometryInstruction` 注入 Plan/IR/SVG 提示词
- `normalizeSlideIr`：有骨架则 **吸附几何**（保留 LLM content）
- `fallbackIr`：优先 `buildIrFromSkeleton` 纯填槽

### 2.3 Agents

- `slideIrSystemPrompt`：锁骨架填文案硬规则
- `buildSlideIrPrompt`：下发完整骨架模板 JSON（content 留空）

---

## 3. 验证

```bash
corepack pnpm --filter @ppt-agent/shared typecheck
corepack pnpm --filter @ppt-agent/agents typecheck
corepack pnpm --filter @ppt-agent/ppt-renderer typecheck
corepack pnpm --filter @ppt-agent/api typecheck
corepack pnpm --filter @ppt-agent/web typecheck
```

均通过（2026-07-18）。

---

## 4. 改动文件清单

| 路径 | 变更 |
|------|------|
| `packages/shared/src/skeletons/frames/*.json` | **新增** 34 坐标帧 |
| `packages/shared/src/skeletons/{types,fill,registry,index,README}.ts/md` | 加载 / 填槽 / 吸附 |
| `packages/shared/src/index.ts` | 导出 |
| `packages/shared/tsconfig.json` | include JSON |
| `packages/agents/src/prompts.ts` | 骨架注入 |
| `packages/agents/src/realGeminiAdapter.ts` | snap + skeleton fallback |
| `packages/agents/src/openaiCompatibleAdapter.ts` | normalize 传 theme |

---

## 5. 后续

- Slide 持久化 `layoutVariantId`
- 骨架坐标可视化预览（Studio）
- 按 ThemePack token 给骨架默认 style.fill（仍锁几何）
