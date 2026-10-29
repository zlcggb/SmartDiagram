import React from 'react';
import { Link } from 'react-router-dom';
import type { CommunityAuthor } from '../lib/types';

export interface AuthorChipProps {
  author?: CommunityAuthor | null;
  userId?: string;
  label?: string;
  email?: string;
  avatarUrl?: string | null;
  subText?: string;
  size?: 'sm' | 'md';
  clickable?: boolean;
}

export const AuthorChip: React.FC<AuthorChipProps> = ({
  author,
  userId = '',
  label = '',
  email = '',
  avatarUrl = null,
  subText = '',
  size = 'sm',
  clickable = true,
}) => {
  const uid = author?.id || userId || '';
  const displayLabel =
    author?.label ||
    label ||
    (author?.email || email || '').split('@')[0] ||
    '匿名用户';
  const avatarSrc = author?.avatar_url || avatarUrl || '';
  const initial = (displayLabel || '?').slice(0, 1).toUpperCase();
  const avatarClass =
    size === 'md' ? 'h-8 w-8 text-[12px]' : 'h-6 w-6 text-[10.5px]';

  const content = (
    <>
      <span
        className={`relative grid shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-tr from-[#0071e3] to-indigo-500 font-bold text-white shadow-2xs ${avatarClass}`}
      >
        {avatarSrc ? (
          <img
            src={avatarSrc}
            alt={displayLabel}
            className="h-full w-full object-cover"
          />
        ) : (
          <span>{initial}</span>
        )}
      </span>
      <span className="min-w-0 truncate">
        <span className="block truncate text-[12px] font-medium text-slate-700 group-hover:text-[#0071e3]">
          {displayLabel}
        </span>
        {subText && (
          <span className="block truncate text-[10px] text-slate-400">
            {subText}
          </span>
        )}
      </span>
    </>
  );

  if (clickable && uid) {
    return (
      <Link
        to={`/video/community/users/${encodeURIComponent(uid)}`}
        onClick={(e) => e.stopPropagation()}
        className="group inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full transition"
      >
        {content}
      </Link>
    );
  }

  return (
    <div className="group inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full transition">
      {content}
    </div>
  );
};
