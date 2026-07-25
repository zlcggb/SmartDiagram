import { useEffect, useRef, useState, type ChangeEvent, type RefObject } from 'react';
import { Camera, Check, ImagePlus, LoaderCircle, Trash2, Zap } from 'lucide-react';
import { fetchBillingData, updateProfile, type BudgetMetrics } from '@/shared/store/auth';
import { usePlatformAuth } from '@/shared/store/authStore';
import { MacWindow } from '@/shared/ui/shell/MacWindow';
import { UserAvatar } from './UserAvatar';

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const ACCEPTED_AVATAR_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

interface ProfileWindowProps {
  onClose: () => void;
  triggerRef?: RefObject<HTMLElement | null>;
}

export function ProfileWindow({ onClose, triggerRef }: ProfileWindowProps) {
  const session = usePlatformAuth((state) => state.session);
  const setSession = usePlatformAuth((state) => state.setSession);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewUrlRef = useRef<string | null>(null);
  const [displayName, setDisplayName] = useState(session?.user.display_name || '');
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [removeAvatar, setRemoveAvatar] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [budget, setBudget] = useState<BudgetMetrics | null>(null);

  useEffect(() => {
    if (session) {
      fetchBillingData(session).then(setBudget).catch(console.error);
    }
  }, [session]);

  useEffect(() => () => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
  }, []);

  if (!session) return null;

  const cleanName = displayName.trim();
  const nameChanged = cleanName !== session.user.display_name.trim();
  const dirty = nameChanged || Boolean(avatarFile) || removeAvatar;
  const previewUser = {
    ...session.user,
    avatar_url: removeAvatar ? null : (previewUrl || session.user.avatar_url),
  };
  const roleLabel = session.user.role === 'admin' || session.user.roles.includes('admin')
    ? '管理员'
    : '成员';

  const replacePreviewUrl = (next: string | null) => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = next;
    setPreviewUrl(next);
  };

  const handleAvatarChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    setSaved(false);
    setError('');
    if (!file) return;
    if (!ACCEPTED_AVATAR_TYPES.has(file.type)) {
      setError('请选择 JPEG、PNG 或 WebP 图片。');
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      setError('图片不能超过 5 MB。');
      return;
    }
    const nextPreview = URL.createObjectURL(file);
    replacePreviewUrl(nextPreview);
    setAvatarFile(file);
    setRemoveAvatar(false);
  };

  const handleRemoveAvatar = () => {
    replacePreviewUrl(null);
    setAvatarFile(null);
    setRemoveAvatar(Boolean(session.user.avatar_url));
    setSaved(false);
    setError('');
  };

  const handleSave = async () => {
    if (!cleanName) {
      setError('请输入昵称。');
      return;
    }
    if (cleanName.length > 40) {
      setError('昵称最多 40 个字符。');
      return;
    }
    setSaving(true);
    setSaved(false);
    setError('');
    try {
      const refreshed = await updateProfile(session, {
        displayName: cleanName,
        avatar: avatarFile || undefined,
        removeAvatar,
      });
      setSession(refreshed);
      replacePreviewUrl(null);
      setAvatarFile(null);
      setRemoveAvatar(false);
      setDisplayName(refreshed.user.display_name);
      setSaved(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '个人资料保存失败，请稍后重试。');
    } finally {
      setSaving(false);
    }
  };

  return (
    <MacWindow title="用户中心" onClose={onClose} triggerRef={triggerRef}>
      <div className="mac-profile-center">
        <header className="mac-profile-hero">
          <div className="mac-profile-avatar-editor">
            <UserAvatar user={previewUser} size={88} />
            <button
              type="button"
              className="mac-profile-avatar-camera"
              aria-label="更换头像"
              title="更换头像"
              onClick={() => fileInputRef.current?.click()}
            >
              <Camera aria-hidden="true" />
            </button>
          </div>
          <div className="mac-profile-hero-copy">
            <span>个人资料</span>
            <strong>{cleanName || session.user.email}</strong>
            <small>头像和昵称会同步显示在桌面、思维导图与 PPT。</small>
          </div>
        </header>

        <input
          ref={fileInputRef}
          className="mac-profile-file-input"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={handleAvatarChange}
        />

        <div className="mac-profile-photo-actions">
          <button type="button" onClick={() => fileInputRef.current?.click()}>
            <ImagePlus aria-hidden="true" />
            选择照片
          </button>
          {(session.user.avatar_url || avatarFile) ? (
            <button type="button" data-danger onClick={handleRemoveAvatar}>
              <Trash2 aria-hidden="true" />
              移除照片
            </button>
          ) : null}
          <small>支持 JPEG、PNG、WebP，最大 5 MB；保存时自动裁成正方形。</small>
        </div>

        <div className="mac-profile-form">
          <label>
            <span>昵称</span>
            <input
              data-autofocus
              type="text"
              value={displayName}
              maxLength={40}
              autoComplete="name"
              onChange={(event) => {
                setDisplayName(event.target.value);
                setSaved(false);
                setError('');
              }}
            />
            <small>{displayName.length}/40</small>
          </label>
          <div className="mac-profile-readonly-grid">
            <label>
              <span>邮箱</span>
              <output>{session.user.email}</output>
            </label>
            <label>
              <span>账户类型</span>
              <output>{roleLabel}</output>
            </label>
          </div>

          {budget && (
            <div className="mac-profile-readonly-grid" style={{ marginTop: '16px' }}>
              <label>
                <span>本月 Token 消耗</span>
                <output style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <Zap size={14} color={(budget as any).budget?.hard_limit_enabled ? '#f59e0b' : '#ef4444'} />
                  <span style={{ fontWeight: 500 }}>
                    {((budget as any).usage?.estimated_total_tokens ?? 0).toLocaleString()} / {((budget as any).budget?.monthly_token_limit ?? 0).toLocaleString()}
                  </span>
                </output>
              </label>
              <label>
                <span>AI 生成次数</span>
                <output>{(budget as any).usage?.run_count ?? 0}</output>
              </label>
            </div>
          )}
        </div>

        <div className="mac-profile-feedback" aria-live="polite">
          {error ? <p data-error>{error}</p> : null}
          {saved ? <p data-success><Check aria-hidden="true" />个人资料已更新</p> : null}
        </div>

        <footer className="mac-profile-footer">
          <button type="button" onClick={onClose}>取消</button>
          <button
            type="button"
            className="mac-primary-button"
            disabled={!dirty || saving || !cleanName}
            onClick={() => void handleSave()}
          >
            {saving ? <LoaderCircle className="is-spinning" aria-hidden="true" /> : null}
            {saving ? '正在保存…' : '保存更改'}
          </button>
        </footer>
      </div>
    </MacWindow>
  );
}
