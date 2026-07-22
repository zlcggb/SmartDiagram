# 执行文档：拉取 SVG→PPTX 参考项目（2026-07-17）

## 需求

评估是否将 ppt-master、svg2pptx-skill 拉取到当前目录作为参考，并做分析。

## 方案与权重

| 方案 | 权重 | 决策 |
|------|------|------|
| A 完整双仓入库 | 35 | 否 |
| B references 浅克隆 + gitignore + 对照文档 | 88 | **执行** |

## 已执行

1. 创建 `references/`
2. `git clone --depth 1` → `references/svg2pptx-skill`
3. `git clone --depth 1 --filter=blob:none --sparse` → `references/ppt-master`（以 docs 为主）
4. 根 `.gitignore` 增加 `references/`
5. 撰写  
   - `references/README.md`  
   - `ppt-agent-engine/docs/00-architecture/REFERENCE_svg2pptx_analysis.md`

## 未执行（有意不做）

- 不把参考仓加入 git 跟踪
- 不把 Python 转换器并入 `ppt-agent-engine` 依赖
- 不完整拉取 ppt-master 示例 deck（体积大、与 skill 重复）

## 验收

- [x] 本地可浏览 skill 源码与 examples
- [x] 本地可浏览 ppt-master 映射/设计文档
- [x] 主仓 git status 不会把 references 当未跟踪业务代码误提交（已 ignore）
