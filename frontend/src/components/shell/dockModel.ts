export const DOCK_AUTO_HIDE_DELAY_MS = 7000;
export const DOCK_PEEK_HEIGHT_PX = 12;
export const DOCK_REVEAL_ZONE_HEIGHT_PX = 22;

export function dockScaleForItem(
  itemKey: string,
  hoveredItemKey: string | null,
  reduceMotion: boolean
): number {
  return !reduceMotion && itemKey === hoveredItemKey ? 1.25 : 1;
}
