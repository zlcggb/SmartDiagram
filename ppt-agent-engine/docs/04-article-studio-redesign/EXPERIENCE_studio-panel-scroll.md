# EXPERIENCE · 工作台多栏：有 overflow 不等于会滚

## 何时复用

- Studio / 工作台三栏布局
- AI 生成长列表、卡片墙、日志流
- 中间主区写了 `overflow-y-auto` 但整页仍在滚

## 根因

`overflow-y: auto` **只有在容器高度被限制时**才会出现滚动条。  
容器高度随内容增长时，overflow 永远不触发，浏览器只能滚 `document`。

常见漏网：

1. 只写了 `overflow-y-auto`，没写 `max-height` / 固定 `height`
2. Grid/Flex 子项默认 `min-height: auto`，子项无法小于内容高度 → 必须 `min-h-0`
3. 父级只有 `max-height`、没有明确高度时，子级 `h-full` / `max-h-full` 可能算不出来

## 推荐套路

1. **大屏**：给整行工作区定高，例如 `lg:h-[calc(100dvh-顶栏预算)]`
2. **子栏**：`min-h-0` + `h-full` + `overflow-y-auto`
3. **主 CTA**（进入下一步）：放在滚动容器内用 `sticky bottom-0`，避免滚到结果末尾才看见按钮
4. **移动端**：可退回各栏独立 `max-h-[50vh|70vh]`，不必强行三列等高

## 反模式

- 用整页滚动承载「栏内任务流」
- 把「完成 / 下一步」按钮放在长内容最底部且不 sticky
- 左右栏限高、中间栏不限高（视觉与交互不一致）
