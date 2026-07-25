# Layout Skeleton Frames

自研版式变体的 **1280×720 坐标骨架**。每个 `frames/<variantId>.json` 对应一个 `layoutVariants` id。

## 契约

| 字段 | 说明 |
|------|------|
| `variantId` | 与 `layoutVariants[].id` 一致 |
| `lockGeometry` | `true` 时 IR 归一化会吸附坐标 |
| `elements[].slot` | 填槽路径（如 `claim`、`metrics.0`） |
| `elements[].x/y/w/h/z` | 画布像素坐标，生成侧不得改 |

## 流程

```text
pickDefaultVariant → getSkeletonFrame →
  Plan/IR/SVG 提示词注入几何
  normalizeSlideIr → snapIrToSkeleton
  fallbackIr → buildIrFromSkeleton（纯填槽）
```

## 新增骨架

1. 在 `layoutVariants.ts` 增加变体元数据  
2. 新增 `frames/<id>.json`  
3. 重跑 registry 生成（或手改 `registry.ts` import）  

```bash
# 从仓库根 ppt-agent-engine 下，用既有 node 脚本模式重写 registry
node --input-type=module -e "/* 见 EXECUTION 文档 */"
```

勿从外部 AGPL 版式库复制组件源码；只维护自研坐标帧。
