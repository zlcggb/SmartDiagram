import type { SVGProps } from "react";
import { PptAgentIconMark } from "@/components/brand/AppIconMarks";

export type AppLogoProps = SVGProps<SVGSVGElement>;

/**
 * PPT Agent 品牌 Logo Mark。
 *
 * 视觉概念：16:10 的圆角画布代表演示幻灯片；左侧竖线 + 半圆弧构成
 * 抽象字母 P；右上方的小四角星表示 AI 对文章/大纲的点亮。整体比例
 * 紧凑，在 28×28 的工具栏和 64×64 的展示场景都能保持清晰。
 */
export function AppLogoMark(props: AppLogoProps) {
  return <PptAgentIconMark {...props} />;
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
