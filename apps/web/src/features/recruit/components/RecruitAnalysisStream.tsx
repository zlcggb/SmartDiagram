import { useEffect, useRef, useState, type DragEvent } from 'react'
import { Check, CircleAlert, FileUp, GraduationCap, LoaderCircle } from 'lucide-react'

import { ModelSelect } from '@/features/recruit/components/ModelSelect'
import { AiLoader } from '@/features/recruit/components/RecruitUI'
import type { AnalysisRun } from '@/features/recruit/lib/analysisStream'
import { fetchRecruitModels } from '@/features/recruit/lib/api'

const RESUME_ACCEPT = '.pdf,application/pdf,.docx,.txt,.md,.png,.jpg,.jpeg,.webp,image/*'
const RESUME_EXTENSIONS = /\.(pdf|docx|txt|md|png|jpe?g|webp)$/i

function useRecruitModels(enabled: boolean) {
  const [catalog, setCatalog] = useState<{ default: string; models: string[] }>({ default: '', models: [] })
  useEffect(() => {
    if (!enabled || catalog.models.length) return
    void fetchRecruitModels().then(setCatalog).catch(() => undefined)
  }, [enabled, catalog.models.length])
  return catalog
}

export function ModelPicker({ value, onChange, enabled = true }: { id?: string; value: string; onChange: (value: string) => void; enabled?: boolean }) {
  const catalog = useRecruitModels(enabled)
  return (
    <ModelSelect
      label="评估模型"
      value={value}
      onChange={onChange}
      models={catalog.models}
      defaultModel={catalog.default}
    />
  )
}

export function ResumeDropZone({
  file,
  loading = false,
  caption,
  onFile,
  onReject,
}: {
  file: File | null
  loading?: boolean
  caption: string
  onFile: (file: File | null) => void
  onReject: (message: string) => void
}) {
  const [isDragging, setIsDragging] = useState(false)

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault()
    setIsDragging(false)
    const dropped = event.dataTransfer.files?.[0]
    if (!dropped) return
    if (!RESUME_EXTENSIONS.test(dropped.name) && !dropped.type.startsWith('image/')) {
      onReject('仅支持 PDF / Word(.docx) / TXT / 图片格式的简历。')
      return
    }
    onFile(dropped)
  }

  return (
    <label
      className={`recruit-upload-zone${isDragging ? ' is-dragging' : ''}`}
      onDragEnter={(event) => { event.preventDefault(); setIsDragging(true) }}
      onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' }}
      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsDragging(false) }}
      onDrop={handleDrop}
    >
      <span className="recruit-upload-zone__head">
        <span className="recruit-upload-zone__icon" aria-hidden="true"><FileUp size={18} /></span>
        <span>
          <strong>{isDragging ? '松开鼠标上传简历' : '拖入或选择简历'}</strong>
          <span>PDF · Word · PNG / JPG → 自动识别信息并开始 AI 初筛</span>
        </span>
        {loading ? <AiLoader label="识别中" /> : null}
      </span>
      <input type="file" accept={RESUME_ACCEPT} onChange={(event) => onFile(event.target.files?.[0] ?? null)} />
      <span className="recruit-upload-zone__caption">{file ? `已选择：${file.name}` : caption}</span>
    </label>
  )
}

export function AnalysisProgress({ run }: { run: AnalysisRun }) {
  const tokenBoxRef = useRef<HTMLPreElement>(null)
  useEffect(() => {
    if (tokenBoxRef.current) tokenBoxRef.current.scrollTop = tokenBoxRef.current.scrollHeight
  }, [run.tokens])

  return (
    <section className="recruit-analysis-stream" aria-live="polite">
      <ol className="recruit-analysis-stream__steps">
        {run.steps.length ? run.steps.map((step) => (
          <li key={step.key} className={`is-${step.status}`}>
            {step.status === 'running' ? <LoaderCircle size={13} className="animate-spin" /> : step.status === 'done' ? <Check size={13} /> : <CircleAlert size={13} />}
            <span>{step.label}</span>
          </li>
        )) : <li className="is-running"><LoaderCircle size={13} className="animate-spin" /><span>上传简历…</span></li>}
      </ol>
      {run.facts.length ? (
        <div className="recruit-analysis-stream__facts">
          {run.facts.map((fact, index) => (
            <p key={`${fact.school}-${index}`}>
              <GraduationCap size={13} />
              <strong>{fact.school || '未识别学校'}</strong>
              <span>{[fact.school_level, ...fact.school_tags].filter(Boolean).join(' · ')}</span>
              <span>{fact.degree ? `${fact.degree}（${fact.degree_source}）` : '学历未知'}</span>
              <span>{fact.graduation_year ? `${fact.graduation_year} 届（${fact.graduation_source}）` : '毕业年份未知'}</span>
            </p>
          ))}
        </div>
      ) : null}
      {run.tokens ? <pre ref={tokenBoxRef} className="recruit-analysis-stream__tokens">{run.tokens}</pre> : null}
    </section>
  )
}
