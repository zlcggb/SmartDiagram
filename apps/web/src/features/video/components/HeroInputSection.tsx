import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import type { UploadMeta, VideoGuestQuota } from '../lib/types';

interface HeroInputSectionProps {
  urlValue: string;
  onUrlChange: (val: string) => void;
  loading: boolean;
  error: string;
  errorCode: string;
  useCookies: boolean;
  onUseCookiesChange: (val: boolean) => void;
  browser: string;
  onBrowserChange: (val: string) => void;
  uploadLoading: boolean;
  uploadProgress: number;
  uploadError: string;
  uploadMeta: UploadMeta | null;
  guestQuota: VideoGuestQuota | null;
  compact: boolean;
  inputTab: 'upload' | 'link';
  onInputTabChange: (tab: 'upload' | 'link') => void;
  pendingFileName: string;
  onParseUrl: () => void;
  onParseUpload: () => void;
  onStageFile: (file: File) => void;
}

const UPLOAD_ACCEPT = '.mp4,.mov,.mkv,.webm,.m4v,.avi,.mp3,.m4a,.wav,.flac,.aac,video/*,audio/*';
const ALLOWED_EXT = [
  '.mp4',
  '.mov',
  '.mkv',
  '.webm',
  '.m4v',
  '.avi',
  '.mp3',
  '.m4a',
  '.wav',
  '.flac',
  '.aac',
];

const BROWSERS = [
  { value: 'firefox', label: 'Firefox（推荐）' },
  { value: 'chrome', label: 'Chrome' },
  { value: 'edge', label: 'Edge' },
  { value: 'brave', label: 'Brave' },
];

const GUIDED_CODES = ['needs_login', 'needs_cookie', 'login_or_ip', 'bot_ip', 'douyin_cookie', 'needs_proxy'];

function isAllowedFile(file: File): boolean {
  if (!file) return false;
  const name = file.name.toLowerCase();
  const dot = name.lastIndexOf('.');
  const ext = dot >= 0 ? name.slice(dot) : '';
  if (ALLOWED_EXT.includes(ext)) return true;
  const t = (file.type || '').toLowerCase();
  return t.startsWith('video/') || t.startsWith('audio/');
}

export const HeroInputSection: React.FC<HeroInputSectionProps> = ({
  urlValue,
  onUrlChange,
  loading,
  error,
  errorCode,
  useCookies,
  onUseCookiesChange,
  browser,
  onBrowserChange,
  uploadLoading,
  uploadProgress,
  uploadError,
  guestQuota,
  compact,
  inputTab,
  onInputTabChange,
  pendingFileName,
  onParseUrl,
  onParseUpload,
  onStageFile,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [localUploadError, setLocalUploadError] = useState('');
  const [showLogin, setShowLogin] = useState(false);
  const [navSlot, setNavSlot] = useState<HTMLElement | null>(null);

  const isLoginError = GUIDED_CODES.includes(errorCode);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      setNavSlot(document.getElementById('vidgrab-navbar-center-slot'));
    }
  }, [compact]);

  const handleFile = (file?: File) => {
    if (!file || uploadLoading) return;
    if (!isAllowedFile(file)) {
      setLocalUploadError('不支持的文件格式，请拖入 MP4 / MOV / MP3 等视频或音频');
      return;
    }
    setLocalUploadError('');
    onStageFile(file);
  };

  if (compact) {
    const compactPill = (
      <div className="flex w-full max-w-[560px] items-center justify-between gap-1.5 rounded-full border border-slate-200/85 bg-slate-100/75 p-1 shadow-2xs transition focus-within:border-[#0071e3]/40 focus-within:bg-white">
        {/* 左侧：迷你上传/链接切换 */}
        <div className="flex shrink-0 items-center gap-0.5 rounded-full bg-slate-200/70 p-0.5 text-[11.5px]">
          <button
            type="button"
            className={`rounded-full px-2.5 py-1 transition ${
              inputTab === 'upload'
                ? 'bg-white font-semibold text-slate-900 shadow-2xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
            onClick={() => onInputTabChange('upload')}
          >
            📁 本地上传
          </button>
          <button
            type="button"
            className={`rounded-full px-2.5 py-1 transition ${
              inputTab === 'link'
                ? 'bg-white font-semibold text-slate-900 shadow-2xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
            onClick={() => onInputTabChange('link')}
          >
            🔗 在线链接
          </button>
        </div>

        {/* 中部：紧凑链接输入或文件选择 */}
        {inputTab === 'upload' ? (
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <input
              ref={fileInputRef}
              type="file"
              accept={UPLOAD_ACCEPT}
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              disabled={uploadLoading}
              onClick={() => fileInputRef.current?.click()}
              className="min-w-0 flex-1 truncate rounded-full bg-white/90 px-3 py-1 text-left text-[12px] text-slate-700 transition hover:text-[#0071e3]"
            >
              {pendingFileName ? `已选：${pendingFileName}` : '点击选择新的本地音视频…'}
            </button>
            <button
              type="button"
              disabled={uploadLoading || !pendingFileName}
              onClick={onParseUpload}
              className="shrink-0 rounded-full bg-[#0071e3] px-3.5 py-1 text-[12px] font-semibold text-white transition hover:bg-[#0077ed] disabled:opacity-40"
            >
              {uploadLoading ? `${uploadProgress}%` : '解析'}
            </button>
          </div>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <input
              type="url"
              value={urlValue}
              onChange={(e) => onUrlChange(e.target.value)}
              placeholder="粘贴新视频链接直接切换…"
              className="h-7 min-w-0 flex-1 rounded-full bg-transparent px-2.5 text-[12px] text-slate-800 outline-none placeholder:text-slate-400"
              onKeyDown={(e) => {
                if (e.key === 'Enter') onParseUrl();
              }}
            />
            <button
              type="button"
              disabled={loading || !urlValue.trim()}
              onClick={onParseUrl}
              className="shrink-0 rounded-full bg-[#0071e3] px-3.5 py-1 text-[12px] font-semibold text-white transition hover:bg-[#0077ed] disabled:opacity-40"
            >
              {loading ? '解析中…' : '解析'}
            </button>
          </div>
        )}
      </div>
    );

    if (navSlot) {
      return createPortal(compactPill, navSlot);
    }

    return <div className="flex shrink-0 justify-center px-4 pt-2 pb-1">{compactPill}</div>;
  }

  return (
    <section className="flex flex-1 flex-col justify-center px-5 py-8 sm:px-8 lg:py-12">
      <div className="mx-auto grid w-full max-w-[1160px] items-center gap-10 md:grid-cols-[minmax(0,0.88fr)_minmax(0,1.12fr)] lg:gap-14">
        {/* Left Hero Pitch */}
        <div className="text-left">
          <div className="mb-3 flex flex-wrap items-center gap-2.5">
            <div className="inline-flex items-center gap-2 rounded-full bg-[#0071e3]/10 px-3 py-1 text-[12px] font-medium text-[#0071e3]">
              <span>✨ AI 视频学习工作台</span>
            </div>
            <Link
              to="/video/history"
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-200/90 bg-white px-3 py-1 text-[12px] font-medium text-slate-700 shadow-2xs transition hover:border-[#0071e3]/40 hover:text-[#0071e3]"
            >
              <span>📚 我的学习记录</span>
              <span>→</span>
            </Link>
          </div>
          <h1 className="text-[34px] font-semibold leading-[1.15] tracking-tight text-slate-900 sm:text-[42px] lg:text-[48px]">
            上传视频，
            <br />
            快速掌握核心内容
          </h1>
          <p className="mt-4 max-w-[460px] text-[15px] leading-7 text-slate-600 sm:text-[16px]">
            自动生成深度内容总结、MindElixir 知识导图、双语字幕与互动学习测验，让培训与课程视频更易吸收。
          </p>
          <div className="mt-6 flex flex-wrap gap-x-5 gap-y-2.5 text-[13px] text-slate-600">
            {['深度研报总结', '思维导图拆解', '逐句双语字幕', 'AI 互动测验与问答'].map((feat) => (
              <span key={feat} className="inline-flex items-center gap-1.5">
                <svg
                  className="h-4 w-4 text-[#0071e3]"
                  viewBox="0 0 20 20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path d="M4 10.5l4 4 8-9" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {feat}
              </span>
            ))}
          </div>
        </div>

        {/* Right Input Card */}
        <div className="w-full">
          <div className="rounded-[24px] border border-slate-200/80 bg-white/95 p-4 shadow-[0_24px_60px_-32px_rgba(15,23,42,0.18)] backdrop-blur-xl sm:p-5">
            {/* Mode Switcher */}
            <div className="mb-4 flex gap-1 rounded-2xl bg-slate-100 p-1">
              <button
                type="button"
                onClick={() => onInputTabChange('upload')}
                className={`flex flex-1 items-center justify-center gap-2 rounded-xl py-2.5 text-[13.5px] transition ${
                  inputTab === 'upload'
                    ? 'bg-white font-semibold text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                  <path
                    d="M12 16V4m0 0L8 8m4-4l4 4M5 15v3a2 2 0 002 2h10a2 2 0 002-2v-3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                本地上传
              </button>
              <button
                type="button"
                onClick={() => onInputTabChange('link')}
                className={`flex flex-1 items-center justify-center gap-2 rounded-xl py-2.5 text-[13.5px] transition ${
                  inputTab === 'link'
                    ? 'bg-white font-semibold text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                  <path
                    d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                在线视频链接
              </button>
            </div>

            {inputTab === 'upload' ? (
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={UPLOAD_ACCEPT}
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFile(f);
                    e.target.value = '';
                  }}
                />
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (!uploadLoading) setIsDragOver(true);
                  }}
                  onDragLeave={(e) => {
                    e.preventDefault();
                    setIsDragOver(false);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    setIsDragOver(false);
                    const f = e.dataTransfer?.files?.[0];
                    if (f) handleFile(f);
                  }}
                  onClick={() => !uploadLoading && fileInputRef.current?.click()}
                  className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-9 text-center transition ${
                    isDragOver
                      ? 'border-[#0071e3] bg-[#0071e3]/5'
                      : 'border-slate-200 bg-slate-50/70 hover:border-[#0071e3]/50 hover:bg-slate-50'
                  }`}
                >
                  <div className="grid h-12 w-12 place-items-center rounded-2xl bg-[#0071e3]/10 text-[#0071e3]">
                    <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                      <path
                        d="M12 16V4m0 0L8 8m4-4l4 4M5 15v3a2 2 0 002 2h10a2 2 0 002-2v-3"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </div>
                  <p className="mt-3 text-[14px] font-medium text-slate-900">
                    {pendingFileName ? `已选择：${pendingFileName}` : '点击或拖拽音视频文件到这里'}
                  </p>
                  <p className="mt-1 text-[12px] text-slate-500">
                    支持 MP4 / MOV / MKV / WebM / MP3 / M4A / WAV 等常见格式
                  </p>
                </div>

                {uploadLoading && (
                  <div className="mt-3">
                    <div className="mb-1 flex justify-between text-[12px] text-slate-600">
                      <span>正在上传视频…</span>
                      <span className="font-mono font-semibold">{uploadProgress}%</span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-[#0071e3] transition-all duration-200"
                        style={{ width: `${uploadProgress}%` }}
                      />
                    </div>
                  </div>
                )}

                {(localUploadError || uploadError) && (
                  <p className="mt-3 text-[12.5px] text-red-500">{localUploadError || uploadError}</p>
                )}

                <div className="mt-4 flex justify-end">
                  <button
                    type="button"
                    disabled={uploadLoading || !pendingFileName}
                    onClick={onParseUpload}
                    className="btn-pill w-full sm:w-auto"
                  >
                    {uploadLoading ? '上传并解析中…' : '上传并开始 AI 学习'}
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <div className="flex flex-col gap-2.5 sm:flex-row">
                  <input
                    type="url"
                    value={urlValue}
                    onChange={(e) => onUrlChange(e.target.value)}
                    placeholder="粘贴 Bilibili / YouTube / 抖音 / TikTok 视频链接…"
                    className="field-pill min-w-0 flex-1 !h-11"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') onParseUrl();
                    }}
                  />
                  <button
                    type="button"
                    disabled={loading || !urlValue.trim()}
                    onClick={onParseUrl}
                    className="btn-pill !h-11 shrink-0"
                  >
                    {loading ? '正在解析…' : '解析视频'}
                  </button>
                </div>

                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[12px] text-slate-500">
                  <button
                    type="button"
                    onClick={() => setShowLogin((v) => !v)}
                    className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-800"
                  >
                    <span>{showLogin || isLoginError ? '▾' : '▸'} 遇到会员/登录受限视频？使用本机浏览器 Cookie</span>
                  </button>
                </div>

                {(showLogin || isLoginError) && (
                  <div className="mt-2.5 flex flex-wrap items-center gap-3 rounded-xl border border-slate-200/80 bg-slate-50 px-3.5 py-2.5 text-[12.5px]">
                    <label className="flex cursor-pointer items-center gap-2 text-slate-700">
                      <input
                        type="checkbox"
                        checked={useCookies}
                        onChange={(e) => onUseCookiesChange(e.target.checked)}
                        className="rounded accent-[#0071e3]"
                      />
                      附带浏览器登录态 (Cookies)
                    </label>
                    {useCookies && (
                      <select
                        value={browser}
                        onChange={(e) => onBrowserChange(e.target.value)}
                        className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[12px] outline-none"
                      >
                        {BROWSERS.map((b) => (
                          <option key={b.value} value={b.value}>
                            {b.label}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                )}

                {error && <p className="mt-3 text-[12.5px] text-red-500">{error}</p>}
              </div>
            )}

            {guestQuota?.is_guest && guestQuota.quota_limit != null && (
              <div className="mt-4 flex items-center justify-between rounded-xl bg-slate-50 px-3.5 py-2 text-[12px] text-slate-600">
                <span>
                  访客试用额度：剩余 <strong>{guestQuota.quota_remaining ?? 0}</strong> / {guestQuota.quota_limit} 次视频总结
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
};
