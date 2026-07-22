# 经验：按阶段组织项目文档

## 场景

一天内并行多 Agent（架构 / P0 / P1 / P2 / 产品重设计）会在 `docs/` 根目录堆出大量 `EXECUTION_*`、`EXPERIENCE_*`。事后「按阶段 / 按天查做了什么」会很痛。

## 可复用做法

1. **阶段编号目录**：`00-architecture`、`01-p0-...`、`02-...`，数字前缀保证浏览排序即时间线。  
2. **根目录只留入口**：总 README + 一份完整 DESIGN + 运维类（MAINTENANCE）+ 本次整理的 EXECUTION/EXPERIENCE。  
3. **每阶段一份短 README**：写清「目标 / 文档清单 / 完成事项时间线」，细节仍链到 EXECUTION。  
4. **执行与经验同阶段存放**：不必再拆 `executions/` vs `experiences/`；文件名前缀已够区分。  
5. **移动后立刻 grep 旧路径**：`docs/EXECUTION_`、`docs/HYBRID_` 等，修 README 与代码注释里的死链。  
6. **未入库文件用 `mv`**：`git mv` 只对已跟踪文件有意义；untracked 直接 `mv` 即可。

## 注意

- 不要编辑用户的 `.cursor/plans/*.plan.md`；设计结论应沉淀到仓库 `docs/DESIGN_*.md`。  
- `archive/` 留给真正过时的碎片，日常文档优先进阶段目录，避免「第二个垃圾场」。  
- 跨阶段引用用相对路径（如 `../00-architecture/COMPILABLE_SVG.md`），避免写死仓库绝对路径。
