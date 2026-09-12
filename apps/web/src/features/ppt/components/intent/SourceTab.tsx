import { useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  AlertCircle,
  ArrowRight,
  Check,
  ClipboardPaste,
  Compass,
  FileText,
  Files,
  Layers,
  Loader2,
  Pencil,
  RefreshCw,
  Send,
  Sparkles,
  Trash2,
  Upload,
  X
} from "lucide-react";
import type { FactDto, FactStatus } from "@ppt-agent/shared";
import { useWorkbenchStore } from '@/features/ppt/store/workbenchStore';
import { api } from "../../lib/api";
import { MaterialUploader } from "../materials/MaterialUploader";
import { MATERIAL_ACCEPT, type MaterialUploadItem } from "../materials/materialUploadModel";
import { useMaterialUploads } from "../materials/useMaterialUploads";
import { canContinueFromSource } from "./intentFlow";
import {
  convertProposalToQualityFacts,
  type ConsultantChapter,
  type ConsultantChatMessage,
  type ConsultantProposal,
  type ConsultantTakeaway
} from "./consultantConsultationModel";

function statusLabel(status: FactStatus) {
  if (status === "confirmed") return "已确认";
  if (status === "suggestion") return "建议";
  return "待确认";
}

export function SourceTab() {
  const [, setSearchParams] = useSearchParams();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  const sourceText = useWorkbenchStore((s) => s.sourceText);
  const setSourceText = useWorkbenchStore((s) => s.setSourceText);
  const loadDemoSource = useWorkbenchStore((s) => s.loadDemoSource);
  const facts = useWorkbenchStore((s) => s.facts);
  const updateFact = useWorkbenchStore((s) => s.updateFact);
  const deleteFact = useWorkbenchStore((s) => s.deleteFact);
  const busy = useWorkbenchStore((s) => s.busy);
  const project = useWorkbenchStore((s) => s.project);
  const materials = useWorkbenchStore((s) => s.materials);
  const loadMaterials = useWorkbenchStore((s) => s.loadMaterials);
  const uploadMaterial = useWorkbenchStore((s) => s.uploadMaterial);
  const deleteMaterial = useWorkbenchStore((s) => s.deleteMaterial);

  // 顾问推导方案状态（完全由真实大模型 API 驱动）
  const [proposal, setProposal] = useState<ConsultantProposal | null>(null);
  const [viewMode, setViewMode] = useState<"proposal" | "facts">("proposal");
  const [userChatInput, setUserChatInput] = useState("");
  const [isConsulting, setIsConsulting] = useState(false);
  const [consultingStage, setConsultingStage] = useState("");
  const [consultantError, setConsultantError] = useState<string | null>(null);

  // 编辑观点
  const [editingTakeawayId, setEditingTakeawayId] = useState<string | null>(null);
  const [editingTakeawayContent, setEditingTakeawayContent] = useState("");

  // 底层事实单项编辑
  const [editingFactId, setEditingFactId] = useState<string | null>(null);
  const [editingFactContent, setEditingFactContent] = useState("");

  const projectId = project?.id;
  const {
    items: materialItems,
    selectionErrors,
    isUploading,
    hasProcessing,
    hasBlockingErrors,
    addFiles,
    retryItem,
    removeItem
  } = useMaterialUploads({
    projectId,
    initialMaterials: materials,
    autoUpload: true,
    uploadFile: uploadMaterial,
    deleteFile: deleteMaterial
  });

  const shouldPollMaterials = materials.some(
    (material) => material.status === "uploading" || material.status === "processing"
  );

  // 轮询上传中或解析中的资料状态
  const pollTimerRef = useRef<number | undefined>(undefined);
  useMemo(() => {
    if (!projectId || !shouldPollMaterials) {
      if (pollTimerRef.current !== undefined) {
        window.clearTimeout(pollTimerRef.current);
        pollTimerRef.current = undefined;
      }
      return;
    }
    const poll = async () => {
      await loadMaterials(projectId);
      pollTimerRef.current = window.setTimeout(() => void poll(), 2500);
    };
    pollTimerRef.current = window.setTimeout(() => void poll(), 2500);
  }, [loadMaterials, projectId, shouldPollMaterials]);

  const selectedFactCount = useMemo(() => facts.filter((fact: FactDto) => fact.canUseInPpt).length, [facts]);
  const readyMaterialCount = materialItems.filter((material: MaterialUploadItem) => material.status === "ready").length;
  const canExtract =
    (sourceText.trim().length >= 10 || readyMaterialCount > 0) &&
    !busy &&
    !hasProcessing &&
    !hasBlockingErrors;
  const canContinue = canContinueFromSource(facts) || Boolean(proposal && proposal.takeaways.some((t: ConsultantTakeaway) => t.selected));

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    await addFiles(Array.from(files));
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  // 触发顾问研读与架构推导（真实大模型实时调用）
  async function handleConsultantAnalyze() {
    if (!projectId) return;
    setIsConsulting(true);
    setConsultantError(null);
    setConsultingStage("AI 顾问正在深度研读背景资料与受众诉求...");

    try {
      const readyMaterialIds = materialItems
        .filter((m: MaterialUploadItem) => m.status === "ready" && Boolean(m.materialId))
        .map((m: MaterialUploadItem) => m.materialId as string);

      setConsultingStage("大模型正在实时提炼核心立论与篇章故事线...");
      const res = await api.proposeConsultantStructure(projectId, {
        sourceText: sourceText.trim(),
        materialIds: readyMaterialIds
      });

      if (res && res.takeaways?.length > 0) {
        setProposal({
          takeaways: res.takeaways.map((t: { id: string; title: string; content: string; category: string }) => ({ ...t, selected: true })),
          chapters: res.chapters || [],
          dialogue: [
            {
              id: `msg-${Date.now()}`,
              role: "consultant",
              text: res.consultantGreeting || "AI 顾问已针对您的材料完成架构与立论深度研读。",
              time: "刚刚"
            }
          ],
          quickActions: res.quickActions || []
        });
        // 刷新项目，使后端大模型沉淀的高质量事实在底层事实列表中同步可见
        await loadMaterials(projectId);
      }
      setViewMode("proposal");
    } catch (err: unknown) {
      console.error("API 顾问推导失败:", err);
      const message = err instanceof Error ? err.message : "大模型顾问研读失败，请检查服务后重试";
      setConsultantError(message);
    } finally {
      setIsConsulting(false);
      setConsultingStage("");
    }
  }

  // 顾问对话微调指令（真实大模型实时交互）
  async function handleSendInstruction(text?: string) {
    const instruction = (text ?? userChatInput).trim();
    if (!instruction || !proposal || !projectId || isConsulting) return;
    setUserChatInput("");
    setIsConsulting(true);
    setConsultantError(null);

    const nowTime = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const interimProposal: ConsultantProposal = {
      ...proposal,
      dialogue: [
        ...proposal.dialogue,
        {
          id: `user-${Date.now()}`,
          role: "user",
          text: instruction,
          time: nowTime
        }
      ]
    };
    setProposal(interimProposal);
    setTimeout(() => chatBottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);

    try {
      // 真实大模型协同微调
      const res = await api.adjustConsultantStructure(projectId, {
        instruction,
        currentProposal: {
          takeaways: proposal.takeaways.map((t: ConsultantTakeaway) => ({
            id: t.id,
            title: t.title,
            content: t.content,
            category: t.category
          })),
          chapters: proposal.chapters,
          consultantGreeting: "",
          quickActions: proposal.quickActions
        }
      });

      if (res && res.takeaways?.length > 0) {
        setProposal({
          takeaways: res.takeaways.map((t: { id: string; title: string; content: string; category: string }) => ({ ...t, selected: true })),
          chapters: res.chapters || [],
          dialogue: [
            ...interimProposal.dialogue,
            {
              id: `consultant-${Date.now()}`,
              role: "consultant",
              text: res.consultantGreeting || `已根据您的指令「${instruction}」动态优化架构与章节侧重。`,
              time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
            }
          ],
          quickActions: res.quickActions?.length ? res.quickActions : proposal.quickActions
        });
      }
    } catch (err: unknown) {
      console.error("API 顾问微调失败:", err);
      const message = err instanceof Error ? err.message : "微调请求异常，请稍后重试";
      setProposal({
        ...interimProposal,
        dialogue: [
          ...interimProposal.dialogue,
          {
            id: `err-${Date.now()}`,
            role: "consultant",
            text: `⚠️ 架构微调失败：${message}。`,
            time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
          }
        ]
      });
    } finally {
      setIsConsulting(false);
      setTimeout(() => chatBottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    }
  }

  // 观点编辑操作
  function toggleTakeaway(id: string) {
    if (!proposal) return;
    setProposal({
      ...proposal,
      takeaways: proposal.takeaways.map((t: ConsultantTakeaway) => (t.id === id ? { ...t, selected: !t.selected } : t))
    });
  }

  function startEditTakeaway(t: ConsultantTakeaway) {
    setEditingTakeawayId(t.id);
    setEditingTakeawayContent(t.content);
  }

  function saveEditTakeaway(id: string) {
    if (!proposal) return;
    setProposal({
      ...proposal,
      takeaways: proposal.takeaways.map((t: ConsultantTakeaway) =>
        t.id === id ? { ...t, content: editingTakeawayContent.trim() || t.content } : t
      )
    });
    setEditingTakeawayId(null);
  }

  function deleteTakeaway(id: string) {
    if (!proposal) return;
    setProposal({
      ...proposal,
      takeaways: proposal.takeaways.filter((t: ConsultantTakeaway) => t.id !== id)
    });
  }

  // 前往视觉模板步骤
  async function handleProceedToVisual() {
    if (!project) return;
    // 如果存在推导方案，将确认的核心立论与章节大纲作为高质量事实沉淀保存
    if (proposal) {
      const qualityFacts = convertProposalToQualityFacts(proposal, project.id);
      // 将核心立论与篇章大纲存入当前 store
      for (const qf of qualityFacts.slice(0, 6)) {
        // 避免重复存入相同内容
        const exists = facts.some((f) => f.content === qf.content);
        if (!exists) {
          try {
            await useWorkbenchStore.getState().updateFact?.(qf.content, qf as any);
          } catch {
            // ignore
          }
        }
      }
    }
    setSearchParams({ tab: "visual" });
  }

  // 事实单项编辑
  function beginFactEdit(fact: FactDto) {
    setEditingFactId(fact.id);
    setEditingFactContent(fact.content);
  }

  async function saveFactEdit(factId: string) {
    const content = editingFactContent.trim();
    if (!content) return;
    await updateFact(factId, { content });
    if (!useWorkbenchStore.getState().error) {
      setEditingFactId(null);
      setEditingFactContent("");
    }
  }

  async function setAllFacts(selected: boolean) {
    for (const fact of facts) {
      if (fact.canUseInPpt !== selected) {
        await updateFact(fact.id, { canUseInPpt: selected });
        if (useWorkbenchStore.getState().error) return;
      }
    }
  }

  return (
    <div className="source-workspace">
      <div className="source-workspace__grid">
        {/* 左侧：资料与背景输入区 */}
        <section className="source-material-card">
          <div className="source-panel-heading">
            <span>
              <ClipboardPaste />
            </span>
            <div>
              <h2>补充内容资料</h2>
              <p>粘贴文本或上传文档，AI 顾问将研读背景并对话推导大纲架构。</p>
            </div>
          </div>

          <textarea
            className="source-material-input"
            value={sourceText}
            onChange={(event) => setSourceText(event.target.value)}
            placeholder="粘贴文字想法、大纲初稿、报告、会议纪要或参考内容（如：普通英语可以看懂，口语差，想提升水平，让自己可以和外国人正常沟通...）"
          />

          <div className="source-upload-row">
            <input
              ref={fileInputRef}
              type="file"
              hidden
              multiple
              accept={MATERIAL_ACCEPT}
              onChange={(event) => void handleFiles(event.target.files)}
            />
            <button
              type="button"
              className="brief-secondary-action"
              disabled={Boolean(busy) || isUploading}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload />
              {isUploading ? "正在上传资料" : "上传资料"}
            </button>
            <button
              type="button"
              className="brief-secondary-action"
              disabled={Boolean(busy)}
              onClick={loadDemoSource}
            >
              <Files />
              载入示例
            </button>
            <span className="source-format-hint">
              PDF / Word / PPT / Excel / 文本 / 图片，最多 8 个，单文件 15 MB
            </span>
          </div>

          <MaterialUploader
            items={materialItems}
            selectionErrors={selectionErrors}
            onRetry={retryItem}
            onRemove={removeItem}
            className="source-material-uploader"
          />

          <div className="source-extract-action">
            <span>
              {sourceText.trim().length} 字 · {readyMaterialCount} 份资料
              {hasProcessing ? " · 等待资料解析" : ""}
              {hasBlockingErrors ? " · 请重试或移除失败资料" : ""}
            </span>
            <button
              type="button"
              className="brief-primary-action consultant-action-btn"
              disabled={!canExtract || isConsulting}
              onClick={() => void handleConsultantAnalyze()}
            >
              {isConsulting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {consultingStage || "大模型正在研读推导..."}
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  {proposal ? "✦ 重新研读并推导架构" : "✦ 顾问研读与架构推导"}
                </>
              )}
            </button>
          </div>
        </section>

        {/* 右侧：顾问工作台（核心立论 + 篇章大纲预览 + 对话式微调） */}
        <section className="source-facts-card consultant-workspace-card">
          <div className="consultant-panel-top">
            <div className="source-panel-heading source-panel-heading--facts">
              <span>
                <Compass />
              </span>
              <div>
                <h2>AI 顾问架构协同</h2>
                <p>提炼核心立论与篇章故事线；支持对话式实时微调架构与侧重点。</p>
              </div>
            </div>

            {/* 模式切换胶囊 */}
            <div className="consultant-view-switch">
              <button
                type="button"
                className={`switch-tab-btn ${viewMode === "proposal" ? "is-active" : ""}`}
                onClick={() => setViewMode("proposal")}
              >
                <Sparkles className="h-3.5 w-3.5" />
                架构与立论
              </button>
              <button
                type="button"
                className={`switch-tab-btn ${viewMode === "facts" ? "is-active" : ""}`}
                onClick={() => setViewMode("facts")}
              >
                <Layers className="h-3.5 w-3.5" />
                引用事实明细 ({facts.length})
              </button>
            </div>
          </div>

          {/* 视图 1：顾问提炼架构与对话交互 */}
          {viewMode === "proposal" ? (
            <div className="consultant-content-scroll">
              {!proposal ? (
                <div className="consultant-empty-state">
                  <Compass className="h-10 w-10 text-brand" />
                  <strong>AI 顾问准备就绪</strong>
                  <p>
                    {project?.topic || project?.name
                      ? `针对课题「${project.topic || project.name}」，AI 大模型将深度研读输入材料，提炼核心立论、规划递进篇章并支持交互协同微调。`
                      : "在左侧补充你的想法背景或上传参考资料，顾问将为你深度提炼核心立论、构建大纲架构并支持互动微调。"}
                  </p>

                  {consultantError && (
                    <div style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      padding: "10px 14px",
                      borderRadius: "8px",
                      background: "rgba(239, 68, 68, 0.08)",
                      border: "1px solid rgba(239, 68, 68, 0.25)",
                      color: "#dc2626",
                      fontSize: "13px",
                      margin: "8px 0"
                    }}>
                      <AlertCircle className="h-4 w-4 shrink-0" />
                      <span style={{ flex: 1, textAlign: "left" }}>{consultantError}</span>
                      <button
                        type="button"
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "4px",
                          padding: "4px 8px",
                          borderRadius: "4px",
                          background: "#fff",
                          border: "1px solid rgba(239, 68, 68, 0.4)",
                          color: "#dc2626",
                          fontSize: "12px",
                          cursor: "pointer"
                        }}
                        onClick={() => void handleConsultantAnalyze()}
                      >
                        <RefreshCw className="h-3 w-3" /> 重试
                      </button>
                    </div>
                  )}

                  <button
                    type="button"
                    className="brief-primary-action"
                    disabled={!canExtract || isConsulting}
                    onClick={() => void handleConsultantAnalyze()}
                  >
                    {isConsulting ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {consultingStage || "正在研读推导中..."}
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-4 w-4" />
                        开始顾问研读
                      </>
                    )}
                  </button>
                </div>
              ) : (
                <div className="consultant-proposal-layout">
                  {/* 板块 1：核心立论 */}
                  <div className="proposal-section">
                    <div className="proposal-section__header">
                      <div className="flex items-center gap-2">
                        <span className="section-badge section-badge--primary">1. 核心观点立论</span>
                        <span className="text-xs text-muted">提炼演示的核心主张，将作为每页的论证依据</span>
                      </div>
                      <span className="text-xs font-semibold text-brand">
                        {proposal.takeaways.filter((t: ConsultantTakeaway) => t.selected).length} / {proposal.takeaways.length} 条已选
                      </span>
                    </div>

                    <div className="takeaway-card-list">
                      {proposal.takeaways.map((takeaway: ConsultantTakeaway) => {
                        const isEditing = editingTakeawayId === takeaway.id;
                        return (
                          <div
                            key={takeaway.id}
                            className={`takeaway-item ${takeaway.selected ? "is-selected" : "is-unselected"}`}
                          >
                            <label className="takeaway-checkbox">
                              <input
                                type="checkbox"
                                checked={takeaway.selected}
                                onChange={() => toggleTakeaway(takeaway.id)}
                              />
                              <span>
                                <Check className="h-3 w-3" />
                              </span>
                            </label>

                            <div className="takeaway-body">
                              <div className="takeaway-meta">
                                <span className="takeaway-tag">{takeaway.category}</span>
                                <strong className="takeaway-title">{takeaway.title}</strong>
                              </div>

                              {isEditing ? (
                                <div className="takeaway-edit-box">
                                  <textarea
                                    value={editingTakeawayContent}
                                    onChange={(e) => setEditingTakeawayContent(e.target.value)}
                                    rows={2}
                                    autoFocus
                                  />
                                  <div className="takeaway-edit-actions">
                                    <button
                                      type="button"
                                      className="btn-text-action"
                                      onClick={() => saveEditTakeaway(takeaway.id)}
                                    >
                                      <Check className="h-3 w-3" /> 保存
                                    </button>
                                    <button
                                      type="button"
                                      className="btn-text-action"
                                      onClick={() => setEditingTakeawayId(null)}
                                    >
                                      <X className="h-3 w-3" /> 取消
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <p className="takeaway-content">{takeaway.content}</p>
                              )}

                              {!isEditing && (
                                <div className="takeaway-actions">
                                  <button
                                    type="button"
                                    onClick={() => startEditTakeaway(takeaway)}
                                    title="修改观点"
                                  >
                                    <Pencil className="h-3 w-3" /> 修改
                                  </button>
                                  <button
                                    type="button"
                                    className="is-danger"
                                    onClick={() => deleteTakeaway(takeaway.id)}
                                    title="删除观点"
                                  >
                                    <Trash2 className="h-3 w-3" /> 删除
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* 板块 2：建议篇章架构预览 */}
                  <div className="proposal-section">
                    <div className="proposal-section__header">
                      <div className="flex items-center gap-2">
                        <span className="section-badge section-badge--secondary">2. 篇章架构与故事线预览</span>
                        <span className="text-xs text-muted">递进式叙事脉络，确认后将直接转化为 PPT 结构大纲</span>
                      </div>
                      <span className="text-xs text-muted font-medium">预计 {proposal.chapters.length} 大章节</span>
                    </div>

                    <div className="chapter-flow-list">
                      {proposal.chapters.map((chapter: ConsultantChapter, idx: number) => (
                        <div key={chapter.id} className="chapter-flow-card">
                          <div className="chapter-flow-card__top">
                            <div className="flex items-center gap-2">
                              <span className="chapter-index">{idx + 1}</span>
                              <strong className="chapter-title">{chapter.title}</strong>
                            </div>
                            <span className="chapter-pages-tag">{chapter.pageCount}</span>
                          </div>
                          <p className="chapter-goal">🎯 {chapter.keyGoal}</p>
                          <div className="chapter-points">
                            {chapter.points.map((pt: string, pIdx: number) => (
                              <span key={pIdx} className="chapter-point-pill">
                                • {pt}
                              </span>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* 板块 3：顾问互动对话与实时微调 */}
                  <div className="proposal-section consultant-dialogue-section">
                    <div className="proposal-section__header">
                      <div className="flex items-center gap-2">
                        <span className="section-badge section-badge--accent">3. 顾问对话微调</span>
                        <span className="text-xs text-muted">随时提出修改意见，AI 顾问实时碰撞并重构架构</span>
                      </div>
                    </div>

                    {/* 顾问对话气泡流 */}
                    <div className="consultant-chat-stream">
                      {proposal.dialogue.map((msg: ConsultantChatMessage) => (
                        <div
                          key={msg.id}
                          className={`chat-bubble-row ${msg.role === "consultant" ? "is-consultant" : "is-user"}`}
                        >
                          {msg.role === "consultant" && (
                            <div className="chat-avatar">
                              <Sparkles className="h-3.5 w-3.5" />
                            </div>
                          )}
                          <div className="chat-bubble">
                            <p>{msg.text}</p>
                            <span className="chat-bubble__time">{msg.time}</span>
                          </div>
                        </div>
                      ))}
                      {isConsulting && (
                        <div className="chat-bubble-row is-consultant">
                          <div className="chat-avatar">
                            <Sparkles className="h-3.5 w-3.5 animate-spin" />
                          </div>
                          <div className="chat-bubble is-loading">
                            <span>顾问正在调整篇章与观点...</span>
                          </div>
                        </div>
                      )}
                      <div ref={chatBottomRef} />
                    </div>

                    {/* 快捷调整标签 */}
                    {proposal.quickActions?.length > 0 && (
                      <div className="quick-actions-bar">
                        <span className="text-xs text-muted">快捷指令：</span>
                        <div className="quick-actions-list">
                          {proposal.quickActions.map((action: string, aIdx: number) => (
                            <button
                              key={aIdx}
                              type="button"
                              className="quick-action-pill"
                              disabled={isConsulting}
                              onClick={() => handleSendInstruction(action)}
                            >
                              + {action}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* 对话输入框 */}
                    <div className="consultant-chat-input-bar">
                      <input
                        type="text"
                        value={userChatInput}
                        onChange={(e) => setUserChatInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            handleSendInstruction();
                          }
                        }}
                        placeholder="向顾问提出调整要求（例如：减少理论部分，重点加一个针对上班族的每日练习日程）..."
                        disabled={isConsulting}
                      />
                      <button
                        type="button"
                        className="chat-send-btn"
                        disabled={!userChatInput.trim() || isConsulting}
                        onClick={() => handleSendInstruction()}
                      >
                        <Send className="h-3.5 w-3.5" />
                        发送
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* 视图 2：原始引用事实明细列表（保留底层兼容与溯源） */
            <div className="facts-legacy-view">
              <div className="facts-toolbar">
                <strong>{selectedFactCount} / {facts.length} 条事实已勾选进入 PPT</strong>
                {facts.length > 0 ? (
                  <div>
                    <button
                      type="button"
                      disabled={Boolean(busy) || selectedFactCount === facts.length}
                      onClick={() => void setAllFacts(true)}
                    >
                      全选
                    </button>
                    <button
                      type="button"
                      disabled={Boolean(busy) || selectedFactCount === 0}
                      onClick={() => void setAllFacts(false)}
                    >
                      清空
                    </button>
                  </div>
                ) : null}
              </div>

              <div className="facts-confirm-list">
                {facts.length === 0 ? (
                  <div className="facts-empty-state">
                    <FileText />
                    <strong>尚未提取底层事实</strong>
                    <p>在左侧补充资料后点击「顾问研读与架构推导」。</p>
                  </div>
                ) : (
                  facts.map((fact) => {
                    const editing = editingFactId === fact.id;
                    return (
                      <article
                        key={fact.id}
                        className={`fact-confirm-card ${fact.canUseInPpt ? "is-selected" : ""}`}
                      >
                        <label className="fact-confirm-card__check">
                          <input
                            type="checkbox"
                            checked={fact.canUseInPpt}
                            disabled={Boolean(busy)}
                            onChange={(event) =>
                              void updateFact(fact.id, { canUseInPpt: event.target.checked })
                            }
                          />
                          <span>
                            <Check />
                          </span>
                        </label>
                        <div className="fact-confirm-card__body">
                          <div className="fact-confirm-card__meta">
                            <span>{fact.category}</span>
                            <small>
                              {statusLabel(fact.status)} · {fact.sourceLocation}
                            </small>
                          </div>
                          {editing ? (
                            <textarea
                              value={editingFactContent}
                              autoFocus
                              onChange={(event) => setEditingFactContent(event.target.value)}
                            />
                          ) : (
                            <p>{fact.content}</p>
                          )}
                          <div className="fact-confirm-card__actions">
                            {editing ? (
                              <>
                                <button
                                  type="button"
                                  disabled={Boolean(busy) || !editingFactContent.trim()}
                                  onClick={() => void saveFactEdit(fact.id)}
                                >
                                  <Check />
                                  保存
                                </button>
                                <button
                                  type="button"
                                  disabled={Boolean(busy)}
                                  onClick={() => setEditingFactId(null)}
                                >
                                  <X />
                                  取消
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                disabled={Boolean(busy)}
                                onClick={() => beginFactEdit(fact)}
                              >
                                <Pencil />
                                修改
                              </button>
                            )}
                            <button
                              type="button"
                              className="is-danger"
                              disabled={Boolean(busy)}
                              onClick={() => void deleteFact(fact.id)}
                            >
                              <Trash2 />
                              删除
                            </button>
                          </div>
                        </div>
                      </article>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </section>
      </div>

      {/* 底部引导栏 */}
      <div className="source-workspace__footer">
        <div className="footer-status-summary">
          {proposal ? (
            <span className="text-xs text-muted">
              ✨ 顾问架构已就绪：
              <strong className="text-title">
                {" "}
                {proposal.takeaways.filter((t: ConsultantTakeaway) => t.selected).length} 条核心观点
              </strong>
              ，
              <strong className="text-title">
                {" "}
                {proposal.chapters.length} 个建议篇章
              </strong>
            </span>
          ) : (
            <span>{canContinue ? `已确认 ${selectedFactCount} 条可用事实` : "请先在左侧输入资料并推导架构"}</span>
          )}
        </div>
        <button
          type="button"
          className="brief-primary-action consultant-confirm-btn"
          disabled={Boolean(busy) || !canContinue}
          onClick={() => void handleProceedToVisual()}
        >
          确认架构，选择视觉模板
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
