# 执行文档：拉取 dashi-ppt-skill 参考仓（2026-07-17）

## 需求

把 [chuspeeism/dashi-ppt-skill](https://github.com/chuspeeism/dashi-ppt-skill) 拉到本仓库 `references/`，分析主题/颜色、生成与导出链路，以及对 `ppt-agent-engine` 的可借鉴点；写清 AGPL / 专有导出引擎边界。

## 方案与权重

| 方案 | 权重 | 决策 |
|------|------|------|
| A 浅克隆 + REFERENCE 分析文档 | ~90 | **执行** |
| B 只读网页不克隆 | ~30 | 否 |

## 已执行

1. 确认根 `.gitignore` 已有 `references/`（无需改业务代码）
2. `git clone --depth 1 https://github.com/chuspeeism/dashi-ppt-skill.git references/dashi-ppt-skill`
3. 阅读 README / SKILL.md / theme token / layout-manifest controls / export-pptx / html-deck-to-pptx 公开说明与 LICENSE
4. 撰写 `REFERENCE_dashi-ppt-skill.md`；更新 `00-architecture/README.md`、`references/README.md` 索引
5. `git check-ignore` 确认参考仓不被跟踪

## 未执行（有意不做）

- 不 commit
- 不把 AGPL 源码或专有 `html-deck-to-pptx` 并入 `ppt-agent-engine`
- 不改业务代码

## 验收

- [x] 本地路径 `references/dashi-ppt-skill/` 可读
- [x] 文档覆盖：结构、颜色、生成、导出、对比建议、合规
- [x] `references/` 仍被 gitignore
