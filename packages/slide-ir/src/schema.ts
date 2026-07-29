import { z } from "zod";

export const SMARTSLIDE_SCHEMA_VERSION = "smartslide/1" as const;
export const SMARTSLIDE_WIDTH = 1280 as const;
export const SMARTSLIDE_HEIGHT = 720 as const;

export const ColorValueSchema = z
  .string()
  .regex(/^(?:#[0-9a-f]{6}|\$[a-z][\w-]*)$/i, "颜色必须是 #RRGGBB 或 $token");

export const BoundsSchema = z.tuple([
  z.number().finite(),
  z.number().finite(),
  z.number().finite().positive(),
  z.number().finite().positive()
]);

export const PointSchema = z.tuple([z.number().finite(), z.number().finite()]);

export const FillSchema = z
  .object({
    color: ColorValueSchema,
    transparency: z.number().min(0).max(100).optional()
  })
  .strict();

export const StrokeSchema = z
  .object({
    color: ColorValueSchema,
    width: z.number().positive().max(24),
    transparency: z.number().min(0).max(100).optional(),
    dash: z.enum(["solid", "dash", "dot"]).optional()
  })
  .strict();

const TextRunSchema = z
  .object({
    text: z.string().min(1).max(2_000),
    fontFamily: z.string().min(1).max(100).optional(),
    fontSize: z.number().min(8).max(120),
    fontWeight: z.number().int().min(100).max(900).optional(),
    color: ColorValueSchema,
    italic: z.boolean().optional(),
    underline: z.boolean().optional(),
    letterSpacing: z.number().min(-4).max(20).optional()
  })
  .strict();

const TextParagraphSchema = z
  .object({
    runs: z.array(TextRunSchema).min(1).max(30),
    align: z.enum(["left", "center", "right"]).optional(),
    lineHeight: z.number().min(0.8).max(3).optional(),
    spaceAfter: z.number().min(0).max(80).optional()
  })
  .strict();

const BaseElementShape = {
  id: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/i, "元素 id 只允许字母、数字、_、-"),
  name: z.string().min(1).max(100).optional(),
  opacity: z.number().min(0).max(1).optional(),
  rotation: z.number().min(-360).max(360).optional(),
  locked: z.boolean().optional()
};

export const TextElementSchema = z
  .object({
    ...BaseElementShape,
    type: z.literal("text"),
    bounds: BoundsSchema,
    paragraphs: z.array(TextParagraphSchema).min(1).max(20),
    verticalAlign: z.enum(["top", "middle", "bottom"]).optional(),
    autoFit: z.enum(["shrink", "clip"]).optional()
  })
  .strict();

export const ShapeElementSchema = z
  .object({
    ...BaseElementShape,
    type: z.literal("shape"),
    bounds: BoundsSchema,
    shape: z.enum(["rect", "roundRect", "ellipse"]),
    fill: FillSchema.optional(),
    stroke: StrokeSchema.optional(),
    radius: z.number().min(0).max(200).optional()
  })
  .strict();

export const LineElementSchema = z
  .object({
    ...BaseElementShape,
    type: z.literal("line"),
    points: z.array(PointSchema).min(2).max(16),
    stroke: StrokeSchema,
    markerStart: z.enum(["none", "arrow", "circle"]).optional(),
    markerEnd: z.enum(["none", "arrow", "circle"]).optional()
  })
  .strict();

export const ImageElementSchema = z
  .object({
    ...BaseElementShape,
    type: z.literal("image"),
    bounds: BoundsSchema,
    source: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("data"), value: z.string().startsWith("data:image/").max(2_000_000) }).strict(),
      z.object({ kind: z.literal("https"), value: z.string().url().startsWith("https://").max(2_048) }).strict(),
      z.object({ kind: z.literal("asset"), value: z.string().min(1).max(200) }).strict()
    ]),
    fit: z.enum(["contain", "cover", "stretch"]).optional(),
    alt: z.string().max(300).optional()
  })
  .strict();

const TableCellSchema = z
  .object({
    text: z.string().max(1_000),
    fill: FillSchema.optional(),
    color: ColorValueSchema.optional(),
    fontSize: z.number().min(8).max(48).optional(),
    fontWeight: z.number().int().min(100).max(900).optional(),
    align: z.enum(["left", "center", "right"]).optional()
  })
  .strict();

export const TableElementSchema = z
  .object({
    ...BaseElementShape,
    type: z.literal("table"),
    bounds: BoundsSchema,
    columns: z.array(z.number().positive()).min(1).max(12),
    rows: z.array(z.array(TableCellSchema).min(1).max(12)).min(1).max(30),
    border: StrokeSchema.optional(),
    rowGap: z.number().min(0).max(12).optional(),
    columnGap: z.number().min(0).max(12).optional()
  })
  .strict();

const ChartSeriesSchema = z
  .object({
    name: z.string().min(1).max(100),
    values: z.array(z.number().finite()).min(1).max(24),
    color: ColorValueSchema.optional()
  })
  .strict();

export const ChartElementSchema = z
  .object({
    ...BaseElementShape,
    type: z.literal("chart"),
    bounds: BoundsSchema,
    chartType: z.enum(["bar", "line", "pie", "doughnut"]),
    categories: z.array(z.string().max(100)).min(1).max(24),
    series: z.array(ChartSeriesSchema).min(1).max(8),
    showLegend: z.boolean().optional(),
    showValues: z.boolean().optional(),
    title: z.string().max(160).optional()
  })
  .strict();

export const SlideIrElementSchema = z.discriminatedUnion("type", [
  TextElementSchema,
  ShapeElementSchema,
  LineElementSchema,
  ImageElementSchema,
  TableElementSchema,
  ChartElementSchema
]);

export const SlideIrSchema = z
  .object({
    schema: z.literal(SMARTSLIDE_SCHEMA_VERSION),
    pageType: z.enum(["cover", "section", "content", "ending"]),
    canvas: z
      .object({
        width: z.literal(SMARTSLIDE_WIDTH),
        height: z.literal(SMARTSLIDE_HEIGHT)
      })
      .strict(),
    theme: z
      .object({
        tokens: z.record(
          z.string().regex(/^[a-z][\w-]*$/i),
          z.string().regex(/^#[0-9a-f]{6}$/i)
        ),
        fonts: z
          .object({
            heading: z.string().min(1).max(100).optional(),
            body: z.string().min(1).max(100).optional(),
            mono: z.string().min(1).max(100).optional()
          })
          .strict()
          .optional()
      })
      .strict(),
    background: z.object({ color: ColorValueSchema }).strict(),
    elements: z.array(SlideIrElementSchema).min(1).max(120),
    metadata: z
      .object({
        title: z.string().max(200).optional(),
        description: z.string().max(500).optional(),
        locale: z.string().max(32).optional()
      })
      .strict()
      .optional()
  })
  .strict();

export type ColorValue = z.infer<typeof ColorValueSchema>;
export type Bounds = z.infer<typeof BoundsSchema>;
export type Point = z.infer<typeof PointSchema>;
export type Fill = z.infer<typeof FillSchema>;
export type Stroke = z.infer<typeof StrokeSchema>;
export type TextElement = z.infer<typeof TextElementSchema>;
export type ShapeElement = z.infer<typeof ShapeElementSchema>;
export type LineElement = z.infer<typeof LineElementSchema>;
export type ImageElement = z.infer<typeof ImageElementSchema>;
export type TableElement = z.infer<typeof TableElementSchema>;
export type ChartElement = z.infer<typeof ChartElementSchema>;
export type SlideIrElement = z.infer<typeof SlideIrElementSchema>;
export type SlideIrDocument = z.infer<typeof SlideIrSchema>;

