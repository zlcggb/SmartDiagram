import type { DiagramEngineType, DiagramTaskType } from './diagram';

export type ArtifactEngineType = DiagramEngineType;
export type ArtifactTaskType = DiagramTaskType;

export const OFFICE_ARTIFACT_ENGINES = ['html_email', 'web_report_html'] as const;
export type OfficeArtifactEngineType = typeof OFFICE_ARTIFACT_ENGINES[number];

export function isOfficeArtifactEngine(engine: ArtifactEngineType | null | undefined): engine is OfficeArtifactEngineType {
  return engine === 'html_email' || engine === 'web_report_html';
}

