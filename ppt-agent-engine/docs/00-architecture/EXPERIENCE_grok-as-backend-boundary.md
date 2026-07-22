# EXPERIENCE · 把编码 Agent「当后端」时的边界

## 场景

看到 grok-build / Cursor Agent / Claude Code 一类完整编排后，产品侧会问：「能不能直接当后端用？」

## 判断清单

1. **任务面**：固定阶段图 vs 开放 tool-loop？错配则不要主路径依赖。  
2. **语言边界**：跨语言只能 sidecar，不能「import crate」。  
3. **产出契约**：需要 schema（JSON/IR/SVG）还是自然语言摘要？后者接不上 ORM。  
4. **认证与模型**：是否已有自有网关双模型？再绑 CLI 登录成本通常不值。  
5. **要的是语义还是壳**：Primary/Subagent/wait_all/hooks 名 → 可同构；TUI/ACP/sandbox → 别嵌。

## 推荐模式

```text
业务 API ──► OrchestrationBackend 端口
                 ├─ native（默认，产品）
                 └─ external sidecar（实验，外围）
```

- **默认 native**：自研 fan-out + 阶段角色即可覆盖「完整编排」的产品语义。  
- **sidecar**：仅当明确需要「开放探索 / 外部脚本」时再接线；用 env 开关，未接线时必须可降级。  
- **禁止**：半集成 spawn（扣费、沙箱、输出漂移）却假装已生产可用。

## 可复用 / 不可 copy

| 可复用（思想或命名） | 不可直接 copy |
|----------------------|---------------|
| Primary / Subagent 角色 | Rust 运行时 crates |
| wait_all + 并发上限 | 编码工具（edit/shell）当 PPT 生成器 |
| SubagentStart/Stop 等 hook 名 | 整仓当 npm/git submodule 依赖 |
| persona 行为叠加（提示词层） | ACP 会话状态机整迁 |

## 一句话

**编排能力用端口承接；编码 Agent 运行时最多 sidecar，且不要占产品主路径。**
