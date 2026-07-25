# 经验：FSD / 目录迁移后的 Import 修复

## 何时复用

- 大范围移动 `apps/*/src` 文件后出现成片 `Cannot find module`
- 新旧目录并存（例如同时有 `components/` 与 `features/`）
- AI 或脚本做过“全局替换”，但应用仍无法 typecheck

## 正确顺序

1. `find` / `tsc` 先看**文件真实落点**与**高频 missing module**
2. 选定目标架构（业务进 `features/`，无业务进 `shared/`）
3. 先搬文件，再写**基于真实路径的映射脚本**
4. 跑 `tsc`，对剩余错误手工修（类型契约、同名页面等）
5. 写执行文档，避免下次再半迁移

## 高危坑

| 坑 | 表现 | 规避 |
|----|------|------|
| 同名页面被全局替换 | 平台首页变成 PPT 首页 | 平台/业务 HomePage 分路径，禁止一条规则打天下 |
| re-export 被改成自引用 | `auth.ts` export 自己 | 映射表不要改写 shim 自身的实现路径 |
| 只改 src 不改 package dist | web 仍读旧 `.d.ts` | 同步 `packages/*/dist` 或正式 rebuild |
| 把某一业务叫“核心” | 后续模块难挂载 | 模块平级 + `modules/registry` |

## 最小验证

```bash
cd apps/web && ./node_modules/.bin/tsc -p tsconfig.app.json --noEmit
```
