import type { ExportMode, FactDto, PageRenderResult, ProjectDto, SlideDto, SvgPptExportMode } from "@ppt-agent/shared";

export type { PageRenderResult };

export interface RenderProjectPptxInput {
  project: ProjectDto;
  slides: SlideDto[];
  facts: FactDto[];
  theme?: string;
  /** 页级强调色预设 id；与 Studio 预览 accent 对齐 */
  accentId?: string | null;
  /** draft | standard | visual；缺省 standard */
  mode?: ExportMode;
  /** fidelity=整页保真 SVG；editable=原生可编辑对象 */
  svgExportMode?: SvgPptExportMode;
}

export interface RenderProjectPptxResult {
  outputPath: string;
  warnings: string[];
  pageResults: PageRenderResult[];
}
