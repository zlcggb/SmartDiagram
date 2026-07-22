import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  ArrowRight,
  Check,
  ClipboardPaste,
  FileText,
  Files,
  Pencil,
  Sparkles,
  Trash2,
  Upload,
  X
} from "lucide-react";
import type { FactDto, FactStatus } from "@ppt-agent/shared";
import { useWorkbenchStore } from "../../store/workbenchStore";
import { MaterialUploader } from "../materials/MaterialUploader";
import { MATERIAL_ACCEPT } from "../materials/materialUploadModel";
import { useMaterialUploads } from "../materials/useMaterialUploads";
import { canContinueFromSource } from "./intentFlow";

function statusLabel(status: FactStatus) {
  if (status === "confirmed") return "已确认";
  if (status === "suggestion") return "建议";
  return "待确认";
}

export function SourceTab() {
  const [, setSearchParams] = useSearchParams();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sourceText = useWorkbenchStore((s) => s.sourceText);
  const setSourceText = useWorkbenchStore((s) => s.setSourceText);
  const loadDemoSource = useWorkbenchStore((s) => s.loadDemoSource);
  const extractFacts = useWorkbenchStore((s) => s.extractFacts);
  const facts = useWorkbenchStore((s) => s.facts);
  const updateFact = useWorkbenchStore((s) => s.updateFact);
  const deleteFact = useWorkbenchStore((s) => s.deleteFact);
  const busy = useWorkbenchStore((s) => s.busy);
  const project = useWorkbenchStore((s) => s.project);
  const materials = useWorkbenchStore((s) => s.materials);
  const loadMaterials = useWorkbenchStore((s) => s.loadMaterials);
  const uploadMaterial = useWorkbenchStore((s) => s.uploadMaterial);
  const deleteMaterial = useWorkbenchStore((s) => s.deleteMaterial);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState("");

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

  useEffect(() => {
    if (!projectId || !shouldPollMaterials) return;
    let cancelled = false;
    let timer: number | undefined;
    const poll = async () => {
      await loadMaterials(projectId);
      if (!cancelled) timer = window.setTimeout(() => void poll(), 2500);
    };
    timer = window.setTimeout(() => void poll(), 2500);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [loadMaterials, projectId, shouldPollMaterials]);

  const selectedCount = useMemo(() => facts.filter((fact) => fact.canUseInPpt).length, [facts]);
  const readyMaterialCount = materialItems.filter((material) => material.status === "ready").length;
  const canExtract = (sourceText.trim().length >= 20 || readyMaterialCount > 0) && !busy && !hasProcessing && !hasBlockingErrors;
  const canContinue = canContinueFromSource(facts);

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    await addFiles(Array.from(files));
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function beginEdit(fact: FactDto) {
    setEditingId(fact.id);
    setEditingContent(fact.content);
  }

  async function saveEdit(factId: string) {
    const content = editingContent.trim();
    if (!content) return;
    await updateFact(factId, { content });
    if (!useWorkbenchStore.getState().error) {
      setEditingId(null);
      setEditingContent("");
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
        <section className="source-material-card">
          <div className="source-panel-heading">
            <span><ClipboardPaste /></span>
            <div>
              <h2>补充内容资料</h2>
              <p>粘贴文本或上传文档，资料会与前面确认的需求一起交给 AI。</p>
            </div>
          </div>

          <textarea
            className="source-material-input"
            value={sourceText}
            onChange={(event) => setSourceText(event.target.value)}
            placeholder="粘贴报告、会议纪要、项目说明、数据口径或其他参考内容（至少 20 字）"
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
            <button type="button" className="brief-secondary-action" disabled={Boolean(busy)} onClick={loadDemoSource}>
              <Files />
              载入示例
            </button>
            <span className="source-format-hint">PDF / Word / PPT / Excel / 文本 / 图片，最多 8 个，单文件 15 MB</span>
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
            <button type="button" className="brief-primary-action" disabled={!canExtract} onClick={() => void extractFacts()}>
              <Sparkles />
              {busy || (facts.length > 0 ? "重新提取事实" : "提取有用事实")}
            </button>
          </div>
        </section>

        <section className="source-facts-card">
          <div className="source-panel-heading source-panel-heading--facts">
            <span><FileText /></span>
            <div>
              <h2>确认可用事实</h2>
              <p>默认全部勾选；你可以取消、修改或删除，只有勾选内容会进入结构。</p>
            </div>
          </div>

          <div className="facts-toolbar">
            <strong>{selectedCount} / {facts.length} 条已选</strong>
            {facts.length > 0 ? (
              <div>
                <button type="button" disabled={Boolean(busy) || selectedCount === facts.length} onClick={() => void setAllFacts(true)}>全选</button>
                <button type="button" disabled={Boolean(busy) || selectedCount === 0} onClick={() => void setAllFacts(false)}>清空</button>
              </div>
            ) : null}
          </div>

          <div className="facts-confirm-list">
            {facts.length === 0 ? (
              <div className="facts-empty-state">
                <FileText />
                <strong>尚未提取事实</strong>
                <p>先在左侧补充资料，再点击「提取有用事实」。</p>
              </div>
            ) : (
              facts.map((fact) => {
                const editing = editingId === fact.id;
                return (
                  <article key={fact.id} className={`fact-confirm-card ${fact.canUseInPpt ? "is-selected" : ""}`}>
                    <label className="fact-confirm-card__check">
                      <input
                        type="checkbox"
                        checked={fact.canUseInPpt}
                        disabled={Boolean(busy)}
                        onChange={(event) => void updateFact(fact.id, { canUseInPpt: event.target.checked })}
                      />
                      <span><Check /></span>
                    </label>
                    <div className="fact-confirm-card__body">
                      <div className="fact-confirm-card__meta">
                        <span>{fact.category}</span>
                        <small>{statusLabel(fact.status)} · {fact.sourceLocation}</small>
                      </div>
                      {editing ? (
                        <textarea value={editingContent} autoFocus onChange={(event) => setEditingContent(event.target.value)} />
                      ) : (
                        <p>{fact.content}</p>
                      )}
                      <div className="fact-confirm-card__actions">
                        {editing ? (
                          <>
                            <button type="button" disabled={Boolean(busy) || !editingContent.trim()} onClick={() => void saveEdit(fact.id)}>
                              <Check />保存
                            </button>
                            <button type="button" disabled={Boolean(busy)} onClick={() => setEditingId(null)}><X />取消</button>
                          </>
                        ) : (
                          <button type="button" disabled={Boolean(busy)} onClick={() => beginEdit(fact)}><Pencil />修改</button>
                        )}
                        <button type="button" className="is-danger" disabled={Boolean(busy)} onClick={() => void deleteFact(fact.id)}>
                          <Trash2 />删除
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })
            )}
          </div>
        </section>
      </div>

      <div className="source-workspace__footer">
        <span>{canContinue ? `已确认 ${selectedCount} 条可用事实` : "至少勾选 1 条事实后才能继续"}</span>
        <button
          type="button"
          className="brief-primary-action"
          disabled={Boolean(busy) || !canContinue}
          onClick={() => setSearchParams({ tab: "visual" })}
        >
          确认事实，选择视觉模板
          <ArrowRight />
        </button>
      </div>
    </div>
  );
}
