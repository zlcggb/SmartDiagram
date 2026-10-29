import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { usePlatformAuth } from '@/shared/store/authStore';
import {
  fetchCommunityPlayback,
  fetchCommunityPost,
  fetchCommunityPostSummary,
  getTranslation,
  parseVideo,
  resolveVideoMediaUrl,
  startTranslate,
  syncCommunityPost,
  withdrawCommunityPost,
} from '../lib/api';
import type {
  CommunityPost,
  SummaryState,
  TranslationState,
  VideoInfo,
} from '../lib/types';
import { AuthorChip } from '../components/AuthorChip';
import { CommunityInteractBar } from '../components/CommunityInteractBar';
import { SummaryPanel } from '../components/SummaryPanel';
import { useVideoDialog } from '../components/VideoDialog';
import {
  VideoPlayer,
  type VideoPlayerConfig,
  type VideoPlayerHandle,
} from '../components/VideoPlayer';

export const VideoCommunityPostPage: React.FC = () => {
  const { postId = '' } = useParams<{ postId: string }>();
  const navigate = useNavigate();
  const session = usePlatformAuth((state) => state.session);
  const openLogin = usePlatformAuth((state) => state.openLogin);
  const currentUserId = session?.user?.id || '';

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [post, setPost] = useState<CommunityPost | null>(null);
  const [info, setInfo] = useState<VideoInfo | null>(null);
  const [archiveLocalSrc, setArchiveLocalSrc] = useState('');
  const [summaryTaskId, setSummaryTaskId] = useState('');
  const [actionBusy, setActionBusy] = useState(false);
  const { confirm: confirmDialog, notify, dialogElement } = useVideoDialog();

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

  const translateTimerRef = useRef<any>(null);
  const videoPlayerRef = useRef<VideoPlayerHandle | null>(null);

  const clearTimers = () => {
    if (translateTimerRef.current) {
      clearInterval(translateTimerRef.current);
      translateTimerRef.current = null;
    }
  };

  const loadPostDetail = async () => {
    if (!postId || !session) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setErrorMsg('');
    setArchiveLocalSrc('');
    setInfo(null);
    try {
      const [postData, sumData, playData] = await Promise.all([
        fetchCommunityPost(postId),
        fetchCommunityPostSummary(postId),
        fetchCommunityPlayback(postId),
      ]);
      const mergedCoverUrl = postData.cover_url || sumData.cover_url || '';
      setPost(mergedCoverUrl ? { ...postData, cover_url: mergedCoverUrl } : postData);
      setSummaryTaskId(sumData.task_id || postData.analysis_id || '');
      setSummary({
        status: (sumData.status as any) || 'done',
        stage: sumData.stage || 'done',
        stageMessage: sumData.stage_message || '',
        percent: sumData.percent ?? 100,
        result: sumData.result || null,
        partial_transcript: sumData.partial_transcript || [],
        timing: sumData.timing || null,
        error: sumData.error || '',
        errorCode: sumData.error_code || '',
      });

      const onlineUrl = sumData.webpage_url || playData.source_url || postData.source_url || '';
      if (playData.storage_status === 'ready' && playData.src) {
        setArchiveLocalSrc(resolveVideoMediaUrl(playData.src));
      } else if (onlineUrl) {
        const baseTitle =
          postData.title || sumData.video_title || '社区共享视频';
        setInfo({
          webpage_url: onlineUrl,
          title: baseTitle,
          duration: sumData.duration,
        });
        void parseVideo(onlineUrl)
          .then((meta) => {
            if (!meta) return;
            setInfo((prev) => ({
              ...prev,
              ...meta,
              webpage_url: meta.webpage_url || onlineUrl,
              title: meta.title || prev?.title || baseTitle,
              duration: meta.duration || prev?.duration || sumData.duration,
            }));
          })
          .catch(() => {
            // ignore silent metadata enrichment failure
          });
      }
    } catch (e: any) {
      setErrorMsg(e?.message || '社区内容不存在或已下架');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadPostDetail();
    return () => clearTimers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postId, session?.access_token]);

  const playerConfig: VideoPlayerConfig | null = useMemo(() => {
    if (archiveLocalSrc) {
      return { localSrc: archiveLocalSrc };
    }
    if (info?.webpage_url) {
      return { url: info.webpage_url };
    }
    return null;
  }, [archiveLocalSrc, info?.webpage_url]);

  const handleTranslate = async (targetLang = 'zh') => {
    if (!summaryTaskId || summary.status !== 'done') return;
    clearTimers();
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
            clearTimers();
          }
        } catch (err: any) {
          clearTimers();
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

  const handleWithdraw = async () => {
    if (!post) return;
    const ok = await confirmDialog({
      title: '下架社区内容',
      message: `确认从学习社区下架「${post.title || '该内容'}」吗？下架后其他成员将不再可见，您仍可随时重新发布。`,
      confirmText: '确认下架',
      danger: true,
    });
    if (!ok) return;
    setActionBusy(true);
    try {
      await withdrawCommunityPost(post.id);
      navigate('/video/community');
    } catch (err: any) {
      notify(err?.message || '下架失败', 'error');
    } finally {
      setActionBusy(false);
    }
  };

  const handleSyncLatest = async () => {
    if (!post) return;
    setActionBusy(true);
    try {
      const updated = await syncCommunityPost(post.id);
      setPost(updated);
      notify('已同步最新研报至学习社区', 'success');
      await loadPostDetail();
    } catch (err: any) {
      notify(err?.message || '同步最新版本失败', 'error');
    } finally {
      setActionBusy(false);
    }
  };

  if (!session) {
    return (
      <div className="panel-scroll mx-auto flex w-full max-w-[1400px] flex-1 items-center justify-center px-4 py-16">
        <div className="w-full max-w-md rounded-3xl border border-slate-200/80 bg-white p-8 text-center shadow-sm">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[#0071e3]/10 text-2xl">
            🌐
          </div>
          <h2 className="mt-4 text-lg font-bold text-slate-900">登录以查看社区详情</h2>
          <p className="mt-2 text-[13px] leading-relaxed text-slate-500">
            请先登录平台账号以播放社区共享视频、查看完整研报与思维导图。
          </p>
          <button
            type="button"
            onClick={() => openLogin()}
            className="mt-6 inline-flex items-center justify-center rounded-full bg-[#0071e3] px-6 py-2.5 text-[13.5px] font-semibold text-white shadow-sm transition hover:bg-[#0077ed]"
          >
            立即登录账号
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:overflow-hidden">
      {/* Top Bar */}
      <div className="shrink-0 border-b border-slate-200/80 bg-white/80 px-4 py-2.5 backdrop-blur lg:px-6">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => navigate('/video/community')}
              className="inline-flex shrink-0 items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-1 text-[12px] font-medium text-slate-700 hover:border-[#0071e3]/40 hover:text-[#0071e3]"
            >
              ← 返回学习社区
            </button>
            {post && (
              <h1 className="truncate text-[14.5px] font-semibold text-slate-900">
                {post.title}
              </h1>
            )}
          </div>

          {post && (
            <div className="flex items-center gap-2.5 text-[12px] text-slate-500">
              <AuthorChip
                author={post.author}
                userId={post.author_id}
                label={post.author_display_name}
                email={post.author_email}
                avatarUrl={post.author_avatar_url}
                subText={`发布于 ${String(
                  post.published_at || post.created_at || '',
                )
                  .slice(0, 16)
                  .replace('T', ' ')}`}
                size="sm"
              />
              {post.is_author && post.status === 'outdated' && (
                <button
                  type="button"
                  disabled={actionBusy}
                  onClick={() => void handleSyncLatest()}
                  className="rounded-full bg-amber-500 px-3 py-1 text-[11.5px] font-semibold text-white hover:bg-amber-600 disabled:opacity-50"
                >
                  更新社区展示
                </button>
              )}
              {post.is_author && (
                <button
                  type="button"
                  disabled={actionBusy}
                  onClick={() => void handleWithdraw()}
                  className="rounded-full border border-rose-200 bg-rose-50/70 px-3 py-1 text-[11.5px] font-medium text-rose-600 hover:bg-rose-100 disabled:opacity-50"
                >
                  下架
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {loading ? (
        <div className="mx-auto flex w-full max-w-[1600px] flex-1 items-center justify-center p-12 text-[13px] text-slate-500">
          正在加载社区视频与研报…
        </div>
      ) : errorMsg ? (
        <div className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center p-12 text-center">
          <p className="text-base font-semibold text-slate-800">{errorMsg}</p>
          <button
            type="button"
            onClick={() => navigate('/video/community')}
            className="mt-4 rounded-full bg-[#0071e3] px-4 py-2 text-[13px] font-medium text-white"
          >
            返回学习社区
          </button>
        </div>
      ) : post ? (
        <div className="mx-auto flex min-h-0 w-full max-w-[1600px] flex-1 flex-col gap-3 overflow-y-auto px-2.5 pt-2 pb-4 sm:px-4 lg:grid lg:grid-cols-[minmax(360px,0.88fr)_minmax(0,1.38fr)] lg:gap-4 lg:overflow-hidden lg:px-6 lg:pt-3 lg:pb-3.5">
          {/* Left Column: VideoPlayer + CommunityInteractBar */}
          <div className="flex shrink-0 flex-col gap-3 lg:panel-scroll lg:min-h-0 lg:pr-1">
            <VideoPlayer
              ref={videoPlayerRef}
              config={playerConfig}
              poster={post.cover_url || info?.thumbnail || ''}
              title={post.title}
              analysisId={summaryTaskId || post.analysis_id || ''}
              postId={post.id}
              videoId={post.video_id || ''}
              existingCoverUrl={post.cover_url || ''}
              onCoverCaptured={(coverUrl) =>
                setPost((prev) => (prev ? { ...prev, cover_url: coverUrl } : prev))
              }
            />

            <CommunityInteractBar
              post={post}
              currentUserId={currentUserId}
              onPostUpdated={(patch) =>
                setPost((prev) => (prev ? { ...prev, ...patch } : prev))
              }
              onSynced={() => void loadPostDetail()}
            />
          </div>

          {/* Right Column: Full-height SummaryPanel (readOnly) */}
          <SummaryPanel
            embedded
            readOnly
            summary={summary}
            translation={translation}
            summaryTaskId={summaryTaskId}
            videoTitle={post.title}
            webpageUrl={info?.webpage_url || post.source_url || ''}
            videoDuration={post.duration_sec || info?.duration || 0}
            onGenerate={() => {}}
            onTranslate={(lang) => void handleTranslate(lang)}
            onCancel={() => {}}
            onSeek={(sec) => videoPlayerRef.current?.seekTo(sec)}
          />
        </div>
      ) : null}
      {dialogElement}
    </div>
  );
};
