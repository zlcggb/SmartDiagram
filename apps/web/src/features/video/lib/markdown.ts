/**
 * 工业级研报富文本与可视化 Markdown 渲染引擎
 * 专为中文大模型研报打造：
 * 1. 完美兼容 CJK 中文全角标点紧邻的 **加粗** 与 *重点概念高亮*
 * 2. 自动将 ``` [阶段一] -> [阶段二] ``` 流程围栏块升维渲染为可视化横向递进流程卡片
 * 3. 支持水平分割线 ---、多级嵌套列表、列表内嵌「话术示范/案例」微卡片、GFM 表格與内联 <svg> 矢量图
 * 4. 支持流式打字机输出期间（Streaming）未闭合语法的自动闭合防闪烁
 * 5. 支持 [mm:ss] / [hh:mm:ss] 可点击视频时间戳药丸跳转
 */

function escapeHtml(str: string): string {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 流式输出自愈：若大模型正在打字机流式吐字，末尾可能存在未闭合的 ``` 或 **
 */
function healStreamingMarkdown(md: string): string {
  let out = md;
  const fenceMatches = out.match(/```/g);
  if (fenceMatches && fenceMatches.length % 2 === 1) {
    out += '\n```';
  }
  return out;
}

/**
 * 判断一个围栏代码块是否为「阶段递进 / 箭头流程图」并渲染为可视化流程卡片
 * 例如：
 * [阶段一：高频能见与心智锚定] -> [阶段二：制造震慑与格局建立] -> [阶段三：深度依赖与愧疚托举]
 * (让决策高层看到你) (让高层对你产生震撼) (让直属领导主动推你)
 */
function tryRenderFlowFence(code: string): string | null {
  const lines = code
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0 || lines.length > 6) return null;

  const firstLine = lines[0];
  const arrowRegex = /\s*(?:->|→|==>|--＞|—>|⇒)\s*/;
  if (!arrowRegex.test(firstLine)) return null;

  const rawSteps = firstLine
    .split(arrowRegex)
    .map((s) => s.trim().replace(/^[\[【(（](.*?)[\]】)）]$/, '$1').trim())
    .filter(Boolean);

  if (rawSteps.length < 2 || rawSteps.length > 6) return null;

  // 解析第二行的括号副标题注解，如：(让决策高层看到你) (让高层对你产生震撼) (让直属领导主动推你)
  let subLabels: string[] = [];
  if (lines.length >= 2) {
    const secondLine = lines[1];
    const parenMatches = Array.from(secondLine.matchAll(/[（(\[【]([^）)\]】]+)[）)\]】]/g)).map((m) =>
      m[1].trim(),
    );
    if (parenMatches.length === rawSteps.length) {
      subLabels = parenMatches;
    } else if (arrowRegex.test(secondLine)) {
      const splitSubs = secondLine
        .split(arrowRegex)
        .map((s) => s.trim().replace(/^[（(\[【](.*?)[）)\]】]$/, '$1').trim());
      if (splitSubs.length === rawSteps.length) {
        subLabels = splitSubs;
      }
    }
  }

  const stepCards = rawSteps
    .map((stepText, idx) => {
      // 拆分「阶段一：xxx」与主体名称
      const colonMatch = stepText.match(/^([^:：]{2,8})[:：]\s*(.+)$/);
      const badgeText = colonMatch ? colonMatch[1].trim() : `STEP 0${idx + 1}`;
      const mainTitle = colonMatch ? colonMatch[2].trim() : stepText;
      const subText = subLabels[idx] || '';

      const cardHtml = `
        <div class="flex min-w-[92px] flex-1 flex-col justify-between rounded-xl border border-[#0071e3]/20 bg-white p-2 shadow-2xs sm:min-w-[160px] sm:rounded-2xl sm:p-3.5 sm:shadow-sm">
          <div>
            <div class="mb-1 inline-flex items-center gap-1 rounded-full bg-[#0071e3]/10 px-1.5 py-0.5 text-[10px] font-bold text-[#0071e3] sm:mb-1.5 sm:gap-1.5 sm:px-2.5 sm:text-[11px]">
              <span class="h-1 w-1 rounded-full bg-[#0071e3] sm:h-1.5 sm:w-1.5"></span>
              <span class="whitespace-nowrap">${escapeHtml(badgeText)}</span>
            </div>
            <div class="text-[12px] font-bold leading-tight text-slate-900 sm:text-[13.5px] sm:leading-snug">${escapeHtml(mainTitle)}</div>
          </div>
          ${
            subText
              ? `<div class="mt-1 border-t border-slate-100 pt-1 text-[10.5px] leading-snug text-slate-500 sm:mt-2 sm:pt-2 sm:text-[12px] sm:leading-relaxed">${escapeHtml(subText)}</div>`
              : ''
          }
        </div>
      `;

      const arrowHtml =
        idx < rawSteps.length - 1
          ? `<div class="flex shrink-0 items-center justify-center px-0 text-[#0071e3]/60 sm:px-1">
               <svg class="h-3.5 w-3.5 sm:h-5 sm:w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                 <path d="M5 12h14" />
                 <path d="m13 6 6 6-6 6" />
               </svg>
             </div>`
          : '';

      return cardHtml + arrowHtml;
    })
    .join('');

  // 若还有第 3+ 行补充说明
  const extraLines =
    lines.length > (subLabels.length > 0 ? 2 : 1)
      ? lines
          .slice(subLabels.length > 0 ? 2 : 1)
          .map((l) => `<div class="mt-1.5 text-center text-[11px] text-slate-500 sm:mt-2 sm:text-[12px]">${parseInline(l)}</div>`)
          .join('')
      : '';

  return `<div class="my-3 overflow-x-auto rounded-2xl border border-[#0071e3]/15 bg-gradient-to-br from-[#0071e3]/[0.05] via-slate-50/80 to-white p-2.5 sm:my-4 sm:p-4">
    <div class="flex flex-nowrap items-stretch gap-1 sm:gap-2">${stepCards}</div>
    ${extraLines}
  </div>`;
}

/**
 * 零依赖多语言语法高亮器（支持 TypeScript / Python / SQL / JSON / Bash / HTTP / Nginx / YAML）
 */
function highlightCodeSyntax(rawCode: string, lang: string): string {
  const lower = (lang || '').toLowerCase();
  const tokens: string[] = [];
  const saveToken = (html: string) => {
    const id = tokens.length;
    tokens.push(html);
    return `@@HL_TOK_${id}@@`;
  };

  let s = escapeHtml(rawCode);

  // 1. 多行注释 /* ... */
  s = s.replace(/\/\*[\s\S]*?\*\//g, (m) =>
    saveToken(`<span class="text-slate-400 italic">${m}</span>`),
  );

  // 2. 单行注释 // ... 或 # ... 或 -- ...
  if (['python', 'py', 'bash', 'sh', 'shell', 'yaml', 'yml', 'dockerfile', 'nginx', 'conf', 'ini'].includes(lower)) {
    s = s.replace(/(^|\s)(#[^\n]*)/gm, (_m, p1: string, cmt: string) =>
      `${p1}${saveToken(`<span class="text-slate-400 italic">${cmt}</span>`)}`,
    );
  } else if (lower === 'sql') {
    s = s.replace(/(--[^\n]*)/g, (m) =>
      saveToken(`<span class="text-slate-400 italic">${m}</span>`),
    );
  } else {
    s = s.replace(/(^|[^:])(\/\/[^\n]*)/gm, (_m, p1: string, cmt: string) =>
      `${p1}${saveToken(`<span class="text-slate-400 italic">${cmt}</span>`)}`,
    );
  }

  // 3. 字符串 ("..." / '...' / `...`)
  s = s.replace(/(&quot;.*?&quot;|&#39;.*?&#39;|`[^`\n]*`)/g, (m) =>
    saveToken(`<span class="text-emerald-300">${m}</span>`),
  );

  // 4. JSON / 对象属性键名 (key:)
  s = s.replace(/^(\s*)([a-zA-Z_][\w-]*)(\??\s*:)/gm, (_m, indent: string, key: string, colon: string) =>
    `${indent}<span class="text-sky-200 font-semibold">${key}</span>${colon}`,
  );

  // 5. 装饰器 @classmethod / @field_validator / @router.get
  s = s.replace(/(@[a-zA-Z_][\w.]*)/g, '<span class="text-amber-300 font-semibold">$1</span>');

  // 6. 语言关键字
  const kwRegex =
    /\b(export|interface|type|class|extends|implements|function|return|const|let|var|async|await|import|from|def|elif|else|if|for|in|try|except|finally|with|as|pass|raise|yield|True|False|None|true|false|null|undefined|SELECT|FROM|WHERE|INSERT|INTO|UPDATE|SET|DELETE|CREATE|TABLE|IF|NOT|EXISTS|PRIMARY|KEY|FOREIGN|REFERENCES|INDEX|ON|DEFAULT|UNIQUE|CHECK|CASCADE|JSONB|UUID|TEXT|INTEGER|BIGINT|NUMERIC|TIMESTAMPTZ|BOOLEAN|POST|GET|PUT|PATCH|OPTIONS|HTTP)\b/g;
  s = s.replace(kwRegex, '<span class="text-purple-300 font-semibold">$1</span>');

  // 7. 常见类型名与内建对象
  const typeRegex =
    /\b(string|number|boolean|any|void|Record|Array|Promise|Optional|List|Dict|Any|BaseModel|Field|ChapterItem|SummaryReportPayload|SummaryReportModel)\b/g;
  s = s.replace(typeRegex, '<span class="text-amber-300">$1</span>');

  // 8. 数字字面量
  s = s.replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="text-orange-300">$1</span>');

  // 9. 还原保护的注释与字符串 Token
  s = s.replace(/@@HL_TOK_(\d+)@@/g, (_m, idStr: string) => tokens[Number(idStr)] || '');

  return s;
}

/**
 * 渲染 macOS 深色 IDE 终端代码卡片（带红黄绿窗口灯、语言徽标、语法高亮与一键复制按钮）
 */
function renderIdeCodeWindow(code: string, lang: string): string {
  const displayLang = (lang || 'CODE').toUpperCase();
  const highlighted = highlightCodeSyntax(code, lang);
  const encodedRaw = encodeURIComponent(code);

  return `<div class="not-prose my-3 sm:my-4 overflow-hidden rounded-xl sm:rounded-2xl border border-slate-800 bg-[#1c2128] shadow-md">
    <div class="flex items-center justify-between border-b border-slate-700/70 bg-[#161b22] px-3 py-1.5 sm:px-4 sm:py-2 select-none">
      <div class="flex items-center gap-1.5 sm:gap-2">
        <div class="flex items-center gap-1.5">
          <span class="inline-block h-2 w-2 sm:h-2.5 sm:w-2.5 rounded-full bg-[#ff5f56]"></span>
          <span class="inline-block h-2 w-2 sm:h-2.5 sm:w-2.5 rounded-full bg-[#ffbd2e]"></span>
          <span class="inline-block h-2 w-2 sm:h-2.5 sm:w-2.5 rounded-full bg-[#27c93f]"></span>
        </div>
        <span class="ml-1 rounded-md bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] sm:text-[10.5px] font-bold tracking-wider text-sky-400 uppercase">${escapeHtml(displayLang)}</span>
      </div>
      <button type="button" data-copy-code="${encodedRaw}" class="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800/90 px-2 py-0.5 sm:px-2.5 sm:py-1 text-[10.5px] sm:text-[11px] font-medium text-slate-300 transition hover:border-sky-500/50 hover:text-white cursor-pointer">
        <span>📋 复制</span>
      </button>
    </div>
    <pre class="overflow-x-auto p-3 sm:p-4 font-mono text-[11.5px] sm:text-[12.5px] leading-relaxed text-slate-100"><code>${highlighted}</code></pre>
  </div>`;
}

/**
 * 智能识别 TypeScript interface / Python Pydantic BaseModel / SQL CREATE TABLE 数据契约代码，
 * 自动升维渲染为「可视化结构化契约卡片 + 可折叠深色源码抽屉」，解决纯代码罗列阅读体验差的问题
 */
function tryRenderDataContractCard(code: string, lang: string): string | null {
  const lower = (lang || '').toLowerCase();

  // Case 1: TypeScript export interface
  if ((lower === 'typescript' || lower === 'ts') && /export\s+interface\s+\w+/.test(code)) {
    const interfaceBlocks = Array.from(
      code.matchAll(/export\s+interface\s+(\w+)\s*\{([\s\S]*?)\n\}/g),
    );
    if (interfaceBlocks.length > 0) {
      const cardsHtml = interfaceBlocks
        .map((match) => {
          const ifaceName = match[1];
          const body = match[2];
          const rows: Array<{ name: string; optional: boolean; type: string; desc: string }> = [];

          // 逐段提取注释与顶层字段
          const lines = body.split(/\r?\n/);
          let pendingComment = '';
          let braceDepth = 0;

          for (const line of lines) {
            const t = line.trim();
            if (!t) continue;

            // 收集注释
            const singleDoc = t.match(/^\/\*\*\s*(.*?)\s*\*\/$/);
            if (singleDoc && braceDepth === 0) {
              pendingComment = singleDoc[1].replace(/^\*\s*/, '').trim();
              continue;
            }
            if (t.startsWith('/**') || t.startsWith('*')) {
              const cleaned = t
                .replace(/^\/\*\*/, '')
                .replace(/\*\/$/, '')
                .replace(/^\*\s?/, '')
                .trim();
              if (cleaned && braceDepth === 0) {
                pendingComment = pendingComment ? `${pendingComment} ${cleaned}` : cleaned;
              }
              continue;
            }

            if (braceDepth === 0) {
              const fieldMatch = t.match(/^([a-zA-Z_]\w*)(\??)\s*:\s*(.+)$/);
              if (fieldMatch) {
                const fName = fieldMatch[1];
                const isOpt = fieldMatch[2] === '?';
                let fType = fieldMatch[3].replace(/;$/, '').trim();
                if (fType.endsWith('{') || fType.startsWith('Array<{')) {
                  fType = fType.startsWith('Array<') ? 'Array<Object>' : 'Object';
                }
                rows.push({
                  name: fName,
                  optional: isOpt,
                  type: fType,
                  desc: pendingComment || '核心业务契约字段',
                });
                pendingComment = '';
              }
            }

            for (const ch of t) {
              if (ch === '{') braceDepth++;
              else if (ch === '}') braceDepth = Math.max(0, braceDepth - 1);
            }
          }

          if (rows.length === 0) return '';

          const rowsHtml = rows
            .map(
              (r) => `
              <tr class="hover:bg-slate-50/80 transition-colors">
                <td class="px-3.5 py-2.5 align-top whitespace-nowrap">
                  <div class="flex items-center gap-1.5">
                    <code class="rounded-md bg-[#0071e3]/10 px-2 py-0.5 font-mono text-[12px] font-bold text-[#0071e3]">${escapeHtml(r.name)}</code>
                    ${
                      r.optional
                        ? '<span class="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">可选</span>'
                        : '<span class="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">必填</span>'
                    }
                  </div>
                </td>
                <td class="px-3.5 py-2.5 align-top whitespace-nowrap">
                  <span class="rounded-md border border-purple-200 bg-purple-50/70 px-2 py-0.5 font-mono text-[11.5px] font-semibold text-purple-700">${escapeHtml(r.type)}</span>
                </td>
                <td class="px-3.5 py-2.5 text-[12.5px] text-slate-700 leading-relaxed">${parseInline(r.desc)}</td>
              </tr>`,
            )
            .join('');

          return `
            <div class="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-2xs">
              <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/80 bg-gradient-to-r from-[#0071e3]/[0.07] via-indigo-50/50 to-white px-4 py-2.5">
                <div class="flex items-center gap-2">
                  <span class="flex h-6 w-6 items-center justify-center rounded-lg bg-[#0071e3] text-[11px] font-bold text-white">TS</span>
                  <span class="font-mono text-[13.5px] font-bold text-slate-900">${escapeHtml(ifaceName)}</span>
                  <span class="rounded-full bg-[#0071e3]/10 px-2 py-0.5 text-[10.5px] font-semibold text-[#0071e3]">前端强类型接口契约</span>
                </div>
                <span class="text-[11px] text-slate-500">共 ${rows.length} 个核心字段</span>
              </div>
              <div class="overflow-x-auto">
                <table class="w-full text-left border-collapse text-[12.5px]">
                  <thead class="bg-slate-50/90 border-b border-slate-200/70 text-slate-500">
                    <tr>
                      <th class="px-3.5 py-2 font-semibold w-[220px]">字段名 (Field)</th>
                      <th class="px-3.5 py-2 font-semibold w-[160px]">类型 (Type)</th>
                      <th class="px-3.5 py-2 font-semibold">契约语义与渲染消费说明</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-slate-100">${rowsHtml}</tbody>
                </table>
              </div>
            </div>`;
        })
        .filter(Boolean)
        .join('<div class="h-3"></div>');

      if (cardsHtml) {
        return `<div class="not-prose my-5 space-y-3">
          ${cardsHtml}
          <details class="group rounded-xl border border-slate-200/80 bg-slate-50/70 px-3.5 py-2 text-xs text-slate-600">
            <summary class="flex cursor-pointer items-center justify-between font-medium text-slate-700 hover:text-[#0071e3] select-none">
              <span>💻 展开查看 TypeScript 原始接口源码定义</span>
              <span class="text-[11px] text-slate-400 group-open:rotate-180 transition-transform">▼</span>
            </summary>
            <div class="mt-2">${renderIdeCodeWindow(code, lang)}</div>
          </details>
        </div>`;
      }
    }
  }

  // Case 2: Python Pydantic BaseModel
  if ((lower === 'python' || lower === 'py') && /class\s+\w+\(BaseModel\):/.test(code)) {
    const modelBlocks = Array.from(
      code.matchAll(/class\s+(\w+)\(BaseModel\):([\s\S]*?)(?=\nclass\s+\w+|\n*$)/g),
    );
    if (modelBlocks.length > 0) {
      const cardsHtml = modelBlocks
        .map((match) => {
          const modelName = match[1];
          const body = match[2];
          const rows: Array<{ name: string; type: string; desc: string }> = [];

          for (const line of body.split(/\r?\n/)) {
            const t = line.trim();
            if (!t || t.startsWith('#') || t.startsWith('@') || t.startsWith('def ')) continue;
            const fMatch = t.match(/^([a-zA-Z_]\w*)\s*:\s*([^=]+?)(?:\s*=\s*Field\((.*)\))?$/);
            if (fMatch) {
              const fName = fMatch[1];
              const fType = fMatch[2].trim();
              const fieldArgs = fMatch[3] || '';
              const descMatch = fieldArgs.match(/description=["']([^"']+)["']/);
              const minMatch = fieldArgs.match(/min_length=(\d+)/);
              let desc = descMatch ? descMatch[1] : 'Pydantic 强校验字段';
              if (minMatch) desc += ` (最小长度 ≥ ${minMatch[1]})`;
              rows.push({ name: fName, type: fType, desc });
            }
          }

          if (rows.length === 0) return '';

          const rowsHtml = rows
            .map(
              (r) => `
              <tr class="hover:bg-slate-50/80 transition-colors">
                <td class="px-3.5 py-2 align-top whitespace-nowrap">
                  <code class="rounded-md bg-emerald-500/10 px-2 py-0.5 font-mono text-[12px] font-bold text-emerald-700">${escapeHtml(r.name)}</code>
                </td>
                <td class="px-3.5 py-2 align-top whitespace-nowrap">
                  <span class="rounded-md border border-amber-200 bg-amber-50/80 px-2 py-0.5 font-mono text-[11.5px] font-semibold text-amber-800">${escapeHtml(r.type)}</span>
                </td>
                <td class="px-3.5 py-2 text-[12.5px] text-slate-700">${escapeHtml(r.desc)}</td>
              </tr>`,
            )
            .join('');

          return `
            <div class="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-2xs">
              <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/80 bg-gradient-to-r from-emerald-500/[0.08] via-teal-50/40 to-white px-4 py-2.5">
                <div class="flex items-center gap-2">
                  <span class="flex h-6 w-6 items-center justify-center rounded-lg bg-emerald-600 text-[11px] font-bold text-white">PY</span>
                  <span class="font-mono text-[13.5px] font-bold text-slate-900">${escapeHtml(modelName)}(BaseModel)</span>
                  <span class="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10.5px] font-semibold text-emerald-700">Pydantic v2 服务端校验模型</span>
                </div>
                <span class="text-[11px] text-slate-500">共 ${rows.length} 个校验字段</span>
              </div>
              <div class="overflow-x-auto">
                <table class="w-full text-left border-collapse text-[12.5px]">
                  <thead class="bg-slate-50/90 border-b border-slate-200/70 text-slate-500">
                    <tr>
                      <th class="px-3.5 py-2 font-semibold w-[220px]">属性名 (Attribute)</th>
                      <th class="px-3.5 py-2 font-semibold w-[200px]">Python 类型注解</th>
                      <th class="px-3.5 py-2 font-semibold">校验约束与默认值规则</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-slate-100">${rowsHtml}</tbody>
                </table>
              </div>
            </div>`;
        })
        .filter(Boolean)
        .join('<div class="h-3"></div>');

      if (cardsHtml) {
        return `<div class="not-prose my-5 space-y-3">
          ${cardsHtml}
          <details class="group rounded-xl border border-slate-200/80 bg-slate-50/70 px-3.5 py-2 text-xs text-slate-600">
            <summary class="flex cursor-pointer items-center justify-between font-medium text-slate-700 hover:text-emerald-600 select-none">
              <span>🐍 展开查看 Python Pydantic 校验器完整源码</span>
              <span class="text-[11px] text-slate-400 group-open:rotate-180 transition-transform">▼</span>
            </summary>
            <div class="mt-2">${renderIdeCodeWindow(code, lang)}</div>
          </details>
        </div>`;
      }
    }
  }

  return null;
}

/**
 * 行内富文本解析（支持代码、链接、粗体、单星号概念高亮、删除线、时间戳药丸）
 */
export function parseInline(text: string): string {
  if (!text) return '';

  // 1. 先保护行内代码 `code`，避免代码内部符号被当成星号或时间戳解析
  const codeTokens: string[] = [];
  let working = String(text).replace(/`([^`]+)`/g, (_m, inner: string) => {
    const idx = codeTokens.length;
    codeTokens.push(
      `<code class="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[12.5px] font-medium text-[#0071e3]">${escapeHtml(inner)}</code>`,
    );
    return `@@INLINE_CODE_${idx}@@`;
  });

  // 2. HTML 基础转义
  let s = escapeHtml(working);

  // 3. 时间戳引用 [mm:ss] 或 [mm:ss-mm:ss] 或 [hh:mm:ss] -> 可点击跳转药丸
  s = s.replace(
    /\[(\d{1,2}:\d{2}(?::\d{2})?)(?:\s*[-~～—]\s*(\d{1,2}:\d{2}(?::\d{2})?))?\]/g,
    (_match, startStr: string, endStr?: string) => {
      const parts = startStr.split(':').map(Number);
      const sec =
        parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1];
      const label = endStr ? `${startStr}-${endStr}` : startStr;
      return `<button type="button" class="timestamp-pill" data-seek-seconds="${sec}" title="点击跳转至视频 ${startStr}">▶ ${label}</button>`;
    },
  );

  // 4. Markdown 链接 [text](https://...)
  s = s.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer" class="font-medium text-[#0071e3] underline decoration-[#0071e3]/40 underline-offset-2 hover:decoration-[#0071e3]">$1</a>',
  );

  // 5. 粗斜体 ***text***
  s = s.replace(
    /\*\*\*([^*]+?)\*\*\*/g,
    '<strong class="font-bold text-slate-900 underline decoration-[#0071e3]/40 underline-offset-4">$1</strong>',
  );

  // 6. 粗体 **text** 或 __text__（完美兼容中英文引号紧贴）
  s = s.replace(/\*\*([\s\S]+?)\*\*/g, '<strong class="font-semibold text-slate-900">$1</strong>');
  s = s.replace(/__([^_]+?)__/g, '<strong class="font-semibold text-slate-900">$1</strong>');

  // 7. 单星号 *text*（中文大模型常用于 *话术示范*、*免打扰*、*背锅与担当* 等核心概念强调）
  s = s.replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, (_m, prefix: string, inner: string) => {
    const trimmedInner = inner.trim();
    if (!trimmedInner) return _m;
    // 若是「话术示范」「案例示范」「核心公式」「避坑指南」等引导标签，渲染为精致胶囊徽章
    if (/^(话术示范|案例示范|反面示范|标准话术|核心公式|关键动作|避坑指南|底层逻辑|破局点)$/.test(trimmedInner)) {
      return `${prefix}<span class="mr-1 inline-flex items-center rounded-md bg-[#0071e3]/12 px-2 py-0.5 text-[12px] font-bold text-[#0071e3]">💬 ${trimmedInner}</span>`;
    }
    // 普通单星号重点概念：渲染为柔和荧光重点词（比斜体在中文下清晰得多）
    return `${prefix}<span class="rounded bg-amber-500/10 px-1 py-0.5 font-medium text-slate-900 decoration-amber-500/50">${trimmedInner}</span>`;
  });

  // 8. 删除线 ~~text~~
  s = s.replace(/~~([^~]+?)~~/g, '<del class="text-slate-400 line-through">$1</del>');

  // 9. 还原行内代码
  s = s.replace(/@@INLINE_CODE_(\d+)@@/g, (_m, idxStr: string) => codeTokens[Number(idxStr)] || '');

  return s;
}

export function renderMarkdown(md: string): string {
  if (!md || typeof md !== 'string') return '';

  const healed = healStreamingMarkdown(md);

  // 1. 提取并保护所有围栏块 ```...``` 与原生 <svg> / HTML 信息图块
  const rawBlocks: string[] = [];

  // 1a. 深度平衡提取所有 <div class="not-prose ..."> 顶级卡片外壳，保护内部任意层级嵌套的 <div> 与 <svg>
  let cursor = 0;
  let depthProtected = '';
  const notProseRegex = /<div\b[^>]*class=["'][^"']*\bnot-prose\b[^"']*["']/gi;
  let npMatch: RegExpExecArray | null;
  while ((npMatch = notProseRegex.exec(healed)) !== null) {
    depthProtected += healed.slice(cursor, npMatch.index);
    const startIdx = npMatch.index;
    let depth = 0;
    let idxCursor = startIdx;
    while (idxCursor < healed.length) {
      if (healed.startsWith('<div', idxCursor)) {
        depth++;
        idxCursor += 4;
      } else if (healed.startsWith('</div>', idxCursor)) {
        depth--;
        idxCursor += 6;
        if (depth === 0) {
          const fullBlock = healed.slice(startIdx, idxCursor);
          const blockIdx = rawBlocks.length;
          rawBlocks.push(`<div class="my-4 overflow-x-auto">${fullBlock}</div>`);
          depthProtected += `\n@@RAW_BLOCK_${blockIdx}@@\n`;
          cursor = idxCursor;
          notProseRegex.lastIndex = idxCursor;
          break;
        }
      } else {
        idxCursor++;
      }
    }
    if (depth !== 0) {
      // 未闭合兜底
      depthProtected += healed.slice(startIdx);
      cursor = healed.length;
      break;
    }
  }
  depthProtected += healed.slice(cursor);

  const textWithPlaceholders = depthProtected
    .replace(/```([a-zA-Z0-9_-]*)[ \t]*\r?\n?([\s\S]*?)```/g, (_m, lang: string, inner: string) => {
      const trimmed = inner.trim();
      const lowerLang = (lang || '').toLowerCase();

      // (a) 原生 SVG / HTML 图表块
      if (
        (lowerLang === 'html' || lowerLang === 'svg' || lowerLang === 'xml' || !lowerLang) &&
        (trimmed.startsWith('<svg') || trimmed.startsWith('<div'))
      ) {
        const idx = rawBlocks.length;
        rawBlocks.push(`<div class="my-4 overflow-x-auto">${trimmed}</div>`);
        return `\n@@RAW_BLOCK_${idx}@@\n`;
      }

      // (b) Mermaid 流程图 / 时序图 / ER 图代码块 -> 渲染为可视化图表容器 + 源码折叠抽屉
      if (lowerLang === 'mermaid') {
        const idx = rawBlocks.length;
        const encodedMermaid = encodeURIComponent(trimmed);
        rawBlocks.push(`
          <div class="not-prose my-5 overflow-hidden rounded-2xl border border-slate-200/90 bg-white p-4 shadow-xs">
            <div class="mb-3 flex items-center justify-between border-b border-slate-100 pb-2">
              <div class="flex items-center gap-2">
                <span class="inline-block h-2 w-2 rounded-full bg-[#0071e3]"></span>
                <span class="text-xs font-bold uppercase tracking-wider text-slate-700">架构与流程拓扑图 (Mermaid Diagram)</span>
              </div>
              <span class="rounded-full bg-[#0071e3]/10 px-2 py-0.5 text-[10.5px] font-semibold text-[#0071e3]">Interactive SVG</span>
            </div>
            <div class="mermaid-render-slot flex justify-center overflow-x-auto py-2" data-mermaid-source="${encodedMermaid}">
              <pre class="text-xs text-slate-400 font-mono">正在渲染架构图...</pre>
            </div>
          </div>
        `);
        return `\n@@RAW_BLOCK_${idx}@@\n`;
      }

      // (c) 智能检测是否为「阶段一 -> 阶段二 -> 阶段三」递进流程图框
      const flowHtml = tryRenderFlowFence(trimmed);
      if (flowHtml) {
        const idx = rawBlocks.length;
        rawBlocks.push(flowHtml);
        return `\n@@RAW_BLOCK_${idx}@@\n`;
      }

      // (d) 智能检测是否为 TypeScript interface / Python Pydantic BaseModel 数据契约，升维渲染为可视化契约表 + 折叠源码
      const schemaCardHtml = tryRenderDataContractCard(trimmed, lowerLang);
      if (schemaCardHtml) {
        const idx = rawBlocks.length;
        rawBlocks.push(schemaCardHtml);
        return `\n@@RAW_BLOCK_${idx}@@\n`;
      }

      // (e) 编程语言 / 配置文件代码块 -> 渲染为 macOS 深色 IDE 语法高亮窗口（带红黄绿灯 + 一键复制）
      if (lowerLang) {
        const idx = rawBlocks.length;
        rawBlocks.push(renderIdeCodeWindow(trimmed, lowerLang));
        return `\n@@RAW_BLOCK_${idx}@@\n`;
      }

      // (f) 无语言标识的研报框架总结框：渲染为精致浅色圆角卡片
      const idx = rawBlocks.length;
      rawBlocks.push(
        `<div class="my-3.5 overflow-x-auto rounded-2xl border border-slate-200/80 bg-slate-50/90 px-4 py-3 text-[13px] leading-relaxed text-slate-800 shadow-2xs"><pre class="whitespace-pre-wrap font-sans">${parseInline(trimmed)}</pre></div>`,
      );
      return `\n@@RAW_BLOCK_${idx}@@\n`;
    })
    .replace(
      /(<div\s+class="my-4[\s\S]*?<\/svg>\s*<\/div>|<svg[\s\S]*?<\/svg>|<details[\s\S]*?<\/details>)/gi,
      (match) => {
        const idx = rawBlocks.length;
        rawBlocks.push(`<div class="my-4 overflow-x-auto">${match}</div>`);
        return `\n@@RAW_BLOCK_${idx}@@\n`;
      },
    );

  const lines = textWithPlaceholders.split(/\r?\n/);
  const html: string[] = [];
  let inList = false;
  let inOrderedList = false;
  let inTable = false;
  let tableHeaderDone = false;

  const closeList = () => {
    if (inList) {
      html.push('</ul>');
      inList = false;
    }
    if (inOrderedList) {
      html.push('</ol>');
      inOrderedList = false;
    }
  };

  const closeTable = () => {
    if (inTable) {
      html.push('</tbody></table></div>');
      inTable = false;
      tableHeaderDone = false;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();
    const indent = raw.match(/^\s*/)?.[0].length ?? 0;

    if (!trimmed) {
      // 如果下一行仍然是列表项或缩进延续行，则不要急着关闭当前列表，保证列表连贯性
      let nextNonEmpty = '';
      let nextIndent = 0;
      for (let j = i + 1; j < lines.length; j++) {
        const nt = lines[j].trim();
        if (nt) {
          nextNonEmpty = nt;
          nextIndent = lines[j].match(/^\s*/)?.[0].length ?? 0;
          break;
        }
      }
      const nextIsListOrContinuation =
        /^[-*•]\s+/.test(nextNonEmpty) ||
        /^\d+\.\s+/.test(nextNonEmpty) ||
        nextIndent >= 2 ||
        /^(\*?话术示范\*?|话术示范|案例示范|示例)[:：]/.test(nextNonEmpty);

      if (!nextIsListOrContinuation) {
        closeList();
      }
      closeTable();
      continue;
    }

    // 忽略残留的孤立 ``` 行
    if (/^`{3,}\s*$/.test(trimmed)) {
      continue;
    }

    // 还原受保护的 SVG / 流程卡片 / 代码块
    const rawMatch = trimmed.match(/^@@RAW_BLOCK_(\d+)@@$/);
    if (rawMatch) {
      closeList();
      closeTable();
      const idx = Number(rawMatch[1]);
      if (rawBlocks[idx]) {
        html.push(rawBlocks[idx]);
      }
      continue;
    }

    // 水平分割线 --- / *** / ___
    if (/^(?:[-*_]\s*){3,}$/.test(trimmed)) {
      closeList();
      closeTable();
      html.push('<hr class="my-5 border-t border-slate-200/80" />');
      continue;
    }

    // Markdown 表格行 | col1 | col2 |
    if (trimmed.startsWith('|') && trimmed.endsWith('|') && trimmed.split('|').length > 2) {
      closeList();
      if (/^\|[\s\-:|]+\|$/.test(trimmed)) {
        continue;
      }
      const cells = trimmed
        .slice(1, -1)
        .split('|')
        .map((c) => c.trim());

      if (!inTable) {
        inTable = true;
        tableHeaderDone = false;
        html.push(
          '<div class="my-3.5 overflow-x-auto rounded-2xl border border-slate-200/80 shadow-2xs sm:my-4"><table class="w-full text-left border-collapse text-[12px] sm:text-[12.5px]">',
        );
      }

      if (!tableHeaderDone) {
        html.push('<thead class="bg-slate-100/90 border-b border-slate-200/80"><tr>');
        cells.forEach((cell, colIdx) => {
          const plainLen = cell.replace(/\*\*/g, '').trim().length;
          const colClass =
            colIdx === 0 && plainLen <= 12
              ? 'whitespace-nowrap w-[1%] bg-slate-100/95'
              : 'min-w-[118px] sm:min-w-[150px]';
          html.push(
            `<th class="px-2.5 py-2 font-semibold text-slate-900 sm:px-3.5 sm:py-2.5 ${colClass}">${parseInline(cell)}</th>`,
          );
        });
        html.push('</tr></thead><tbody class="divide-y divide-slate-100 bg-white">');
        tableHeaderDone = true;
      } else {
        html.push('<tr class="hover:bg-slate-50/80 transition-colors">');
        cells.forEach((cell, colIdx) => {
          const plainLen = cell.replace(/\*\*/g, '').trim().length;
          const colClass =
            colIdx === 0 && plainLen <= 12
              ? 'whitespace-nowrap font-semibold text-slate-900 bg-slate-50/50'
              : 'min-w-[118px] sm:min-w-[150px] text-slate-700';
          html.push(
            `<td class="px-2.5 py-2 leading-snug align-top sm:px-3.5 sm:py-2.5 sm:leading-relaxed ${colClass}">${parseInline(cell)}</td>`,
          );
        });
        html.push('</tr>');
      }
      continue;
    } else {
      closeTable();
    }

    const toAnchorId = (rawTitle: string) =>
      rawTitle
        .replace(/\*\*/g, '')
        .toLowerCase()
        .replace(/[^\w\u4e00-\u9fa5]+/g, '-')
        .replace(/^-|-$/g, '');

    // 一级标题 #
    if (trimmed.startsWith('# ')) {
      closeList();
      const rawTitle = trimmed.slice(2).trim();
      const title = parseInline(rawTitle);
      const id = toAnchorId(rawTitle);
      html.push(
        `<h1 id="${id}" class="mt-4 mb-2 text-[17px] leading-snug font-bold tracking-tight text-slate-900 scroll-mt-20 sm:mt-6 sm:mb-3 sm:text-[20px]">${title}</h1>`,
      );
      continue;
    }

    // 二级标题 ##
    if (trimmed.startsWith('## ')) {
      closeList();
      const rawTitle = trimmed.slice(3).trim();
      const title = parseInline(rawTitle);
      const id = toAnchorId(rawTitle);
      html.push(
        `<h2 id="${id}" class="mt-4 mb-2 flex items-center gap-2 text-[14.5px] leading-snug font-bold tracking-tight text-slate-900 border-b border-slate-200/70 pb-1.5 scroll-mt-20 sm:mt-6 sm:mb-3 sm:text-[16px] sm:pb-2"><span class="inline-block h-3.5 w-1 shrink-0 rounded-full bg-[#0071e3] sm:h-4"></span><span>${title}</span></h2>`,
      );
      continue;
    }

    // 三级标题 ###
    if (trimmed.startsWith('### ')) {
      closeList();
      const rawTitle = trimmed.slice(4).trim();
      const title = parseInline(rawTitle);
      const id = toAnchorId(rawTitle);
      html.push(
        `<h3 id="${id}" class="mt-3 mb-1.5 text-[13.5px] font-bold text-slate-900 scroll-mt-20 sm:mt-4 sm:mb-2 sm:text-[14.5px]">${title}</h3>`,
      );
      continue;
    }

    // 四级与五级标题 #### / #####
    if (/^#{4,6}\s+/.test(trimmed)) {
      closeList();
      const title = parseInline(trimmed.replace(/^#{4,6}\s+/, '').trim());
      html.push(`<h5 class="mt-3 mb-1.5 text-[13.5px] font-semibold text-slate-800">${title}</h5>`);
      continue;
    }

    // 引用块 >
    if (trimmed.startsWith('>')) {
      const quote = parseInline(trimmed.replace(/^>\s*/, ''));
      const quoteBox = `<blockquote class="my-2.5 rounded-r-xl border-l-4 border-[#0071e3]/70 bg-[#0071e3]/[0.05] px-3.5 py-2.5 text-[13px] leading-relaxed text-slate-800">${quote}</blockquote>`;
      if (inList || inOrderedList) {
        html.push(`<li class="list-none -ml-2">${quoteBox}</li>`);
      } else {
        html.push(quoteBox);
      }
      continue;
    }

    // 无序列表 - 或 * 或 •
    if (/^[-*•]\s+/.test(trimmed)) {
      const itemContent = parseInline(trimmed.replace(/^[-*•]\s+/, ''));
      // 若当前在有序列表中且此行有缩进，作为有序列表下的子项展示，不打断外层有序列表
      if (inOrderedList && indent >= 2) {
        html.push(
          `<li class="ml-4 list-disc text-[13.5px] leading-relaxed text-slate-700 marker:text-[#0071e3]/70">${itemContent}</li>`,
        );
        continue;
      }
      if (inOrderedList) {
        html.push('</ol>');
        inOrderedList = false;
      }
      if (!inList) {
        html.push('<ul class="my-2.5 space-y-2 pl-5 list-disc marker:text-[#0071e3]">');
        inList = true;
      }
      const subClass = indent >= 2 ? 'ml-4 list-[circle]' : '';
      html.push(`<li class="${subClass} text-[13.5px] leading-relaxed text-slate-800">${itemContent}</li>`);
      continue;
    }

    // 有序列表 1. 2.
    if (/^\d+\.\s+/.test(trimmed)) {
      const numMatch = trimmed.match(/^(\d+)\.\s+(.*)$/);
      const itemNum = numMatch ? Number(numMatch[1]) : 1;
      const itemContent = parseInline(numMatch ? numMatch[2] : trimmed.replace(/^\d+\.\s+/, ''));

      // 若大模型用「1. 节点一：xxx」作为章节小标题（下一行是无序列表而非紧跟 2.），渲染为醒目的小节标题
      if (inList) {
        html.push('</ul>');
        inList = false;
      }
      if (!inOrderedList) {
        html.push(
          `<ol start="${itemNum}" class="my-2.5 space-y-2 pl-5 list-decimal marker:text-[#0071e3] marker:font-semibold">`,
        );
        inOrderedList = true;
      }
      html.push(
        `<li value="${itemNum}" class="text-[13.5px] font-medium leading-relaxed text-slate-900"><span class="font-normal text-slate-800">${itemContent}</span></li>`,
      );
      continue;
    }

    // 列表内部的缩进延续段落 或 「*话术示范*：...」微卡片
    const isScriptDemo = /^(\*{1,2}话术示范\*{1,2}|话术示范|案例示范|反面示范|标准话术|示例)[:：]/.test(trimmed);
    if ((inList || inOrderedList) && (indent >= 2 || isScriptDemo)) {
      if (isScriptDemo) {
        html.push(
          `<li class="list-none my-1.5 rounded-xl border border-[#0071e3]/20 bg-[#0071e3]/[0.04] px-3.5 py-2.5 text-[13px] leading-relaxed text-slate-800 shadow-2xs">${parseInline(trimmed)}</li>`,
        );
      } else {
        html.push(
          `<li class="list-none my-1 text-[13px] leading-relaxed text-slate-600">${parseInline(trimmed)}</li>`,
        );
      }
      continue;
    }

    // 独立段落的「话术示范 / 案例示范」也自动渲染为精致微卡片
    if (isScriptDemo) {
      closeList();
      html.push(
        `<div class="my-2.5 rounded-xl border border-[#0071e3]/20 bg-[#0071e3]/[0.04] px-3.5 py-2.5 text-[13px] leading-relaxed text-slate-800 shadow-2xs">${parseInline(trimmed)}</div>`,
      );
      continue;
    }

    // 普通段落
    closeList();
    html.push(`<p class="my-2.5 text-[13.5px] leading-relaxed text-slate-800">${parseInline(trimmed)}</p>`);
  }

  closeList();
  closeTable();
  return html.join('\n');
}

/**
 * 专门用于 AI 聊天窗口的轻量级 Markdown 渲染器（紧凑间距，支持时间戳点击跳转）
 */
export function renderChatMarkdown(md: string): string {
  if (!md || typeof md !== 'string') return '';
  return renderMarkdown(md);
}

export interface MarkdownHeading {
  level: number;
  title: string;
  id: string;
}

/**
 * 从 Markdown 文本中提取多级大纲目录（H1, H2, H3）
 * 用于文档中心右侧 On-this-page 导航
 */
export function extractHeadings(md: string): MarkdownHeading[] {
  if (!md) return [];
  const headings: MarkdownHeading[] = [];
  const lines = String(md).split(/\r?\n/);
  let inFence = false;
  for (const line of lines) {
    if (/^`{3,}/.test(line.trim())) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = line.match(/^(#{1,3})\s+(.+)$/);
    if (match) {
      const level = match[1].length;
      const title = match[2].trim().replace(/\*\*/g, '');
      const id = title
        .toLowerCase()
        .replace(/[^\w\u4e00-\u9fa5]+/g, '-')
        .replace(/^-|-$/g, '');
      headings.push({ level, title, id });
    }
  }
  return headings;
}

