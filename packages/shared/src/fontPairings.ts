/**
 * 字体配对注册表。
 *
 * 从 kimi-slides.skill 的 24 套设计系统中提炼出 5 种跨平台安全的字体配对模式。
 * 所有字体均为 Windows + macOS 预装，确保 PPTX 导出后可正确显示。
 *
 * 设计原则：
 * - PPTX 不嵌入字体文件，只写入字体名称 → 必须用跨平台预装字体
 * - heading 与 body 字体有明确的角色区分（标题张力 vs 阅读舒适）
 * - 每种配对模式对应一种设计气质
 */

export interface FontPairing {
  /** 配对方案 ID */
  id: string;
  /** 显示名称 */
  label: string;
  /** 标题字体（标题、关键数字、模块标题） */
  heading: string;
  /** 正文字体（正文段落、表格、图表标签） */
  body: string;
  /** 等宽字体（代码、数据标签） */
  mono: string;
  /** SVG 渲染用的 heading font-family stack（含 fallback） */
  headingStack: string;
  /** SVG 渲染用的 body font-family stack（含 fallback） */
  bodyStack: string;
  /** 设计理由 */
  rationale: string;
}

/**
 * 5 套字体配对方案，覆盖 kimi-slides.skill 的全部设计模式。
 *
 * 模式 A - modern-sans：全 Sans，科技/产品/工程
 * 模式 B - editorial-serif：Serif 标题 + Sans 正文，咨询/金融
 * 模式 C - classic-report：Sans 标题 + Serif 正文，年报/白皮书
 * 模式 D - sharp-tech：紧凑 Sans，数据密集型
 * 模式 E - premium-contrast：全 Serif，品牌/杂志/人文
 */
export const fontPairings: Record<string, FontPairing> = {
  "modern-sans": {
    id: "modern-sans",
    label: "现代无衬线",
    heading: "Calibri",
    body: "Calibri",
    mono: "Consolas",
    headingStack: "Calibri, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif",
    bodyStack: "Calibri, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif",
    rationale: "全 Sans，简洁现代，适合科技/产品/工程"
  },
  "editorial-serif": {
    id: "editorial-serif",
    label: "编辑衬线",
    heading: "Georgia",
    body: "Calibri",
    mono: "Consolas",
    headingStack: "Georgia, 'Times New Roman', 'Songti SC', serif",
    bodyStack: "Calibri, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif",
    rationale: "Serif 标题带编辑庄重感，Sans 正文保持阅读性"
  },
  "classic-report": {
    id: "classic-report",
    label: "经典报告",
    heading: "Calibri",
    body: "Cambria",
    mono: "Consolas",
    headingStack: "Calibri, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif",
    bodyStack: "Cambria, Georgia, 'Songti SC', serif",
    rationale: "Sans 标题 + Serif 正文，年报/白皮书的经典搭配"
  },
  "sharp-tech": {
    id: "sharp-tech",
    label: "锐利科技",
    heading: "Tahoma",
    body: "Tahoma",
    mono: "Consolas",
    headingStack: "Tahoma, Verdana, 'PingFang SC', 'Microsoft YaHei', sans-serif",
    bodyStack: "Tahoma, Verdana, 'PingFang SC', 'Microsoft YaHei', sans-serif",
    rationale: "紧凑清晰的无衬线，适合数据密集型技术报告"
  },
  "premium-contrast": {
    id: "premium-contrast",
    label: "高端对比",
    heading: "Georgia",
    body: "Georgia",
    mono: "Courier New",
    headingStack: "Georgia, 'Times New Roman', 'Songti SC', serif",
    bodyStack: "Georgia, 'Times New Roman', 'Songti SC', serif",
    rationale: "全 Serif，杂志感和人文气质，适合品牌故事/专题"
  }
};

export const fontPairingList: FontPairing[] = Object.values(fontPairings);

/** 默认字体配对 ID */
export const defaultFontPairingId = "modern-sans";

/**
 * 根据 ID 获取字体配对方案。未知 ID 回落到 modern-sans。
 */
export function getFontPairing(id: string | null | undefined): FontPairing {
  if (id && id in fontPairings) return fontPairings[id]!;
  return fontPairings[defaultFontPairingId]!;
}
