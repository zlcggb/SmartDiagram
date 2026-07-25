export type ArtifactPayload = Record<string, unknown>;

export type HtmlArtifactRenderResult = {
  html: string;
  metadata: Record<string, unknown>;
  error?: string;
};

export type EmailTemplateId = 'executive_brief' | 'newsletter_update' | 'product_launch' | 'blueprint_review';

type EmailTheme = {
  brandColor: string;
  accentColor: string;
  background: string;
  surface: string;
  softBg: string;
  textColor: string;
  mutedColor: string;
  borderColor: string;
  maxWidth: number;
  warningColor?: string;
  dangerColor?: string;
  subtleBorderColor?: string;
  tableHeadBg?: string;
  layout?: 'blueprint_review';
};

export const EMAIL_TEMPLATE_OPTIONS: Array<{
  id: EmailTemplateId;
  label: string;
  description: string;
}> = [
  {
    id: 'executive_brief',
    label: '商务简报',
    description: '客户跟进、内部通知、高管摘要',
  },
  {
    id: 'newsletter_update',
    label: '资讯简报',
    description: '产品更新、活动邀请、多段内容',
  },
  {
    id: 'product_launch',
    label: '产品推广',
    description: '发布、促销、强行动召唤',
  },
  {
    id: 'blueprint_review',
    label: '蓝图评审',
    description: '会议纪要、方案评审、行动计划',
  },
];

const EMAIL_THEMES: Record<EmailTemplateId, EmailTheme> = {
  executive_brief: {
    brandColor: '#2563eb',
    accentColor: '#14b8a6',
    background: '#eef3f8',
    surface: '#ffffff',
    softBg: '#f8fafc',
    textColor: '#0f172a',
    mutedColor: '#526173',
    borderColor: '#d8e2ef',
    maxWidth: 660,
  },
  newsletter_update: {
    brandColor: '#0f766e',
    accentColor: '#f59e0b',
    background: '#ecfdf5',
    surface: '#ffffff',
    softBg: '#f0fdfa',
    textColor: '#10201d',
    mutedColor: '#49645f',
    borderColor: '#b7e4d8',
    maxWidth: 680,
  },
  product_launch: {
    brandColor: '#ea580c',
    accentColor: '#0f172a',
    background: '#fff7ed',
    surface: '#ffffff',
    softBg: '#fffbeb',
    textColor: '#111827',
    mutedColor: '#5f6368',
    borderColor: '#fed7aa',
    maxWidth: 660,
  },
  blueprint_review: {
    brandColor: '#0071e3',
    accentColor: '#34c759',
    warningColor: '#ff9500',
    dangerColor: '#ff3b30',
    background: '#f5f5f7',
    surface: '#ffffff',
    softBg: '#f5f5f7',
    tableHeadBg: '#fafafa',
    textColor: '#1d1d1f',
    mutedColor: '#86868b',
    borderColor: '#e5e5e5',
    subtleBorderColor: '#f0f0f0',
    maxWidth: 680,
    layout: 'blueprint_review',
  },
};

const EMAIL_TEMPLATE_ALIASES: Record<string, EmailTemplateId> = {
  default: 'executive_brief',
  classic: 'executive_brief',
  business: 'executive_brief',
  letter: 'executive_brief',
  executive: 'executive_brief',
  newsletter: 'newsletter_update',
  digest: 'newsletter_update',
  update: 'newsletter_update',
  marketing: 'product_launch',
  promo: 'product_launch',
  promotion: 'product_launch',
  launch: 'product_launch',
  blueprint: 'blueprint_review',
  blueprint_review: 'blueprint_review',
  review: 'blueprint_review',
  meeting: 'blueprint_review',
  minutes: 'blueprint_review',
  wemail: 'blueprint_review',
  apple: 'blueprint_review',
};

const escapeHtml = (value: unknown, maxChars = 4000) =>
  String(value ?? '')
    .trim()
    .slice(0, maxChars)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const safeColor = (value: unknown, fallback = '#2563eb') => {
  const text = String(value ?? '').trim();
  return /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(text) ? text : fallback;
};

const safeWidth = (value: unknown, fallback: number) => {
  const width = Number(value);
  return Number.isFinite(width) ? Math.max(320, Math.min(960, Math.round(width))) : fallback;
};

const safeHref = (value: unknown) => {
  const href = String(value ?? '').trim();
  const lowered = href.toLowerCase();
  if (!href) return '';
  if (
    lowered.startsWith('https://') ||
    lowered.startsWith('mailto:') ||
    (href.startsWith('/') && !href.startsWith('//')) ||
    href.startsWith('#')
  ) {
    return escapeHtml(href, 1000);
  }
  return '';
};

const stripOrderedMarker = (value: unknown) =>
  String(value ?? '').trim().replace(/^\s*\d+\s*[\.\．、\)）]\s*/, '');

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

const asItemRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : { label: stripOrderedMarker(value) };

const itemText = (item: Record<string, unknown>, keys: string[], maxChars = 240) => {
  for (const key of keys) {
    const value = item[key];
    if (value !== undefined && String(value).trim()) {
      return escapeHtml(stripOrderedMarker(value), maxChars);
    }
  }
  return '';
};

const itemsFrom = (section: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    const value = section[key];
    if (Array.isArray(value) && value.length > 0) return value;
  }
  return [];
};

const safePercent = (value: unknown, fallback = 0) => {
  const text = String(value ?? '').trim().replace('%', '');
  const raw = Number.parseFloat(text);
  const number = Number.isFinite(raw) ? raw : fallback;
  const normalized = number > 0 && number <= 1 ? number * 100 : number;
  return Math.max(0, Math.min(100, Math.round(normalized)));
};

const isBlueprintTheme = (theme: EmailTheme) => theme.layout === 'blueprint_review';

const normalizeEmailTemplateId = (value: unknown): EmailTemplateId => {
  const key = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (key === 'executive_brief' || key === 'newsletter_update' || key === 'product_launch' || key === 'blueprint_review') {
    return key;
  }
  return EMAIL_TEMPLATE_ALIASES[key] || 'executive_brief';
};

export function getEmailTemplateId(payload: ArtifactPayload | null): EmailTemplateId {
  if (!payload) return 'executive_brief';
  const style = asRecord(payload.style);
  return normalizeEmailTemplateId(payload.template || payload.template_id || style.template || style.template_id);
}

export function applyEmailTemplate(payload: ArtifactPayload, templateId: EmailTemplateId): ArtifactPayload {
  return {
    ...payload,
    template: templateId,
    style: {
      ...asRecord(payload.style),
      template: templateId,
    },
  };
}

const emailTheme = (payload: ArtifactPayload): { templateId: EmailTemplateId; theme: EmailTheme } => {
  const templateId = getEmailTemplateId(payload);
  const style = asRecord(payload.style);
  const base = EMAIL_THEMES[templateId];
  return {
    templateId,
    theme: {
      ...base,
      brandColor: safeColor(style.brand_color, base.brandColor),
      maxWidth: safeWidth(style.max_width, base.maxWidth),
    },
  };
};

const brandName = (payload: ArtifactPayload) => {
  const style = asRecord(payload.style);
  const brand = asRecord(payload.brand);
  return escapeHtml(style.brand_name || brand.name || payload.brand || 'SmartDiagram', 80);
};

const payloadSections = (payload: ArtifactPayload) => {
  const sections = Array.isArray(payload.sections) && payload.sections.length > 0
    ? payload.sections
    : [{ type: 'text', body: payload.body || payload.title || 'Draft' }];
  return sections.slice(0, 18);
};

const splitEmailSections = (payload: ArtifactPayload, subject: string, preheader: string) => {
  const sections = payloadSections(payload);
  const first = asRecord(sections[0]);
  if (String(first.type || '').toLowerCase() === 'hero') {
    return { hero: first, contentSections: sections.slice(1) };
  }
  return {
    hero: {
      type: 'hero',
      heading: payload.title || subject,
      body: payload.body || preheader || payload.audience || '',
    },
    contentSections: sections,
  };
};

const renderList = (items: unknown) => {
  if (!Array.isArray(items)) return '';
  return items
    .slice(0, 12)
    .map((item) => `<li style="margin:0 0 7px;color:#334155;line-height:1.55;">${escapeHtml(item, 240)}</li>`)
    .join('');
};

const renderEmailList = (items: unknown, theme: EmailTheme) => {
  if (!Array.isArray(items)) return '';
  if (isBlueprintTheme(theme)) {
    const cells = items
      .slice(0, 12)
      .map((rawItem) => {
        const item = asItemRecord(rawItem);
        const label = itemText(item, ['label', 'title', 'name', 'heading'], 120);
        const body = itemText(item, ['body', 'description', 'detail', 'text', 'note'], 300);
        if (!label && !body) return '';
        const content = body
          ? `<p style="margin:0 0 8px;font-size:11px;font-weight:600;color:${theme.mutedColor};text-transform:uppercase;letter-spacing:.5px;">${label}</p><p style="margin:0;font-size:14px;color:${theme.textColor};line-height:1.6;">${body}</p>`
          : `<p style="margin:0;font-size:14px;color:${theme.textColor};line-height:1.65;">${label}</p>`;
        return `<td width="48%" valign="top" style="background:${theme.softBg};border-radius:12px;padding:20px;">${content}</td>`;
      })
      .filter(Boolean);
    if (!cells.length) return '';
    const rows: string[] = [];
    for (let index = 0; index < cells.length; index += 2) {
      const rowCells = cells.slice(index, index + 2);
      if (rowCells.length === 1) rowCells.push('<td width="48%" valign="top" style="font-size:0;line-height:0;">&nbsp;</td>');
      rows.push(`<tr>${rowCells[0]}<td width="4%" style="font-size:0;line-height:0;">&nbsp;</td>${rowCells[1]}</tr>`);
    }
    return `<table role="presentation" cellspacing="0" cellpadding="0" width="100%" style="border-collapse:separate;border-spacing:0;">${rows.join('<tr><td colspan="3" style="font-size:0;line-height:16px;height:16px;">&nbsp;</td></tr>')}</table>`;
  }
  const cells = items
    .slice(0, 12)
    .map((rawItem) => {
      const item = asItemRecord(rawItem);
      const label = itemText(item, ['label', 'title', 'name', 'heading'], 120);
      const body = itemText(item, ['body', 'description', 'detail', 'text', 'note'], 260);
      if (!label && !body) return '';
      const bodyNode = body
        ? `<div style="margin-top:6px;color:${theme.mutedColor};font-size:13px;line-height:1.55;">${body}</div>`
        : '';
      return `<td valign="top" width="50%" style="padding:6px;"><table role="presentation" cellspacing="0" cellpadding="0" width="100%" style="border-collapse:separate;background:${theme.softBg};border:1px solid ${theme.borderColor};border-radius:12px;"><tr><td width="5" style="background:${theme.brandColor};border-radius:12px 0 0 12px;font-size:0;line-height:0;">&nbsp;</td><td style="padding:14px 14px 13px;"><div style="color:${theme.textColor};font-size:14px;font-weight:700;line-height:1.45;">${label || body}</div>${bodyNode}</td></tr></table></td>`;
    })
    .filter(Boolean);
  if (!cells.length) return '';
  const rows: string[] = [];
  for (let index = 0; index < cells.length; index += 2) {
    const rowCells = cells.slice(index, index + 2);
    if (rowCells.length === 1) rowCells.push('<td width="50%" style="padding:6px;">&nbsp;</td>');
    rows.push(`<tr>${rowCells.join('')}</tr>`);
  }
  return `<table role="presentation" cellspacing="0" cellpadding="0" width="100%" style="border-collapse:collapse;margin:4px -6px 0;">${rows.join('')}</table>`;
};

const renderEmailMetricGrid = (section: Record<string, unknown>, theme: EmailTheme) => {
  const items = itemsFrom(section, ['metrics', 'items', 'data']);
  const cells = items
    .slice(0, 6)
    .map((rawItem) => {
      const item = asItemRecord(rawItem);
      const label = itemText(item, ['label', 'title', 'name'], 80);
      const value = itemText(item, ['value', 'amount', 'number'], 80);
      const delta = itemText(item, ['delta', 'change', 'trend'], 80);
      const note = itemText(item, ['note', 'body', 'description'], 140);
      if (!label && !value) return '';
      const deltaNode = delta
        ? `<span style="display:inline-block;margin-left:6px;color:${theme.brandColor};font-size:12px;font-weight:700;">${delta}</span>`
        : '';
      const noteNode = note
        ? `<div style="margin-top:6px;color:${theme.mutedColor};font-size:12px;line-height:1.45;">${note}</div>`
        : '';
      if (isBlueprintTheme(theme)) {
        return `<td valign="top" width="33.333%" style="padding:6px;"><table role="presentation" cellspacing="0" cellpadding="0" width="100%" style="border-collapse:separate;background:${theme.softBg};border:0;border-radius:12px;"><tr><td style="padding:20px;"><div style="margin-bottom:8px;color:${theme.mutedColor};font-size:11px;font-weight:600;letter-spacing:.5px;text-transform:uppercase;line-height:1.35;">${label}</div><div style="color:${theme.textColor};font-size:24px;font-weight:700;line-height:1.1;">${value || label}${deltaNode}</div>${noteNode}</td></tr></table></td>`;
      }
      return `<td valign="top" width="33.333%" style="padding:6px;"><table role="presentation" cellspacing="0" cellpadding="0" width="100%" style="border-collapse:separate;background:${theme.surface};border:1px solid ${theme.borderColor};border-radius:12px;"><tr><td style="padding:15px 14px;"><div style="margin-bottom:8px;color:${theme.mutedColor};font-size:12px;line-height:1.35;">${label}</div><div style="color:${theme.textColor};font-size:24px;font-weight:800;line-height:1.1;">${value || label}${deltaNode}</div>${noteNode}</td></tr></table></td>`;
    })
    .filter(Boolean);
  if (!cells.length) return '';
  const rows: string[] = [];
  for (let index = 0; index < cells.length; index += 3) {
    const rowCells = cells.slice(index, index + 3);
    while (rowCells.length < 3) rowCells.push('<td width="33.333%" style="padding:6px;">&nbsp;</td>');
    rows.push(`<tr>${rowCells.join('')}</tr>`);
  }
  return `<table role="presentation" cellspacing="0" cellpadding="0" width="100%" style="border-collapse:collapse;margin:6px -6px 0;">${rows.join('')}</table>`;
};

const renderEmailBarChart = (section: Record<string, unknown>, theme: EmailTheme) => {
  const items = itemsFrom(section, ['data', 'items', 'metrics']);
  const rows = items
    .slice(0, 8)
    .map((rawItem) => {
      const item = asItemRecord(rawItem);
      const label = itemText(item, ['label', 'title', 'name'], 120);
      const percent = safePercent(item.value || item.percent || item.score);
      const display = itemText(item, ['display', 'delta', 'note'], 80) || `${percent}%`;
      if (!label) return '';
      return `<tr><td style="padding:9px 0 4px;color:${theme.textColor};font-size:13px;font-weight:700;line-height:1.35;">${label}</td><td align="right" style="padding:9px 0 4px;color:${theme.mutedColor};font-size:12px;line-height:1.35;">${display}</td></tr><tr><td colspan="2" style="padding:0 0 8px;"><table role="presentation" cellspacing="0" cellpadding="0" width="100%" style="border-collapse:collapse;background:${theme.softBg};border-radius:999px;"><tr><td width="${percent}%" style="background:${theme.brandColor};border-radius:999px;font-size:0;line-height:8px;height:8px;">&nbsp;</td><td width="${100 - percent}%" style="font-size:0;line-height:8px;height:8px;">&nbsp;</td></tr></table></td></tr>`;
    })
    .filter(Boolean)
    .join('');
  return rows
    ? `<table role="presentation" cellspacing="0" cellpadding="0" width="100%" style="border-collapse:collapse;margin-top:4px;">${rows}</table>`
    : '';
};

const renderEmailTimeline = (section: Record<string, unknown>, theme: EmailTheme) => {
  const items = itemsFrom(section, ['items', 'milestones', 'steps']);
  const rows = items
    .slice(0, 8)
    .map((rawItem) => {
      const item = asItemRecord(rawItem);
      let phase = itemText(item, ['phase', 'date', 'time', 'label'], 80);
      let title = itemText(item, ['title', 'heading', 'name'], 140);
      const body = itemText(item, ['body', 'description', 'detail', 'note'], 220);
      if (!title && !body) {
        title = phase;
        phase = '';
      }
      const bodyNode = body
        ? `<div style="margin-top:4px;color:${theme.mutedColor};font-size:13px;line-height:1.55;">${body}</div>`
        : '';
      return `<tr><td valign="top" width="18" style="padding:8px 10px 8px 0;"><span style="display:block;width:10px;height:10px;background:${theme.brandColor};border-radius:999px;margin-top:4px;"></span></td><td valign="top" style="padding:8px 0;border-bottom:1px solid ${theme.subtleBorderColor || '#edf2f7'};"><div style="color:${theme.warningColor || theme.accentColor};font-size:12px;font-weight:700;line-height:1.35;">${phase}</div><div style="margin-top:2px;color:${theme.textColor};font-size:14px;font-weight:700;line-height:1.45;">${title}</div>${bodyNode}</td></tr>`;
    })
    .filter(Boolean)
    .join('');
  return rows
    ? `<table role="presentation" cellspacing="0" cellpadding="0" width="100%" style="border-collapse:collapse;margin-top:2px;">${rows}</table>`
    : '';
};

const renderEmailComparison = (section: Record<string, unknown>, theme: EmailTheme) => {
  if (section.rows || section.columns) return renderTable(section, theme);
  const items = itemsFrom(section, ['items', 'data']);
  const cells = items
    .slice(0, 4)
    .map((rawItem) => {
      const item = asItemRecord(rawItem);
      const label = itemText(item, ['label', 'title', 'name'], 100);
      const body = itemText(item, ['body', 'description', 'detail', 'value'], 260);
      if (!label && !body) return '';
      const background = isBlueprintTheme(theme) ? theme.softBg : theme.surface;
      const border = isBlueprintTheme(theme) ? '0' : `1px solid ${theme.borderColor}`;
      return `<td valign="top" width="50%" style="padding:6px;"><table role="presentation" cellspacing="0" cellpadding="0" width="100%" style="border-collapse:separate;background:${background};border:${border};border-radius:12px;"><tr><td style="padding:20px;"><div style="color:${theme.brandColor};font-size:12px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;">${label}</div><div style="margin-top:8px;color:${theme.textColor};font-size:14px;line-height:1.62;">${body}</div></td></tr></table></td>`;
    })
    .filter(Boolean);
  if (!cells.length) return '';
  const rows: string[] = [];
  for (let index = 0; index < cells.length; index += 2) {
    const rowCells = cells.slice(index, index + 2);
    if (rowCells.length === 1) rowCells.push('<td width="50%" style="padding:6px;">&nbsp;</td>');
    rows.push(`<tr>${rowCells.join('')}</tr>`);
  }
  return `<table role="presentation" cellspacing="0" cellpadding="0" width="100%" style="border-collapse:collapse;margin:4px -6px 0;">${rows.join('')}</table>`;
};

const renderTable = (section: Record<string, unknown>, theme?: EmailTheme) => {
  const columns = Array.isArray(section.columns) ? section.columns : [];
  const rows = Array.isArray(section.rows) ? section.rows : [];
  if (theme && isBlueprintTheme(theme)) {
    return renderBlueprintTable(columns, rows, theme);
  }
  const border = theme?.borderColor || '#dbe3ef';
  const text = theme?.textColor || '#0f172a';
  const head = columns
    .slice(0, 8)
    .map((col) => `<th style="text-align:left;border-bottom:1px solid ${border};padding:8px 10px;color:${text};font-size:12px;">${escapeHtml(col, 80)}</th>`)
    .join('');
  const body = rows
    .slice(0, 12)
    .map((row) => {
      const values = Array.isArray(row) ? row : [row];
      return `<tr>${values.slice(0, 8).map((cell) => `<td style="border-bottom:1px solid #edf2f7;padding:8px 10px;color:#334155;font-size:12px;line-height:1.45;">${escapeHtml(cell, 160)}</td>`).join('')}</tr>`;
    })
    .join('');
  return `<table role="presentation" cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%;margin-top:8px;">${head ? `<thead><tr>${head}</tr></thead>` : ''}<tbody>${body}</tbody></table>`;
};

const blueprintStatusChip = (value: unknown, theme: EmailTheme) => {
  const raw = String(value ?? '').trim();
  const text = escapeHtml(raw, 80);
  const lowered = raw.toLowerCase();
  const doneValues = new Set(['完成', '已完成', '通过', 'done', 'completed', 'passed', 'approved']);
  const todoValues = new Set(['待办', '未开始', 'todo', 'pending', 'open']);
  const riskValues = new Set(['风险', '高风险', 'blocked', 'risk', 'failed']);
  const progressValues = new Set(['进行中', '处理中', 'in progress', 'progress', 'ongoing']);
  let background = '';
  let color = '';
  if (doneValues.has(raw) || doneValues.has(lowered)) {
    background = '#ecfdf3';
    color = theme.accentColor;
  } else if (todoValues.has(raw) || todoValues.has(lowered)) {
    background = theme.softBg;
    color = theme.mutedColor;
  } else if (riskValues.has(raw) || riskValues.has(lowered)) {
    background = '#fff5f5';
    color = theme.dangerColor || '#ff3b30';
  } else if (progressValues.has(raw) || progressValues.has(lowered)) {
    background = '#eaf6ff';
    color = theme.brandColor;
  } else {
    return text;
  }
  return `<span style="display:inline-block;padding:4px 10px;background:${background};color:${color};font-size:11px;font-weight:500;border-radius:10px;">${text}</span>`;
};

const renderBlueprintTable = (columns: unknown[], rows: unknown[], theme: EmailTheme) => {
  if (!columns.length && !rows.length) return '';
  const subtleBorder = theme.subtleBorderColor || '#f0f0f0';
  const width = Math.max(12, Math.round(100 / Math.max(1, columns.slice(0, 8).length || 1)));
  const head = columns
    .slice(0, 8)
    .map((col) => `<td style="padding:14px 16px;font-size:11px;font-weight:600;color:${theme.mutedColor};text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid ${subtleBorder};" width="${width}%">${escapeHtml(col, 80)}</td>`)
    .join('');
  const body = rows
    .slice(0, 12)
    .map((row, rowIndex) => {
      const values = Array.isArray(row) ? row : [row];
      const isLast = rowIndex === Math.min(rows.length, 12) - 1;
      const border = isLast ? '' : `border-bottom:1px solid ${subtleBorder};`;
      return `<tr>${values.slice(0, 8).map((cell) => `<td style="padding:16px;font-size:14px;color:${theme.textColor};line-height:1.5;${border}">${blueprintStatusChip(cell, theme)}</td>`).join('')}</tr>`;
    })
    .join('');
  return `<table role="presentation" cellspacing="0" cellpadding="0" width="100%" style="border-collapse:separate;border-spacing:0;width:100%;border:1px solid ${subtleBorder};border-radius:12px;overflow:hidden;margin-top:2px;">${head ? `<tr style="background:${theme.tableHeadBg || '#fafafa'};">${head}</tr>` : ''}${body}</table>`;
};

const emailCard = (content: string, theme: EmailTheme, templateId: EmailTemplateId, compact = false) => {
  if (isBlueprintTheme(theme)) {
    const padding = compact ? '20px' : '32px';
    return `<table role="presentation" cellspacing="0" cellpadding="0" width="100%" style="border-collapse:separate;width:100%;background:${theme.surface};border:1px solid ${theme.borderColor};border-radius:16px;"><tr><td style="padding:${padding};">${content}</td></tr></table>`;
  }
  const padding = compact ? '14px 18px' : '18px 22px';
  const background = templateId === 'product_launch' ? theme.softBg : theme.surface;
  return `<table role="presentation" cellspacing="0" cellpadding="0" width="100%" style="border-collapse:separate;width:100%;background:${background};border:1px solid ${theme.borderColor};border-radius:14px;"><tr><td style="padding:${padding};">${content}</td></tr></table>`;
};

const emailHeading = (section: Record<string, unknown>, theme: EmailTheme, size = 18) => {
  const heading = escapeHtml(section.heading || section.title, 160);
  if (!heading) return '';
  if (isBlueprintTheme(theme)) {
    return `<table role="presentation" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin:0 0 24px;"><tr><td style="width:4px;background:${theme.brandColor};border-radius:2px;font-size:0;line-height:0;">&nbsp;</td><td style="padding-left:14px;font-size:20px;font-weight:600;line-height:1.35;color:${theme.textColor};">${heading}</td></tr></table>`;
  }
  return `<h2 style="margin:0 0 10px;font-size:${size}px;line-height:1.35;color:${theme.textColor};">${heading}</h2>`;
};

const emailBody = (section: Record<string, unknown>, theme: EmailTheme, maxChars = 2200) => {
  const body = escapeHtml(section.body || section.text, maxChars);
  if (!body) return '';
  if (isBlueprintTheme(theme)) {
    return `<p style="margin:0;color:${theme.textColor};font-size:15px;line-height:1.7;">${body}</p>`;
  }
  return `<p style="margin:0;color:${theme.mutedColor};font-size:15px;line-height:1.68;">${body}</p>`;
};

const emailSectionInner = (section: Record<string, unknown>, theme: EmailTheme, type: string) => {
  const heading = emailHeading(section, theme);
  const body = emailBody(section, theme);
  if (['list', 'insight_grid', 'cards'].includes(type)) {
    return heading + body + renderEmailList(section.items, theme);
  }
  if (['metric_grid', 'metrics', 'kpi', 'stats'].includes(type)) {
    return heading + body + renderEmailMetricGrid(section, theme);
  }
  if (['bar_chart', 'progress_chart', 'chart'].includes(type)) {
    return heading + body + renderEmailBarChart(section, theme);
  }
  if (['timeline', 'roadmap'].includes(type)) {
    return heading + body + renderEmailTimeline(section, theme);
  }
  if (['comparison', 'comparison_table'].includes(type)) {
    return heading + body + renderEmailComparison(section, theme);
  }
  if (type === 'table') {
    return heading + body + renderTable(section, theme);
  }
  if (type === 'quote') {
    return `<div style="border-left:4px solid ${theme.brandColor};padding:2px 0 2px 14px;"><p style="margin:0;color:${theme.textColor};font-size:15px;line-height:1.68;">${escapeHtml(section.body || section.text, 2200)}</p></div>`;
  }
  return heading + body;
};

const renderEmailSection = (raw: unknown, theme: EmailTheme, templateId: EmailTemplateId, index: number) => {
  const section = asRecord(raw);
  const sectionPadding = isBlueprintTheme(theme) ? '0 0 30px' : '0 34px 14px';
  if (!Object.keys(section).length) {
    const content = `<p style="margin:0;color:${theme.textColor};font-size:14px;line-height:1.65;">${escapeHtml(raw)}</p>`;
    return `<tr><td style="padding:${sectionPadding};">${emailCard(content, theme, templateId)}</td></tr>`;
  }
  const type = String(section.type || 'text').toLowerCase();

  if (type === 'cta') {
    const label = escapeHtml(section.label || section.text || '查看详情', 80);
    const href = safeHref(section.href);
    const align = isBlueprintTheme(theme) ? String(section.align || 'left') : templateId === 'product_launch' ? 'center' : 'left';
    const button = href
      ? `<a href="${href}" style="display:inline-block;border-radius:999px;background:${theme.brandColor};color:#fff;text-decoration:none;padding:12px 20px;font-size:14px;font-weight:700;">${label}</a>`
      : `<span style="display:inline-block;color:${theme.brandColor};font-size:14px;font-weight:700;">${label}</span>`;
    const ctaPadding = isBlueprintTheme(theme) ? '0 0 30px' : '4px 34px 22px';
    return `<tr><td align="${align}" style="padding:${ctaPadding};">${button}</td></tr>`;
  }

  let content = emailSectionInner(section, theme, type);
  if (!content) {
    content = `<p style="margin:0;color:${theme.mutedColor};font-size:14px;">Draft section ${index}</p>`;
  }
  return `<tr><td style="padding:${sectionPadding};">${emailCard(content, theme, templateId)}</td></tr>`;
};

const renderEmailHero = (
  hero: Record<string, unknown>,
  subject: string,
  preheader: string,
  brand: string,
  theme: EmailTheme,
  templateId: EmailTemplateId,
) => {
  const heading = escapeHtml(hero.heading || hero.title || subject, 180);
  const body = escapeHtml(hero.body || hero.text || preheader, 1200);

  if (templateId === 'blueprint_review') {
    const badge = escapeHtml(hero.badge || hero.eyebrow || hero.kicker || `${brand} REVIEW`, 80);
    return `<tr><td align="center" style="padding:0 0 50px;"><table role="presentation" cellspacing="0" cellpadding="0" style="border-collapse:collapse;"><tr><td align="center" style="padding-bottom:12px;"><span style="display:inline-block;font-size:11px;font-weight:600;letter-spacing:1px;color:${theme.brandColor};text-transform:uppercase;background:#eaf6ff;padding:6px 14px;border-radius:20px;">${badge}</span></td></tr><tr><td align="center" style="padding-bottom:12px;"><h1 style="margin:0;font-size:36px;font-weight:700;letter-spacing:-.5px;line-height:1.18;color:${theme.textColor};">${heading}</h1></td></tr><tr><td align="center"><p style="margin:0;font-size:18px;color:${theme.mutedColor};font-weight:400;line-height:1.5;">${body}</p></td></tr></table></td></tr>`;
  }

  if (templateId === 'newsletter_update') {
    return `<tr><td style="padding:0;background:${theme.brandColor};border-radius:16px 16px 0 0;"><table role="presentation" cellspacing="0" cellpadding="0" width="100%" style="border-collapse:collapse;"><tr><td style="padding:32px 36px 30px;"><div style="margin:0 0 16px;color:#ccfbf1;font-size:12px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;">${brand} · Newsletter</div><h1 style="margin:0 0 12px;color:#fff;font-size:30px;line-height:1.18;">${heading}</h1><p style="margin:0;color:#d1fae5;font-size:15px;line-height:1.7;">${body}</p></td></tr></table></td></tr>`;
  }
  if (templateId === 'product_launch') {
    return `<tr><td style="padding:0;background:${theme.accentColor};border-radius:16px 16px 0 0;"><table role="presentation" cellspacing="0" cellpadding="0" width="100%" style="border-collapse:collapse;"><tr><td style="padding:34px 36px 32px;border-top:6px solid ${theme.brandColor};"><div style="margin:0 0 14px;color:#fed7aa;font-size:12px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;">${brand} · Launch</div><h1 style="margin:0 0 12px;color:#fff;font-size:32px;line-height:1.14;">${heading}</h1><p style="margin:0;color:#e5e7eb;font-size:15px;line-height:1.7;">${body}</p></td></tr></table></td></tr>`;
  }
  return `<tr><td style="padding:34px 38px 24px;"><div style="margin:0 0 16px;color:${theme.brandColor};font-size:12px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;">${brand}</div><h1 style="margin:0 0 12px;color:${theme.textColor};font-size:30px;line-height:1.18;">${heading}</h1><p style="margin:0;color:${theme.mutedColor};font-size:15px;line-height:1.72;">${body}</p><div style="height:3px;width:72px;background:${theme.accentColor};border-radius:999px;margin-top:22px;"></div></td></tr>`;
};

const renderEmailFooter = (footer: string, theme: EmailTheme, brand: string, templateId: EmailTemplateId) => {
  if (templateId === 'blueprint_review') {
    return `<tr><td align="center" style="padding:0 0 4px;"><p style="margin:0;font-size:12px;color:${theme.mutedColor};line-height:1.6;">${footer}</p></td></tr>`;
  }
  const background = templateId === 'product_launch' ? '#111827' : theme.softBg;
  const color = templateId === 'product_launch' ? '#d1d5db' : theme.mutedColor;
  const labelColor = templateId === 'product_launch' ? '#fed7aa' : theme.brandColor;
  return `<tr><td style="padding:20px 34px 24px;background:${background};border-radius:0 0 16px 16px;"><div style="margin:0 0 6px;color:${labelColor};font-size:12px;font-weight:700;">${brand}</div><div style="color:${color};font-size:12px;line-height:1.55;">${footer}</div></td></tr>`;
};

const renderSection = (raw: unknown, brandColor: string) => {
  const section = asRecord(raw);
  if (!Object.keys(section).length) {
    return `<div style="padding:18px 0;color:#334155;line-height:1.6;">${escapeHtml(raw)}</div>`;
  }
  const type = String(section.type || 'text').toLowerCase();
  const headingText = escapeHtml(section.heading || section.title, 160);
  const heading = headingText ? `<h2 style="margin:0 0 10px;font-size:18px;line-height:1.35;color:#0f172a;">${headingText}</h2>` : '';
  const body = escapeHtml(section.body || section.text, 2200);

  if (type === 'hero') {
    return `<div style="padding:26px 0 20px;border-bottom:1px solid #e2e8f0;"><div style="margin:0 0 12px;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${brandColor};">SmartDiagram</div><h1 style="margin:0 0 12px;font-size:28px;line-height:1.2;color:#0f172a;">${escapeHtml(section.heading || section.title, 180)}</h1><p style="margin:0;color:#475569;font-size:15px;line-height:1.65;">${body}</p></div>`;
  }
  if (type === 'list') {
    return `<div style="padding:18px 0;border-bottom:1px solid #edf2f7;">${heading}<ul style="margin:0;padding-left:20px;">${renderList(section.items)}</ul></div>`;
  }
  if (type === 'cta') {
    const label = escapeHtml(section.label || section.text || '查看详情', 80);
    const href = safeHref(section.href);
    return href
      ? `<div style="padding:20px 0;"><a href="${href}" style="display:inline-block;border-radius:8px;background:${brandColor};color:#fff;text-decoration:none;padding:11px 18px;font-size:14px;font-weight:700;">${label}</a></div>`
      : `<div style="padding:18px 0;color:${brandColor};font-weight:700;">${label}</div>`;
  }
  if (type === 'table') {
    return `<div style="padding:18px 0;border-bottom:1px solid #edf2f7;">${heading}${renderTable(section)}</div>`;
  }
  if (type === 'quote') {
    return `<blockquote style="margin:18px 0;padding:12px 16px;border-left:4px solid ${brandColor};background:#f8fafc;color:#334155;line-height:1.6;">${body}</blockquote>`;
  }
  return `<div style="padding:18px 0;border-bottom:1px solid #edf2f7;">${heading}<p style="margin:0;color:#334155;line-height:1.65;">${body}</p></div>`;
};

const renderSections = (payload: ArtifactPayload, brandColor: string) =>
  payloadSections(payload).map((section) => renderSection(section, brandColor)).join('');

export function parseArtifactDsl(code: string): ArtifactPayload | null {
  try {
    const payload = JSON.parse(code);
    return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as ArtifactPayload : null;
  } catch {
    return null;
  }
}

const renderEmailArtifact = (payload: ArtifactPayload): HtmlArtifactRenderResult => {
  const email = asRecord(payload.email);
  const { templateId, theme } = emailTheme(payload);
  const brand = brandName(payload);
  const subject = String(email.subject || payload.title || 'Untitled email').trim().slice(0, 160);
  const preheader = String(email.preheader || '').trim().slice(0, 220);
  const { hero, contentSections } = splitEmailSections(payload, subject, preheader);
  const footer = escapeHtml(payload.footer || '此邮件由 SmartDiagram Office Artifact Platform 生成。', 220);
  const preheaderNode = preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(preheader, 220)}</div>`
    : '';
  const outerPadding = isBlueprintTheme(theme) ? '40px 20px 60px' : '28px 12px';
  const containerStyle = isBlueprintTheme(theme)
    ? `border-collapse:collapse;width:100%;max-width:${theme.maxWidth}px;`
    : `border-collapse:separate;width:100%;max-width:${theme.maxWidth}px;background:${theme.surface};border:1px solid ${theme.borderColor};border-radius:16px;`;
  const bodyFont = "-apple-system,system-ui,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',Arial,sans-serif";
  const html = `<!doctype html><html lang="${escapeHtml(payload.language || 'zh-CN', 16)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject, 160)}</title></head><body style="margin:0;padding:0;background:${theme.background};font-family:${bodyFont};">${preheaderNode}<table role="presentation" cellspacing="0" cellpadding="0" width="100%" style="border-collapse:collapse;background:${theme.background};"><tr><td align="center" style="padding:${outerPadding};"><table role="presentation" cellspacing="0" cellpadding="0" width="100%" style="${containerStyle}">${renderEmailHero(hero, subject, preheader, brand, theme, templateId)}${contentSections.map((section, index) => renderEmailSection(section, theme, templateId, index + 1)).join('')}${renderEmailFooter(footer, theme, brand, templateId)}</table></td></tr></table></body></html>`;

  return {
    html,
    metadata: {
      artifactType: 'html_email',
      template: templateId,
      title: subject,
    },
  };
};

export function renderHtmlArtifact(code: string): HtmlArtifactRenderResult {
  const payload = parseArtifactDsl(code);
  if (!payload) {
    return {
      html: '<!doctype html><html><body style="font-family:Arial,sans-serif;padding:24px;color:#334155;">Invalid office artifact DSL</body></html>',
      metadata: {},
      error: 'Invalid JSON DSL',
    };
  }

  const style = asRecord(payload.style);
  const artifactType = String(payload.artifact_type || 'web_report_html');
  const isEmail = artifactType === 'html_email';
  if (isEmail) {
    return renderEmailArtifact(payload);
  }

  const brandColor = safeColor(style.brand_color, '#0f766e');
  const maxWidth = safeWidth(style.max_width, 920);
  const title = String(payload.title || 'Office artifact').slice(0, 180);
  const sections = renderSections(payload, brandColor);
  const html = `<!doctype html><html lang="${escapeHtml(payload.language || 'zh-CN', 16)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title, 180)}</title></head><body style="margin:0;background:#f8fafc;color:#0f172a;font-family:Arial,'PingFang SC','Microsoft YaHei',sans-serif;"><main style="max-width:${maxWidth}px;margin:0 auto;padding:40px 22px 56px;"><header style="padding:0 0 24px;border-bottom:3px solid ${brandColor};"><div style="font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:${brandColor};">SmartDiagram Report</div><h1 style="margin:10px 0 8px;font-size:34px;line-height:1.15;color:#0f172a;">${escapeHtml(title, 180)}</h1><p style="margin:0;color:#64748b;font-size:14px;">${escapeHtml(payload.audience || payload.tone || 'Office report', 160)}</p></header><section style="background:#fff;border:1px solid #dbe3ef;border-radius:12px;margin-top:22px;padding:4px 24px 18px;">${sections}</section></main></body></html>`;

  return {
    html,
    metadata: {
      artifactType,
      title,
    },
  };
}
