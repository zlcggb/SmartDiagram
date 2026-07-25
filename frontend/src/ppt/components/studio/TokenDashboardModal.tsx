import { useCallback, useEffect, useState } from "react";
import { AlertCircle, BarChart2, CheckCircle2, Clock3, RefreshCw, Zap, X } from "lucide-react";
import { useWorkbenchStore } from "../../store/workbenchStore";

function fmtNum(value: number): string {
  return value.toLocaleString("zh-CN");
}

function fmtCost(value: number, currency = "CNY"): string {
  const mark = currency === "CNY" ? "¥" : `${currency} `;
  return `${mark}${value.toFixed(4)}`;
}

function fmtDuration(value: number): string {
  if (value < 1000) return `${value} ms`;
  return `${(value / 1000).toFixed(1)} s`;
}

function fmtPercent(value: number): string {
  return `${value < 1 ? value.toFixed(2) : value.toFixed(1)}%`;
}

function fmtTime(value?: string): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

const stageNames: Record<string, string> = {
  extract_facts: "提取事实",
  outline: "生成大纲",
  plan: "生成初稿",
  ir: "结构渲染",
  svg: "SVG 设计",
  research: "资料研究",
  brief: "需求澄清",
};

export function TokenDashboardModal({ onClose }: { onClose: () => void }) {
  const summary = useWorkbenchStore((state) => state.aiUsageSummary);
  const refreshAiUsage = useWorkbenchStore((state) => state.refreshAiUsage);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      await refreshAiUsage();
    } finally {
      setLoading(false);
    }
  }, [refreshAiUsage]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const tokenUsage = summary?.tokenUsage;
  const inputTokens = tokenUsage?.promptTokens ?? 0;
  const outputTokens = tokenUsage?.completionTokens ?? 0;
  const totalTokens = tokenUsage?.totalTokens ?? summary?.totalTokens ?? 0;
  const cachedTokens = summary?.cachedTokens ?? 0;
  const reasoningTokens = summary?.reasoningTokens ?? 0;
  const runCount = summary?.projectRunCount ?? 0;
  const estimatedCost = summary?.estimatedCost ?? 0;
  const currency = summary?.currency ?? "CNY";
  const events = summary?.events ?? [];
  const failedCount = events.filter((event) => event.status === "failed").length;
  const monthlyUsedTokens = summary?.monthlyUsedTokens ?? 0;
  const monthlyRemainingTokens = summary?.monthlyRemainingTokens ?? 0;
  const monthlyUsedPercent = summary?.monthlyUsedPercent ?? 0;
  const monthlyRemainingPercent = summary?.monthlyRemainingPercent ?? 0;
  const quotaColor = monthlyUsedPercent >= 90 ? "#ef4444" : monthlyUsedPercent >= 70 ? "#f59e0b" : "#22c55e";
  // 弹窗是聚合视图，副标题列出本项目真实调用过的所有模型（去重），比单个主模型更准确。
  const usedModels = Array.from(
    new Set(events.map((event) => event.model).filter((name) => name && name !== "unknown")),
  );
  const headerModel = usedModels.length > 0 ? usedModels.join(" · ") : (summary?.model ?? "AI");

  const Stat = ({ label, value, sub }: { label: string; value: string; sub?: string }) => (
    <div style={{ minWidth: 0, padding: "14px 16px", borderRadius: 12, background: "#fff", border: "1px solid #e5e7eb" }}>
      <div style={{ marginBottom: 6, fontSize: 11, color: "#6b7280", fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: "#111827", letterSpacing: "-0.02em" }}>{value}</div>
      {sub ? <div style={{ marginTop: 2, fontSize: 10, color: "#9ca3af" }}>{sub}</div> : null}
    </div>
  );

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 99999, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, backgroundColor: "rgba(0,0,0,0.5)", backdropFilter: "blur(12px)", boxSizing: "border-box" }}
      onClick={onClose}
    >
      <div
        style={{ width: "100%", maxWidth: 920, maxHeight: "90vh", display: "flex", flexDirection: "column", overflow: "hidden", borderRadius: 20, background: "#fff", border: "1px solid #e5e7eb", boxShadow: "0 20px 60px rgba(0,0,0,0.3)", color: "#111827", fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', system-ui, sans-serif" }}
        onClick={(event) => event.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 22px", borderBottom: "1px solid #f3f4f6" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 36, height: 36, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 10, background: "linear-gradient(135deg, #2563eb, #1d4ed8)", boxShadow: "0 2px 8px rgba(37,99,235,0.25)" }}>
              <BarChart2 style={{ width: 20, height: 20, color: "#fff" }} />
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>当前项目使用统计</h2>
              <p style={{ margin: 0, fontSize: 11, color: "#9ca3af" }}>{summary?.period ?? "当月"} · {headerModel}</p>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" onClick={() => void refresh()} disabled={loading} style={{ display: "flex", alignItems: "center", gap: 4, padding: "5px 10px", borderRadius: 8, background: "#f9fafb", border: "1px solid #e5e7eb", fontSize: 11, color: "#6b7280", cursor: loading ? "wait" : "pointer" }}>
              <RefreshCw style={{ width: 12, height: 12 }} className={loading ? "animate-spin" : ""} />刷新
            </button>
            <button type="button" onClick={onClose} aria-label="关闭" style={{ width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 8, background: "#f9fafb", border: "1px solid #e5e7eb", color: "#6b7280", cursor: "pointer" }}>
              <X style={{ width: 16, height: 16 }} />
            </button>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "20px 22px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, padding: "18px 22px", borderRadius: 16, color: "#fff", background: "linear-gradient(135deg, #0f172a, #1e293b)" }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#93c5fd", fontWeight: 600 }}><Zap style={{ width: 13, height: 13 }} />当前项目消耗 Tokens</div>
              <div style={{ marginTop: 4, fontSize: 30, fontWeight: 800, letterSpacing: "-0.03em" }}>{fmtNum(totalTokens)}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 11, color: "#94a3b8" }}>当前项目预估费用</div>
              <div style={{ marginTop: 2, fontSize: 22, fontWeight: 700, color: "#34d399" }}>{fmtCost(estimatedCost, currency)}</div>
              <div style={{ fontSize: 10, color: "#cbd5e1" }}>{runCount} 次模型调用</div>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10, marginBottom: 16 }}>
            <Stat label="输入 Input" value={fmtNum(inputTokens)} sub={`${(inputTokens / 1_000_000).toFixed(3)} M`} />
            <Stat label="输出 Output" value={fmtNum(outputTokens)} sub={`${(outputTokens / 1_000_000).toFixed(3)} M`} />
            <Stat label="缓存 Cache" value={fmtNum(cachedTokens)} sub={`推理 ${fmtNum(reasoningTokens)} Tokens`} />
          </div>

          {summary?.usageError ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, padding: "10px 12px", borderRadius: 10, background: "#fff7ed", border: "1px solid #fed7aa", color: "#9a3412", fontSize: 12 }}>
              <AlertCircle style={{ width: 15, height: 15, flexShrink: 0 }} />{summary.usageError}
            </div>
          ) : null}
          {(summary?.unpricedCount ?? 0) > 0 ? (
            <div style={{ marginBottom: 16, padding: "10px 12px", borderRadius: 10, background: "#fffbeb", border: "1px solid #fde68a", color: "#92400e", fontSize: 12 }}>
              有 {summary?.unpricedCount} 次调用尚未配置服务端价格，相关费用暂记为 0。
            </div>
          ) : null}

          <div style={{ overflow: "hidden", borderRadius: 14, border: "1px solid #e5e7eb" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", background: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#374151" }}>每次模型调用明细</span>
              <span style={{ fontSize: 11, color: "#9ca3af" }}>共 {runCount} 次{failedCount ? ` · ${failedCount} 次失败` : ""}</span>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", minWidth: 760, borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: "#f9fafb", color: "#6b7280" }}>
                    <th style={{ padding: "9px 14px", textAlign: "left" }}>时间</th>
                    <th style={{ padding: "9px 12px", textAlign: "left" }}>阶段 / 模型</th>
                    <th style={{ padding: "9px 12px", textAlign: "right" }}>Tokens</th>
                    <th style={{ padding: "9px 12px", textAlign: "right" }}>本次费用</th>
                    <th style={{ padding: "9px 14px", textAlign: "right" }}>状态 / 耗时</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((event) => (
                    <tr key={event.id} style={{ borderTop: "1px solid #f3f4f6" }}>
                      <td style={{ padding: "11px 14px", whiteSpace: "nowrap", color: "#6b7280" }}>{fmtTime(event.startedAt)}</td>
                      <td style={{ padding: "11px 12px", maxWidth: 260 }}>
                        <div style={{ fontWeight: 700, color: "#111827" }}>{stageNames[event.stage] ?? event.stage}</div>
                        <div style={{ marginTop: 2, color: "#6b7280", fontFamily: "monospace", fontSize: 11 }}>{event.model}</div>
                        {(event.errorMessage || event.outputSummary) ? <div title={event.errorMessage || event.outputSummary} style={{ marginTop: 3, maxWidth: 250, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: event.status === "failed" ? "#dc2626" : "#9ca3af", fontSize: 10 }}>{event.errorMessage || event.outputSummary}</div> : null}
                      </td>
                      <td style={{ padding: "11px 12px", textAlign: "right" }}>
                        <div style={{ fontWeight: 700, color: "#111827" }}>{fmtNum(event.totalTokens)}</div>
                        <div style={{ marginTop: 2, color: "#9ca3af", fontSize: 10 }}>入 {fmtNum(event.inputTokens)} · 出 {fmtNum(event.outputTokens)}{event.cachedTokens ? ` · 缓 ${fmtNum(event.cachedTokens)}` : ""}</div>
                      </td>
                      <td style={{ padding: "11px 12px", textAlign: "right", whiteSpace: "nowrap", fontWeight: 700, color: event.pricingSource === "unpriced" ? "#9ca3af" : "#059669" }}>{event.pricingSource === "unpriced" ? "未计价" : fmtCost(event.estimatedCost, event.currency)}</td>
                      <td style={{ padding: "11px 14px", textAlign: "right", whiteSpace: "nowrap" }}>
                        <div style={{ display: "inline-flex", alignItems: "center", gap: 4, color: event.status === "failed" ? "#dc2626" : "#16a34a", fontWeight: 600 }}>
                          {event.status === "failed" ? <AlertCircle style={{ width: 13, height: 13 }} /> : <CheckCircle2 style={{ width: 13, height: 13 }} />}
                          {event.status === "failed" ? "失败" : "成功"}
                        </div>
                        <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 3, marginTop: 3, color: "#9ca3af", fontSize: 10 }}><Clock3 style={{ width: 10, height: 10 }} />{fmtDuration(event.durationMs)}</div>
                      </td>
                    </tr>
                  ))}
                  {!loading && events.length === 0 ? (
                    <tr><td colSpan={5} style={{ padding: "30px 16px", textAlign: "center", color: "#9ca3af" }}>{summary?.usageError ?? "当前项目本月还没有已记录的模型调用"}</td></tr>
                  ) : null}
                  {loading && events.length === 0 ? (
                    <tr><td colSpan={5} style={{ padding: "30px 16px", textAlign: "center", color: "#9ca3af" }}>正在读取调用明细…</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 24, padding: "12px 22px 14px", borderTop: "1px solid #f3f4f6", color: "#6b7280", fontSize: 11 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {summary?.limitTokens ? (
              <>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, marginBottom: 7 }}>
                  <strong style={{ color: "#374151" }}>本月 Token 使用量</strong>
                  <span>月限额 {fmtNum(summary.limitTokens)} · 硬限流{summary.isHardLimit ? "已开启" : "关闭"}</span>
                </div>
                <div style={{ height: 6, overflow: "hidden", borderRadius: 999, background: "#eef0f3" }}>
                  <div style={{ width: `${monthlyUsedPercent}%`, height: "100%", borderRadius: 999, background: quotaColor, transition: "width 0.25s ease" }} />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 16, marginTop: 7 }}>
                  <span>已使用 <strong style={{ color: "#374151" }}>{fmtNum(monthlyUsedTokens)}</strong> Tokens（{fmtPercent(monthlyUsedPercent)}）</span>
                  <span>剩余 <strong style={{ color: "#059669" }}>{fmtNum(monthlyRemainingTokens)}</strong> Tokens（{fmtPercent(monthlyRemainingPercent)}）</span>
                </div>
              </>
            ) : <span>尚未配置账户月度 Token 限额</span>}
          </div>
          <button type="button" onClick={onClose} style={{ padding: "5px 14px", borderRadius: 8, background: "#111827", color: "#fff", border: "none", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>关闭</button>
        </div>
      </div>
    </div>
  );
}
