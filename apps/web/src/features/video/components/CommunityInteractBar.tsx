import React, { useEffect, useState } from 'react';
import {
  fetchCommunityComments,
  postCommunityComment,
  reportCommunityComment,
  syncCommunityPost,
  toggleCommunityFavorite,
  toggleCommunityLike,
} from '../lib/api';
import type { CommunityComment, CommunityPost } from '../lib/types';
import { AuthorChip } from './AuthorChip';

export interface CommunityInteractBarProps {
  post: CommunityPost;
  currentUserId?: string;
  onPostUpdated?: (patch: Partial<CommunityPost>) => void;
  onSynced?: () => void;
}

export const CommunityInteractBar: React.FC<CommunityInteractBarProps> = ({
  post,
  currentUserId = '',
  onPostUpdated,
  onSynced,
}) => {
  const [liked, setLiked] = useState(Boolean(post.liked ?? post.viewer_liked));
  const [favorited, setFavorited] = useState(Boolean(post.favorited ?? post.viewer_favorited));
  const [likeCount, setLikeCount] = useState(Number(post.like_count || 0));
  const [favoriteCount, setFavoriteCount] = useState(Number(post.favorite_count || 0));
  const [commentCount, setCommentCount] = useState(Number(post.comment_count || 0));

  const [comments, setComments] = useState<CommunityComment[]>([]);
  const [commentBody, setCommentBody] = useState('');
  const [commentError, setCommentError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [reportedIds, setReportedIds] = useState<Record<string, boolean>>({});
  const [reportingCommentId, setReportingCommentId] = useState<string | null>(null);
  const [reportReason, setReportReason] = useState('');
  const [reportNotice, setReportNotice] = useState('');

  useEffect(() => {
    setLiked(Boolean(post.liked ?? post.viewer_liked));
    setFavorited(Boolean(post.favorited ?? post.viewer_favorited));
    setLikeCount(Number(post.like_count || 0));
    setFavoriteCount(Number(post.favorite_count || 0));
    setCommentCount(Number(post.comment_count || 0));
  }, [post]);

  const loadComments = async () => {
    if (!post?.id) return;
    try {
      const res = await fetchCommunityComments(post.id);
      setComments(res.items || []);
    } catch {
      setComments([]);
    }
  };

  useEffect(() => {
    void loadComments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post?.id]);

  const handleLike = async () => {
    try {
      const res = await toggleCommunityLike(post.id);
      setLiked(Boolean(res.liked));
      setLikeCount(Number(res.like_count || 0));
      onPostUpdated?.({ liked: res.liked, like_count: res.like_count });
    } catch (e: any) {
      setCommentError(e?.message || '操作失败');
    }
  };

  const handleFavorite = async () => {
    try {
      const res = await toggleCommunityFavorite(post.id);
      setFavorited(Boolean(res.favorited));
      setFavoriteCount(Number(res.favorite_count || 0));
      onPostUpdated?.({
        favorited: res.favorited,
        favorite_count: res.favorite_count,
      });
    } catch (e: any) {
      setCommentError(e?.message || '操作失败');
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    setCommentError('');
    try {
      const updated = await syncCommunityPost(post.id);
      onPostUpdated?.(updated);
      onSynced?.();
    } catch (e: any) {
      setCommentError(e?.message || '同步失败');
    } finally {
      setSyncing(false);
    }
  };

  const handleSubmitComment = async () => {
    const text = commentBody.trim();
    if (!text || submitting) return;
    setCommentError('');
    setSubmitting(true);
    try {
      const created = await postCommunityComment(post.id, text);
      setComments((prev) => [...prev, created]);
      setCommentBody('');
      const nextCount = commentCount + 1;
      setCommentCount(nextCount);
      onPostUpdated?.({ comment_count: nextCount });
    } catch (e: any) {
      setCommentError(e?.message || '评论未通过合规校验');
    } finally {
      setSubmitting(false);
    }
  };

  const submitReport = async (c: CommunityComment) => {
    try {
      await reportCommunityComment(c.id, reportReason.trim());
      setReportedIds((prev) => ({ ...prev, [c.id]: true }));
      setReportingCommentId(null);
      setReportReason('');
      setReportNotice('已提交举报，感谢共同维护学习社区环境');
      setTimeout(() => setReportNotice(''), 3000);
    } catch (e: any) {
      setCommentError(e?.message || '举报提交失败');
    }
  };

  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
      {post.status === 'outdated' && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50/90 px-3.5 py-2 text-[12px] text-amber-800">
          <span>⚠️ 作者已在个人工作台重新生成了新版本研报，当前展示为历史发布版本。</span>
          {post.is_author && (
            <button
              type="button"
              disabled={syncing}
              onClick={() => void handleSync()}
              className="rounded-lg bg-amber-600 px-2.5 py-1 text-[11.5px] font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
            >
              {syncing ? '同步中…' : '更新社区展示'}
            </button>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void handleLike()}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[12.5px] font-semibold transition ${
              liked
                ? 'border-rose-300 bg-rose-50 text-rose-600'
                : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
            }`}
          >
            <span>{liked ? '❤️' : '🤍'}</span>
            <span>点赞 {likeCount}</span>
          </button>

          <button
            type="button"
            onClick={() => void handleFavorite()}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[12.5px] font-semibold transition ${
              favorited
                ? 'border-amber-300 bg-amber-50 text-amber-700'
                : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
            }`}
          >
            <span>{favorited ? '⭐' : '☆'}</span>
            <span>{favorited ? '已收藏' : '收藏'} {favoriteCount}</span>
          </button>
        </div>

        <span className="text-[12px] text-slate-500">💬 讨论 ({commentCount})</span>
      </div>

      {reportNotice && (
        <div className="mt-2.5 rounded-xl bg-emerald-50 px-3 py-1.5 text-[11.5px] text-emerald-700">
          {reportNotice}
        </div>
      )}

      <div className="mt-3 border-t border-slate-100 pt-3">
        {comments.length > 0 ? (
          <div className="max-h-60 space-y-2.5 overflow-y-auto pr-1">
            {comments.map((c) => (
              <div
                key={c.id}
                className="rounded-xl bg-slate-50/90 px-3 py-2 text-[12.5px]"
              >
                <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500">
                  <AuthorChip
                    author={c.author}
                    userId={c.author_id || c.user_id}
                    label={c.author_display_name || c.author_label}
                    email={c.author_email}
                    avatarUrl={c.author_avatar_url}
                    size="sm"
                  />
                  <div className="flex shrink-0 items-center gap-2">
                    <span>{String(c.created_at || '').slice(0, 16).replace('T', ' ')}</span>
                    {currentUserId && (c.author_id || c.user_id) !== currentUserId && (
                      <button
                        type="button"
                        disabled={Boolean(reportedIds[c.id])}
                        onClick={() => {
                          setReportingCommentId(
                            reportingCommentId === c.id ? null : c.id,
                          );
                          setReportReason('');
                        }}
                        className="rounded px-1.5 py-0.5 text-[10.5px] text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 disabled:cursor-default disabled:text-slate-300"
                        title="举报不当评论"
                      >
                        {reportedIds[c.id] ? '已举报' : '举报'}
                      </button>
                    )}
                  </div>
                </div>
                <p className="mt-1 whitespace-pre-wrap break-words text-slate-700">
                  {c.body}
                </p>

                {reportingCommentId === c.id && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-rose-200/80 bg-white p-2">
                    <input
                      value={reportReason}
                      onChange={(e) => setReportReason(e.target.value)}
                      type="text"
                      maxLength={200}
                      placeholder="可选填写举报原因（如广告、不当言论）"
                      className="min-w-[180px] flex-1 rounded-lg border border-slate-200 px-2.5 py-1 text-[11.5px] text-slate-800 outline-none focus:border-rose-400"
                    />
                    <button
                      type="button"
                      onClick={() => void submitReport(c)}
                      className="rounded-lg bg-rose-600 px-2.5 py-1 text-[11.5px] font-semibold text-white hover:bg-rose-700"
                    >
                      确认举报
                    </button>
                    <button
                      type="button"
                      onClick={() => setReportingCommentId(null)}
                      className="rounded-lg px-2 py-1 text-[11.5px] text-slate-500 hover:bg-slate-100"
                    >
                      取消
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="py-2 text-[12px] text-slate-400">
            暂无评论，欢迎分享你的学习笔记或心得～
          </p>
        )}

        <div className="mt-3 flex gap-2">
          <input
            value={commentBody}
            onChange={(e) => setCommentBody(e.target.value)}
            type="text"
            maxLength={500}
            placeholder="写下你的学习心得（限纯文本 2~500 字，勿含外链/联系方式）…"
            className="flex-1 rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-1.5 text-[12.5px] text-slate-900 outline-none focus:border-[#0071e3] focus:bg-white"
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleSubmitComment();
            }}
          />
          <button
            type="button"
            disabled={submitting || !commentBody.trim()}
            onClick={() => void handleSubmitComment()}
            className="rounded-xl bg-[#0071e3] px-3.5 py-1.5 text-[12.5px] font-semibold text-white transition hover:bg-[#0077ed] disabled:opacity-50"
          >
            {submitting ? '发送中' : '发表'}
          </button>
        </div>

        {commentError && (
          <p className="mt-1.5 text-[11.5px] text-rose-600">{commentError}</p>
        )}
      </div>
    </div>
  );
};
