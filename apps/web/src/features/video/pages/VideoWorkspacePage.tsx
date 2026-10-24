import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { readAuthSession } from '@/shared/lib/config/auth';
import {
  cancelDownload,
  cancelSummarize,
  fileDownloadUrl,
  getGuestQuota,
  getProgress,
  getSummary,
  getTranslation,
  parseVideo,
  pauseDownload,
  resumeDownload,
  startDownload,
  startSummarize,
  startTranslate,
  uploadMedia,
} from '../lib/api';
import { saveGuestVideo } from '../lib/guestHistory';
import type {
  DownloadState,
  SummaryState,
  TranslationState,
  UploadMeta,
  VideoGuestQuota,
  VideoInfo,
} from '../lib/types';
import { HeroInputSection } from '../components/HeroInputSection';
import { SummaryPanel } from '../components/SummaryPanel';
import { UploadMetaCard, VideoDownloadCard } from '../components/VideoDownloadCard';
import { VideoPlayer, type VideoPlayerConfig, type VideoPlayerHandle } from '../components/VideoPlayer';

const LONG_VIDEO_SEC = 3600;
const AUTO_SUMMARY_DELAY_MS = 3500;

export const VideoWorkspacePage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const sParam = searchParams.get('s') || '';
  const analysisParam = searchParams.get('analysis') || '';
  const shareParam = searchParams.get('share') || '';
  const targetLookupId = sParam || analysisParam;
  const isReadOnlyShare = Boolean(sParam || (shareParam && analysisParam));

  const [shareToken, setShareToken] = useState(sParam || shareParam);

  const [url, setUrl] = useState('');
  const [inputTab, setInputTab] = useState<'upload' | 'link'>('upload');
  const [pendingUploadFile, setPendingUploadFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState('');
  const [parseErrorCode, setParseErrorCode] = useState('');
  const [info, setInfo] = useState<VideoInfo | null>(null);
  const [selectedFormat, setSelectedFormat] = useState('');
  const [useCookies, setUseCookies] = useState(false);
  const [cookieBrowser, setCookieBrowser] = useState('firefox');

  const [uploadLoading, setUploadLoading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState('');
  const [uploadMeta, setUploadMeta] = useState<UploadMeta | null>(null);

  const [guestQuota, setGuestQuota] = useState<VideoGuestQuota | null>(null);
  const [mobilePlayerCollapsed, setMobilePlayerCollapsed] = useState(false);

  const [download, setDownload] = useState<DownloadState>({
    status: 'idle',
    percent: 0,
    speed: '',
    eta: '',
    taskId: '',
    ready: false,
    downloadUrl: '',
    error: '',
  });

  const [summaryTaskId, setSummaryTaskId] = useState('');
  const [summary, setSummary] = useState<SummaryState>({
    status: 'idle',
    stage: '',
    stageMessage: '',
    percent: 0,
    result: null,
    partial_transcript: [],
    timing: null,
    error: '',
    errorCode: '',
  });

  const [translation, setTranslation] = useState<TranslationState>({
    status: 'idle',
    percent: 0,
    result: null,
    error: '',
  });

  const pollTimerRef = useRef<any>(null);
  const summaryTimerRef = useRef<any>(null);
  const translateTimerRef = useRef<any>(null);
  const videoPlayerRef = useRef<VideoPlayerHandle | null>(null);
  const prevAnalysisParamRef = useRef<string>(analysisParam);
  const autoDownloadedTaskRef = useRef<string>('');

  const hasWorkspace = !!(info || uploadMeta);

  const loadQuota = async () => {
    if (readAuthSession()) {
      setGuestQuota(null);
      return;
    }
    const q = await getGuestQuota();
    setGuestQuota(q);
  };

  const clearTimers = () => {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    if (summaryTimerRef.current) clearInterval(summaryTimerRef.current);
    if (translateTimerRef.current) clearInterval(translateTimerRef.current);
    pollTimerRef.current = null;
    summaryTimerRef.current = null;
    translateTimerRef.current = null;
  };

  useEffect(() => {
    void loadQuota();
    return () => clearTimers();
  }, []);

  const resetTranslation = () => {
    if (translateTimerRef.current) {
      clearInterval(translateTimerRef.current);
      translateTimerRef.current = null;
    }
    setTranslation({ status: 'idle', percent: 0, result: null, error: '' });
  };

  const resetSummary = () => {
    if (summaryTimerRef.current) {
      clearInterval(summaryTimerRef.current);
      summaryTimerRef.current = null;
    }
    setSummaryTaskId('');
    setSummary({
      status: 'idle',
      stage: '',
      stageMessage: '',
      percent: 0,
      result: null,
      partial_transcript: [],
      timing: null,
      error: '',
      errorCode: '',
    });
    resetTranslation();
  };

  const resetDownload = () => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    setDownload({
      status: 'idle',
      percent: 0,
      speed: '',
      eta: '',
      taskId: '',
      ready: false,
      downloadUrl: '',
      error: '',
    });
  };

  const pollSummary = async (taskId: string, currentTitle?: string, currentSourceUrl?: string) => {
    try {
      const p = await getSummary(taskId);
      setSummary((prev) => ({
        ...prev,
        status: (p.status as any) || prev.status,
        stage: p.stage || '',
        percent: p.percent || 0,
        stageMessage: p.stage_message || '',
        partial_transcript: p.partial_transcript || [],
        timing: p.timing || null,
        result: p.result || prev.result,
        error:
          p.status === 'cancelled'
            ? p.error || '已取消 AI 总结'
            : p.status === 'error'
              ? p.error || 'AI 总结失败，请重试'
              : '',
        errorCode: p.error_code || '',
      }));

      if (p.share_token) {
        setShareToken(p.share_token);
      }

      if (p.status === 'done') {
        if (summaryTimerRef.current) {
          clearInterval(summaryTimerRef.current);
          summaryTimerRef.current = null;
        }
        if (!readAuthSession()) {
          saveGuestVideo({
            id: taskId,
            summary_task_id: taskId,
            title:
              p.video_title ||
              p.result?.title ||
              currentTitle ||
              uploadMeta?.filename ||
              info?.title ||
              '未命名视频',
            source_type: p.source_type || (uploadMeta ? 'upload' : 'url'),
            source_url: p.webpage_url || currentSourceUrl || info?.webpage_url || '',
            duration_seconds: p.duration || info?.duration || uploadMeta?.duration || 0,
            summary_result: p.result,
          });
        }
      } else if (p.status === 'cancelled' || p.status === 'error') {
        if (summaryTimerRef.current) {
          clearInterval(summaryTimerRef.current);
          summaryTimerRef.current = null;
        }
      }
    } catch (err: any) {
      if (summaryTimerRef.current) {
        clearInterval(summaryTimerRef.current);
        summaryTimerRef.current = null;
      }
      setSummary((prev) => ({
        ...prev,
        status: 'error',
        error: err?.message || '查询总结进度失败',
      }));
    }
  };

  const triggerSummarizeUpload = async (
    fileId: string,
    filename: string,
    opts: { targetLang?: string; prompt?: string } = {},
  ) => {
    if (summaryTimerRef.current) {
      clearInterval(summaryTimerRef.current);
      summaryTimerRef.current = null;
    }
    resetTranslation();
    setSummary({
      status: 'queued',
      stage: 'queued',
      stageMessage: '',
      percent: 0,
      result: null,
      partial_transcript: [],
      timing: null,
      error: '',
      errorCode: '',
    });
    try {
      const res = await startSummarize({
        file_id: fileId,
        target_lang: opts.targetLang || 'zh',
        prompt: opts.prompt,
      });
      prevAnalysisParamRef.current = res.task_id;
      setSummaryTaskId(res.task_id);
      setSearchParams({ analysis: res.task_id }, { replace: true });
      void loadQuota();
      summaryTimerRef.current = setInterval(() => {
        void pollSummary(res.task_id, filename);
      }, 700);
    } catch (err: any) {
      setSummary((prev) => ({
        ...prev,
        status: 'error',
        error: err?.message || '启动总结失败',
        errorCode: err?.code || 'generic',
      }));
      void loadQuota();
    }
  };

  const triggerSummarizeUrl = async (
    targetUrl: string,
    title: string,
    opts: { targetLang?: string; prompt?: string } = {},
  ) => {
    if (summaryTimerRef.current) {
      clearInterval(summaryTimerRef.current);
      summaryTimerRef.current = null;
    }
    resetTranslation();
    setSummary({
      status: 'queued',
      stage: 'queued',
      stageMessage: '',
      percent: 0,
      result: null,
      partial_transcript: [],
      timing: null,
      error: '',
      errorCode: '',
    });
    try {
      const res = await startSummarize({
        url: targetUrl,
        browser: useCookies ? cookieBrowser : null,
        target_lang: opts.targetLang || 'zh',
        prompt: opts.prompt,
      });
      prevAnalysisParamRef.current = res.task_id;
      setSummaryTaskId(res.task_id);
      setSearchParams({ analysis: res.task_id }, { replace: true });
      void loadQuota();
      summaryTimerRef.current = setInterval(() => {
        void pollSummary(res.task_id, title, targetUrl);
      }, 700);
    } catch (err: any) {
      setSummary((prev) => ({
        ...prev,
        status: 'error',
        error: err?.message || '启动总结失败',
        errorCode: err?.code || 'generic',
      }));
      void loadQuota();
    }
  };

  const handleStageFile = (file: File) => {
    setPendingUploadFile(file);
    setUploadError('');
    setParseError('');
    setInfo(null);
    setUploadMeta(null);
    resetSummary();
    resetDownload();
  };

  const handleParseUpload = async () => {
    if (!pendingUploadFile) {
      setUploadError('请先选择要上传的视频');
      return;
    }
    setUploadError('');
    setUploadMeta(null);
    setUploadLoading(true);
    setUploadProgress(0);
    setParsing(true);
    resetSummary();
    setInfo(null);
    resetDownload();
    const file = pendingUploadFile;
    try {
      const meta = await uploadMedia(file, (p) => setUploadProgress(p));
      setUploadMeta(meta);
      setPendingUploadFile(null);
      await triggerSummarizeUpload(meta.file_id, meta.filename || file.name, { targetLang: 'zh' });
    } catch (err: any) {
      setUploadError(err?.message || '上传失败');
    } finally {
      setUploadLoading(false);
      setParsing(false);
    }
  };

  const handleParseUrl = async () => {
    const value = url.trim();
    if (!value) {
      setParseError('请输入视频链接');
      return;
    }
    setParsing(true);
    setParseError('');
    setParseErrorCode('');
    setInfo(null);
    resetDownload();
    resetSummary();
    setUploadMeta(null);
    setPendingUploadFile(null);
    try {
      const data = await parseVideo(value, {
        useCookies,
        browser: useCookies ? cookieBrowser : null,
      });
      setInfo(data);
      const resolvedUrl = data.webpage_url || value;
      if (data.webpage_url) setUrl(data.webpage_url);
      setSelectedFormat(data.formats?.[0]?.format_id || '');
      if ((data.duration || 0) <= LONG_VIDEO_SEC) {
        setTimeout(() => {
          void triggerSummarizeUrl(resolvedUrl, data.title || '在线视频', { targetLang: 'zh' });
        }, AUTO_SUMMARY_DELAY_MS);
      }
    } catch (err: any) {
      setParseError(err?.message || '解析失败');
      setParseErrorCode(err?.code || 'generic');
    } finally {
      setParsing(false);
    }
  };

  const triggerBrowserFileDownload = (dlUrl: string) => {
    if (typeof document === 'undefined' || !dlUrl) return;
    const a = document.createElement('a');
    a.href = dlUrl;
    a.setAttribute('download', '');
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
    }, 200);
  };

  const pollDownloadProgress = async (taskId: string) => {
    try {
      const p = await getProgress(taskId);
      const isFinished = p.status === 'finished';
      const dlUrl = isFinished ? fileDownloadUrl(taskId) : '';
      setDownload((prev) => ({
        ...prev,
        status: (isFinished ? 'done' : p.status) as any,
        percent: isFinished ? 100 : p.percent || 0,
        speed: p.speed || '',
        eta: p.eta || '',
        ready: isFinished || !!prev.ready,
        downloadUrl: dlUrl || prev.downloadUrl,
        error: p.status === 'error' ? p.error || '下载失败，请重试' : '',
      }));
      if (isFinished && autoDownloadedTaskRef.current !== taskId) {
        autoDownloadedTaskRef.current = taskId;
        triggerBrowserFileDownload(dlUrl);
      }
      if (isFinished || p.status === 'error' || p.status === 'cancelled') {
        if (pollTimerRef.current) {
          clearInterval(pollTimerRef.current);
          pollTimerRef.current = null;
        }
      }
    } catch (err: any) {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      setDownload((prev) => ({
        ...prev,
        status: 'error',
        error: err?.message || '获取下载进度失败',
      }));
    }
  };

  const handleStartDownload = async () => {
    if (!info) return;
    resetDownload();
    setDownload((prev) => ({ ...prev, status: 'queued' }));
    try {
      const res = await startDownload({
        url: info.webpage_url || url.trim(),
        format_id: selectedFormat || undefined,
        title: info.title,
        browser: useCookies ? cookieBrowser : null,
      });
      setDownload((prev) => ({ ...prev, taskId: res.task_id }));
      pollTimerRef.current = setInterval(() => {
        void pollDownloadProgress(res.task_id);
      }, 1000);
    } catch (err: any) {
      setDownload((prev) => ({
        ...prev,
        status: 'error',
        error: err?.message || '启动下载失败',
      }));
    }
  };

  const handleCancelSummary = async () => {
    if (!summaryTaskId) return;
    if (summaryTimerRef.current) {
      clearInterval(summaryTimerRef.current);
      summaryTimerRef.current = null;
    }
    try {
      await cancelSummarize(summaryTaskId);
    } catch {
      // ignore
    }
    setSummary((prev) => ({
      ...prev,
      status: 'cancelled',
      stage: 'cancelled',
      error: '已取消 AI 总结',
    }));
  };

  const handleTranslate = async (targetLang = 'zh') => {
    if (!summaryTaskId || summary.status !== 'done') return;
    if (translateTimerRef.current) {
      clearInterval(translateTimerRef.current);
      translateTimerRef.current = null;
    }
    setTranslation({ status: 'translating', percent: 0, result: null, error: '' });
    try {
      const res = await startTranslate(summaryTaskId, targetLang);
      translateTimerRef.current = setInterval(async () => {
        try {
          const p = await getTranslation(res.task_id);
          setTranslation({
            status: (p.status as any) || 'translating',
            percent: p.percent || 0,
            result: p.status === 'done' ? p.result || null : null,
            error: p.status === 'error' ? p.error || '翻译失败' : '',
          });
          if (p.status === 'done' || p.status === 'error') {
            if (translateTimerRef.current) {
              clearInterval(translateTimerRef.current);
              translateTimerRef.current = null;
            }
          }
        } catch (err: any) {
          if (translateTimerRef.current) {
            clearInterval(translateTimerRef.current);
            translateTimerRef.current = null;
          }
          setTranslation((prev) => ({
            ...prev,
            status: 'error',
            error: err?.message || '翻译失败',
          }));
        }
      }, 1500);
    } catch (err: any) {
      setTranslation({
        status: 'error',
        percent: 0,
        result: null,
        error: err?.message || '启动翻译失败',
      });
    }
  };

  const resetToHome = () => {
    clearTimers();
    setParsing(false);
    setParseError('');
    setParseErrorCode('');
    setUploadError('');
    setInfo(null);
    setUploadMeta(null);
    setPendingUploadFile(null);
    resetDownload();
    resetSummary();
  };

  useEffect(() => {
    const onResetHome = () => {
      resetToHome();
    };
    window.addEventListener('vidgrab:reset-home', onResetHome);
    return () => window.removeEventListener('vidgrab:reset-home', onResetHome);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load historical or shared analysis when `?s=<short>` or `?analysis=<id>` is present
  useEffect(() => {
    if (!targetLookupId) {
      if (prevAnalysisParamRef.current) {
        prevAnalysisParamRef.current = '';
        resetToHome();
      }
      return;
    }
    if (prevAnalysisParamRef.current === targetLookupId && summaryTaskId) {
      return;
    }
    prevAnalysisParamRef.current = targetLookupId;
    let cancelled = false;
    const loadAnalysis = async () => {
      setParsing(true);
      setParseError('');
      resetDownload();
      resetTranslation();
      setSummaryTaskId(analysisParam || targetLookupId);
      setSummary({
        status: 'queued',
        stage: 'fetching',
        stageMessage: '正在读取历史认知研报…',
        percent: 10,
        result: null,
        partial_transcript: [],
        timing: null,
        error: '',
        errorCode: '',
      });
      try {
        const data = await getSummary(targetLookupId, shareParam || null);
        if (cancelled) return;
        if (data.task_id) {
          setSummaryTaskId(data.task_id);
        }
        if (data.share_token) {
          setShareToken(data.share_token);
        } else if (sParam || shareParam) {
          setShareToken(sParam || shareParam);
        }
        setSummary({
          status: (data.status as any) || 'done',
          stage: data.stage || 'done',
          stageMessage: data.stage_message || '',
          percent: data.percent || 100,
          result: data.result || null,
          partial_transcript: data.partial_transcript || [],
          timing: data.timing || null,
          error: '',
          errorCode: '',
        });
        if (data.source_type === 'upload' && data.video_id) {
          setInputTab('upload');
          setUploadMeta({
            file_id: data.video_id,
            filename: data.video_title || '本地视频',
            duration: data.duration,
          });
          setInfo(null);
        } else if (data.webpage_url) {
          setInputTab('link');
          setUrl(data.webpage_url);
          const baseTitle = data.video_title || data.result?.title || '在线视频';
          setInfo({
            webpage_url: data.webpage_url,
            title: baseTitle,
            duration: data.duration,
          });
          setUploadMeta(null);

          // 后台静默补全视频平台元数据（作者名、清晰度列表、封面图）
          void parseVideo(data.webpage_url, {
            useCookies,
            browser: useCookies ? cookieBrowser : null,
          })
            .then((metaInfo) => {
              if (cancelled || !metaInfo) return;
              setInfo((prev) => ({
                ...prev,
                ...metaInfo,
                webpage_url: metaInfo.webpage_url || data.webpage_url,
                title: metaInfo.title || prev?.title || baseTitle,
                duration: metaInfo.duration || prev?.duration || data.duration,
              }));
              if (metaInfo.formats?.[0]?.format_id) {
                setSelectedFormat(metaInfo.formats[0].format_id);
              }
            })
            .catch(() => {
              // 忽略静默补充失败，不影响视频播放与默认画质下载
            });
        }
      } catch (err: any) {
        if (cancelled) return;
        setSummary((prev) => ({
          ...prev,
          status: 'error',
          error: err?.message || '调取历史研报失败',
        }));
      } finally {
        if (!cancelled) setParsing(false);
      }
    };
    void loadAnalysis();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetLookupId, shareParam]);

  const playerConfig: VideoPlayerConfig | null = useMemo(() => {
    if (uploadMeta?.file_id) {
      return { fileId: uploadMeta.file_id };
    }
    if (download.ready && download.downloadUrl) {
      return { localSrc: download.downloadUrl };
    }
    if (info?.webpage_url) {
      return {
        url: info.webpage_url,
        browser: useCookies ? cookieBrowser : null,
      };
    }
    return null;
  }, [cookieBrowser, download.downloadUrl, download.ready, info?.webpage_url, uploadMeta?.file_id, useCookies]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:overflow-hidden">
      {!isReadOnlyShare && (
        <HeroInputSection
          urlValue={url}
          onUrlChange={setUrl}
          loading={parsing || uploadLoading}
          error={parseError}
          errorCode={parseErrorCode}
          useCookies={useCookies}
          onUseCookiesChange={setUseCookies}
          browser={cookieBrowser}
          onBrowserChange={setCookieBrowser}
          uploadLoading={uploadLoading}
          uploadProgress={uploadProgress}
          uploadError={uploadError}
          uploadMeta={uploadMeta}
          guestQuota={guestQuota}
          compact={hasWorkspace}
          inputTab={inputTab}
          onInputTabChange={setInputTab}
          pendingFileName={pendingUploadFile?.name || ''}
          onParseUrl={() => void handleParseUrl()}
          onParseUpload={() => void handleParseUpload()}
          onStageFile={handleStageFile}
        />
      )}

      {hasWorkspace && (
        <div className="mx-auto flex min-h-0 w-full max-w-[1600px] flex-1 flex-col gap-2 overflow-hidden px-2.5 pt-2 pb-2 sm:px-4 lg:grid lg:grid-cols-[minmax(360px,0.88fr)_minmax(0,1.38fr)] lg:gap-4 lg:px-6 lg:pt-3 lg:pb-3.5">
          {/* Left Column (Desktop) / Sticky Top Player & Compact Info Drawer (Mobile) */}
          <div className="flex shrink-0 flex-col gap-1.5 lg:panel-scroll lg:min-h-0 lg:gap-3 lg:pr-1">
            <div className={mobilePlayerCollapsed ? 'hidden lg:block' : 'block'}>
              <VideoPlayer
                ref={videoPlayerRef}
                config={playerConfig}
                poster={info?.thumbnail || ''}
                title={info?.title || uploadMeta?.filename || ''}
              />
            </div>
            {info ? (
              <VideoDownloadCard
                embedded
                info={info}
                selectedFormat={selectedFormat}
                onSelectFormat={setSelectedFormat}
                download={download}
                mobilePlayerCollapsed={mobilePlayerCollapsed}
                onToggleMobilePlayer={() => setMobilePlayerCollapsed((v) => !v)}
                onStart={() => void handleStartDownload()}
                onCancel={() => {
                  if (download.taskId) void cancelDownload(download.taskId);
                }}
                onPause={() => {
                  if (download.taskId) {
                    void pauseDownload(download.taskId);
                    setDownload((prev) => ({ ...prev, status: 'paused' }));
                  }
                }}
                onResume={() => {
                  if (download.taskId) {
                    void resumeDownload(download.taskId);
                    setDownload((prev) => ({ ...prev, status: 'downloading' }));
                  }
                }}
              />
            ) : uploadMeta ? (
              <UploadMetaCard
                meta={uploadMeta}
                mobilePlayerCollapsed={mobilePlayerCollapsed}
                onToggleMobilePlayer={() => setMobilePlayerCollapsed((v) => !v)}
              />
            ) : null}
          </div>

          {/* Right Column (Desktop) / Bottom Main Card Workspace (Mobile) */}
          <SummaryPanel
            embedded
            summary={summary}
            translation={translation}
            summaryTaskId={summaryTaskId}
            videoTitle={info?.title || uploadMeta?.filename || '本地视频'}
            webpageUrl={info?.webpage_url || ''}
            videoDuration={info?.duration || uploadMeta?.duration || 0}
            readOnly={isReadOnlyShare}
            shareToken={shareToken || shareParam}
            onGenerate={(opts) => {
              if (info) {
                void triggerSummarizeUrl(info.webpage_url || url.trim(), info.title || '在线视频', opts);
              } else if (uploadMeta) {
                void triggerSummarizeUpload(uploadMeta.file_id, uploadMeta.filename, opts);
              }
            }}
            onTranslate={(lang) => void handleTranslate(lang)}
            onCancel={() => void handleCancelSummary()}
            onSeek={(sec) => {
              setMobilePlayerCollapsed(false);
              videoPlayerRef.current?.seekTo(sec);
            }}
          />
        </div>
      )}
    </div>
  );
};
