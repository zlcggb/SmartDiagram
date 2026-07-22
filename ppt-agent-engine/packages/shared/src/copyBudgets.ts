/**
 * 文案生成软约束。结构数据始终保留完整原文，视觉层负责换行与缩放。
 */

export const copyBudgets = {
  /** 单字段异常输出上限仅用于提示与质量告警，不用于截断 */
  title: { maxChars: 300, hint: "标题完整清晰，单字段建议不超过 300 字" },
  keyMessage: { maxChars: 300, hint: "主结论表达完整，单字段建议不超过 300 字" },
  bullet: { maxChars: 300, hint: "每条要点表达完整，单字段建议不超过 300 字" },
  metric: { maxChars: 300, hint: "指标值优先使用短词或数字，建议不超过 300 字" },
  metricLabel: { maxChars: 300, hint: "指标名称完整清晰，建议不超过 300 字" },
  cardTitle: { maxChars: 300, hint: "卡片标题完整清晰，建议不超过 300 字" },
  /** 单页 contentPoints 条数 */
  bulletCount: { max: 5, hint: "每页要点不超过 5 条" },
  /** 每个 contentBlock.items 条数 */
  blockItemCount: { max: 3, hint: "每块最多 3 条" }
} as const;

export function formatCopyBudgetCatalog(): string {
  const b = copyBudgets;
  return [
    "- 所有字段必须保持语义和句子完整，禁止通过截断添加省略号",
    `- title：${b.title.hint}`,
    `- keyMessage：${b.keyMessage.hint}`,
    `- contentPoints：${b.bullet.hint}；总数 ≤${b.bulletCount.max}`,
    `- 指标 value / label：保持完整，单字段建议不超过 ${b.metric.maxChars} 字`,
    `- 卡片标题：${b.cardTitle.hint}；每块 items ≤${b.blockItemCount.max}`
  ].join("\n");
}

/** 兼容旧调用名：只归一化空白，不再修改或截断 AI 文案。 */
export function softTrimCopy(text: string, _maxChars: number): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Outline / Plan 归一化：保留完整文案，仅限制数组条目数量。 */
export function applyCopyBudgetsToSlideFields(input: {
  title?: string;
  keyMessage?: string;
  slideGoal?: string;
  contentPoints?: string[];
}): {
  title: string;
  keyMessage: string;
  slideGoal: string;
  contentPoints: string[];
} {
  const b = copyBudgets;
  return {
    title: softTrimCopy(input.title ?? "", b.title.maxChars),
    keyMessage: softTrimCopy(input.keyMessage ?? "", b.keyMessage.maxChars),
    slideGoal: softTrimCopy(input.slideGoal ?? "", b.keyMessage.maxChars),
    contentPoints: (input.contentPoints ?? [])
      .map((point) => softTrimCopy(point, b.bullet.maxChars))
      .filter(Boolean)
      .slice(0, b.bulletCount.max)
  };
}

export function applyCopyBudgetsToBlockItems(items: string[]): string[] {
  const b = copyBudgets;
  return items
    .map((item) => softTrimCopy(item, b.bullet.maxChars))
    .filter(Boolean)
    .slice(0, b.blockItemCount.max);
}
