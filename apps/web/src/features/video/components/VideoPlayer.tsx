import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { prepareMedia, resolveVideoMediaUrl } from '../lib/api';

export interface VideoPlayerConfig {
  url?: string;
  fileId?: string;
  formatId?: string;
  browser?: string | null;
  localSrc?: string;
}

export interface VideoPlayerHandle {
  seekTo: (seconds: number) => void;
  reload: () => void;
}

interface VideoPlayerProps {
  config: VideoPlayerConfig | null;
  poster?: string;
  title?: string;
}

const PORTRAIT_PROVIDERS = new Set(['tiktok', 'douyin']);

function withEmbedParent(url: string): string {
  if (!url) return '';
  const parent = typeof window !== 'undefined' ? window.location.hostname || 'localhost' : 'localhost';
  return url.replace(/\{parent\}/g, parent);
}

export const VideoPlayer = forwardRef<VideoPlayerHandle, VideoPlayerProps>(function VideoPlayer(
  { config, poster, title },
  ref,
) {
  const [loading, setLoading] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [error, setError] = useState('');
  const [playback, setPlayback] = useState<any>(null);
  const [embedSrc, setEmbedSrc] = useState('');
  const [embedKey, setEmbedKey] = useState(0);
  const [portraitByMeta, setPortraitByMeta] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const reqIdRef = useRef(0);
  const pendingSeekRef = useRef<number | null>(null);
  const lastKnownTimeRef = useRef<number>(0);
  const autoRetryCountRef = useRef<number>(0);

  const mode = playback?.mode || '';
  const provider = playback?.provider || '';
  const videoSrc = resolveVideoMediaUrl(playback?.src || '');
  const urlLower = (config?.url || '').toLowerCase();
  const isPortraitByUrl =
    urlLower.includes('douyin') ||
    urlLower.includes('iesdouyin') ||
    urlLower.includes('tiktok');
  const isPortrait =
    playback?.orientation === 'portrait' ||
    PORTRAIT_PROVIDERS.has(provider) ||
    isPortraitByUrl ||
    portraitByMeta;

  const buildEmbedUrl = (p: any, t = 0): string => {
    if (!p) return '';
    const sec = Math.max(0, Math.floor(t));
    if (p.provider === 'bilibili' && p.bvid && p.cid) {
      return `https://player.bilibili.com/player.html?isOutside=true&autoplay=0&bvid=${encodeURIComponent(p.bvid)}&cid=${p.cid}&t=${sec}`;
    }
    if (p.provider === 'youtube' && p.video_id) {
      return `https://www.youtube.com/embed/${p.video_id}?enablejsapi=1&start=${sec}&autoplay=1`;
    }
    if (p.provider === 'piped') {
      const base = p.embed_url || (p.video_id ? `https://piped.video/embed/${p.video_id}` : '');
      if (!base) return '';
      const join = base.includes('?') ? '&' : '?';
      return `${base}${join}t=${sec}`;
    }
    if (p.provider === 'tiktok' && p.video_id) {
      const base = p.embed_url || `https://www.tiktok.com/embed/v2/${p.video_id}`;
      const join = base.includes('?') ? '&' : '?';
      return `${base}${join}lang=zh-CN${sec > 0 ? `&timestamp=${sec}` : ''}`;
    }
    if (p.embed_url) {
      return withEmbedParent(p.embed_url);
    }
    return '';
  };

  const applyPendingSeek = (v: HTMLVideoElement | null) => {
    if (!v || pendingSeekRef.current === null) return;
    if (v.readyState < 1) return;
    const target = Math.max(0, Number(pendingSeekRef.current) || 0);
    pendingSeekRef.current = null;
    try {
      v.currentTime = target;
      const playPromise = v.play();
      if (playPromise && typeof playPromise.then === 'function') {
        playPromise
          .then(() => {
            if (Math.abs((v.currentTime || 0) - target) > 1.5) {
              try {
                v.currentTime = target;
              } catch {
                // ignore
              }
            }
          })
          .catch(() => {
            // ignore autoplay block
          });
      }
    } catch {
      // ignore
    }
  };

  const loadPlayback = async (opts?: { seekTo?: number; isAutoRetry?: boolean }) => {
    const reqId = ++reqIdRef.current;
    if (typeof opts?.seekTo === 'number' && !Number.isNaN(opts.seekTo)) {
      pendingSeekRef.current = Math.max(0, opts.seekTo);
    }
    if (!opts?.isAutoRetry) {
      autoRetryCountRef.current = 0;
    }

    setError('');
    if (!opts?.isAutoRetry) {
      setPlayback(null);
      setEmbedSrc('');
      setPortraitByMeta(false);
    }
    if (!config) {
      setLoading(false);
      setRecovering(false);
      return;
    }

    if (config.localSrc) {
      setLoading(false);
      setRecovering(false);
      setPlayback({
        mode: 'video',
        stream_type: 'progressive',
        src: resolveVideoMediaUrl(config.localSrc),
        mime: 'video/mp4',
        source: 'local',
      });
      return;
    }

    if (!config.url && !config.fileId) {
      setLoading(false);
      setRecovering(false);
      return;
    }

    if (opts?.isAutoRetry) {
      setRecovering(true);
    } else {
      setLoading(true);
    }

    try {
      const data: any = await prepareMedia({
        url: config.url,
        fileId: config.fileId,
        formatId: config.formatId,
        browser: config.browser || undefined,
      });
      if (reqId !== reqIdRef.current) return;
      setPlayback(data);
      if (data.mode === 'embed') {
        const startSec = pendingSeekRef.current ?? 0;
        pendingSeekRef.current = null;
        setEmbedSrc(buildEmbedUrl(data, startSec));
        setEmbedKey((k) => k + 1);
      }
    } catch (e: any) {
      if (reqId !== reqIdRef.current) return;
      setError(e?.message || '无法加载播放器');
    } finally {
      if (reqId === reqIdRef.current) {
        setLoading(false);
        setRecovering(false);
      }
    }
  };

  useEffect(() => {
    pendingSeekRef.current = null;
    lastKnownTimeRef.current = 0;
    autoRetryCountRef.current = 0;
    void loadPlayback();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?.url, config?.fileId, config?.formatId, config?.browser, config?.localSrc]);

  useImperativeHandle(ref, () => ({
    seekTo(seconds: number) {
      const t = Math.max(0, Number(seconds) || 0);
      pendingSeekRef.current = t;
      lastKnownTimeRef.current = t;

      // 若之前因流过期处于报错状态，或尚未完成首次准备，点击进度自动重连并跳转
      if (error || (!playback && !loading)) {
        autoRetryCountRef.current = 0;
        void loadPlayback({ seekTo: t });
        return;
      }

      if (loading || recovering) {
        // 已记录到 pendingSeekRef.current，流加载完成后会在 onLoadedMetadata / onCanPlay 自动跳转
        return;
      }

      if ((mode === 'video' || mode === 'progressive') && videoRef.current) {
        const v = videoRef.current;
        if (v.readyState >= 1) {
          applyPendingSeek(v);
        } else {
          // 播放器尚未完成元数据初始化：触发加载并在 onLoadedMetadata / onCanPlay 中完成精准跳转
          try {
            v.load();
            void v.play().catch(() => {});
          } catch {
            // ignore
          }
        }
        return;
      }

      if (mode === 'embed' && playback) {
        pendingSeekRef.current = null;
        setEmbedSrc(buildEmbedUrl(playback, t));
        setEmbedKey((k) => k + 1);
      }
    },
    reload() {
      autoRetryCountRef.current = 0;
      void loadPlayback({ seekTo: pendingSeekRef.current ?? lastKnownTimeRef.current });
    },
  }));

  if (!config) return null;

  return (
    <div
      className={`relative overflow-hidden rounded-2xl bg-black shadow-sm ${
        isPortrait
          ? 'mx-auto h-[200px] w-full sm:h-[240px] lg:h-auto lg:aspect-[9/16] lg:max-w-[min(100%,390px)] lg:max-h-[66vh]'
          : 'h-[200px] w-full sm:h-[240px] lg:h-auto lg:aspect-video lg:max-h-[54vh]'
      }`}
    >
      {(loading || recovering) && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-slate-950/85 text-xs text-white/85">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/25 border-t-white" />
          <span>{recovering ? '正在刷新视频流并定位进度…' : '正在准备视频流…'}</span>
        </div>
      )}

      {error && !loading && !recovering && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-slate-950/95 px-5 text-center text-xs text-white/85">
          <p className="max-w-sm leading-relaxed text-red-300">{error}</p>
          <button
            type="button"
            onClick={() => {
              autoRetryCountRef.current = 0;
              void loadPlayback({ seekTo: pendingSeekRef.current ?? lastKnownTimeRef.current });
            }}
            className="mt-1 rounded-full bg-white/15 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-white/25"
          >
            重试播放
          </button>
        </div>
      )}

      {!loading && !error && (mode === 'video' || mode === 'progressive') && videoSrc && (
        <video
          key={videoSrc}
          ref={videoRef}
          src={videoSrc}
          poster={poster || undefined}
          preload="metadata"
          controls
          playsInline
          className="h-full w-full object-contain bg-black"
          onLoadedMetadata={(e) => {
            const v = e.currentTarget;
            if (v.videoWidth && v.videoHeight) {
              setPortraitByMeta(v.videoHeight > v.videoWidth * 1.05);
            }
            applyPendingSeek(v);
          }}
          onCanPlay={(e) => {
            autoRetryCountRef.current = 0;
            applyPendingSeek(e.currentTarget);
          }}
          onTimeUpdate={(e) => {
            const cur = e.currentTarget.currentTime;
            if (cur > 0) {
              lastKnownTimeRef.current = cur;
            }
          }}
          onError={() => {
            // 若代理令牌或防盗链流因长时间闲置失效，自动静默重签一次并恢复进度
            if (autoRetryCountRef.current < 2 && !config.localSrc) {
              autoRetryCountRef.current += 1;
              const resumeTime =
                pendingSeekRef.current ??
                (videoRef.current?.currentTime || lastKnownTimeRef.current || 0);
              void loadPlayback({ seekTo: resumeTime, isAutoRetry: true });
              return;
            }
            setError('视频加载失败。海外平台请确认网络畅通，或先在下方下载后播放。');
          }}
        />
      )}

      {!loading && !error && mode === 'embed' && embedSrc && (
        <iframe
          key={embedKey}
          src={embedSrc}
          title={title || '嵌入式视频播放器'}
          className="h-full w-full border-0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />
      )}
    </div>
  );
});
