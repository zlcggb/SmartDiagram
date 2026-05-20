/**
 * SettingsModal — Model configuration dialog.
 * Allows configuring API Key, Base URL, Model ID.
 * Includes a connection test feature.
 */

import { useState, useEffect } from 'react';
import { X, Loader2, CheckCircle, AlertCircle } from 'lucide-react';
import { useChatStore } from '../../store/chatStore';

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

export default function SettingsModal({ open, onClose }: SettingsModalProps) {
  const { modelConfig, setModelConfig, canvasMode } = useChatStore();

  const [apiKey, setApiKey] = useState(modelConfig?.api_key || '');
  const [baseUrl, setBaseUrl] = useState(modelConfig?.base_url || '');
  const [modelId, setModelId] = useState(modelConfig?.model_id || '');
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [testError, setTestError] = useState('');

  useEffect(() => {
    if (open) {
      setApiKey(modelConfig?.api_key || '');
      setBaseUrl(modelConfig?.base_url || '');
      setModelId(modelConfig?.model_id || '');
      setTestStatus('idle');
    }
  }, [open, modelConfig]);

  const handleTest = async () => {
    setTestStatus('testing');
    setTestError('');
    try {
      const url = (baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
      const res = await fetch(`${url}/models`, {
        headers: { 'Authorization': `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        setTestStatus('success');
      } else {
        setTestStatus('error');
        setTestError(`HTTP ${res.status}: ${res.statusText}`);
      }
    } catch (e: unknown) {
      setTestStatus('error');
      setTestError(e instanceof Error ? e.message : 'Connection failed');
    }
  };

  const handleSave = () => {
    setModelConfig({
      api_key: apiKey.trim(),
      base_url: baseUrl.trim(),
      model_id: modelId.trim(),
    });
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center animate-fade-in">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-xs" onClick={onClose} />

      {/* Modal */}
      <div className={`relative border rounded-2xl shadow-2xl w-full max-w-md mx-4 sd-fade-in transition-colors duration-300 ${
        canvasMode === 'light' ? 'bg-white border-slate-200' : 'bg-slate-900 border-slate-700/50'
      }`}>
        {/* Header */}
        <div className={`flex items-center justify-between px-6 py-4 border-b ${
          canvasMode === 'light' ? 'border-slate-200 bg-slate-50/50 rounded-t-2xl' : 'border-slate-700/50'
        }`}>
          <h2 className={`text-base font-semibold ${canvasMode === 'light' ? 'text-slate-800' : 'text-slate-100'}`}>模型配置</h2>
          <button onClick={onClose} className={`p-1.5 rounded-lg transition-colors ${
            canvasMode === 'light' ? 'text-slate-400 hover:text-slate-750 hover:bg-slate-200' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
          }`}>
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form */}
        <div className="px-6 py-5 space-y-4">
          {/* API Key */}
          <div>
            <label className={`block text-xs font-medium mb-1.5 ${canvasMode === 'light' ? 'text-slate-600' : 'text-slate-400'}`}>API Key</label>
            <input
              type="password"
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder="sk-..."
              className={`w-full px-3 py-2.5 rounded-lg border text-sm outline-none focus:border-blue-500/50 transition-colors ${
                canvasMode === 'light' 
                  ? 'bg-slate-50 border-slate-250 text-slate-805 placeholder:text-slate-400' 
                  : 'bg-slate-800 border-slate-700/50 text-slate-200 placeholder:text-slate-600'
              }`}
            />
          </div>

          {/* Base URL */}
          <div>
            <label className={`block text-xs font-medium mb-1.5 ${canvasMode === 'light' ? 'text-slate-600' : 'text-slate-400'}`}>Base URL</label>
            <input
              type="text"
              value={baseUrl}
              onChange={e => setBaseUrl(e.target.value)}
              placeholder="https://api.openai.com/v1"
              className={`w-full px-3 py-2.5 rounded-lg border text-sm outline-none focus:border-blue-500/50 transition-colors ${
                canvasMode === 'light' 
                  ? 'bg-slate-50 border-slate-250 text-slate-805 placeholder:text-slate-400' 
                  : 'bg-slate-800 border-slate-700/50 text-slate-200 placeholder:text-slate-600'
              }`}
            />
          </div>

          {/* Model ID */}
          <div>
            <label className={`block text-xs font-medium mb-1.5 ${canvasMode === 'light' ? 'text-slate-600' : 'text-slate-400'}`}>Model ID</label>
            <input
              type="text"
              value={modelId}
              onChange={e => setModelId(e.target.value)}
              placeholder="gpt-4o"
              className={`w-full px-3 py-2.5 rounded-lg border text-sm outline-none focus:border-blue-500/50 transition-colors ${
                canvasMode === 'light' 
                  ? 'bg-slate-50 border-slate-250 text-slate-805 placeholder:text-slate-400' 
                  : 'bg-slate-800 border-slate-700/50 text-slate-200 placeholder:text-slate-600'
              }`}
            />
          </div>

          {/* Test result */}
          {testStatus === 'success' && (
            <div className="flex items-center gap-2 text-xs text-emerald-600 bg-emerald-500/10 rounded-lg px-3 py-2">
              <CheckCircle className="w-3.5 h-3.5" />
              连接成功
            </div>
          )}
          {testStatus === 'error' && (
            <div className="flex items-start gap-2 text-xs text-red-500 bg-red-500/10 rounded-lg px-3 py-2">
              <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>{testError}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className={`flex items-center justify-between px-6 py-4 border-t ${
          canvasMode === 'light' ? 'border-slate-200 bg-slate-50/50 rounded-b-2xl' : 'border-slate-700/50'
        }`}>
          <button
            onClick={handleTest}
            disabled={!apiKey.trim() || testStatus === 'testing'}
            className={`px-4 py-2 rounded-lg text-xs font-medium transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
              canvasMode === 'light'
                ? 'text-slate-600 bg-slate-100 border border-slate-250 hover:bg-slate-200'
                : 'text-slate-300 bg-slate-800 border border-slate-700/50 hover:bg-slate-700'
            }`}
          >
            {testStatus === 'testing'
              ? <span className="flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin" />测试中...</span>
              : '测试连接'
            }
          </button>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className={`px-4 py-2 rounded-lg text-xs font-medium transition-colors ${
              canvasMode === 'light' ? 'text-slate-500 hover:text-slate-800' : 'text-slate-400 hover:text-slate-200'
            }`}>
              取消
            </button>
            <button
              onClick={handleSave}
              className="px-4 py-2 rounded-lg text-xs font-medium text-white bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 shadow-lg shadow-indigo-500/20 transition-all"
            >
              保存
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
