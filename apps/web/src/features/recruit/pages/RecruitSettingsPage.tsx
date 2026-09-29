import { useEffect, useState } from 'react'
import { ArrowDownToLine, ArrowUpFromLine, Coins, Cpu, History, Layers, Save, SlidersHorizontal } from 'lucide-react'
import { Link } from 'react-router-dom'

import { ModelSelect } from '@/features/recruit/components/ModelSelect'
import { ErrorBanner, RecruitPage, SectionCard, StatCard } from '@/features/recruit/components/RecruitPrimitives'
import { EmptyState, MeterBar } from '@/features/recruit/components/RecruitUI'
import { fetchRecruitSettings, fetchRecruitUsage, saveRecruitSettings } from '@/features/recruit/lib/api'
import { formatTokens, MODEL_ROLE_LABELS } from '@/features/recruit/lib/format'
import type { RecruitAiSettings, RecruitModelRole, RecruitUsageReport } from '@/features/recruit/lib/types'

const ROLES: Array<{ role: RecruitModelRole; hint: string }> = [
  { role: 'screening', hint: '逐项评估简历证据并打分，调用最多，决定评分质量。' },
  { role: 'rubric', hint: '根据 JD 生成评分卡，每个岗位只生成一次。' },
  { role: 'ocr', hint: '扫描件 / 图片 / 排版错乱的 PDF 交给视觉模型转写，需支持图片输入。' },
]
const EMPTY_MODELS: RecruitAiSettings['models'] = { screening: '', rubric: '', ocr: '' }

function formatTime(value: string) {
  return new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export function RecruitSettingsPage() {
  const [settings, setSettings] = useState<RecruitAiSettings | null>(null)
  const [draft, setDraft] = useState(EMPTY_MODELS)
  const [usage, setUsage] = useState<RecruitUsageReport | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    Promise.all([fetchRecruitSettings(), fetchRecruitUsage()])
      .then(([nextSettings, nextUsage]) => {
        if (cancelled) return
        setSettings(nextSettings)
        setDraft(nextSettings.models)
        setUsage(nextUsage)
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : '加载设置失败')
      })
    return () => { cancelled = true }
  }, [])

  async function handleSave() {
    setSaving(true)
    setError('')
    try {
      const next = await saveRecruitSettings(draft)
      setSettings(next)
      setDraft(next.models)
      setSavedAt(Date.now())
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const dirty = settings ? ROLES.some(({ role }) => draft[role] !== settings.models[role]) : false
  const totals = usage?.totals
  const modelMax = Math.max(1, ...(usage?.by_model ?? []).map((item) => item.total_tokens))

  return (
    <RecruitPage title="设置" eyebrow="Settings · 模型与用量" description="为招聘平台的每类 AI 任务指定默认模型，并追踪每一次分析的 Token 消耗。">
      <ErrorBanner message={error} />

      <SectionCard
        title="默认模型"
        description="留空则跟随系统环境配置；新增候选人和重新评分时仍可临时切换评估模型。"
        icon={<SlidersHorizontal size={15} />}
        aside={(
          <button type="button" className="recruit-button recruit-button--primary" onClick={() => void handleSave()} disabled={!dirty || saving}>
            <Save size={14} /> {saving ? '保存中…' : dirty ? '保存设置' : savedAt ? '已保存' : '保存设置'}
          </button>
        )}
      >
        <div className="rx-settings-models">
          {ROLES.map(({ role, hint }) => (
            <div key={role} className="rx-settings-models__item">
              <ModelSelect
                label={MODEL_ROLE_LABELS[role]}
                value={draft[role]}
                onChange={(value) => setDraft((current) => ({ ...current, [role]: value }))}
                models={settings?.catalog ?? []}
                defaultModel={settings?.fallbacks[role] ?? ''}
                disabled={!settings}
              />
              <p>{hint}</p>
            </div>
          ))}
        </div>
      </SectionCard>

      <div className="recruit-stat-grid">
        <StatCard label="分析次数" icon={<History size={16} />} tone="ink" value={totals?.analyses ?? 0} hint="已记录用量的 AI 初筛 / 重新评分" />
        <StatCard label="总 Tokens" icon={<Coins size={16} />} tone="lime" value={formatTokens(totals?.total_tokens)} hint="输入 + 输出" />
        <StatCard label="输入 Tokens" icon={<ArrowUpFromLine size={16} />} value={formatTokens(totals?.input_tokens)} hint="简历、JD、评分卡与页面图像" />
        <StatCard label="单次平均" icon={<Layers size={16} />} tone="amber" value={formatTokens(totals?.analyses ? Math.round(totals.total_tokens / totals.analyses) : 0)} hint="每次分析平均消耗" />
      </div>

      <SectionCard title="按模型汇总" description="统计范围为最近 1000 次分析。" icon={<Cpu size={15} />}>
        <div className="rx-funnel">
          {(usage?.by_model ?? []).map((item, index) => (
            <div key={item.model} className="rx-funnel__row" style={{ ['--i' as string]: index }}>
              <span className="rx-usage-model">{item.model}</span>
              <MeterBar value={item.total_tokens} max={modelMax} tone={index === 0 ? 'ink' : 'accent'} label={item.model} />
              <strong>{formatTokens(item.total_tokens)}<em>{item.calls} 次</em></strong>
            </div>
          ))}
          {!usage?.by_model.length ? <EmptyState icon={<Cpu size={20} />} title="还没有用量数据" hint="完成一次 AI 初筛后这里会出现统计。" /> : null}
        </div>
      </SectionCard>

      <SectionCard title="分析记录" description="每次分析的调用明细；≈ 表示模型未返回用量、按字数估算。" icon={<ArrowDownToLine size={15} />}>
        <div className="rx-usage-table">
          {(usage?.records ?? []).map((record) => (
            <article key={record.activity_id} className="rx-usage-row">
              <time>{formatTime(record.created_at)}</time>
              <div className="rx-usage-row__main">
                {record.candidate_id ? <Link to={`/recruit/candidates/${record.candidate_id}`}>{record.candidate_name || '候选人'}</Link> : <strong>{record.candidate_name}</strong>}
                {typeof record.score === 'number' ? <span className="rx-usage-row__score">{record.score} 分</span> : null}
                <div className="rx-usage-row__calls">
                  {record.usage.calls.map((call, index) => (
                    <span key={index} title={`输入 ${call.input_tokens} · 输出 ${call.output_tokens}`}>
                      {MODEL_ROLE_LABELS[call.role] || call.role} · {call.model} · {call.estimated ? '≈' : ''}{formatTokens(call.total_tokens)}
                    </span>
                  ))}
                </div>
              </div>
              <strong className="rx-usage-row__total">
                {record.usage.estimated ? '≈' : ''}{formatTokens(record.usage.total_tokens)}
                <em>↑{formatTokens(record.usage.input_tokens)} ↓{formatTokens(record.usage.output_tokens)}</em>
              </strong>
            </article>
          ))}
          {!usage?.records.length ? <EmptyState icon={<History size={20} />} title="暂无分析记录" /> : null}
        </div>
      </SectionCard>
    </RecruitPage>
  )
}
