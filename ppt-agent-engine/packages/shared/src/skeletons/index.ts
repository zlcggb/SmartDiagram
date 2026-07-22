export type {
  SkeletonCanvas,
  SkeletonElement,
  SkeletonElementType,
  LayoutSkeletonFrame,
  SkeletonSlotValues
} from "./types.js";
export {
  getSkeletonFrame,
  listSkeletonFrames,
  hasSkeletonFrame,
  skeletonVariantIds
} from "./registry.js";
export {
  slotsFromSlide,
  fillSkeletonFrame,
  buildIrFromSkeleton,
  snapIrToSkeleton,
  formatSkeletonGeometryInstruction,
  type SlideLikeForSkeleton
} from "./fill.js";
