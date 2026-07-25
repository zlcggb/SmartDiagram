# FSD 架构收口与 Import 修复 — 执行文档

日期：2026-07-25  
范围：`apps/web` 前端目录整理 + 破损 import 修复；后端服务命名沿用已完成的 `api-diagram` / `api-ppt` / `service-ppt-renderer`。

## 1. 需求结论

上一轮半迁移把文件挪进了 `features/` / `shared/`，但：

- 真实文件位置与 import 期望路径不一致（约 70+ `Cannot find module`）
- 旧目录（`store/`、`lib/`、`components/layout`）与新目录并存
- 图表业务被表述成“平台核心”，不符合“每个业务模块平级、按业务边界拆分”的目标

目标：模块边界清晰（diagram / ppt / profile 平级），应用能重新 typecheck。

## 2. 方案对比与选型

| 方案 | 做法 | 架构清晰 | AI 友好 | 风险 | 速度 | 综合 |
|------|------|----------|---------|------|------|------|
| A. 兼容层 shim | 在旧路径放 re-export，少搬文件 | 4 | 5 | 低 | 高 | **6.5** |
| B. 收口 FSD + 真实映射修 import（选定） | 业务文件进 `features/*`，再按真实落点批量修 import | 9 | 9 | 中 | 中 | **8.0** |

选定 **B**：与“每个模块按业务逻辑独立文件夹”一致，后续加新模块（如文档 / 白板）只需加 `features/<name>` + `modules/registry` + 路由。

## 3. 目标目录蓝图（apps/web/src）

```text
app/                 # 入口、路由、i18n、全局 CSS
pages/               # 薄页面拼装（平台桌面、diagram 挂载点）
modules/             # 模块注册表（导航/首页共用，新增模块只改这里）
features/
  diagram/           # 图表业务（思维导图只是其中一种引擎，不是平台核心）
    model/           # chatStore、diagramHistory
    ui/              # canvas / chat / layout
  ppt/               # PPT 业务（components / hooks / lib / pages / store）
  profile/           # 用户画像窗口
shared/              # 无业务逻辑：hooks、lib、store(auth/desktop)、ui(shell/settings)
components/          # 过渡区：auth / brand / common / ops（后续可再收进 shared/ui）
types/               # 跨模块类型
```

后端（已对齐）：

- `apps/api-diagram` — 图表 Python API
- `apps/api-ppt` — PPT Agent Python API
- `apps/service-ppt-renderer` — PPTX 渲染微服务（内部）

## 4. 已执行步骤

1. **物理收口**
   - `store/chatStore.ts` → `features/diagram/model/chatStore.ts`
   - `lib/diagramHistory.ts` → `features/diagram/model/diagramHistory.ts`
   - `components/layout/{CanvasPanel,MobileTabBar}.tsx` → `features/diagram/ui/layout/`
   - `store/desktopStore.test.ts` → `shared/store/`
2. **稳定导出**
   - `shared/store/auth.ts` → re-export `shared/lib/config/auth`
   - `shared/ui/useRecentWork.ts` → re-export shell 内 hook
3. **一键修 import**：`apps/web/scripts/fix_fsd_imports.cjs`（按真实文件映射，禁止盲替换平台 HomePage）
4. **模块语义**
   - `modules/registry`：`思维导图` → `智能图表`，说明与 PPT 平级
   - 路由注释：diagram 是 feature，不是核心壳
5. **PPT IR 类型对齐**：`@ppt-agent/shared` 补齐 `ir`/`hybrid`、`irJson`、`SlideIrDto`（src + dist）
6. **验证**：`tsc -p tsconfig.app.json --noEmit` 与 `tsc -b` 均 **0 error**

## 5. 验证命令

```bash
cd apps/web
./node_modules/.bin/tsc -p tsconfig.app.json --noEmit
./node_modules/.bin/tsc -b
# 可选
pnpm --filter @smartdiagram/web build
```

## 6. 后续建议（未做，避免扩大范围）

1. 把 `components/{auth,brand,common,ops}` 收进 `shared/ui/*`，删掉过渡目录
2. 新模块模板：`features/<name>/{model,ui,api}` + registry + `/route`
3. 修好后重跑 `packages/shared` 正式 `pnpm build`（需已补的 `tsconfig.base.json`），避免手改 dist
4. `package.json` 的 `test:shell` 路径已更新，建议本地跑一遍确认

## 7. 经验（可复用）

- **先核对真实文件树，再写映射脚本**；半迁移最危险的是“目录看起来像 FSD，import 仍指向旧相对路径”。
- **禁止全局替换页面同名组件**（平台 `pages/home/HomePage` ≠ PPT `features/ppt/pages/HomePage`）。
- **re-export 文件不要被脚本改成自引用**（`shared/store/auth.ts` 曾被改成 `export * from '@/shared/store/auth'`）。
- 图表不要命名/宣传成“核心”；在 monorepo + 多模块产品里，**feature 平级**对 AI 检索和人类 onboarding 都更稳。
