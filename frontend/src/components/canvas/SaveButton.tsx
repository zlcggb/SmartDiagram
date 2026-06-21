import { useState } from 'react';
import { Save, Check, Loader2 } from 'lucide-react';
import { useChatStore } from '../../store/chatStore';
import { API_BASE, enterpriseHeaders } from '../../config/enterpriseContext';
import { useT } from '../../i18n';
import { NoticeDialog } from '../common/AppDialog';

export default function SaveButton() {
  const {
    canvasEngine,
    canvasDiagramId,
    canvasDiagramVersionId,
    excalidrawAPI,
    setCanvasDiagramVersionId,
    setCanvasCode,
    messages,
    updateMessageById,
  } = useChatStore();
  const { t } = useT();

  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only show for Excalidraw with a persisted diagram
  const isEditable = canvasEngine === 'excalidraw' && Boolean(excalidrawAPI) && Boolean(canvasDiagramId);
  if (!isEditable) return null;

  const handleSave = async () => {
    if (saving || !excalidrawAPI || !canvasDiagramId) return;

    // Serialize current canvas — exclude soft-deleted elements
    let newCode = '';
    try {
      const elements = excalidrawAPI.getSceneElements();
      const active = elements.filter((el: any) => !el.isDeleted);
      newCode = JSON.stringify(active, null, 2);
    } catch (e) {
      setError('Failed to read canvas content');
      return;
    }

    setSaving(true);
    setSuccess(false);

    try {
      const response = await fetch(`${API_BASE}/api/diagrams/${canvasDiagramId}/versions`, {
        method: 'POST',
        headers: enterpriseHeaders(),
        body: JSON.stringify({
          code: newCode,
          reason: 'Manual canvas edit',
        }),
      });

      if (!response.ok) {
        let msg = response.statusText;
        try {
          const payload = await response.json();
          msg = payload.detail || msg;
        } catch {}
        throw new Error(msg);
      }

      const result = await response.json();

      // 1. Update canvas store so the toolbar / ExportButton use the new version
      if (result.diagram_version_id) {
        setCanvasDiagramVersionId(result.diagram_version_id);
      }
      if (result.code) {
        setCanvasCode(result.code);
      }

      // 2. CRITICAL: patch the source message so that clicking "加载到画布"
      //    restores the EDITED version, not the original AI-generated code.
      //    Find the message whose diagramVersionId matches the OLD version we just superseded.
      const oldVersionId = canvasDiagramVersionId;
      if (oldVersionId && result.diagram_version_id && result.code) {
        const sourceMsg = messages.find(
          (m) => m.role === 'assistant' && m.diagramVersionId === oldVersionId
        );
        if (sourceMsg) {
          updateMessageById(sourceMsg.id, {
            code: result.code,
            diagramVersionId: result.diagram_version_id,
          });
        }
      }

      setSuccess(true);
      setTimeout(() => setSuccess(false), 2500);
    } catch (e: any) {
      console.error('[SaveButton] Save failed:', e);
      setError(e.message || 'Failed to save diagram');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <button
        onClick={handleSave}
        disabled={saving || success}
        title={t('common.save') || 'Save Changes'}
        className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-all shadow-sm hover:shadow
          ${success
            ? 'bg-emerald-50 text-emerald-600 border border-emerald-200'
            : 'bg-white border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50 text-indigo-600'
          } disabled:opacity-50 disabled:cursor-not-allowed`}
      >
        {saving ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : success ? (
          <Check className="w-3.5 h-3.5" />
        ) : (
          <Save className="w-3.5 h-3.5" />
        )}
        <span>
          {saving
            ? (t('common.saving') || '保存中...')
            : success
            ? (t('common.saved') || '已保存')
            : (t('common.save') || '保存')}
        </span>
      </button>

      {error && (
        <NoticeDialog
          open={true}
          title="Save Failed"
          message={error}
          onClose={() => setError(null)}
        />
      )}
    </>
  );
}
