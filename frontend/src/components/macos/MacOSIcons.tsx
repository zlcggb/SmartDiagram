/**
 * DeepDiagram 的 macOS 风格 artwork。
 *
 * 保留稳定的 artwork API，但图形语言属于产品自身：桌面工作台、思维节点、
 * 演示画布与项目文件夹。每个实例都通过 useId 创建独立 SVG 渐变，避免
 * 桌面与 Dock 同时渲染时发生 ID 冲突。
 */

import { useId } from "react";

interface IconProps {
  size?: number;
}

function iconId(rawId: string, name: string) {
  return `${rawId.replace(/:/g, "")}-${name}`;
}

/** 首页 / Dock 使用的 DeepDiagram 工作台图标。导出名保留为 FinderIcon 以维持 API。 */
export function FinderIcon({ size = 60 }: IconProps) {
  const rawId = useId();
  const backgroundId = iconId(rawId, "desktop-background");
  const canvasId = iconId(rawId, "desktop-canvas");

  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true">
      <defs>
        <linearGradient id={backgroundId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#16294f" />
          <stop offset="52%" stopColor="#1768c6" />
          <stop offset="100%" stopColor="#22b8d8" />
        </linearGradient>
        <linearGradient id={canvasId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#dcecff" />
        </linearGradient>
      </defs>

      <rect x="3" y="3" width="58" height="58" rx="14" fill={`url(#${backgroundId})`} />
      <rect x="3.75" y="3.75" width="56.5" height="19" rx="13" fill="#ffffff" opacity="0.12" />

      {/* 自有的“工作台”符号：侧边栏 + 可视化画布，而非 Finder 脸谱。 */}
      <rect x="11" y="12" width="42" height="38" rx="7" fill={`url(#${canvasId})`} />
      <path d="M11 21h42" stroke="#8fb4dc" strokeWidth="1" />
      <circle cx="16" cy="16.5" r="1.35" fill="#ff6058" />
      <circle cx="20.5" cy="16.5" r="1.35" fill="#ffbd2e" />
      <circle cx="25" cy="16.5" r="1.35" fill="#28c940" />
      <path d="M21 21v29" stroke="#b9d2eb" strokeWidth="1.2" />
      <rect x="14.5" y="26" width="3.5" height="3.5" rx="1" fill="#2b7fd3" opacity="0.9" />
      <rect x="14.5" y="32" width="3.5" height="3.5" rx="1" fill="#6d7ff5" opacity="0.72" />
      <rect x="14.5" y="38" width="3.5" height="3.5" rx="1" fill="#22b8d8" opacity="0.72" />
      <g stroke="#4b75b8" strokeWidth="1.65" strokeLinecap="round" opacity="0.88">
        <path d="m29 36 7-7 8 6" />
        <path d="M36 29v12l8-6" />
      </g>
      <circle cx="29" cy="36" r="2.6" fill="#6d7ff5" />
      <circle cx="36" cy="29" r="2.8" fill="#2b7fd3" />
      <circle cx="36" cy="41" r="2.45" fill="#22b8d8" />
      <circle cx="44" cy="35" r="2.6" fill="#4d67dd" />
      <path d="M15 51.5h34" stroke="#08264d" strokeWidth="2" strokeLinecap="round" opacity="0.28" />
    </svg>
  );
}

export function MindmapAppIcon({ size = 60 }: IconProps) {
  const rawId = useId();
  const backgroundId = iconId(rawId, "mindmap-background");

  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true">
      <defs>
        <linearGradient id={backgroundId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#7c8cff" />
          <stop offset="55%" stopColor="#5a64f2" />
          <stop offset="100%" stopColor="#22d3ee" />
        </linearGradient>
      </defs>
      <rect x="3" y="3" width="58" height="58" rx="14" fill={`url(#${backgroundId})`} />
      <rect x="3" y="3" width="58" height="20" rx="14" fill="#ffffff" opacity="0.16" />
      <g stroke="#ffffff" strokeWidth="3" strokeLinecap="round" opacity="0.85">
        <line x1="32" y1="36" x2="16" y2="18" />
        <line x1="32" y1="36" x2="49" y2="16" />
        <line x1="32" y1="36" x2="50" y2="48" />
        <line x1="32" y1="36" x2="14" y2="48" />
      </g>
      <circle cx="16" cy="18" r="4.4" fill="#ffffff" />
      <circle cx="49" cy="16" r="4.4" fill="#ffffff" />
      <circle cx="50" cy="48" r="4.4" fill="#ffffff" />
      <circle cx="14" cy="48" r="4.4" fill="#ffffff" />
      <circle cx="32" cy="36" r="7" fill="#ffffff" />
      <circle cx="32" cy="36" r="3.2" fill="#5a64f2" />
    </svg>
  );
}

export function SlidesAppIcon({ size = 60 }: IconProps) {
  const rawId = useId();
  const backgroundId = iconId(rawId, "slides-background");

  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true">
      <defs>
        <linearGradient id={backgroundId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#fbbf24" />
          <stop offset="55%" stopColor="#fb7c3c" />
          <stop offset="100%" stopColor="#f43f5e" />
        </linearGradient>
      </defs>
      <rect x="3" y="3" width="58" height="58" rx="14" fill={`url(#${backgroundId})`} />
      <rect x="3" y="3" width="58" height="20" rx="14" fill="#ffffff" opacity="0.16" />
      <rect x="13" y="13" width="38" height="27" rx="4.5" fill="#ffffff" />
      <rect x="20" y="27" width="5.5" height="8" rx="1.4" fill="#fb923c" />
      <rect x="29" y="22" width="5.5" height="13" rx="1.4" fill="#f97316" />
      <rect x="38" y="18" width="5.5" height="17" rx="1.4" fill="#f43f5e" />
      <rect x="29.5" y="41" width="5" height="6" fill="#ffffff" opacity="0.95" />
      <rect x="21" y="48" width="22" height="4.5" rx="2.25" fill="#ffffff" />
    </svg>
  );
}

export function FolderIcon({ size = 60 }: IconProps) {
  const rawId = useId();
  const backId = iconId(rawId, "folder-back");
  const frontId = iconId(rawId, "folder-front");

  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true">
      <defs>
        <linearGradient id={backId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#5aa9f2" />
          <stop offset="100%" stopColor="#3b86e0" />
        </linearGradient>
        <linearGradient id={frontId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#a4d2fa" />
          <stop offset="100%" stopColor="#6eb0ef" />
        </linearGradient>
      </defs>
      <path
        d="M7 16a5 5 0 0 1 5-5h11l6 6h22a5 5 0 0 1 5 5v25a5 5 0 0 1-5 5H12a5 5 0 0 1-5-5Z"
        fill={`url(#${backId})`}
      />
      <rect x="12" y="18" width="40" height="22" rx="2" fill="#f2f7fd" opacity="0.9" />
      <path
        d="M5 24a4 4 0 0 1 4-4h46a4 4 0 0 1 4 4l-3.5 24a5 5 0 0 1-5 4.4h-37a5 5 0 0 1-5-4.4Z"
        fill={`url(#${frontId})`}
      />
      <path d="M9 20.5h46" stroke="#ffffff" strokeWidth="1.4" opacity="0.55" strokeLinecap="round" />
    </svg>
  );
}
