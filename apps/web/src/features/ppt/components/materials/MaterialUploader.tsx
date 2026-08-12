import { AlertCircle, CheckCircle2, FileText, LoaderCircle, RefreshCw, Trash2 } from "lucide-react";
import { MAX_MATERIAL_FILE_MIB, formatMaterialSize, type MaterialSelectionError, type MaterialUploadItem } from "./materialUploadModel";

interface MaterialUploaderProps {
  items: readonly MaterialUploadItem[];
  selectionErrors?: readonly MaterialSelectionError[];
  onRetry?: (localId: string) => void | Promise<unknown>;
  onRemove: (localId: string) => void | Promise<unknown>;
  className?: string;
}

const statusLabels: Record<MaterialUploadItem["status"], string> = {
  pending: "待上传",
  uploading: "上传中",
  processing: "解析中",
  ready: "可用",
  failed: "失败"
};

const routeLabels = {
  auto: "自动路由",
  text: "文本",
  "full-context": "全文",
  rag: "长文档",
  vision: "视觉"
} as const;

export function MaterialUploader({ items, selectionErrors = [], onRetry, onRemove, className = "" }: MaterialUploaderProps) {
  if (items.length === 0 && selectionErrors.length === 0) return null;

  const ready = items.filter((item) => item.status === "ready").length;
  const failed = items.filter((item) => item.status === "failed").length;
  const active = items.filter((item) => item.status === "uploading" || item.status === "processing").length;
  const summary = [
    ready ? `${ready} 个可用` : "",
    active ? `${active} 个处理中` : "",
    failed ? `${failed} 个失败` : ""
  ].filter(Boolean).join(" · ") || `${items.length} 个待上传`;

  return (
    <section className={`material-uploader ${className}`.trim()} aria-label="已选资料">
      <div className="material-uploader__summary" role="status" aria-live="polite" aria-atomic="true">
        <span>{summary}</span>
        <small>最多 8 个，单文件 {MAX_MATERIAL_FILE_MIB} MiB</small>
      </div>

      {selectionErrors.length > 0 ? (
        <div className="material-uploader__selection-errors" role="alert">
          {selectionErrors.map((error, index) => <p key={`${error.filename}-${index}`}>{error.filename}：{error.errorMessage}</p>)}
        </div>
      ) : null}

      <div className="material-uploader__list">
        {items.map((item) => (
          <article key={item.localId} className={`material-upload-item is-${item.status}`}>
            <span className="material-upload-item__icon" aria-hidden="true">
              {item.status === "ready" ? <CheckCircle2 /> : item.status === "failed" ? <AlertCircle /> : item.status === "uploading" || item.status === "processing" ? <LoaderCircle /> : <FileText />}
            </span>
            <div className="material-upload-item__body">
              <div className="material-upload-item__title">
                <strong title={item.filename}>{item.filename}</strong>
                <span>{formatMaterialSize(item.sizeBytes)}</span>
              </div>
              <div className="material-upload-item__meta">
                <span>{statusLabels[item.status]}{item.status === "uploading" ? ` ${item.progress}%` : ""}</span>
                {item.routeMode ? <small>{routeLabels[item.routeMode]}</small> : null}
              </div>
              {item.status === "uploading" ? <progress max="100" value={item.progress} aria-label={`${item.filename} 上传进度`} /> : null}
              {item.errorMessage ? <p className="material-upload-item__error">{item.errorMessage}</p> : null}
            </div>
            <div className="material-upload-item__actions">
              {item.status === "failed" && item.retryable && onRetry ? (
                <button type="button" onClick={() => void onRetry(item.localId)} aria-label={`重试 ${item.filename}`}><RefreshCw />重试</button>
              ) : null}
              <button type="button" onClick={() => void onRemove(item.localId)} aria-label={`移除 ${item.filename}`}><Trash2 /></button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
