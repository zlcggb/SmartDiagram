import { useEffect, useState, type CSSProperties } from 'react';
import { UserRound } from 'lucide-react';
import type { AuthUser } from '../../config/auth';

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
  const [imageFailed, setImageFailed] = useState(false);
  const avatarUrl = user?.avatar_url?.trim() || '';

  useEffect(() => setImageFailed(false), [avatarUrl]);

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
        <img src={avatarUrl} alt="" onError={() => setImageFailed(true)} />
      ) : (
        <UserRound aria-hidden="true" />
      )}
    </span>
  );
}
