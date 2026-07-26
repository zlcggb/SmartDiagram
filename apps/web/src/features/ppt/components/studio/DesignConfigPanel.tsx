import { useMemo, useState } from "react";
import type {
  PptExportTheme,
  PresentationStyleId,
  ThemeSurfaceId
} from "@ppt-agent/shared";
import {
  copyBudgets,
  getPresentationStylePreset,
  getThemeSurfacePreset,
  presentationStyleList,
  themeSurfaceList
} from "@ppt-agent/shared";
import { exportThemeOptions } from "../../lib/exportMode";

type ThemeFamilyFilter = "all" | "light" | "dark";
type StyleScope = "project" | "slide";
export type DesignConfigTab = "style" | "theme";

type DesignConfigPanelProps = {
  busy: string | null;
  activeTab: DesignConfigTab;
  projectStyle: PresentationStyleId;
  slideStyle: PresentationStyleId | null;
  exportTheme: PptExportTheme;
  themeAccentId: string;
  themeSurfaceId: ThemeSurfaceId;
  exportWarnings: string[];
  slidesEmpty: boolean;
  hasSelected: boolean;
  onTabChange: (tab: DesignConfigTab) => void;
  onProjectStyleChange: (style: PresentationStyleId) => void;
  onSlideStyleChange: (style: PresentationStyleId | null) => void;
  onThemeChange: (theme: PptExportTheme) => void;
  onAccentChange: (accentId: string) => void;
  onSurfaceChange: (surfaceId: ThemeSurfaceId) => void;
  onRegenerateCurrent: () => void;
  onRegenerateAll: () => void;
};

const glyphWidths: Record<PresentationStyleId, readonly [number, number, number]> = {
  "apple-minimal": [22, 13, 8],
  consulting: [22, 22, 15],
  "data-story": [9, 16, 23],
  "tech-architecture": [16, 23, 16],
  editorial: [23, 11, 19]
};

function StyleGlyph({ style, active }: { style: PresentationStyleId; active: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`flex h-8 w-8 shrink-0 flex-col justify-center gap-1 rounded-[9px] border px-1.5 ${
        active
          ? "border-[rgba(0,0,0,0.18)] bg-white"
          : "border-[rgba(0,0,0,0.08)] bg-[rgba(0,0,0,0.025)]"
      }`}
    >
      {glyphWidths[style].map((width, index) => (
        <span
          key={`${style}-${index}`}
          className={`block h-[2px] rounded-full ${
            index === 0 && active
              ? "bg-[rgba(0,0,0,0.86)]"
              : "bg-[rgba(0,0,0,0.28)]"
          }`}
          style={{ width }}
        />
      ))}
    </span>
  );
}

export function DesignConfigPanel({
  busy,
  activeTab,
  projectStyle,
  slideStyle,
  exportTheme,
  themeAccentId,
  themeSurfaceId,
  exportWarnings,
  slidesEmpty,
  hasSelected,
  onTabChange,
  onProjectStyleChange,
  onSlideStyleChange,
  onThemeChange,
  onAccentChange,
  onSurfaceChange,
  onRegenerateCurrent,
  onRegenerateAll
}: DesignConfigPanelProps) {
  const [familyFilter, setFamilyFilter] = useState<ThemeFamilyFilter>("all");
  const [styleScope, setStyleScope] = useState<StyleScope>("project");
  const surface = getThemeSurfacePreset(themeSurfaceId);
  const currentPack = exportThemeOptions.find((option) => option.id === exportTheme);
  const effectiveStyle = getPresentationStylePreset(slideStyle ?? projectStyle);
  const filteredPacks = useMemo(() => {
    if (familyFilter === "all") return exportThemeOptions;
    return exportThemeOptions.filter((option) => option.family === familyFilter);
  }, [familyFilter]);

  return (
    <aside className="theme-config-panel flex h-full min-h-0 flex-col rounded-2xl border border-[rgba(0,0,0,0.13)] bg-white shadow-[0_5px_16px_-4px_rgba(0,0,0,0.07)]">
      <div className="border-b border-[rgba(0,0,0,0.13)] px-4 py-3">
        <h3 className="text-sm font-medium text-[rgba(0,0,0,0.9)]">设计配置</h3>
        <p className="mt-0.5 text-xs text-[rgba(0,0,0,0.45)]">
          风格管布局 · 主题管色彩与质感
        </p>
        <div
          className="mt-3 grid grid-cols-2 rounded-[9px] bg-[rgba(0,0,0,0.045)] p-0.5"
          role="tablist"
          aria-label="设计配置分类"
        >
          {(
            [
              ["theme", "主题"],
              ["style", "风格"]
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={activeTab === id}
              className={`rounded-[7px] px-3 py-1.5 text-xs font-medium transition ${
                activeTab === id
                  ? "bg-white text-[rgba(0,0,0,0.9)] shadow-[0_1px_3px_rgba(0,0,0,0.08)]"
                  : "text-[rgba(0,0,0,0.5)] hover:text-[rgba(0,0,0,0.8)]"
              }`}
              onClick={() => onTabChange(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 space-y-0 overflow-y-auto">
        {activeTab === "style" ? (
          <>
            <section className="theme-config-section">
              <p className="theme-config-label">作用范围</p>
              <div className="theme-segmented mt-2" role="group" aria-label="风格作用范围">
                <button
                  type="button"
                  disabled={Boolean(busy)}
                  className={styleScope === "project" ? "is-active" : undefined}
                  onClick={() => setStyleScope("project")}
                >
                  整套默认
                </button>
                <button
                  type="button"
                  disabled={Boolean(busy) || !hasSelected}
                  className={styleScope === "slide" ? "is-active" : undefined}
                  onClick={() => setStyleScope("slide")}
                >
                  当前页
                </button>
              </div>
              <p className="mt-2 text-[11px] leading-4 text-[rgba(0,0,0,0.45)]">
                当前生效：{effectiveStyle.label}
                {slideStyle ? " · 本页覆盖" : " · 继承整套"}
              </p>
            </section>

            <section className="theme-config-section">
              <p className="theme-config-label">演示风格</p>
              <p className="theme-config-hint">决定叙事、版式、字阶与信息密度</p>
              <div className="mt-2 space-y-1.5">
                {styleScope === "slide" ? (
                  <button
                    type="button"
                    disabled={Boolean(busy) || !hasSelected}
                    className={`flex w-full items-center justify-between rounded-[10px] border px-3 py-2 text-left transition ${
                      slideStyle === null
                        ? "border-[rgba(0,0,0,0.75)] bg-[rgba(0,0,0,0.025)]"
                        : "border-[rgba(0,0,0,0.12)] hover:border-[rgba(0,0,0,0.28)]"
                    } disabled:opacity-50`}
                    onClick={() => onSlideStyleChange(null)}
                  >
                    <span>
                      <span className="block text-xs font-medium text-[rgba(0,0,0,0.85)]">
                        继承整套默认
                      </span>
                      <span className="mt-0.5 block text-[10px] text-[rgba(0,0,0,0.43)]">
                        {getPresentationStylePreset(projectStyle).label}
                      </span>
                    </span>
                    {slideStyle === null ? (
                      <span className="h-1.5 w-1.5 rounded-full bg-[rgba(0,0,0,0.8)]" />
                    ) : null}
                  </button>
                ) : null}

                {presentationStyleList.map((style) => {
                  const active =
                    styleScope === "project"
                      ? projectStyle === style.id
                      : slideStyle === style.id;
                  return (
                    <button
                      key={style.id}
                      type="button"
                      disabled={Boolean(busy) || (styleScope === "slide" && !hasSelected)}
                      className={`flex w-full items-start gap-2.5 rounded-[11px] border px-2.5 py-2.5 text-left transition ${
                        active
                          ? "border-[rgba(0,0,0,0.75)] bg-[rgba(0,0,0,0.025)]"
                          : "border-[rgba(0,0,0,0.12)] bg-white hover:border-[rgba(0,0,0,0.3)]"
                      } disabled:opacity-50`}
                      onClick={() =>
                        styleScope === "project"
                          ? onProjectStyleChange(style.id)
                          : onSlideStyleChange(style.id)
                      }
                    >
                      <StyleGlyph style={style.id} active={active} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-2">
                          <span className="text-xs font-medium text-[rgba(0,0,0,0.88)]">
                            {style.label}
                          </span>
                          <span className="text-[9px] text-[rgba(0,0,0,0.38)]">
                            {style.useCases[0]}
                          </span>
                        </span>
                        <span className="mt-0.5 block text-[10px] leading-[1.45] text-[rgba(0,0,0,0.48)]">
                          {style.description}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          </>
        ) : (
          <>
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

            <section className="theme-config-section">
              <p className="theme-config-label">主题包</p>
              <p className="theme-config-hint">切换即改 SVG 色板</p>
              <div className="mt-2 max-h-[min(180px,35vh)] space-y-1.5 overflow-y-auto pr-0.5">
                {filteredPacks.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    disabled={Boolean(busy)}
                    onClick={() => onThemeChange(option.id)}
                    className={`flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition ${
                      exportTheme === option.id
                        ? "border-[rgba(0,0,0,0.9)] bg-[rgba(0,0,0,0.03)]"
                        : "border-[rgba(0,0,0,0.13)] bg-white hover:border-[rgba(0,0,0,0.35)]"
                    } disabled:opacity-60`}
                  >
                    <span
                      className="h-7 w-7 shrink-0 rounded-md border border-[rgba(0,0,0,0.05)]"
                      style={{
                        background: `linear-gradient(135deg, ${option.previewBg} 40%, ${option.accentHex})`
                      }}
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-[rgba(0,0,0,0.9)]">
                        {option.label}
                      </span>
                      <span className="block truncate text-[10px] text-[rgba(0,0,0,0.45)]">
                        {option.suitableFor}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </section>

            <section className="theme-config-section">
              <p className="theme-config-label">页级强调色</p>
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
                    <span
                      className="h-3 w-3 rounded-sm border border-[rgba(0,0,0,0.05)]"
                      style={{ background: preset.hex }}
                    />
                    {preset.label}
                  </button>
                ))}
              </div>
            </section>

            <section className="theme-config-section">
              <p className="theme-config-label">质感预设</p>
              <div
                className="theme-segmented theme-segmented-wrap mt-2"
                role="group"
                aria-label="质感预设"
              >
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
              <p className="mt-1.5 text-[11px] leading-4 text-[rgba(0,0,0,0.45)]">
                {surface.description}
              </p>
            </section>

            <section className="theme-config-section">
              <p className="theme-config-label">文案与结构</p>
              <p className="mt-1.5 text-[11px] leading-4 text-[rgba(0,0,0,0.45)]">
                原文保持完整；AI 单字段建议不超过 {copyBudgets.keyMessage.maxChars} 字，设计阶段自动换行适配。
              </p>
            </section>
          </>
        )}

        <section className="theme-config-section space-y-2 border-b-0">
          <p className="theme-config-label">应用到设计稿</p>
          <p className="text-[11px] leading-4 text-[rgba(0,0,0,0.45)]">
            主题换色即时预览；风格与构图变化将在重新生成后应用。
          </p>
          <button
            type="button"
            className="secondary-button w-full rounded-[10px] text-xs"
            disabled={Boolean(busy) || !hasSelected}
            onClick={onRegenerateCurrent}
          >
            按当前配置重新生成本页
          </button>
          <button
            type="button"
            className="secondary-button w-full rounded-[10px] text-xs"
            disabled={Boolean(busy) || slidesEmpty}
            onClick={onRegenerateAll}
          >
            按当前配置重新生成全部
          </button>
          {exportWarnings.length > 0 ? (
            <ul className="space-y-1 rounded-lg bg-[rgba(0,0,0,0.03)] px-2 py-2 text-[11px] text-[rgba(0,0,0,0.6)]">
              {exportWarnings.slice(0, 3).map((warning) => (
                <li
                  key={warning}
                  className="border-l-2 border-[rgba(0,0,0,0.13)] pl-2"
                >
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
