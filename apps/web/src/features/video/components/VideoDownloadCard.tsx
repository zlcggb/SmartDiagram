import React, { useState } from 'react';
import type { DownloadState, UploadMeta, VideoInfo } from '../lib/types';

interface VideoDownloadCardProps {
  info: VideoInfo;
  selectedFormat: string;
  onSelectFormat: (fmt: string) => void;
  download: DownloadState;
  onStart: () => void;
  onCancel: () => void;
  onPause: () => void;
  onResume: () => void;
  embedded?: boolean;
  mobilePlayerCollapsed?: boolean;
  onToggleMobilePlayer?: () => void;
}

function sizeText(bytes?: number): string {
  if (!bytes) return '';
  const mb = bytes / 1024 / 1024;
  if (mb < 1024) return `${mb.toFixed(0)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

function formatDurationBadge(seconds?: number): string {
  if (!seconds || seconds <= 0) return '';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

interface PlatformMeta {
  name: string;
  icon: string;
  badgeClass: string;
}

function detectPlatformMeta(url?: string, extractor?: string): PlatformMeta {
  const raw = `${url || ''} ${extractor || ''}`.toLowerCase();
  if (raw.includes('douyin') || raw.includes('iesdouyin')) {
    return {
      name: '抖音',
      icon: '🎵',
      badgeClass: 'border-slate-900/15 bg-slate-900 text-white',
    };
  }
  if (raw.includes('bilibili') || raw.includes('b23.tv')) {
    return {
      name: '哔哩哔哩',
      icon: '📺',
      badgeClass: 'border-pink-500/25 bg-pink-500/10 text-pink-700',
    };
  }
  if (raw.includes('xiaohongshu') || raw.includes('xhslink')) {
    return {
      name: '小红书',
      icon: '📕',
      badgeClass: 'border-rose-500/25 bg-rose-500/10 text-rose-700',
    };
  }
  if (raw.includes('youtube') || raw.includes('youtu.be')) {
    return {
      name: 'YouTube',
      icon: '▶️',
      badgeClass: 'border-red-500/25 bg-red-500/10 text-red-700',
    };
  }
  if (raw.includes('tiktok')) {
    return {
      name: 'TikTok',
      icon: '🎵',
      badgeClass: 'border-slate-800/20 bg-slate-800 text-white',
    };
  }
  if (raw.includes('kuaishou') || raw.includes('chenzhongtech')) {
    return {
      name: '快手',
      icon: '🎥',
      badgeClass: 'border-orange-500/25 bg-orange-500/10 text-orange-700',
    };
  }
  if (raw.includes('weibo')) {
    return {
      name: '微博视频',
      icon: '🌐',
      badgeClass: 'border-amber-500/25 bg-amber-500/10 text-amber-800',
    };
  }
  if (raw.includes('v.qq.com') || raw.includes('qq')) {
    return {
      name: '腾讯视频',
      icon: '🎬',
      badgeClass: 'border-blue-500/25 bg-blue-500/10 text-blue-700',
    };
  }
  if (raw.includes('iqiyi')) {
    return {
      name: '爱奇艺',
      icon: '🎬',
      badgeClass: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700',
    };
  }
  return {
    name: extractor ? extractor.toUpperCase() : '在线视频',
    icon: '🔗',
    badgeClass: 'border-[#0071e3]/20 bg-[#0071e3]/10 text-[#0071e3]',
  };
}

export const VideoDownloadCard: React.FC<VideoDownloadCardProps> = ({
  info,
  selectedFormat,
  onSelectFormat,
  download,
  onStart,
  onCancel,
  onPause,
  onResume,
  embedded = false,
  mobilePlayerCollapsed = false,
  onToggleMobilePlayer,
}) => {
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const isBusy =
    download.status === 'queued' ||
    download.status === 'downloading' ||
    download.status === 'paused' ||
    download.status === 'processing';
  const isLongVideo = (info.duration || 0) > 3600;
  const platform = detectPlatformMeta(info.webpage_url, info.extractor);
  const durationStr = info.duration_string || formatDurationBadge(info.duration);
  const formats =
    info.formats && info.formats.length > 0
      ? info.formats
      : [{ format_id: '', quality: '最佳画质 (MP4 自动优选)' }];

  const showMobileBody = !embedded || mobileDetailOpen || isBusy || download.status === 'error';

  return (
    <div className="vg-card-container flex flex-col gap-2.5 rounded-2xl border border-black/[0.06] bg-white px-3 py-2.5 shadow-2xs lg:gap-3 lg:border-slate-200/80 lg:p-4 lg:shadow-sm">
      {/* 移动端专属紧凑单行条（默认收起画质下载详情，释放屏幕给下方研报/导图） */}
      {embedded && (
        <div className="flex items-center justify-between gap-2 lg:hidden">
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <span
              className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-semibold ${platform.badgeClass}`}
            >
              <span>{platform.icon}</span>
              <span>{platform.name}</span>
            </span>
            <h3 className="min-w-0 flex-1 truncate text-[13px] font-semibold text-slate-900">
              {info.title || '未命名视频'}
            </h3>
            {durationStr && mobilePlayerCollapsed && (
              <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 font-mono text-[10.5px] font-medium text-slate-600">
                {durationStr}
              </span>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {onToggleMobilePlayer && (
              <button
                type="button"
                onClick={onToggleMobilePlayer}
                className="inline-flex h-7 items-center gap-0.5 rounded-full bg-slate-100 px-2.5 text-[11px] font-medium text-slate-700 transition active:scale-95"
                title={mobilePlayerCollapsed ? '展开视频画面' : '收起视频画面以全屏阅读'}
              >
                <span>{mobilePlayerCollapsed ? '▶ 画面' : '▲ 收起'}</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setMobileDetailOpen((v) => !v)}
              className={`inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[11px] font-semibold transition active:scale-95 ${
                mobileDetailOpen || isBusy
                  ? 'bg-[#0071e3] text-white'
                  : 'bg-[#0071e3]/10 text-[#0071e3]'
              }`}
            >
              <span>{isBusy ? `⬇ ${Math.round(download.percent || 0)}%` : '⬇ 下载'}</span>
              <span>{mobileDetailOpen ? '▴' : '▾'}</span>
            </button>
          </div>
        </div>
      )}

      {/* 桌面端完整展示 / 移动端点击「⬇ 下载 ▾」展开的详情面板 */}
      <div className={`${showMobileBody ? 'flex' : 'hidden'} flex-col gap-3 lg:flex`}>
        <div className="min-w-0">
          {/* 顶部来源标签行：平台徽章 + 作者 + 时长 + 原链接跳转 */}
          <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2 lg:mb-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span
                className={`hidden items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11.5px] font-semibold lg:inline-flex ${platform.badgeClass}`}
              >
                <span>{platform.icon}</span>
                <span>{platform.name}</span>
              </span>

              {info.uploader && (
                <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-[11.5px] font-medium text-slate-700">
                  @{info.uploader}
                </span>
              )}

              {durationStr && (
                <span className="hidden items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 font-mono text-[11px] font-medium text-slate-600 lg:inline-flex">
                  ⏱ {durationStr}
                </span>
              )}
            </div>

            {info.webpage_url && (
              <a
                href={info.webpage_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-full border border-slate-200/90 bg-slate-50 px-2.5 py-0.5 text-[11.5px] font-medium text-slate-600 transition hover:border-[#0071e3]/40 hover:bg-[#0071e3]/5 hover:text-[#0071e3]"
                title="在新标签页打开原视频链接"
              >
                <span>原视频链接</span>
                <span>↗</span>
              </a>
            )}
          </div>

          <h3 className="line-clamp-2 text-[13.5px] font-bold leading-snug text-slate-900 lg:text-[15.5px]">
            {info.title || '未命名视频'}
          </h3>

          {info.login_hint && (
            <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-[12px] leading-relaxed text-amber-900">
              {info.login_hint}
            </p>
          )}
        </div>

        {/* 清晰度选择与一键下载栏 */}
        <div className="flex items-center gap-2 pt-0.5">
          <div className="relative min-w-0 flex-1">
            <select
              value={selectedFormat}
              disabled={isBusy}
              onChange={(e) => onSelectFormat(e.target.value)}
              className="field-pill w-full appearance-none !h-9 pr-8 text-[12px] lg:!h-10 lg:pr-9 lg:text-[12.5px]"
            >
              {formats.map((f) => (
                <option key={f.format_id || 'best'} value={f.format_id}>
                  {f.quality}
                  {f.filesize ? ` · ${sizeText(f.filesize)}` : ''}
                </option>
              ))}
            </select>
            <svg
              className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 lg:right-3.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>

          <button
            type="button"
            className="btn-pill-sm shrink-0 !h-9 !px-3.5 !text-[12.5px] lg:!h-10 lg:!px-4 lg:!text-[13px]"
            disabled={isBusy}
            onClick={onStart}
          >
            {isBusy
              ? `下载中 ${Math.round(download.percent || 0)}%…`
              : download.status === 'done'
                ? '⬇ 重新下载'
                : '⬇ 下载视频'}
          </button>
        </div>

        {embedded && isLongVideo && download.status === 'idle' && (
          <p className="text-[12px] text-amber-700">
            超过 1 小时的长视频不会自动总结，请在下方点击「开始总结」。
          </p>
        )}

        {download.status && download.status !== 'idle' && (
          <div className="mt-0.5 rounded-xl bg-slate-50 p-2.5 lg:mt-1 lg:p-3">
            <div className="flex items-center justify-between text-[12px] text-slate-600">
              <span>
                {download.status === 'queued' && '正在准备下载文件…'}
                {download.status === 'downloading' && `正在拉取视频流 ${download.speed ? `· ${download.speed}` : ''}`}
                {download.status === 'paused' && '已暂停'}
                {download.status === 'processing' && '正在合并高画质音视频…'}
                {download.status === 'done' && '✓ 下载完成，已自动弹出浏览器保存'}
                {download.status === 'cancelled' && '已取消'}
                {download.status === 'error' && '下载出错'}
              </span>
              <span className="font-mono font-semibold text-slate-800">{Math.round(download.percent || 0)}%</span>
            </div>
            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-full rounded-full bg-[#0071e3] transition-all duration-300"
                style={{ width: `${Math.min(100, Math.max(0, download.percent || 0))}%` }}
              />
            </div>
            {isBusy && (
              <div className="mt-2 flex items-center justify-end gap-2">
                {download.status === 'downloading' && (
                  <button
                    type="button"
                    onClick={onPause}
                    className="text-[12px] text-slate-600 hover:text-slate-900"
                  >
                    暂停
                  </button>
                )}
                {download.status === 'paused' && (
                  <button
                    type="button"
                    onClick={onResume}
                    className="text-[12px] font-medium text-[#0071e3] hover:underline"
                  >
                    继续
                  </button>
                )}
                <button
                  type="button"
                  onClick={onCancel}
                  className="text-[12px] text-red-600 hover:underline"
                >
                  取消
                </button>
              </div>
            )}
          </div>
        )}

        {download.error && <p className="text-[12.5px] text-red-500">{download.error}</p>}
      </div>
    </div>
  );
};

export const UploadMetaCard: React.FC<{
  meta: UploadMeta;
  mobilePlayerCollapsed?: boolean;
  onToggleMobilePlayer?: () => void;
}> = ({ meta, mobilePlayerCollapsed = false, onToggleMobilePlayer }) => {
  const mb = meta.size ? `${(meta.size / 1024 / 1024).toFixed(1)} MB` : '';
  return (
    <div className="rounded-2xl border border-black/[0.06] bg-white px-3 py-2.5 shadow-2xs lg:border-slate-200/80 lg:p-4 lg:shadow-sm">
      <div className="flex items-center justify-between gap-2.5">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-[#0071e3]/10 text-[#0071e3] lg:h-9 lg:w-9">
            <svg className="h-4.5 w-4.5 lg:h-5 lg:w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
              <path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14v-4z" />
              <rect x="3" y="6" width="12" height="12" rx="2" />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-[13px] font-semibold text-slate-900 lg:text-[14.5px]">
              {meta.filename || '本地视频'}
            </h3>
            <p className="mt-0.5 text-[11px] text-slate-500 lg:text-[12px]">
              本地上传文件 {mb ? `· ${mb}` : ''}
            </p>
          </div>
        </div>
        {onToggleMobilePlayer && (
          <button
            type="button"
            onClick={onToggleMobilePlayer}
            className="inline-flex h-7 shrink-0 items-center gap-0.5 rounded-full bg-slate-100 px-2.5 text-[11px] font-medium text-slate-700 transition active:scale-95 lg:hidden"
          >
            <span>{mobilePlayerCollapsed ? '▶ 画面' : '▲ 收起'}</span>
          </button>
        )}
      </div>
    </div>
  );
};
