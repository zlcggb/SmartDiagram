# Human Approval Checkpoints Plan

**Goal:** 将 Agent 的 `needs_user_input` 状态从“停止并提示”升级为可审计、可查询、可决策的企业人工确认闭环。

## Scope

适用场景：

- Consistency Agent 发现生成结果与企业知识显式约束冲突。
- 高风险工具调用或业务 API 写入前需要人工确认。
- 外发导出、敏感知识引用、越权风险需要用户或管理员审批。

## Data Model

新增 `human_approval_requests`：

```text
tenant_id
project_id
conversation_id
agent_run_id
approval_type
status: pending / approved / rejected / expired
required_scope
reason
resource_json
decision_json
requested_by
decided_by
created_at
decided_at
expires_at
```

## API

```text
POST /api/approvals
GET  /api/approvals
GET  /api/approvals/{approval_id}
POST /api/approvals/{approval_id}/decision
```

## Execution Update - 2026-05-26

Implemented:

- Added `HumanApprovalRequest` persistence model.
- Added `human_approval_service` with create, list, get, approve, and reject operations.
- Added `routes_approvals` behind `approval:read` and `approval:write` scopes plus project access checks.
- Chat stream now creates a durable approval request when Consistency Agent stops on explicit knowledge conflicts, then emits `human_approval_required`.
- Frontend chat messages now render a Human Approval card with approve/reject actions.
- Approval decisions write `human.approval.decided` audit events.
- `smoke:enterprise` verifies approval creation, lookup, approval decision, outsider denial, and audit visibility.
