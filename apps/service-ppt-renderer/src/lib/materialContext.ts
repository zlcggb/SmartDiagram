import {
  ContextBundleSchema,
  FactEvidenceSchema,
  type ContextBlock,
  type ContextBundle,
  type ExtractedFactDraft,
  type ExtractFactsResult,
  type FactEvidence,
  type ProjectMaterialDto
} from "@ppt-agent/shared";
import type { KnowledgeGateway } from "./knowledgeGateway.js";

export interface MaterialContextChunk {
  chunkId: string;
  text: string;
  sourceLocation: string;
}

export interface MaterialContextSource {
  material: ProjectMaterialDto;
  chunks: MaterialContextChunk[];
}

type ChunkGateway = Pick<KnowledgeGateway, "getDocumentChunks">;

export function parseFactEvidenceJson(value: string | null | undefined): FactEvidence[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    const result = FactEvidenceSchema.array().safeParse(parsed);
    return result.success ? result.data : [];
  } catch {
    return [];
  }
}

export class MaterialsNotReadyError extends Error {
  readonly materials: ProjectMaterialDto[];

  constructor(materials: ProjectMaterialDto[]) {
    super("部分资料仍在处理或处理失败，请稍后重试");
    this.name = "MaterialsNotReadyError";
    this.materials = materials;
  }
}

export function assertMaterialsReady(materials: ProjectMaterialDto[]) {
  const unavailable = materials.filter((material) => material.status !== "ready");
  if (unavailable.length > 0) throw new MaterialsNotReadyError(unavailable);
}

export async function loadMaterialContextSources(input: {
  gateway: ChunkGateway;
  materials: ProjectMaterialDto[];
  projectId: string;
  requestHeaders: Headers | Record<string, string | string[] | undefined>;
}): Promise<MaterialContextSource[]> {
  assertMaterialsReady(input.materials);
  const sources: MaterialContextSource[] = [];

  for (const material of input.materials) {
    if (!material.documentId) {
      throw new MaterialsNotReadyError([
        { ...material, status: "failed", errorMessage: "资料缺少 Knowledge document 引用" }
      ]);
    }
    const chunks: MaterialContextChunk[] = [];
    let cursor = 0;
    const visited = new Set<number>();
    for (let pageIndex = 0; pageIndex < 10_000; pageIndex += 1) {
      if (visited.has(cursor)) throw new Error("资料 chunks 分页游标重复，已停止读取");
      visited.add(cursor);
      const page = await input.gateway.getDocumentChunks(material.documentId, {
        projectId: input.projectId,
        requestHeaders: input.requestHeaders,
        cursor,
        limit: 100
      });
      for (const chunk of page.chunks) {
        if (chunk.text.trim()) {
          chunks.push({
            chunkId: chunk.chunkId,
            text: chunk.text,
            sourceLocation: chunk.sourceLocator
          });
        }
      }
      if (!page.hasMore || page.nextCursor === null) break;
      cursor = page.nextCursor;
    }
    sources.push({ material, chunks });
  }
  return sources;
}

function compactText(value: string) {
  return value.replace(/\r\n/g, "\n").trim();
}

function sourceTextBlock(sourceText: { id: string; content: string }): ContextBlock | null {
  const text = compactText(sourceText.content);
  if (!text) return null;
  return {
    id: `source:${sourceText.id}`,
    text,
    evidence: {
      sourceTextId: sourceText.id,
      sourceLocation: "粘贴内容",
      quote: text
    }
  };
}

function materialBlock(source: MaterialContextSource, chunk: MaterialContextChunk): ContextBlock | null {
  const text = compactText(chunk.text);
  if (!text || !chunk.chunkId.trim()) return null;
  const sourceLocation = chunk.sourceLocation.trim() || source.material.filename;
  return {
    id: `chunk:${chunk.chunkId}`,
    text,
    evidence: {
      materialId: source.material.id,
      ...(source.material.documentId ? { documentId: source.material.documentId } : {}),
      chunkId: chunk.chunkId,
      sourceLocation,
      quote: text
    }
  };
}

export function buildContextBundle(input: {
  projectId: string;
  sourceText?: { id: string; content: string } | null;
  materials?: MaterialContextSource[];
}): ContextBundle {
  const blocks: ContextBlock[] = [];
  if (input.sourceText) {
    const block = sourceTextBlock(input.sourceText);
    if (block) blocks.push(block);
  }
  for (const source of input.materials ?? []) {
    for (const chunk of source.chunks) {
      const block = materialBlock(source, chunk);
      if (block) blocks.push(block);
    }
  }

  const seen = new Set<string>();
  return ContextBundleSchema.parse({
    version: "v1",
    projectId: input.projectId,
    blocks: blocks.filter((block) => {
      if (seen.has(block.id)) return false;
      seen.add(block.id);
      return true;
    })
  });
}

function serializeContextBlock(block: ContextBlock) {
  return `【证据块 ${block.id}｜${block.evidence.sourceLocation}】\n${block.text}`;
}

export function serializeContextBundle(bundle: ContextBundle) {
  return bundle.blocks.map(serializeContextBlock).join("\n\n");
}

function splitOversizedBlock(block: ContextBlock, maxChars: number): ContextBlock[] {
  if (serializeContextBlock(block).length <= maxChars) return [block];
  const emptyHeaderSize = serializeContextBlock({ ...block, text: "x" }).length - 1;
  const textBudget = Math.max(1, maxChars - emptyHeaderSize - 24);
  const parts: ContextBlock[] = [];
  for (let offset = 0, part = 1; offset < block.text.length; offset += textBudget, part += 1) {
    const text = block.text.slice(offset, offset + textBudget);
    parts.push({
      ...block,
      id: `${block.id}:part=${part}`,
      text,
      evidence: { ...block.evidence, quote: text }
    });
  }
  return parts;
}

export function partitionContextBundle(bundle: ContextBundle, maxChars = 48_000): ContextBundle[] {
  const budget = Math.max(80, Math.trunc(maxChars));
  const blocks = bundle.blocks.flatMap((block) => splitOversizedBlock(block, budget));
  const batches: ContextBundle[] = [];
  let current: ContextBlock[] = [];
  let currentSize = 0;

  for (const block of blocks) {
    const size = serializeContextBlock(block).length + (current.length > 0 ? 2 : 0);
    if (current.length > 0 && currentSize + size > budget) {
      batches.push({ version: "v1", projectId: bundle.projectId, blocks: current });
      current = [];
      currentSize = 0;
    }
    current.push(block);
    currentSize += size;
  }
  if (current.length > 0) {
    batches.push({ version: "v1", projectId: bundle.projectId, blocks: current });
  }
  return batches;
}

function normalizedQuote(value: string) {
  return value.replace(/\s+/g, "").trim();
}

function resolvedEvidence(block: ContextBlock, quote: string): FactEvidence {
  return {
    ...(block.evidence.materialId ? { materialId: block.evidence.materialId } : {}),
    ...(block.evidence.sourceTextId ? { sourceTextId: block.evidence.sourceTextId } : {}),
    ...(block.evidence.documentId ? { documentId: block.evidence.documentId } : {}),
    ...(block.evidence.chunkId ? { chunkId: block.evidence.chunkId } : {}),
    sourceLocation: block.evidence.sourceLocation,
    quote
  };
}

export function resolveDraftEvidence<T extends ExtractedFactDraft>(
  draft: T,
  bundle: ContextBundle
): T & { evidence: FactEvidence[] } {
  const location = draft.sourceLocation.trim();
  let matched = bundle.blocks.find((block) => block.id === location);

  if (!matched) {
    const quote = normalizedQuote(draft.sourceText);
    if (quote) {
      const matches = bundle.blocks.filter((block) => normalizedQuote(block.text).includes(quote));
      if (matches.length === 1) matched = matches[0];
    }
  }

  if (!matched) return { ...draft, evidence: [] };
  return {
    ...draft,
    sourceLocation: matched.evidence.sourceLocation,
    evidence: [resolvedEvidence(matched, draft.sourceText.trim() || draft.content)]
  };
}

function evidenceKey(evidence: FactEvidence) {
  return [
    evidence.materialId ?? "",
    evidence.sourceTextId ?? "",
    evidence.documentId ?? "",
    evidence.chunkId ?? "",
    evidence.sourceLocation,
    evidence.quote
  ].join("\u0000");
}

function mergeEvidence(left: FactEvidence[] = [], right: FactEvidence[] = []) {
  const seen = new Set<string>();
  return [...left, ...right].filter((evidence) => {
    const key = evidenceKey(evidence);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function extractResolvedFactsFromContext(input: {
  bundle: ContextBundle;
  maxChars?: number;
  extract: (serializedContext: string, batch: ContextBundle) => Promise<ExtractFactsResult>;
}): Promise<Array<ExtractedFactDraft & { evidence: FactEvidence[] }>> {
  const facts: Array<ExtractedFactDraft & { evidence: FactEvidence[] }> = [];
  for (const batch of partitionContextBundle(input.bundle, input.maxChars)) {
    const extraction = await input.extract(serializeContextBundle(batch), batch);
    const drafts = [
      ...extraction.facts,
      ...extraction.risks,
      ...extraction.uncertainties,
      ...extraction.nextSteps
    ];
    facts.push(...drafts.map((draft) => resolveDraftEvidence(draft, batch)));
  }

  const merged = new Map<string, ExtractedFactDraft & { evidence: FactEvidence[] }>();
  for (const fact of facts) {
    const key = `${fact.category}\u0000${normalizedQuote(fact.content)}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, fact);
      continue;
    }
    merged.set(key, {
      ...existing,
      confidence: Math.max(existing.confidence, fact.confidence),
      evidence: mergeEvidence(existing.evidence, fact.evidence)
    });
  }
  return [...merged.values()];
}
