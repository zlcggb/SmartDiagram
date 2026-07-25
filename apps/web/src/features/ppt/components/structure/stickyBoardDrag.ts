export type HorizontalDropTarget = {
  id: string;
  left: number;
  right: number;
};

export type HorizontalDropHint = {
  targetId: string;
  place: "before" | "after";
};

/**
 * 将横向指针位置映射到最近的卡片间隙。
 * 拖拽源会被排除，因此中间空隙不会错误退化成“追加到行尾”。
 */
export function resolveHorizontalDropHint(
  clientX: number,
  targets: HorizontalDropTarget[],
  dragId: string
): HorizontalDropHint | null {
  const candidates = targets
    .filter((target) => target.id !== dragId)
    .sort((a, b) => a.left - b.left);

  if (candidates.length === 0) return null;

  for (const candidate of candidates) {
    const midpoint = candidate.left + (candidate.right - candidate.left) / 2;
    if (clientX < midpoint) {
      return { targetId: candidate.id, place: "before" };
    }
  }

  return { targetId: candidates[candidates.length - 1]!.id, place: "after" };
}
