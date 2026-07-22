import type { SVGProps } from "react";

export type AppLogoProps = SVGProps<SVGSVGElement>;

/**
 * PPT Agent 品牌 Logo Mark。
 *
 * 视觉概念：16:10 的圆角画布代表演示幻灯片；左侧竖线 + 半圆弧构成
 * 抽象字母 P；右上方的小四角星表示 AI 对文章/大纲的点亮。整体比例
 * 紧凑，在 28×28 的工具栏和 64×64 的展示场景都能保持清晰。
 */
export function AppLogoMark(props: AppLogoProps) {
  return (
    <svg
      viewBox="0 0 28 28"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      {...props}
    >
      {/* 画布背景：显式深色，不依赖 currentColor */}
      <rect width="28" height="28" rx="7" fill="#111827" />
      {/* 抽象字母 P：左侧竖条 */}
      <rect x="7" y="6" width="4" height="16" rx="1.5" fill="#fff" />
      {/* 抽象字母 P：半圆弧 */}
      <path
        d="M11 10.5 h3.5 a4 4 0 0 1 0 8 H11"
        stroke="#fff"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      {/* AI sparkle */}
      <path
        d="M20 6 l0.6 1.4 l1.4 0.6 l-1.4 0.6 l-0.6 1.4 l-0.6 -1.4 l-1.4 -0.6 l1.4 -0.6 z"
        fill="#38bdf8"
      />
    </svg>
  );
}

/**
 * 完整 Logo：mark + 文字组合。用于首页顶部等需要品牌名出现的场景。
 */
export function AppLogo({
  showWordmark = true,
  className,
  ...props
}: AppLogoProps & { showWordmark?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ""}`}>
      <AppLogoMark className="h-7 w-7" {...props} />
      {showWordmark ? (
        <span className="text-base font-medium tracking-tight text-[rgba(0,0,0,0.9)]">
          PPT Agent
        </span>
      ) : null}
    </span>
  );
}
