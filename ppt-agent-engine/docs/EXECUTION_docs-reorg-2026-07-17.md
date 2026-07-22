# 执行文档：docs 按阶段重组（2026-07-17）

## 需求分析

1. 写一份**完整设计文稿**（文章式工作室 + Hybrid 导出总览），对齐已实现代码。  
2. 整理现有 EXECUTION / EXPERIENCE / 架构类文档，按阶段分目录，便于按「每天 / 每阶段做了什么」查阅。  
3. 不改业务代码（仅修正明显死链）；不编辑 `.cursor/plans/...`；不创建 git commit。

## 方案对比与选型

| 方案 | 做法 | 权重 |
|------|------|------|
| **A. 阶段目录 + 根入口设计文稿**（选用） | `00`–`04` 分目录；根保留 README + DESIGN；各阶段 README 写时间线 | **90** |
| B. 仅按文件名前缀扁平索引 | 根目录加 INDEX，文件不移动 | 45 |

选用 **A**：查阅路径短、阶段边界清晰；历史文档多为 untracked，用 `mv` 即可（`git mv` 因未入库不可用）。

## 已执行动作

### 1. 目录创建

```text
docs/
  00-architecture/
  01-p0-export-mode/
  02-p1-svg-strategy/
  03-p2-grade-usage/
  04-article-studio-redesign/
  archive/          # 占位，当前无归档碎片
  prd/              # 保留不动
```

### 2. 文件归类（mv）

| 目标目录 | 迁入内容 |
|----------|----------|
| `00-architecture/` | ARCHITECTURE_*、HYBRID_*、COMPILABLE_*、OPTIMIZATION_*、REFERENCE_*、相关 EXPERIENCE、EXECUTION_reference-clone |
| `01-p0-export-mode/` | EXECUTION_p0-*、EXPERIENCE_p0-* |
| `02-p1-svg-strategy/` | EXECUTION_p1-*、EXPERIENCE_p1-* |
| `03-p2-grade-usage/` | EXECUTION_p2-*、EXPERIENCE_p2-* |
| `04-article-studio-redesign/` | EXECUTION_article-*、EXPERIENCE_article-*、SEARCH_ADAPTER.md |
| 根目录保留 | MAINTENANCE.md、GIT_SETUP.md、prd/ |

### 3. 新增文档

| 文件 | 说明 |
|------|------|
| `DESIGN_文章式PPT_Agent工作室.md` | 完整设计说明 |
| `README.md` | 文档总入口 + 时间线 |
| `00`–`04` 各 `README.md` | 阶段目标、清单、时间线 |
| `EXPERIENCE_docs-phased-organization.md` | 整理经验 |
| 本文 | 执行记录 |

### 4. 死链修复

- 仓库根 `README.md`：`REFERENCE_svg2pptx_analysis` → `docs/00-architecture/...`
- `ppt-agent-engine/README.md`：补充文档中心入口
- 阶段内相对链接（prd、跨文档路径、integration 交叉引用）
- `svg-compile-regression.ts` 提示路径 → `docs/03-p2-grade-usage/EXECUTION_p2-engineering.md`
- `OPTIMIZATION_PLAN.md` 内 `prd/`、上层 README 相对路径

## 验证

- [x] `docs/` 下无大量扁平 EXECUTION_/EXPERIENCE_ 堆积  
- [x] 根有 DESIGN + README  
- [x] 各阶段有 README 时间线  
- [x] prd/ 仍在  
- [x] grep 旧路径后修正明显外链  

## 未做

- 未改 `.cursor/plans/`  
- 未 commit  
- 未改业务逻辑（仅文档路径提示字符串）
