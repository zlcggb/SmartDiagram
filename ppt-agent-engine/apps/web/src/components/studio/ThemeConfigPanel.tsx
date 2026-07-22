import { useMemo, useState } from "react";
import type { PptExportTheme, ThemeSurfaceId } from "@ppt-agent/shared";
import { copyBudgets, getThemeSurfacePreset, themeSurfaceList } from "@ppt-agent/shared";
import { exportThemeOptions } from "../../lib/exportMode";

type ThemeFamilyFilter = "all" | "light" | "dark";

type ThemeConfigPanelProps = {
  busy: string | null;
  exportTheme: PptExportTheme;
  themeAccentId: string;
  themeSurfaceId: ThemeSurfaceId;
  exportWarnings: string[];
  slidesEmpty: boolean;
  hasSelected: boolean;
  onThemeChange: (theme: PptExportTheme) => void;
  onAccentChange: (accentId: string) => void;
  onSurfaceChange: (surfaceId: ThemeSurfaceId) => void;
  onRegenerateCurrent: () => void;
  onRegenerateAll: () => void;
};

export function ThemeConfigPanel({
  busy,
  exportTheme,
  themeAccentId,
  themeSurfaceId,
  exportWarnings,
  slidesEmpty,
  hasSelected,
  onThemeChange,
  onAccentChange,
  onSurfaceChange,
  onRegenerateCurrent,
  onRegenerateAll
}: ThemeConfigPanelProps) {
  const [familyFilter, setFamilyFilter] = useState<ThemeFamilyFilter>("all");
  const surface = getThemeSurfacePreset(themeSurfaceId);
  const currentPack = exportThemeOptions.find((o) => o.id === exportTheme);
  const filteredPacks = useMemo(() => {
    if (familyFilter === "all") return exportThemeOptions;
    return exportThemeOptions.filter((o) => o.family === familyFilter);
  }, [familyFilter]);

  return (
    <aside className="theme-config-panel flex h-full min-h-0 flex-col rounded-2xl border border-[rgba(0,0,0,0.13)] bg-white shadow-[0_5px_16px_-4px_rgba(0,0,0,0.07)]">
      <div className="border-b border-[rgba(0,0,0,0.13)] px-4 py-3">
        <h3 className="text-sm font-medium text-[rgba(0,0,0,0.9)]">主题配置</h3>
        <p className="mt-0.5 text-xs text-[rgba(0,0,0,0.45)]">分层调节 · 色板与质感即时预览</p>
      </div>

      <div className="flex-1 space-y-0 overflow-y-auto">
        {/* 1. 主题族（样式族筛选） */}
        <section className="theme-config-section">
          <p className="theme-config-label">主题族</p>
          <div className="theme-segmented" role="group" aria-label="主题族">
            {(
              [
                ["all", "全部"],
                ["light", "浅色"],
                ["dark", "深色"]
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                disabled={Boolean(busy)}
                className={familyFilter === id ? "is-active" : undefined}
                onClick={() => setFamilyFilter(id)}
              >
                {label}
              </button>
            ))}
          </div>
        </section>

        {/* 2. 主题包 */}
        <section className="theme-config-section">
          <p className="theme-config-label">主题包</p>
          <p className="theme-config-hint">切换即改 SVG 色板；版式大变可再「按主题生成」</p>
          <div className="mt-2 max-h-[min(180px,35vh)] space-y-1.5 overflow-y-auto pr-0.5">
            {filteredPacks.map((opt) => (
              <button
                key={opt.id}
                type="button"
                disabled={Boolean(busy)}
                onClick={() => onThemeChange(opt.id)}
                className={`flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition ${
                  exportTheme === opt.id
                    ? "border-[rgba(0,0,0,0.9)] bg-[rgba(0,0,0,0.03)]"
                    : "border-[rgba(0,0,0,0.13)] bg-white hover:border-[rgba(0,0,0,0.35)]"
                } disabled:opacity-60`}
              >
                <span
                  className="h-7 w-7 shrink-0 rounded-md border border-[rgba(0,0,0,0.05)]"
                  style={{ background: `linear-gradient(135deg, ${opt.previewBg} 40%, ${opt.accentHex})` }}
                />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-[rgba(0,0,0,0.9)]">{opt.label}</span>
                  <span className="block truncate text-[10px] text-[rgba(0,0,0,0.45)]">{opt.suitableFor}</span>
                </span>
              </button>
            ))}
            {filteredPacks.length === 0 ? <p className="text-xs text-[rgba(0,0,0,0.45)]">该族暂无主题包</p> : null}
          </div>
        </section>

        {/* 3. 强调色 */}
        <section className="theme-config-section">
          <p className="theme-config-label">页级强调色</p>
          <p className="theme-config-hint">有限枚举，预览与导出同步</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {(currentPack?.accentPresets ?? []).map((preset) => (
              <button
                key={preset.id}
                type="button"
                disabled={Boolean(busy)}
                onClick={() => onAccentChange(preset.id)}
                className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-[11px] transition ${
                  themeAccentId === preset.id
                    ? "border-[rgba(0,0,0,0.9)] bg-[rgba(0,0,0,0.03)] font-medium text-[rgba(0,0,0,0.9)]"
                    : "border-[rgba(0,0,0,0.13)] bg-white text-[rgba(0,0,0,0.6)] hover:border-[rgba(0,0,0,0.35)]"
                } disabled:opacity-60`}
                title={preset.label}
              >
                <span className="h-3 w-3 rounded-sm border border-[rgba(0,0,0,0.05)]" style={{ background: preset.hex }} />
                {preset.label}
              </button>
            ))}
          </div>
        </section>

        {/* 4. 质感预设（对齐「渲染样式」分段） */}
        <section className="theme-config-section">
          <p className="theme-config-label">质感预设</p>
          <p className="theme-config-hint">预览即时滤镜；构图级差异需下方重新生成</p>
          <div className="theme-segmented theme-segmented-wrap mt-2" role="group" aria-label="质感预设">
            {themeSurfaceList.map((preset) => (
              <button
                key={preset.id}
                type="button"
                disabled={Boolean(busy)}
                className={themeSurfaceId === preset.id ? "is-active" : undefined}
                title={preset.description}
                onClick={() => onSurfaceChange(preset.id)}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[11px] leading-4 text-[rgba(0,0,0,0.45)]">{surface.description}</p>
        </section>

        {/* 5. 说明：文案完整性 + 管线边界 */}
        <section className="theme-config-section">
          <p className="theme-config-label">文案与结构</p>
          <ul className="mt-1.5 space-y-1 text-[11px] leading-4 text-[rgba(0,0,0,0.45)]">
            <li>结构数据保留完整原文；AI 单字段建议不超过 {copyBudgets.keyMessage.maxChars} 字，设计阶段自动换行适配。</li>
            <li>节点数 / 上下交替 / 贯穿线等结构参数由版式生成决定，无法在此即时改；需重新生成。</li>
          </ul>
        </section>

        {/* 6. 按主题重生（一键导出已移至设计稿工具条右上角） */}
        <section className="theme-config-section space-y-2 border-b-0">
          <p className="theme-config-label">按主题重生</p>
          <p className="text-[11px] leading-4 text-[rgba(0,0,0,0.45)]">
            换色即时预览与导出；质感滤镜仅预览近似。深色或布局级变化请重新生成。
          </p>
          <button
            type="button"
            className="secondary-button w-full rounded-[10px] text-xs"
            disabled={Boolean(busy) || !hasSelected}
            onClick={onRegenerateCurrent}
            title="调用 AI 按新主题重新设计本页（会改构图）"
          >
            按主题重新生成本页
          </button>
          <button
            type="button"
            className="secondary-button w-full rounded-[10px] text-xs"
            disabled={Boolean(busy) || slidesEmpty}
            onClick={onRegenerateAll}
            title="调用 AI 按新主题重新设计全部页"
          >
            按主题重新生成全部
          </button>
          {exportWarnings.length > 0 ? (
            <ul className="space-y-1 rounded-lg bg-[rgba(0,0,0,0.03)] px-2 py-2 text-[11px] text-[rgba(0,0,0,0.6)]">
              {exportWarnings.slice(0, 3).map((warning) => (
                <li key={warning} className="border-l-2 border-[rgba(0,0,0,0.13)] pl-2">
                  {warning}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      </div>
    </aside>
  );
}
