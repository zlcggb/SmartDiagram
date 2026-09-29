import { renderRecruitReportPdf } from '@/features/recruit/lib/api'
import type { RecruitScreeningSummary } from '@/features/recruit/lib/types'

const KNOCKOUT_LABELS: Record<string, string> = { pass: '通过', fail: '未通过', unknown: '待确认' }

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function list(items: string[] | undefined): string {
  const rows = (items ?? []).filter(Boolean)
  return rows.length ? `<ul>${rows.map((item) => `<li>${esc(item)}</li>`).join('')}</ul>` : '<p class="muted">无</p>'
}

function section(title: string, body: string): string {
  return `<section><h2>${esc(title)}</h2>${body}</section>`
}

export function buildScreeningReportHtml(screening: RecruitScreeningSummary, meta: { candidateName: string; jobTitle: string }): string {
  const report = screening.score_report
  const candidate = report?.candidate
  const parts: string[] = []

  parts.push(`<header>
    <h1>${esc(meta.candidateName || report?.candidate_name || '候选人')} · AI 初筛报告</h1>
    <p class="muted">岗位：${esc(meta.jobTitle || report?.rubric?.role_title || '-')} · 生成时间：${esc(screening.created_at)}</p>
    <div class="score"><strong>${esc(screening.total_score)}</strong> / ${esc(screening.max_score)}
      ${report?.tier ? `<span class="tier">${esc(report.tier.grade)} · ${esc(report.tier.label)}</span>` : ''}
      <span>${esc(report?.tier?.recommendation || screening.recommendation)}</span>
    </div>
    <p>${esc(report?.summary || screening.overall_summary)}</p>
  </header>`)

  if (candidate) {
    const school = [candidate.school, candidate.school_level, ...(candidate.school_tags ?? [])].filter(Boolean).join(' · ')
    parts.push(section('候选人概况', `<table>
      <tr><th>学校</th><td>${esc(school || '-')}</td><th>学历</th><td>${esc(candidate.degree || '-')}</td></tr>
      <tr><th>专业</th><td>${esc(candidate.major || '-')}</td><th>毕业</th><td>${esc(candidate.graduation || '-')}</td></tr>
    </table>`))
  }

  if (report?.knockouts?.length) {
    parts.push(section('硬性条件', `<table><tr><th>条件</th><th>结果</th><th>依据 / 说明</th></tr>${report.knockouts.map((item) => `
      <tr><td>${esc(item.label)}</td><td class="ko-${esc(item.status)}">${esc(KNOCKOUT_LABELS[item.status] || item.status)}</td>
      <td>${esc([item.evidence, item.note].filter(Boolean).join(' · '))}</td></tr>`).join('')}</table>`))
  }

  if (report?.education_facts?.length) {
    parts.push(section('院校库识别', `<table><tr><th>学校</th><th>层次</th><th>学历</th><th>毕业年份</th></tr>${report.education_facts.map((fact) => `
      <tr><td>${esc(fact.school)}</td><td>${esc([fact.school_level, ...fact.school_tags].filter(Boolean).join(' · '))}</td>
      <td>${esc(fact.degree ? `${fact.degree}（${fact.degree_source}）` : '-')}</td>
      <td>${esc(fact.graduation_year ? `${fact.graduation_year}（${fact.graduation_source}）` : '-')}</td></tr>`).join('')}</table>`))
  }

  if (report?.categories?.length) {
    parts.push(section('分项得分', `<table><tr><th>维度</th><th>得分</th><th>规则</th></tr>${report.categories.map((item) => `
      <tr><td>${esc(item.label)}</td><td>${esc(item.score)} / ${esc(item.max_score)}</td><td>${esc(item.rule)}</td></tr>`).join('')}</table>`))
  } else if (screening.dimension_scores.length) {
    parts.push(section('分项得分', `<table><tr><th>维度</th><th>得分</th><th>理由</th></tr>${screening.dimension_scores.map((item) => `
      <tr><td>${esc(item.label)}</td><td>${esc(item.score)} / ${esc(item.max_score)}</td><td>${esc(item.reason)}</td></tr>`).join('')}</table>`))
  }

  if (report?.requirements?.length) {
    parts.push(section('能力要求逐项评估', report.requirements.map((item) => `
      <div class="req"><h3>${esc(item.label)} <span class="muted">${esc(item.level_label)} · ${esc(item.points)} / ${esc(item.max_points)}</span></h3>
      <p>${esc(item.rationale)}</p>
      ${item.evidence.length ? `<ul>${item.evidence.map((quote) => `<li>“${esc(quote.text)}”${quote.verified ? '' : ' <span class="muted">(未在原文核验)</span>'}</li>`).join('')}</ul>` : ''}
      ${item.gap ? `<p class="muted">差距：${esc(item.gap)}</p>` : ''}</div>`).join('')))
  }

  parts.push(section('亮点', list(report?.highlights ?? screening.strengths)))
  parts.push(section('关注点', list(report?.concerns ?? screening.risks)))
  if (report?.red_flags?.length) parts.push(section('风险信号', list(report.red_flags.map((flag) => `${flag.type}：${flag.detail}`))))

  if (report?.interview_plan?.length) {
    parts.push(section('面试追问计划', `<ol>${report.interview_plan.map((item) => `
      <li><strong>${esc(item.question)}</strong><p class="muted">目的：${esc(item.purpose)}</p>
      ${item.good_signals.length ? `<p>正向信号：${esc(item.good_signals.join('；'))}</p>` : ''}
      ${item.red_signals.length ? `<p>风险信号：${esc(item.red_signals.join('；'))}</p>` : ''}</li>`).join('')}</ol>`))
  } else if (screening.interview_questions.length) {
    parts.push(section('面试问题', list(screening.interview_questions)))
  }

  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${esc(meta.candidateName)}-AI初筛报告</title>
<style>
  @page { size: A4; margin: 16mm 14mm; }
  body { font-family: -apple-system, "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", "WenQuanYi Micro Hei", sans-serif; color: #16171b; font-size: 12px; line-height: 1.6; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  h2 { font-size: 14px; margin: 18px 0 8px; padding-bottom: 4px; border-bottom: 1px solid #ddd; }
  h3 { font-size: 12.5px; margin: 10px 0 4px; }
  .muted { color: #777; }
  .score { margin: 10px 0; display: flex; gap: 12px; align-items: baseline; }
  .score strong { font-size: 28px; }
  .tier { padding: 2px 8px; border-radius: 6px; background: #edf0ff; color: #2440d6; font-weight: 600; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #e3e3e3; padding: 5px 7px; text-align: left; vertical-align: top; }
  th { background: #f7f6f2; font-weight: 600; white-space: nowrap; }
  .ko-pass { color: #13875a; } .ko-fail { color: #c7372c; } .ko-unknown { color: #a4600a; }
  .req, section, tr, li { break-inside: avoid; }
  ul, ol { margin: 4px 0; padding-left: 18px; }
  p { margin: 3px 0; }
</style></head><body>${parts.join('')}</body></html>`
}

export async function downloadScreeningReport(screening: RecruitScreeningSummary, meta: { candidateName: string; jobTitle: string }) {
  const name = (meta.candidateName || '候选人').replace(/[\\/:*?"<>|]/g, '_')
  const filename = `${name}-AI初筛报告.pdf`
  const blob = await renderRecruitReportPdf(buildScreeningReportHtml(screening, meta), filename)
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
