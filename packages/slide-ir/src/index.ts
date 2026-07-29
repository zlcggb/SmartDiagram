export {
  SMARTSLIDE_HEIGHT,
  SMARTSLIDE_SCHEMA_VERSION,
  SMARTSLIDE_WIDTH,
  BoundsSchema,
  ChartElementSchema,
  ColorValueSchema,
  FillSchema,
  ImageElementSchema,
  LineElementSchema,
  PointSchema,
  ShapeElementSchema,
  SlideIrElementSchema,
  SlideIrSchema,
  StrokeSchema,
  TableElementSchema,
  TextElementSchema
} from "./schema.js";
export type {
  Bounds,
  ChartElement,
  ColorValue,
  Fill,
  ImageElement,
  LineElement,
  Point,
  ShapeElement,
  SlideIrDocument,
  SlideIrElement,
  Stroke,
  TableElement,
  TextElement
} from "./schema.js";
export { SlideIrTokenError, collectColorReferences, resolveColor } from "./tokens.js";
export {
  SmartSlideParseError,
  parseSmartSlide,
  stringifySmartSlide
} from "./language.js";
export {
  estimateTextElementHeight,
  validateSlideIr
} from "./validate.js";
export type {
  SlideIrIssue,
  SlideIrIssueSeverity,
  SlideIrValidationResult
} from "./validate.js";
export { renderSlideIrToSvg } from "./renderSvg.js";
export { compileSlideIrToPptx } from "./compilePptx.js";
export type {
  SlideIrPptxCompileResult,
  SlideIrPptxInstance,
  SlideIrPptxSlide
} from "./compilePptx.js";
export { slideIrJsonSchema } from "./jsonSchema.js";
