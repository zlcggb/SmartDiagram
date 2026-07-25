import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  ArrowRight,
  ArrowUpRight,
  Clock3,
  FileText,
  FolderOpen,
  Layers3,
  Paperclip,
  Presentation,
  X
} from "lucide-react";
import { getThemePack, normalizePptExportTheme, type ProjectDto } from '@ppt-agent/shared';
import { AppLogoMark } from "../components/AppLogo";
import { MaterialUploader } from "../components/materials/MaterialUploader";
import { MATERIAL_ACCEPT } from "../components/materials/materialUploadModel";
import { useMaterialUploads } from "../components/materials/useMaterialUploads";
import { api } from "../lib/api";
import { useWorkbenchStore } from '@/features/ppt/store/workbenchStore';

const starterPrompts = [
  "做一份面向管理层的 Q3 经营复盘",
  "为新品发布会策划一套 12 页演示",
  "把项目周报整理成清晰的汇报材料"
];

function formatProjectDate(value: string) {
  return new Date(value).toLocaleDateString("zh-CN", {
    month: "short",
    day: "numeric"
  });
}

function deriveProjectName(prompt: string, filenames: string[]) {
  const firstLine = prompt.trim().split(/\r?\n/)[0]?.replace(/[，。！？!?：:]+$/g, "").trim();
  if (firstLine) return firstLine.slice(0, 42);
  const fileName = filenames[0]?.replace(/\.[^.]+$/, "");
  return fileName?.slice(0, 42) || "未命名演示项目";
}

export function HomePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const createProject = useWorkbenchStore((s) => s.createProject);
  const busy = useWorkbenchStore((s) => s.busy);
  const error = useWorkbenchStore((s) => s.error);
  const clearError = useWorkbenchStore((s) => s.clearError);
  const materials = useWorkbenchStore((s) => s.materials);
  const uploadMaterial = useWorkbenchStore((s) => s.uploadMaterial);
  const deleteMaterial = useWorkbenchStore((s) => s.deleteMaterial);

  const [prompt, setPrompt] = useState("");
  const [referenceText, setReferenceText] = useState("");
  const [referenceOpen, setReferenceOpen] = useState(false);
  const [createdProjectId, setCreatedProjectId] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [recentProjects, setRecentProjects] = useState<ProjectDto[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [projectsError, setProjectsError] = useState<string | null>(null);

  const {
    items: attachments,
    selectionErrors,
    isUploading,
    addFiles,
    uploadAll,
    retryItem,
    removeItem
  } = useMaterialUploads({
    projectId: createdProjectId ?? undefined,
    initialMaterials: createdProjectId ? materials : undefined,
    uploadFile: uploadMaterial,
    deleteFile: deleteMaterial
  });
  const referenceMaterial = referenceText.trim();
  const canSubmit = Boolean(prompt.trim() || referenceMaterial.length >= 20 || attachments.some((item) => item.status !== "failed"));

  const loadRecentProjects = useCallback(async () => {
    setProjectsLoading(true);
    setProjectsError(null);
    try {
      setRecentProjects(await api.listProjects());
    } catch (reason) {
      setProjectsError(reason instanceof Error ? reason.message : "项目列表加载失败");
    } finally {
      setProjectsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRecentProjects();
  }, [loadRecentProjects]);

  useEffect(() => {
    const targetId = location.hash.slice(1);
    if (targetId !== "ppt-create-project" && targetId !== "recent-projects") return;
    const frame = window.requestAnimationFrame(() => {
      const target = document.getElementById(targetId);
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
      target?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [location.hash]);

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    setLocalError(null);
    await addFiles(Array.from(files));
    setReferenceOpen(true);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function startProject() {
    if (!canSubmit) return;
    clearError();
    setLocalError(null);
    const name = deriveProjectName(prompt, attachments.map((item) => item.filename));
    const topic = prompt.trim() || `请基于已提供的资料，为“${name}”策划一份演示文稿`;
    let projectId = createdProjectId;
    if (!projectId) {
      const project = await createProject({
        name,
        topic,
        mode: "topic",
        reportType: "待顾问确认",
        audience: "待确认受众",
        purpose: "待确认目的",
        pageCount: 8,
        theme: "white-blue"
      });
      if (!project) return;
      projectId = project.id;
      setCreatedProjectId(project.id);
    }

    try {
      if (referenceMaterial.length >= 20) {
        await api.saveSourceText(projectId, referenceMaterial);
      }
      const uploaded = await uploadAll(projectId);
      if (!uploaded) {
        setLocalError("部分资料上传失败；成功项已保留，请重试失败项或将其移除后继续。");
        return;
      }
      navigate(`p/${projectId}/intent`);
    } catch (reason) {
      setLocalError(reason instanceof Error ? reason.message : "参考资料保存失败，请重试。");
    }
  }

  return (
    <div className="home-shell">
      <header className="home-topbar">
        <div className="home-topbar__inner">
          <Link to="." className="home-brand" aria-label="PPT Agent 首页">
            <span className="home-brand__mark"><AppLogoMark /></span>
            <span className="home-brand__name">PPT Agent</span>
          </Link>
          <a href="#recent-projects" className="home-navlink">
            <FolderOpen />
            我的项目
            {recentProjects.length ? <span className="home-navlink__count">{recentProjects.length}</span> : null}
          </a>
        </div>
      </header>

      <main className="home-main">
        <section className="home-intro">
          <p className="home-intro__eyebrow">AI 演示顾问</p>
          <h1>先把事情聊清楚，<br />再生成一份真正能用的 PPT。</h1>
          <p className="home-intro__sub">
            直接说主题，也可以附上已有资料。AI 会先确认受众、目标与重点，
            再和你一起完成调研、大纲、设计与导出。
          </p>
        </section>

        <section
          id="ppt-create-project"
          className="home-composer"
          aria-label="创建演示项目"
          tabIndex={-1}
        >
          <textarea
            className="home-composer__input"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="例如：下周要向管理层汇报智慧展厅二期方案，希望突出投入产出和交付计划……"
            aria-label="描述演示需求"
          />

          {referenceOpen ? (
            <div className="home-reference">
              <div className="home-reference__heading">
                <span><FileText />参考资料</span>
                <button type="button" className="home-reference__close" onClick={() => setReferenceOpen(false)} aria-label="收起资料区"><X /></button>
              </div>
              <textarea
                value={referenceText}
                onChange={(event) => setReferenceText(event.target.value)}
                placeholder="粘贴会议纪要、项目说明、网页正文或数据备注。AI 会先理解资料，再询问缺失信息。"
                aria-label="粘贴参考资料"
              />
              <MaterialUploader
                items={attachments}
                selectionErrors={selectionErrors}
                onRetry={createdProjectId ? retryItem : undefined}
                onRemove={removeItem}
                className="home-material-uploader"
              />
            </div>
          ) : null}

          <div className="home-composer__bar">
            <div className="home-composer__tools">
              <input
                ref={fileInputRef}
                type="file"
                hidden
                multiple
                accept={MATERIAL_ACCEPT}
                onChange={(event) => void handleFiles(event.target.files)}
              />
              <button type="button" className="home-tool" onClick={() => fileInputRef.current?.click()}>
                <Paperclip />上传资料
              </button>
              <button
                type="button"
                className={referenceOpen ? "home-tool is-active" : "home-tool"}
                onClick={() => setReferenceOpen((open) => !open)}
              >
                <FileText />粘贴内容
              </button>
            </div>
            <button
              type="button"
              className="home-send"
              disabled={Boolean(busy) || isUploading || !canSubmit}
              onClick={() => void startProject()}
            >
              {busy ? busy : isUploading ? "正在上传资料" : createdProjectId ? "重试并继续" : "开始顾问对话"}
              <ArrowRight />
            </button>
          </div>
        </section>

        <div className="home-starters" aria-label="需求示例">
          <span>试试这样说</span>
          {starterPrompts.map((item) => (
            <button key={item} type="button" onClick={() => setPrompt(item)}>{item}</button>
          ))}
        </div>

        {localError || error ? <p className="home-error" role="alert">{localError || error}</p> : null}

        <section
          id="recent-projects"
          className="home-projects"
          aria-labelledby="home-projects-title"
          tabIndex={-1}
        >
          <div className="home-projects__heading">
            <h2 id="home-projects-title">继续最近项目</h2>
            <span>{recentProjects.length} 个项目</span>
          </div>

          {projectsLoading ? <div className="home-projects__empty">正在载入最近项目…</div> : null}
          {projectsError ? (
            <div className="home-projects__empty is-error">
              <span>{projectsError}</span>
              <button type="button" className="home-retry" onClick={() => void loadRecentProjects()}>重试</button>
            </div>
          ) : null}
          {!projectsLoading && !projectsError && recentProjects.length === 0 ? (
            <div className="home-projects__empty">
              <FolderOpen />这里会保存你的演示项目，随时回来继续。
            </div>
          ) : null}
          {recentProjects.length > 0 ? (
            <div className="home-projects__grid">
              {recentProjects.slice(0, 4).map((project) => {
                const projectTheme = getThemePack(normalizePptExportTheme(project.theme));
                return (
                  <Link key={project.id} to={`p/${project.id}/studio`} className="home-project-card">
                    <span
                      className="home-project-card__cover"
                      style={{
                        background: `radial-gradient(circle at 76% 20%, ${projectTheme.tokens.primary}66, transparent 36%), linear-gradient(145deg, ${projectTheme.tokens.bg}, ${projectTheme.tokens.bgSoft})`
                      }}
                    >
                      <Presentation />
                    </span>
                    <span className="home-project-card__body">
                      <strong>{project.name}</strong>
                      <small>{project.topic || project.reportType}</small>
                      <span className="home-project-card__meta">
                        <span><Layers3 />{project.pageCount} 页</span>
                        <span><Clock3 />{formatProjectDate(project.updatedAt)}</span>
                      </span>
                    </span>
                    <ArrowUpRight className="home-project-card__arrow" />
                  </Link>
                );
              })}
            </div>
          ) : null}
        </section>

        <p className="home-footnote">项目、对话、资料与设计稿会保存在同一工作空间</p>
      </main>
    </div>
  );
}
