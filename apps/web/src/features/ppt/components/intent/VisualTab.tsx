import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Check, ChevronDown, WandSparkles } from "lucide-react";
import type { PptExportTheme } from "@ppt-agent/shared";
import { useWorkbenchStore } from '@/features/ppt/store/workbenchStore';
import { exportThemeOptions } from "../../lib/exportMode";

function recommendThemes(context: string): PptExportTheme[] {
  const normalized = context.toLowerCase();
  if (/金融|投资|财务|指数|基金|银行|证券/.test(normalized)) {
    return ["gold-index", "deep-strategy", "chart-report"];
  }
  if (/技术|开发|架构|ai|人工智能|系统|代码|工程/.test(normalized)) {
    return ["blue-black", "code-surface", "white-blue"];
  }
  if (/品牌|发布会|新品|消费|创意|营销/.test(normalized)) {
    return ["glass-brand", "black-gold", "soft-product"];
  }
  if (/研究|调研|白皮书|报告|数据|分析/.test(normalized)) {
    return ["cold-research", "chart-report", "white-blue"];
  }
  if (/增长|复盘|路演|销售|业绩/.test(normalized)) {
    return ["growth-energy", "chart-report", "white-blue"];
  }
  return ["white-blue", "soft-product", "deep-strategy"];
}

export function VisualTab() {
  const navigate = useNavigate();
  const project = useWorkbenchStore((s) => s.project);
  const facts = useWorkbenchStore((s) => s.facts);
  const exportTheme = useWorkbenchStore((s) => s.exportTheme);
  const busy = useWorkbenchStore((s) => s.busy);
  const setExportTheme = useWorkbenchStore((s) => s.setExportTheme);
  const generateOutline = useWorkbenchStore((s) => s.generateOutline);

  const [selectedTheme, setSelectedTheme] = useState<PptExportTheme>(exportTheme);
  const [autoTheme, setAutoTheme] = useState(true);
  const [showAllThemes, setShowAllThemes] = useState(false);

  const themeRecommendations = useMemo(() => {
    const context = [
      project?.topic,
      project?.name,
      project?.reportType,
      project?.briefJson?.summary,
      project?.audience,
      project?.purpose
    ]
      .filter(Boolean)
      .join(" ");
    return recommendThemes(context);
  }, [project]);

  const displayedThemes = showAllThemes
    ? exportThemeOptions
    : themeRecommendations
        .map((themeId) => exportThemeOptions.find((option) => option.id === themeId))
        .filter((option): option is (typeof exportThemeOptions)[number] => Boolean(option));

  async function buildStructure() {
    const recommendedTheme = themeRecommendations[0] ?? "white-blue";
    const theme = autoTheme ? recommendedTheme : selectedTheme;
    await setExportTheme(theme);
    if (useWorkbenchStore.getState().error) return;
    await generateOutline();
    if (useWorkbenchStore.getState().error) return;
    if (project) navigate("../structure");
  }

  return (
    <section className="brief-dialog-card">
      <div className="brief-dialog-card__title">
        <span><WandSparkles className="h-5 w-5" /></span>
        <div>
          <h2>选择这份演示的视觉方向</h2>
          <p>模板只决定视觉表达；已确认的需求与事实不会在这里被重新提取或覆盖。</p>
        </div>
      </div>

      <button
        type="button"
        className={`theme-auto-choice ${autoTheme ? "is-selected" : ""}`}
        onClick={() => {
          setAutoTheme(true);
          setSelectedTheme(themeRecommendations[0] ?? "white-blue");
        }}
      >
        <span><WandSparkles className="h-5 w-5" /></span>
        <span>
          <strong>交给 AI 选择</strong>
          <small>根据受众、主题与内容密度，自动采用最合适的方向</small>
        </span>
        <i>{autoTheme ? <Check className="h-4 w-4" /> : null}</i>
      </button>

      <div className="theme-choice-heading">
        <span>{showAllThemes ? "全部视觉主题" : "为你推荐"}</span>
        <button type="button" onClick={() => setShowAllThemes((show) => !show)}>
          {showAllThemes ? "收起" : "查看全部"}
          <ChevronDown className={`h-4 w-4 ${showAllThemes ? "rotate-180" : ""}`} />
        </button>
      </div>

      <div className={`brief-theme-grid ${showAllThemes ? "is-all" : ""}`}>
        {displayedThemes.map((option, index) => {
          const selected = !autoTheme && selectedTheme === option.id;
          return (
            <button
              key={option.id}
              type="button"
              className={`brief-theme-card ${selected ? "is-selected" : ""}`}
              onClick={() => {
                setAutoTheme(false);
                setSelectedTheme(option.id);
              }}
            >
              <span className="brief-theme-card__preview" style={{ background: option.previewBg }}>
                <i style={{ background: option.accentHex }} />
                <b style={{ background: option.accentHex }} />
                <em />
              </span>
              <span className="brief-theme-card__copy">
                <strong>{option.label}</strong>
                <small>{option.suitableFor}</small>
              </span>
              {!showAllThemes ? <span className="brief-theme-card__rank">推荐 {index + 1}</span> : null}
              {selected ? (
                <span className="brief-theme-card__check">
                  <Check className="h-3.5 w-3.5" />
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="brief-dialog-card__footer">
        <span className="visual-fact-summary">将使用 {facts.filter((fact) => fact.canUseInPpt).length} 条已确认事实生成结构</span>
        <button
          type="button"
          className="brief-primary-action"
          disabled={Boolean(busy) || !facts.some((fact) => fact.canUseInPpt)}
          onClick={() => void buildStructure()}
        >
          {busy || "选择此模板并生成结构"}
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </section>
  );
}
