import { useMemo, useRef, useState } from 'react';
import {
  Check,
  Code2,
  Copy,
  Eye,
  FileCode2,
  Palette,
  PencilLine,
  Plus,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import { useChatStore } from '@/features/diagram/model/chatStore';
import { getAgentDisplayName } from '@/shared/lib/config/diagramAgents';
import { useT } from '@/app/i18n';
import {
  EMAIL_TEMPLATE_OPTIONS,
  applyEmailTemplate,
  getEmailTemplateId,
  parseArtifactDsl,
  renderHtmlArtifact,
  type ArtifactPayload,
  type EmailTemplateId,
} from './htmlArtifactRenderer';

type TabKey = 'preview' | 'edit' | 'dsl' | 'html';
type CopyTarget = 'html' | 'dsl' | null;

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

const stringifyArtifact = (payload: ArtifactPayload) => JSON.stringify(payload, null, 2);

const escapeCodeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const formatHtmlTag = (tag: string, indent: string) => {
  if (tag.length <= 120 || /^<\/|^<!|^<!--/.test(tag)) return tag;
  const match = tag.match(/^<([^\s/>]+)([\s\S]*?)(\/?)>$/);
  if (!match) return tag;
  const [, tagName, rawAttrs, selfClosing] = match;
  const attrs = [...rawAttrs.matchAll(/\s+([:@\w-]+)(=("([^"]*)"|'([^']*)'|[^\s>]+))?/g)];
  if (!attrs.length) return tag;
  const attrIndent = `${indent}  `;
  const renderedAttrs = attrs.map((attr) => {
    const name = attr[1];
    const value = attr[2] || '';
    return `${attrIndent}${name}${value}`;
  });
  return [`<${tagName}`, ...renderedAttrs, `${indent}${selfClosing ? '/' : ''}>`].join('\n');
};

const formatHtmlCode = (html: string) => {
  const tokens = html.replace(/>\s+</g, '><').split(/(<[^>]+>)/g).filter(Boolean);
  const lines: string[] = [];
  let depth = 0;
  const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
  tokens.forEach((token) => {
    const trimmed = token.trim();
    if (!trimmed) return;
    const isClosing = /^<\//.test(trimmed);
    const isSpecial = /^<!|^<!--/.test(trimmed);
    const tagMatch = trimmed.match(/^<\/?\s*([a-zA-Z0-9:-]+)/);
    const tagName = tagMatch?.[1]?.toLowerCase() || '';
    const isSelfClosing = /\/>$/.test(trimmed) || voidTags.has(tagName);
    if (isClosing) depth = Math.max(0, depth - 1);
    const indent = '  '.repeat(depth);
    if (trimmed.startsWith('<')) {
      const formattedTag = formatHtmlTag(trimmed, indent)
        .split('\n')
        .map((line, index) => `${index === 0 ? indent : ''}${line}`)
        .join('\n');
      lines.push(formattedTag);
    } else {
      trimmed.split(/\s*\n\s*/).filter(Boolean).forEach((line) => lines.push(`${indent}${line}`));
    }
    if (!isClosing && !isSelfClosing && !isSpecial && trimmed.startsWith('<')) {
      depth += 1;
    }
  });
  return lines.join('\n');
};

const highlightJson = (code: string) => {
  const tokenPattern = /("(?:\\.|[^"\\])*"(?=\s*:))|("(?:\\.|[^"\\])*")|(\btrue\b|\bfalse\b|\bnull\b)|(-?\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b)|([{}[\],:])/gi;
  let cursor = 0;
  let html = '';
  code.replace(tokenPattern, (match, key, stringValue, literal, numberValue, punctuation, offset) => {
    html += escapeCodeHtml(code.slice(cursor, offset));
    const className = key
      ? 'text-sky-600 dark:text-sky-300'
      : stringValue
        ? 'text-emerald-600 dark:text-emerald-300'
        : literal
          ? 'text-violet-600 dark:text-violet-300'
          : numberValue
            ? 'text-amber-600 dark:text-amber-300'
            : punctuation
              ? 'text-slate-500 dark:text-slate-400'
              : '';
    html += `<span class="${className}">${escapeCodeHtml(match)}</span>`;
    cursor = offset + match.length;
    return match;
  });
  html += escapeCodeHtml(code.slice(cursor));
  return html;
};

const highlightHtml = (code: string) => {
  const tokenPattern = /(<!--[\s\S]*?-->|<!doctype[^>]*>|<\/?[^>]+>)/gi;
  let cursor = 0;
  let html = '';
  code.replace(tokenPattern, (match, _token, offset) => {
    html += escapeCodeHtml(code.slice(cursor, offset));
    if (match.startsWith('<!--')) {
      html += `<span class="text-slate-400 dark:text-slate-500">${escapeCodeHtml(match)}</span>`;
    } else if (/^<!doctype/i.test(match)) {
      html += `<span class="text-violet-600 dark:text-violet-300">${escapeCodeHtml(match)}</span>`;
    } else {
      const tagMatch = match.match(/^<\s*(\/?)([a-zA-Z0-9:-]+)([\s\S]*?)(\/?)>$/);
      if (!tagMatch) {
        html += escapeCodeHtml(match);
      } else {
        const [, slash, tagName, rawAttrs, selfClosing] = tagMatch;
        let tagHtml = `<span class="text-slate-500 dark:text-slate-400">&lt;${slash}</span><span class="text-fuchsia-600 dark:text-fuchsia-300">${escapeCodeHtml(tagName)}</span>`;
        const attrPattern = /(\s+)([:@\w-]+)(=("[^"]*"|'[^']*'|[^\s>]+))?/g;
        let attrCursor = 0;
        rawAttrs.replace(attrPattern, (attrMatch, whitespace, name, equalsValue, value, attrOffset) => {
          tagHtml += escapeCodeHtml(rawAttrs.slice(attrCursor, attrOffset));
          tagHtml += escapeCodeHtml(whitespace);
          tagHtml += `<span class="text-amber-600 dark:text-amber-300">${escapeCodeHtml(name)}</span>`;
          if (equalsValue) {
            tagHtml += `<span class="text-slate-500 dark:text-slate-400">=</span><span class="text-emerald-600 dark:text-emerald-300">${escapeCodeHtml(value)}</span>`;
          }
          attrCursor = attrOffset + attrMatch.length;
          return attrMatch;
        });
        tagHtml += escapeCodeHtml(rawAttrs.slice(attrCursor));
        tagHtml += `<span class="text-slate-500 dark:text-slate-400">${selfClosing ? '/' : ''}&gt;</span>`;
        html += tagHtml;
      }
    }
    cursor = offset + match.length;
    return match;
  });
  html += escapeCodeHtml(code.slice(cursor));
  return html;
};

const highlightCode = (code: string, language: 'html' | 'json') =>
  language === 'html' ? highlightHtml(code) : highlightJson(code);

const linesToList = (value: string) =>
  value
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);

const listToLines = (items: unknown) => (Array.isArray(items) ? items.map(String).join('\n') : '');

const rowsToText = (rows: unknown) =>
  Array.isArray(rows)
    ? rows.map((row) => (Array.isArray(row) ? row.join(' | ') : String(row))).join('\n')
    : '';

const textToRows = (value: string) =>
  value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split('|').map((cell) => cell.trim()));

const metricItemsToText = (items: unknown) =>
  Array.isArray(items)
    ? items
        .map((item) => {
          const record = asRecord(item);
          if (!Object.keys(record).length) return String(item);
          return [record.label || record.title || record.name, record.value || record.amount || record.number, record.delta || record.change || record.trend, record.note || record.body || record.description]
            .map((value) => String(value ?? '').trim())
            .join(' | ')
            .replace(/(\s\|\s)*$/g, '');
        })
        .join('\n')
    : '';

const textToMetricItems = (value: string) =>
  value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [label, metricValue, delta, note] = line.split('|').map((part) => part.trim());
      return { label, value: metricValue || '', delta: delta || '', note: note || '' };
    });

const chartItemsToText = (items: unknown) =>
  Array.isArray(items)
    ? items
        .map((item) => {
          const record = asRecord(item);
          if (!Object.keys(record).length) return String(item);
          return [record.label || record.title || record.name, record.value || record.percent || record.score, record.display || record.note]
            .map((value) => String(value ?? '').trim())
            .join(' | ')
            .replace(/(\s\|\s)*$/g, '');
        })
        .join('\n')
    : '';

const textToChartItems = (value: string) =>
  value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [label, rawValue, display] = line.split('|').map((part) => part.trim());
      const numericValue = Number(rawValue?.replace('%', ''));
      return { label, value: Number.isFinite(numericValue) ? numericValue : rawValue || 0, display: display || rawValue || '' };
    });

const timelineItemsToText = (items: unknown) =>
  Array.isArray(items)
    ? items
        .map((item) => {
          const record = asRecord(item);
          if (!Object.keys(record).length) return String(item);
          return [record.phase || record.date || record.time || record.label, record.title || record.heading || record.name, record.body || record.description || record.detail || record.note]
            .map((value) => String(value ?? '').trim())
            .join(' | ')
            .replace(/(\s\|\s)*$/g, '');
        })
        .join('\n')
    : '';

const textToTimelineItems = (value: string) =>
  value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [phase, title, body] = line.split('|').map((part) => part.trim());
      return { phase, title: title || phase, body: body || '' };
    });

const comparisonItemsToText = (items: unknown) =>
  Array.isArray(items)
    ? items
        .map((item) => {
          const record = asRecord(item);
          if (!Object.keys(record).length) return String(item);
          return [record.label || record.title || record.name, record.body || record.description || record.detail || record.value]
            .map((value) => String(value ?? '').trim())
            .join(' | ')
            .replace(/(\s\|\s)*$/g, '');
        })
        .join('\n')
    : '';

const textToComparisonItems = (value: string) =>
  value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [label, body] = line.split('|').map((part) => part.trim());
      return { label, body: body || '' };
    });

function Field({
  label,
  value,
  onChange,
  isLight,
  disabled,
  multiline = false,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  isLight: boolean;
  disabled?: boolean;
  multiline?: boolean;
  placeholder?: string;
}) {
  const className = `w-full rounded-md border px-3 py-2 text-xs outline-none transition-colors ${
    isLight
      ? 'border-slate-200 bg-white text-slate-900 placeholder:text-slate-400 focus:border-teal-400'
      : 'border-slate-800 bg-slate-950 text-slate-100 placeholder:text-slate-600 focus:border-teal-500'
  } disabled:cursor-not-allowed disabled:opacity-60`;
  return (
    <label className="block min-w-0">
      <span className={`mb-1 block text-[11px] font-semibold ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>{label}</span>
      {multiline ? (
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          placeholder={placeholder}
          rows={3}
          className={`${className} resize-y leading-relaxed`}
        />
      ) : (
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          placeholder={placeholder}
          className={className}
        />
      )}
    </label>
  );
}

function SourceCodeEditor({
  value,
  onChange,
  language,
  isLight,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  language: 'html' | 'json';
  isLight: boolean;
  disabled?: boolean;
}) {
  const highlightRef = useRef<HTMLPreElement>(null);
  const highlighted = useMemo(() => highlightCode(value, language), [language, value]);
  const syncScroll = (target: HTMLTextAreaElement) => {
    if (!highlightRef.current) return;
    highlightRef.current.scrollTop = target.scrollTop;
    highlightRef.current.scrollLeft = target.scrollLeft;
  };

  return (
    <div className={`relative h-full overflow-hidden rounded-lg border font-mono text-[12px] leading-5 ${
      isLight ? 'border-slate-200 bg-white' : 'border-slate-800 bg-slate-950'
    }`}>
      <pre
        ref={highlightRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre p-4"
        dangerouslySetInnerHTML={{ __html: highlighted || ' ' }}
      />
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onScroll={(event) => syncScroll(event.currentTarget)}
        disabled={disabled}
        spellCheck={false}
        wrap="off"
        className="absolute inset-0 h-full w-full resize-none overflow-auto whitespace-pre bg-transparent p-4 font-mono text-[12px] leading-5 text-transparent outline-none caret-slate-900 selection:bg-sky-200/50 dark:caret-slate-100 dark:selection:bg-sky-500/30"
      />
    </div>
  );
}

function EmailContentEditor({
  payload,
  onChange,
  isLight,
  disabled,
}: {
  payload: ArtifactPayload;
  onChange: (payload: ArtifactPayload) => void;
  isLight: boolean;
  disabled?: boolean;
}) {
  const email = asRecord(payload.email);
  const style = asRecord(payload.style);
  const sections = Array.isArray(payload.sections) ? payload.sections : [];

  const updateRoot = (key: string, value: unknown) => onChange({ ...payload, [key]: value });
  const updateEmail = (key: string, value: string) => onChange({ ...payload, email: { ...email, [key]: value } });
  const updateStyle = (key: string, value: string) => onChange({ ...payload, style: { ...style, [key]: value } });
  const updateSection = (index: number, patch: Record<string, unknown>) => {
    const nextSections = [...sections];
    nextSections[index] = { ...asRecord(nextSections[index]), ...patch };
    onChange({ ...payload, sections: nextSections });
  };
  const changeSectionType = (index: number, nextType: string) => {
    const nextSections = [...sections];
    const nextSection: Record<string, unknown> = { ...asRecord(nextSections[index]), type: nextType };
    if (['list', 'metric_grid', 'bar_chart', 'timeline', 'comparison'].includes(nextType)) {
      delete nextSection.columns;
      delete nextSection.rows;
    }
    if (nextType === 'table') {
      delete nextSection.items;
      delete nextSection.metrics;
      delete nextSection.data;
      delete nextSection.milestones;
      delete nextSection.steps;
    }
    nextSections[index] = nextSection;
    onChange({ ...payload, sections: nextSections });
  };
  const removeSection = (index: number) => onChange({ ...payload, sections: sections.filter((_, itemIndex) => itemIndex !== index) });
  const addSection = () => {
    onChange({
      ...payload,
      sections: [
        ...sections,
        {
          type: 'text',
          heading: '新段落',
          body: '在这里补充邮件正文。',
        },
      ],
    });
  };

  return (
    <div className={`h-full overflow-auto rounded-lg border ${
      isLight ? 'border-slate-200 bg-white' : 'border-slate-800 bg-slate-900'
    }`}>
      <div className="grid gap-4 p-4 lg:grid-cols-2">
        <Field
          label="邮件主题"
          value={String(email.subject || payload.title || '')}
          onChange={(value) => updateEmail('subject', value)}
          isLight={isLight}
          disabled={disabled}
        />
        <Field
          label="预览摘要"
          value={String(email.preheader || '')}
          onChange={(value) => updateEmail('preheader', value)}
          isLight={isLight}
          disabled={disabled}
          placeholder="收件箱里展示的短摘要"
        />
        <Field
          label="品牌名称"
          value={String(style.brand_name || asRecord(payload.brand).name || payload.brand || 'SmartDiagram')}
          onChange={(value) => updateStyle('brand_name', value)}
          isLight={isLight}
          disabled={disabled}
        />
        <Field
          label="品牌颜色"
          value={String(style.brand_color || '')}
          onChange={(value) => updateStyle('brand_color', value)}
          isLight={isLight}
          disabled={disabled}
          placeholder="#2563eb"
        />
        <div className="lg:col-span-2">
          <Field
            label="页脚"
            value={String(payload.footer || '')}
            onChange={(value) => updateRoot('footer', value)}
            isLight={isLight}
            disabled={disabled}
            multiline
            placeholder="可填写公司声明、联系方式或退订说明"
          />
        </div>
      </div>

      <div className={`border-t px-4 py-3 ${isLight ? 'border-slate-200' : 'border-slate-800'}`}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className={`text-xs font-semibold ${isLight ? 'text-slate-700' : 'text-slate-200'}`}>内容区块</div>
          <button
            type="button"
            onClick={addSection}
            disabled={disabled}
            className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${
              isLight
                ? 'border-slate-200 bg-white text-slate-700 hover:border-teal-300 hover:text-teal-700'
                : 'border-slate-800 bg-slate-950 text-slate-300 hover:border-teal-600 hover:text-teal-300'
            } disabled:cursor-not-allowed disabled:opacity-60`}
          >
            <Plus className="h-3 w-3" />
            添加段落
          </button>
        </div>

        <div className="space-y-3">
          {sections.map((rawSection, index) => {
            const section = asRecord(rawSection);
            const type = String(section.type || 'text');
            return (
              <div
                key={index}
                className={`rounded-lg border p-3 ${
                  isLight ? 'border-slate-200 bg-slate-50' : 'border-slate-800 bg-slate-950/60'
                }`}
              >
                <div className="mb-3 flex items-center gap-2">
                  <select
                    value={type}
                    onChange={(event) => changeSectionType(index, event.target.value)}
                    disabled={disabled}
                    className={`rounded-md border px-2 py-1.5 text-xs outline-none ${
                      isLight ? 'border-slate-200 bg-white text-slate-800' : 'border-slate-800 bg-slate-900 text-slate-100'
                    } disabled:cursor-not-allowed disabled:opacity-60`}
                  >
                    <option value="hero">头图标题</option>
                    <option value="text">正文</option>
                    <option value="list">洞察卡片</option>
                    <option value="metric_grid">指标卡片</option>
                    <option value="bar_chart">条形图</option>
                    <option value="timeline">时间线</option>
                    <option value="comparison">对比图</option>
                    <option value="table">表格</option>
                    <option value="quote">引用</option>
                    <option value="cta">按钮</option>
                  </select>
                  <span className={`text-[11px] ${isLight ? 'text-slate-400' : 'text-slate-500'}`}>#{index + 1}</span>
                  <button
                    type="button"
                    onClick={() => removeSection(index)}
                    disabled={disabled || sections.length <= 1}
                    className={`ml-auto inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
                      isLight ? 'text-slate-400 hover:bg-rose-50 hover:text-rose-600' : 'text-slate-500 hover:bg-rose-950/40 hover:text-rose-300'
                    } disabled:cursor-not-allowed disabled:opacity-40`}
                    title="删除区块"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>

                {type === 'cta' ? (
                  <div className="grid gap-3 md:grid-cols-2">
                    <Field
                      label="按钮文字"
                      value={String(section.label || section.text || '')}
                      onChange={(value) => updateSection(index, { label: value })}
                      isLight={isLight}
                      disabled={disabled}
                    />
                    <Field
                      label="链接"
                      value={String(section.href || '')}
                      onChange={(value) => updateSection(index, { href: value })}
                      isLight={isLight}
                      disabled={disabled}
                      placeholder="https://..."
                    />
                  </div>
                ) : (
                  <div className="grid gap-3">
                    <Field
                      label={type === 'hero' ? '主标题' : '标题'}
                      value={String(section.heading || section.title || '')}
                      onChange={(value) => updateSection(index, { heading: value })}
                      isLight={isLight}
                      disabled={disabled}
                    />
                    {type === 'list' ? (
                      <Field
                        label="洞察卡片（每行一张）"
                        value={listToLines(section.items)}
                        onChange={(value) => updateSection(index, { items: linesToList(value) })}
                        isLight={isLight}
                        disabled={disabled}
                        multiline
                      />
                    ) : type === 'metric_grid' ? (
                      <Field
                        label="指标项（标签 | 数值 | 变化 | 说明）"
                        value={metricItemsToText(section.metrics || section.items || section.data)}
                        onChange={(value) => updateSection(index, { metrics: textToMetricItems(value) })}
                        isLight={isLight}
                        disabled={disabled}
                        multiline
                        placeholder="转化率 | 36% | +8% | 较上周提升"
                      />
                    ) : type === 'bar_chart' ? (
                      <Field
                        label="条形图数据（标签 | 数值0-100 | 显示文案）"
                        value={chartItemsToText(section.data || section.items || section.metrics)}
                        onChange={(value) => updateSection(index, { data: textToChartItems(value) })}
                        isLight={isLight}
                        disabled={disabled}
                        multiline
                        placeholder="客户续费意向 | 72 | 72%"
                      />
                    ) : type === 'timeline' ? (
                      <Field
                        label="时间线（阶段/日期 | 标题 | 说明）"
                        value={timelineItemsToText(section.items || section.milestones || section.steps)}
                        onChange={(value) => updateSection(index, { items: textToTimelineItems(value) })}
                        isLight={isLight}
                        disabled={disabled}
                        multiline
                        placeholder="今日 | 发送邮件 | 附上续费权益"
                      />
                    ) : type === 'comparison' ? (
                      <Field
                        label="对比项（标签 | 内容）"
                        value={comparisonItemsToText(section.items || section.data)}
                        onChange={(value) => updateSection(index, { items: textToComparisonItems(value) })}
                        isLight={isLight}
                        disabled={disabled}
                        multiline
                        placeholder="传统做法 | 直接罗列步骤，信息密度低"
                      />
                    ) : type === 'table' ? (
                      <div className="grid gap-3 md:grid-cols-2">
                        <Field
                          label="列名（每行一列）"
                          value={listToLines(section.columns)}
                          onChange={(value) => updateSection(index, { columns: linesToList(value) })}
                          isLight={isLight}
                          disabled={disabled}
                          multiline
                        />
                        <Field
                          label="行数据（用 | 分列）"
                          value={rowsToText(section.rows)}
                          onChange={(value) => updateSection(index, { rows: textToRows(value) })}
                          isLight={isLight}
                          disabled={disabled}
                          multiline
                          placeholder="维度 | 内容 | 负责人"
                        />
                      </div>
                    ) : (
                      <Field
                        label="正文"
                        value={String(section.body || section.text || '')}
                        onChange={(value) => updateSection(index, { body: value })}
                        isLight={isLight}
                        disabled={disabled}
                        multiline
                      />
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function ArtifactCanvas() {
  const { canvasCode, canvasEngine, canvasMode, streamingCode, setCanvasCode } = useChatStore();
  const { t } = useT();
  const [tab, setTab] = useState<TabKey>('preview');
  const [copied, setCopied] = useState<CopyTarget>(null);
  const sourceCode = canvasCode || streamingCode || '';
  const payload = useMemo(() => parseArtifactDsl(sourceCode), [sourceCode]);
  const rendered = useMemo(() => renderHtmlArtifact(sourceCode), [sourceCode]);
  const formattedHtml = useMemo(() => formatHtmlCode(rendered.html), [rendered.html]);
  const [htmlDraftState, setHtmlDraftState] = useState({ source: '', draft: '' });
  const isLight = canvasMode === 'light';
  const isEmail = String(payload?.artifact_type || canvasEngine) === 'html_email';
  const activeTemplate = getEmailTemplateId(payload);
  const canEdit = Boolean(canvasCode && payload && !rendered.error);

  const htmlDraft = htmlDraftState.source === formattedHtml
    ? htmlDraftState.draft
    : formattedHtml;
  const activeTab = tab === 'edit' && !isEmail ? 'preview' : tab;

  const tabs: { id: TabKey; label: string; Icon: LucideIcon; hidden?: boolean }[] = [
    { id: 'preview', label: t('artifact.preview'), Icon: Eye },
    { id: 'edit', label: '编辑', Icon: PencilLine, hidden: !isEmail },
    { id: 'dsl', label: 'DSL', Icon: Code2 },
    { id: 'html', label: 'HTML', Icon: FileCode2 },
  ];

  const updatePayload = (nextPayload: ArtifactPayload) => {
    if (!canEdit) return;
    setCanvasCode(stringifyArtifact(nextPayload));
  };

  const switchTemplate = (templateId: EmailTemplateId) => {
    if (!payload || !canEdit) return;
    updatePayload(applyEmailTemplate(payload, templateId));
  };

  const copyText = async (target: Exclude<CopyTarget, null>, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(target);
    window.setTimeout(() => setCopied(null), 1400);
  };

  const previewHtml = htmlDraft || rendered.html;

  if (!sourceCode) {
    return (
      <div className={`flex h-full items-center justify-center ${isLight ? 'bg-slate-50 text-slate-500' : 'bg-slate-950 text-slate-500'}`}>
        <div className="text-sm">{t('canvas.noRenderableContent')}</div>
      </div>
    );
  }

  return (
    <div className={`flex h-full flex-col ${isLight ? 'bg-slate-100 text-slate-900' : 'bg-slate-950 text-slate-100'}`}>
      <div className={`border-b px-4 py-2 ${
        isLight ? 'border-slate-200 bg-white/85' : 'border-slate-800 bg-slate-900/85'
      }`}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${canvasEngine === 'html_email' ? 'bg-teal-400' : 'bg-sky-400'}`} />
            <span className="truncate text-xs font-semibold">{getAgentDisplayName(canvasEngine)}</span>
            {rendered.error && <span className="text-[11px] text-rose-500">{rendered.error}</span>}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {isEmail && (
              <button
                type="button"
                onClick={() => copyText('html', previewHtml)}
                className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${
                  isLight
                    ? 'border-slate-200 bg-white text-slate-700 hover:border-teal-300 hover:text-teal-700'
                    : 'border-slate-800 bg-slate-950 text-slate-300 hover:border-teal-600 hover:text-teal-300'
                }`}
              >
                {copied === 'html' ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                复制 HTML
              </button>
            )}
            <div className={`flex rounded-lg border p-0.5 ${
              isLight ? 'border-slate-200 bg-slate-100' : 'border-slate-800 bg-slate-950'
            }`}>
              {tabs.filter((item) => !item.hidden).map(({ id, label, Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTab(id)}
                  className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                    activeTab === id
                      ? isLight ? 'bg-white text-slate-900 shadow-sm' : 'bg-slate-800 text-slate-100'
                      : isLight ? 'text-slate-500 hover:text-slate-800' : 'text-slate-500 hover:text-slate-200'
                  }`}
                >
                  <Icon className="h-3 w-3" />
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {isEmail && payload && (
          <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
            {EMAIL_TEMPLATE_OPTIONS.map((template) => {
              const selected = activeTemplate === template.id;
              return (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => switchTemplate(template.id)}
                  disabled={!canEdit}
                  className={`flex min-w-[150px] items-start gap-2 rounded-lg border px-3 py-2 text-left transition-colors ${
                    selected
                      ? isLight
                        ? 'border-teal-300 bg-teal-50 text-teal-900'
                        : 'border-teal-600 bg-teal-950/50 text-teal-100'
                      : isLight
                        ? 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                        : 'border-slate-800 bg-slate-950 text-slate-300 hover:border-slate-700'
                  } disabled:cursor-not-allowed disabled:opacity-70`}
                >
                  <Palette className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span className="min-w-0">
                    <span className="block text-[11px] font-semibold">{template.label}</span>
                    <span className={`block truncate text-[10px] ${selected ? '' : isLight ? 'text-slate-500' : 'text-slate-500'}`}>
                      {template.description}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 p-4">
        {activeTab === 'preview' ? (
          <div className={`h-full overflow-hidden rounded-lg border shadow-sm ${
            isLight ? 'border-slate-200 bg-white' : 'border-slate-800 bg-slate-900'
          }`}>
            <iframe
              title="Artifact preview"
              sandbox=""
              srcDoc={previewHtml}
              className="h-full w-full border-0 bg-white"
            />
          </div>
        ) : activeTab === 'edit' && isEmail && payload ? (
          <EmailContentEditor payload={payload} onChange={updatePayload} isLight={isLight} disabled={!canEdit} />
        ) : (
          <div className="relative h-full">
            {activeTab === 'dsl' && (
              <button
                type="button"
                onClick={() => copyText('dsl', sourceCode)}
                className={`absolute right-3 top-3 z-10 inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-semibold ${
                  isLight
                    ? 'border-slate-200 bg-white text-slate-600 hover:text-slate-900'
                    : 'border-slate-800 bg-slate-950 text-slate-400 hover:text-slate-100'
                }`}
              >
                {copied === 'dsl' ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                复制
              </button>
            )}
            <SourceCodeEditor
              value={activeTab === 'dsl' ? sourceCode : htmlDraft}
              onChange={activeTab === 'dsl'
                ? (value) => canEdit && setCanvasCode(value)
                : (draft) => setHtmlDraftState({ source: formattedHtml, draft })}
              language={activeTab === 'dsl' ? 'json' : 'html'}
              isLight={isLight}
              disabled={activeTab === 'dsl' && !canEdit}
            />
          </div>
        )}
      </div>
    </div>
  );
}
