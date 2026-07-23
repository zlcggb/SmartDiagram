import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { Download, Eye, FileDown, Headphones, ListFilter, Mic2, Play, Save, SlidersHorizontal, Video, X } from "lucide-react";
import {
  narrationStylePresets,
  subtitleStylePresets,
  type MediaExportDto,
  type NarrationStylePresetId,
  type SlideNarrationDto,
  type SubtitleStyleId
} from "../shared";
import { absoluteDownloadUrl, api } from "../lib/api";
import { useWorkbenchStore } from "../store/workbenchStore";
import { resolveDirectorScope, type DirectorScopeMode } from "./directorScope";

const fallbackVoices = ["Kore", "Aoede", "Zephyr", "Leda", "Callirrhoe", "Puck", "Charon", "Fenrir"];
const fallbackSubtitleFonts = [{
  id: "noto-sans-cjk-sc",
  label: "Noto Sans CJK SC（思源黑体）",
  family: "Noto Sans CJK SC",
  license: "SIL Open Font License 1.1"
}];
const intensityNotes = {
  natural: "表演强度保持自然克制，所有风格特征只做轻微点缀。",
  visible: "表演强度适度明显，让听众能感受到当前风格、重点词和句尾变化，但保持自然可懂。",
  strong: "表演强度明显加强，突出当前风格特征、重点词和句尾变化，但不得尖锐失真或影响吐字。"
} as const;

type VoiceIntensity = keyof typeof intensityNotes;

function parseDirectorPrompt(prompt: string) {
  for (const [intensity, note] of Object.entries(intensityNotes) as Array<[VoiceIntensity, string]>) {
    if (prompt.endsWith(note)) {
      return { prompt: prompt.slice(0, -note.length).trim(), intensity };
    }
  }
  return { prompt, intensity: "visible" as VoiceIntensity };
}

export function ExportsSpace() {
  const { projectId } = useParams();
  const location = useLocation();
  const exports = useWorkbenchStore((s) => s.exports);
  const busy = useWorkbenchStore((s) => s.busy);
  const slides = useWorkbenchStore((s) => s.slides);
  const [narrations, setNarrations] = useState<SlideNarrationDto[]>([]);
  const [mediaExports, setMediaExports] = useState<MediaExportDto[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [mediaBusy, setMediaBusy] = useState<string | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [runtimeReady, setRuntimeReady] = useState(false);
  const [voices, setVoices] = useState<string[]>(fallbackVoices);
  const [stylePresetId, setStylePresetId] = useState<NarrationStylePresetId>("custom");
  const [voice, setVoice] = useState("Zephyr");
  const [directorPrompt, setDirectorPrompt] = useState("用自然、专业、清晰的中文演讲语气朗读");
  const [intensity, setIntensity] = useState<VoiceIntensity>("visible");
  const [ttsConcurrency, setTtsConcurrency] = useState(3);
  const [subtitlesEnabled, setSubtitlesEnabled] = useState(true);
  const [subtitleFont, setSubtitleFont] = useState("noto-sans-cjk-sc");
  const [subtitleFonts, setSubtitleFonts] = useState(fallbackSubtitleFonts);
  const [subtitleStyle, setSubtitleStyle] = useState<SubtitleStyleId>("minimal-outline");
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [previewAudio, setPreviewAudio] = useState<{ url: string; durationMs: number } | null>(null);
  const [previewVideo, setPreviewVideo] = useState<MediaExportDto | null>(null);
  const [scopeMode, setScopeMode] = useState<DirectorScopeMode>("designed");
  const [scopeStartPage, setScopeStartPage] = useState(1);
  const [scopeEndPage, setScopeEndPage] = useState(1);
  const isDirectorRoute = location.pathname.includes(`/p/${projectId}/director`);

  const effectivePrompt = `${directorPrompt.trim()} ${intensityNotes[intensity]}`.trim();
  const scope = useMemo(
    () => resolveDirectorScope(slides, { mode: scopeMode, startPage: scopeStartPage, endPage: scopeEndPage }),
    [slides, scopeMode, scopeStartPage, scopeEndPage]
  );
  const scopedNarrations = useMemo(() => {
    const selected = new Set(scope.slideIds);
    return narrations.filter((item) => selected.has(item.slideId));
  }, [narrations, scope.slideIds]);

  useEffect(() => {
    if (!slides.length) return;
    setScopeStartPage((page) => Math.min(Math.max(page, 1), slides.length));
    setScopeEndPage((page) => page === 1 ? slides.length : Math.min(Math.max(page, 1), slides.length));
  }, [slides.length]);

  async function refreshMedia() {
    if (!projectId) return;
    const [nextNarrations, nextExports] = await Promise.all([
      api.getNarrations(projectId),
      api.getMediaExports(projectId)
    ]);
    setNarrations(nextNarrations);
    setMediaExports(nextExports);
    setDrafts(Object.fromEntries(nextNarrations.map((item) => [item.slideId, item.scriptText])));
    return nextNarrations;
  }

  useEffect(() => {
    if (!projectId || !isDirectorRoute) return;
    void Promise.all([api.getMediaStatus(), refreshMedia()])
      .then(([status, nextNarrations]) => {
        setRuntimeReady(status.configured && status.ffmpeg);
        setVoices(status.voices.length ? status.voices : fallbackVoices);
        setTtsConcurrency(status.ttsConcurrency);
        setSubtitleFonts(status.subtitleFonts.length ? status.subtitleFonts : fallbackSubtitleFonts);
        if (status.subtitleFonts[0]) setSubtitleFont(status.subtitleFonts[0].id);
        const first = nextNarrations?.[0];
        if (first) {
          const parsedPrompt = parseDirectorPrompt(first.prompt || "用自然、专业、清晰的中文演讲语气朗读");
          setVoice(first.voice || status.voice);
          setDirectorPrompt(parsedPrompt.prompt);
          setIntensity(parsedPrompt.intensity);
          const matched = narrationStylePresets.find((preset) => preset.voice === first.voice && preset.prompt === parsedPrompt.prompt);
          setStylePresetId(matched?.id || "custom");
        } else {
          setVoice(status.voice);
        }
      })
      .catch((error) => setMediaError(error instanceof Error ? error.message : "媒体功能检查失败"));
  }, [projectId, isDirectorRoute]);

  function selectPreset(id: NarrationStylePresetId) {
    setStylePresetId(id);
    const preset = narrationStylePresets.find((item) => item.id === id);
    if (preset) {
      setVoice(preset.voice);
      setDirectorPrompt(preset.prompt);
    }
    setSettingsDirty(true);
    setPreviewAudio(null);
  }

  async function runMediaAction(label: string, action: () => Promise<unknown>) {
    setMediaBusy(label);
    setMediaError(null);
    try {
      await action();
      await refreshMedia();
    } catch (error) {
      setMediaError(error instanceof Error ? error.message : "操作失败");
    } finally {
      setMediaBusy(null);
    }
  }

  return (
    <div className="space-y-6">
    {!isDirectorRoute ? <section className="rounded-2xl border border-line bg-white p-6 shadow-soft">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-title">导出历史</h2>
          <p className="mt-1 text-sm text-muted">
            下载本项目已生成的 PPTX。主题在工作室右侧配置；导出在工作室 · 设计稿工具条。
          </p>
        </div>
        {projectId ? (
          <Link to={`../studio`} className="secondary-button rounded-xl">
            去工作室导出
          </Link>
        ) : null}
      </div>

      {exports.length === 0 ? (
        <div className="mt-8 rounded-xl bg-card px-4 py-14 text-center">
          <FileDown className="mx-auto h-8 w-8 text-muted" />
          <p className="mt-3 text-sm text-muted">
            {busy ? "加载中…" : "尚无导出记录。请到工作室 · 设计稿使用「导出当前页」或「导出 PPTX」。"}
          </p>
        </div>
      ) : (
        <ul className="mt-6 divide-y divide-line rounded-xl border border-line">
          {exports.map((item, index) => (
            <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="font-semibold text-title">
                  {item.versionName || `导出 ${exports.length - index}`}
                  {index === 0 ? (
                    <span className="ml-2 rounded-md bg-tint px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                      最近
                    </span>
                  ) : null}
                </p>
                <p className="mt-0.5 text-xs text-muted">
                  {new Date(item.createdAt).toLocaleString()}
                  {item.warnings?.length ? ` · ${item.warnings.length} 条提示` : ""}
                </p>
              </div>
              <a
                className="secondary-button rounded-xl"
                href={absoluteDownloadUrl(item.downloadUrl)}
                download={`${item.versionName || "export"}.pptx`}
                title="下载该历史文件，不会重新导出"
              >
                <Download className="h-4 w-4" />
                下载
              </a>
            </li>
          ))}
        </ul>
      )}
    </section> : null}
    {isDirectorRoute ? <section className="director-space rounded-2xl border border-line bg-white p-6 shadow-soft">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Video className="h-5 w-5 text-primary" />
            <h2 className="text-xl font-bold text-title">配音与视频导演</h2>
            <span className={`rounded-full px-2 py-0.5 text-xs ${runtimeReady ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
              {runtimeReady ? "TTS / FFmpeg 已就绪" : "运行时未就绪"}
            </span>
          </div>
          <p className="mt-1 text-sm text-muted">逐页生成演讲稿与配音，批量 TTS 支持 1–5 路受控并发，再按真实音频时长导出 1080p MP4。</p>
        </div>
        <div className="director-scope flex min-w-[19rem] flex-wrap items-end gap-2 rounded-xl border border-line bg-card px-3 py-2" aria-label="页面范围">
          <ListFilter className="mb-2 h-4 w-4 text-primary" />
          <label className="text-[11px] font-medium text-muted">
            页面范围
            <select
              aria-label="页面范围模式"
              className="mt-0.5 block rounded-lg border border-line bg-white px-2.5 py-1.5 text-sm font-medium text-title"
              value={scopeMode}
              onChange={(event) => setScopeMode(event.target.value as DirectorScopeMode)}
            >
              <option value="designed">已完成设计稿</option>
              <option value="custom">自定义范围</option>
              <option value="all">全部页面</option>
            </select>
          </label>
          {scopeMode === "custom" ? <>
            <label className="text-[11px] font-medium text-muted">
              从
              <select aria-label="起始页" className="mt-0.5 block rounded-lg border border-line bg-white px-2 py-1.5 text-sm text-title" value={scopeStartPage} onChange={(event) => {
                const page = Number(event.target.value);
                setScopeStartPage(page);
                if (page > scopeEndPage) setScopeEndPage(page);
              }}>
                {slides.map((slide, index) => <option key={slide.id} value={index + 1}>第 {index + 1} 页</option>)}
              </select>
            </label>
            <span className="mb-2 text-xs text-muted">至</span>
            <label className="text-[11px] font-medium text-muted">
              到
              <select aria-label="结束页" className="mt-0.5 block rounded-lg border border-line bg-white px-2 py-1.5 text-sm text-title" value={scopeEndPage} onChange={(event) => {
                const page = Number(event.target.value);
                setScopeEndPage(page);
                if (page < scopeStartPage) setScopeStartPage(page);
              }}>
                {slides.map((slide, index) => <option key={slide.id} value={index + 1}>第 {index + 1} 页</option>)}
              </select>
            </label>
          </> : null}
          <div className="min-w-[9rem] border-l border-line pl-3">
            <span className="block text-[10px] font-semibold uppercase tracking-wide text-muted">当前范围</span>
            <strong className="mt-0.5 block text-sm text-title">{scope.summary}</strong>
            {scope.exportBlockedReason && scope.slideIds.length ? <span className="mt-0.5 block text-[11px] text-amber-700">{scope.exportBlockedReason}</span> : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="secondary-button rounded-xl" disabled={!projectId || scope.slideIds.length === 0 || Boolean(mediaBusy)} onClick={() => projectId && void runMediaAction("生成演讲稿中", () => api.generateNarrations(projectId, { slideIds: scope.slideIds }))}>
            <Mic2 className="h-4 w-4" /> 生成演讲稿
          </button>
          <button className="secondary-button rounded-xl" title={settingsDirty ? "请先应用新的配音设置" : undefined} disabled={!projectId || scopedNarrations.length === 0 || Boolean(mediaBusy) || settingsDirty} onClick={() => projectId && void runMediaAction(`${ttsConcurrency} 路并发生成配音中`, () => api.synthesizeNarrations(projectId, { slideIds: scope.slideIds, concurrency: ttsConcurrency }))}>
            <Play className="h-4 w-4" /> 生成配音
          </button>
          <button className="primary-button rounded-xl" title={scope.exportBlockedReason || undefined} disabled={!projectId || !scope.exportReady || Boolean(mediaBusy)} onClick={() => projectId && void runMediaAction("生成视频中", () => api.exportVideo(projectId, {
            slideIds: scope.slideIds,
            concurrency: ttsConcurrency,
            subtitles: subtitlesEnabled,
            subtitleFont,
            subtitleStyle
          }))}>
            <Video className="h-4 w-4" /> {subtitlesEnabled ? "导出带字幕视频" : "导出无字幕视频"}
          </button>
        </div>
      </div>

      <div className="mt-5 rounded-2xl border border-line bg-card p-4">
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 text-primary" />
          <h3 className="font-semibold text-title">配音导演台</h3>
          {settingsDirty ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] text-amber-700">有未应用的修改</span> : null}
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-4">
          <label className="text-xs font-medium text-muted">
            风格预设
            <select className="mt-1 w-full rounded-xl border border-line bg-white px-3 py-2 text-sm text-title" value={stylePresetId} onChange={(event) => selectPreset(event.target.value as NarrationStylePresetId)}>
              {narrationStylePresets.map((preset) => <option key={preset.id} value={preset.id}>{preset.label} · {preset.description}</option>)}
              <option value="custom">自定义</option>
            </select>
          </label>
          <label className="text-xs font-medium text-muted">
            基础音色
            <select className="mt-1 w-full rounded-xl border border-line bg-white px-3 py-2 text-sm text-title" value={voice} onChange={(event) => { setVoice(event.target.value); setStylePresetId("custom"); setSettingsDirty(true); setPreviewAudio(null); }}>
              {voices.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label className="text-xs font-medium text-muted">
            表演强度
            <select className="mt-1 w-full rounded-xl border border-line bg-white px-3 py-2 text-sm text-title" value={intensity} onChange={(event) => { setIntensity(event.target.value as VoiceIntensity); setSettingsDirty(true); setPreviewAudio(null); }}>
              <option value="natural">自然克制</option>
              <option value="visible">特征明显</option>
              <option value="strong">强烈表演</option>
            </select>
          </label>
          <label className="text-xs font-medium text-muted">
            批量配音并发
            <select className="mt-1 w-full rounded-xl border border-line bg-white px-3 py-2 text-sm text-title" value={ttsConcurrency} onChange={(event) => setTtsConcurrency(Number(event.target.value))}>
              {[1, 2, 3, 4, 5].map((count) => <option key={count} value={count}>{count} 路{count === 3 ? "（推荐）" : ""}</option>)}
            </select>
          </label>
        </div>
        <div className="mt-3 rounded-xl border border-line bg-white p-3">
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-title">
              <input type="checkbox" className="h-4 w-4 accent-black" checked={subtitlesEnabled} onChange={(event) => setSubtitlesEnabled(event.target.checked)} />
              烧录中文字幕
            </label>
            <select
              aria-label="字幕字体"
              className="rounded-lg border border-line bg-white px-3 py-1.5 text-sm text-title disabled:bg-card disabled:text-muted"
              disabled={!subtitlesEnabled}
              value={subtitleFont}
              onChange={(event) => setSubtitleFont(event.target.value)}
            >
              {subtitleFonts.map((font) => <option key={font.id} value={font.id}>{font.label}</option>)}
            </select>
            <span className="text-xs text-muted">商用可用 · {subtitleFonts.find((font) => font.id === subtitleFont)?.license}</span>
          </div>
          <div className={`mt-3 grid gap-2 md:grid-cols-3 ${subtitlesEnabled ? "" : "pointer-events-none opacity-45"}`} aria-label="字幕样式">
            {subtitleStylePresets.map((preset) => {
              const selected = subtitleStyle === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  aria-pressed={selected}
                  className={`flex items-center gap-3 rounded-xl border p-2.5 text-left transition ${selected ? "border-title bg-title text-white shadow-sm" : "border-line bg-card text-title hover:border-muted"}`}
                  onClick={() => setSubtitleStyle(preset.id)}
                >
                  <span className="flex h-11 w-24 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-[#e9e5de]">
                    {preset.id === "minimal-outline" ? (
                      <span className="text-[11px] font-semibold text-white" style={{ textShadow: "0 1px 2px #111, 1px 0 #111, -1px 0 #111" }}>示例字幕</span>
                    ) : preset.id === "soft-capsule" ? (
                      <span className="rounded-md bg-black/55 px-2 py-1 text-[10px] font-medium text-white">示例字幕</span>
                    ) : (
                      <span className="flex items-center gap-1.5 rounded-md bg-[#111318]/80 px-2 py-1 text-[10px] font-medium text-white"><i className="h-3 w-0.5 rounded-full bg-[#F25700]" />示例字幕</span>
                    )}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">{preset.label}{preset.id === "minimal-outline" ? " · 推荐" : ""}</span>
                    <span className={`mt-0.5 block text-xs ${selected ? "text-white/65" : "text-muted"}`}>{preset.description}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        <label className="mt-3 block text-xs font-medium text-muted">
          导演提示（可继续手动调整鼻音、气声、语速和句尾）
          <textarea className="mt-1 min-h-24 w-full rounded-xl border border-line bg-white p-3 text-sm leading-6 text-title" value={directorPrompt} onChange={(event) => { setDirectorPrompt(event.target.value); setStylePresetId("custom"); setSettingsDirty(true); setPreviewAudio(null); }} />
        </label>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <button className="secondary-button rounded-xl" disabled={Boolean(mediaBusy) || !directorPrompt.trim()} onClick={() => void runMediaAction("生成试听中", async () => {
              const sample = await api.previewTts({ text: "好嘛，就再听我说一点点，这一页真的很重要哦。", voice, prompt: effectivePrompt, languageCode: "cmn-CN" });
              setPreviewAudio({ url: sample.audioUrl, durationMs: sample.durationMs });
            })}>
              <Headphones className="h-4 w-4" /> 试听短句
            </button>
            <button className="primary-button rounded-xl" disabled={!projectId || scopedNarrations.length === 0 || Boolean(mediaBusy) || !settingsDirty || !directorPrompt.trim()} onClick={() => projectId && void runMediaAction("应用配音风格中", async () => {
              await api.applyNarrationStyle(projectId, { slideIds: scope.slideIds, voice, prompt: effectivePrompt, languageCode: "cmn-CN" });
              setSettingsDirty(false);
            })}>
              应用到当前范围
            </button>
          </div>
          {previewAudio ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted">{(previewAudio.durationMs / 1000).toFixed(1)} 秒</span>
              <audio controls autoPlay src={absoluteDownloadUrl(previewAudio.url)} className="h-9 max-w-full" />
            </div>
          ) : <span className="text-xs text-muted">建议先试听；满意后再应用并批量生成配音。</span>}
        </div>
      </div>

      {mediaBusy ? <p className="mt-4 rounded-xl bg-tint px-4 py-3 text-sm text-primary">{mediaBusy}，请勿关闭页面…</p> : null}
      {mediaError ? <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{mediaError}</p> : null}

      {scopedNarrations.length > 0 ? (
        <div className="mt-6 space-y-3">
          {scopedNarrations.map((item) => {
            const slide = slides.find((candidate) => candidate.id === item.slideId);
            const pageNumber = slides.findIndex((candidate) => candidate.id === item.slideId) + 1;
            return (
              <article key={item.id} className="rounded-xl border border-line p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-semibold text-title">{pageNumber}. {slide?.title || "页面演讲稿"}</p>
                  <span className="text-xs text-muted">{item.audioDurationMs ? `${(item.audioDurationMs / 1000).toFixed(1)} 秒` : "待配音"}</span>
                </div>
                <textarea className="mt-3 min-h-28 w-full rounded-xl border border-line p-3 text-sm leading-6 text-title" value={drafts[item.slideId] ?? item.scriptText} onChange={(event) => setDrafts((current) => ({ ...current, [item.slideId]: event.target.value }))} />
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                  {item.audioUrl ? <audio controls preload="none" src={absoluteDownloadUrl(item.audioUrl)} className="h-9 max-w-full" /> : <span className="text-xs text-muted">保存修改后需要重新生成配音</span>}
                  <div className="flex flex-wrap gap-2">
                    <button className="secondary-button rounded-xl" title={settingsDirty ? "请先应用新的配音设置" : undefined} disabled={!projectId || Boolean(mediaBusy) || settingsDirty} onClick={() => projectId && void runMediaAction(`生成第 ${pageNumber} 页配音中`, () => api.synthesizeNarration(projectId, item.slideId, { force: true }))}>
                      <Play className="h-4 w-4" /> 重配本页
                    </button>
                    <button className="secondary-button rounded-xl" disabled={!projectId || Boolean(mediaBusy)} onClick={() => projectId && void runMediaAction("保存演讲稿中", () => api.updateNarration(projectId, item.slideId, drafts[item.slideId] ?? item.scriptText))}>
                      <Save className="h-4 w-4" /> 保存讲稿
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : <p className="mt-6 rounded-xl bg-card px-4 py-8 text-center text-sm text-muted">当前范围还没有演讲稿，请先点击“生成演讲稿”。</p>}

      {mediaExports.length > 0 ? (
        <div className="mt-6 border-t border-line pt-5">
          <h3 className="font-semibold text-title">视频导出历史</h3>
          <ul className="mt-3 space-y-2">
            {mediaExports.map((item) => (
              <li key={item.id} className="flex items-center justify-between rounded-xl bg-card px-4 py-3 text-sm">
                <span>{new Date(item.createdAt).toLocaleString()} · {item.status === "completed" ? "已完成" : item.status}{item.status === "completed" ? ` · ${item.subtitles ? "带字幕" : "无字幕"}` : ""}</span>
                {item.downloadUrl && item.previewUrl ? (
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className="secondary-button rounded-xl" onClick={() => setPreviewVideo(item)}>
                      <Eye className="h-4 w-4" /> 预览
                    </button>
                    <a className="secondary-button rounded-xl" href={absoluteDownloadUrl(item.downloadUrl)}>
                      <Download className="h-4 w-4" /> 下载 MP4
                    </a>
                    {item.subtitleUrl ? (
                      <a className="secondary-button rounded-xl" href={absoluteDownloadUrl(item.subtitleUrl)}>
                        <FileDown className="h-4 w-4" /> 下载 SRT
                      </a>
                    ) : null}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {previewVideo?.previewUrl ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-label="视频预览" onClick={() => setPreviewVideo(null)}>
          <div className="w-full max-w-5xl overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <div>
                <h3 className="font-semibold text-title">视频预览</h3>
                <p className="mt-0.5 text-xs text-muted">{new Date(previewVideo.createdAt).toLocaleString()}</p>
              </div>
              <button type="button" className="rounded-lg p-2 text-muted hover:bg-card hover:text-title" aria-label="关闭预览" onClick={() => setPreviewVideo(null)}>
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="bg-black p-2 sm:p-4">
              <video className="mx-auto max-h-[70vh] w-full bg-black" src={absoluteDownloadUrl(previewVideo.previewUrl)} controls autoPlay playsInline />
            </div>
            <div className="flex justify-end px-5 py-4">
              {previewVideo.downloadUrl ? (
                <a className="primary-button rounded-xl" href={absoluteDownloadUrl(previewVideo.downloadUrl)}>
                  <Download className="h-4 w-4" /> 下载 MP4
                </a>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </section> : null}
    </div>
  );
}
