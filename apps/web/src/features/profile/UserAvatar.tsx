import { useState, type CSSProperties } from 'react';
import { UserRound } from 'lucide-react';
import type { AuthUser } from '@/shared/store/auth';

interface UserAvatarProps {
  user?: Pick<AuthUser, 'display_name' | 'email' | 'avatar_url'> | null;
  size?: number;
  className?: string;
  label?: string;
}

export function UserAvatar({
  user,
  size = 40,
  className = '',
  label,
}: UserAvatarProps) {
  const [failedAvatarUrl, setFailedAvatarUrl] = useState('');
  const avatarUrl = user?.avatar_url?.trim() || '';
  const imageFailed = avatarUrl === failedAvatarUrl;

  const style = { '--user-avatar-size': `${size}px` } as CSSProperties;
  const accessibleLabel = label || (user ? `${user.display_name || user.email}的头像` : '用户头像');

  return (
    <span
      className={`mac-user-avatar ${className}`.trim()}
      style={style}
      data-has-image={avatarUrl && !imageFailed ? true : undefined}
      role="img"
      aria-label={accessibleLabel}
    >
      {avatarUrl && !imageFailed ? (
        <img src={avatarUrl} alt="" onError={() => setFailedAvatarUrl(avatarUrl)} />
      ) : (
        <UserRound aria-hidden="true" />
      )}
    </span>
  );
}
