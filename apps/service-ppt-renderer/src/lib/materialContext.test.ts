import assert from "node:assert/strict";
import test from "node:test";
import type { ExtractedFactDraft, ProjectMaterialDto } from "@ppt-agent/shared";
import {
  MaterialsNotReadyError,
  assertMaterialsReady,
  buildContextBundle,
  extractResolvedFactsFromContext,
  loadMaterialContextSources,
  partitionContextBundle,
  parseFactEvidenceJson,
  resolveDraftEvidence,
  serializeContextBundle
} from "./materialContext.js";

const baseDraft: ExtractedFactDraft = {
  category: "项目进展",
  content: "项目已完成联调",
  status: "confirmed",
  confidence: 0.9,
  sourceText: "项目已完成联调",
  sourceLocation: "chunk:chunk-2",
  canUseInPpt: true
};

function material(overrides: Partial<ProjectMaterialDto> = {}): ProjectMaterialDto {
  return {
    id: "material-1",
    projectId: "project-1",
    filename: "周报.pptx",
    mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    sizeBytes: 1024,
    routeMode: "auto",
    status: "ready",
    documentId: "document-1",
    sourceId: "source-1",
    jobId: "job-1",
    ...overrides
  };
}

test("SourceText 与多个资料 chunks 构成稳定且可序列化的 ContextBundle", () => {
  const bundle = buildContextBundle({
    projectId: "project-1",
    sourceText: { id: "source-text-1", content: "用户粘贴的补充说明" },
    materials: [
      {
        material: material(),
        chunks: [
          { chunkId: "chunk-1", text: "第一页给出项目背景", sourceLocation: "pptx:slide=1" },
          { chunkId: "chunk-2", text: "项目已完成联调", sourceLocation: "pptx:slide=4" }
        ]
      }
    ]
  });

  assert.deepEqual(bundle.blocks.map((block) => block.id), [
    "source:source-text-1",
    "chunk:chunk-1",
    "chunk:chunk-2"
  ]);
  const serialized = serializeContextBundle(bundle);
  assert.match(serialized, /【证据块 source:source-text-1｜粘贴内容】/);
  assert.match(serialized, /【证据块 chunk:chunk-2｜pptx:slide=4】\n项目已完成联调/);
});

test("按字符预算分批时保留所有后续 chunk，单个超长块也不会丢失", () => {
  const bundle = buildContextBundle({
    projectId: "project-1",
    materials: [
      {
        material: material(),
        chunks: [
          { chunkId: "chunk-1", text: "A".repeat(90), sourceLocation: "text:lines=1-10" },
          { chunkId: "chunk-2", text: "B".repeat(90), sourceLocation: "text:lines=11-20" },
          { chunkId: "chunk-3", text: "C".repeat(260), sourceLocation: "text:lines=21-30" }
        ]
      }
    ]
  });

  const batches = partitionContextBundle(bundle, 180);
  const combined = batches.flatMap((batch) => batch.blocks);
  const combinedText = combined.map((block) => block.text).join("");

  assert.ok(batches.length > 2);
  assert.match(combinedText, /A{90}/);
  assert.match(combinedText, /B{90}/);
  assert.equal((combinedText.match(/C/g) ?? []).length, 260);
  assert.ok(combined.some((block) => block.id.startsWith("chunk:chunk-3:part=")));
});

test("事实位置精确匹配 block ID 时生成确定性证据并恢复人类定位符", () => {
  const bundle = buildContextBundle({
    projectId: "project-1",
    materials: [
      {
        material: material(),
        chunks: [
          { chunkId: "chunk-2", text: "项目已完成联调，并通过客户验收。", sourceLocation: "pptx:slide=4" }
        ]
      }
    ]
  });

  const resolved = resolveDraftEvidence(baseDraft, bundle);

  assert.equal(resolved.sourceLocation, "pptx:slide=4");
  assert.deepEqual(resolved.evidence, [
    {
      materialId: "material-1",
      documentId: "document-1",
      chunkId: "chunk-2",
      sourceLocation: "pptx:slide=4",
      quote: "项目已完成联调"
    }
  ]);
});

test("block ID 缺失时只允许用原文做唯一匹配", () => {
  const uniqueBundle = buildContextBundle({
    projectId: "project-1",
    materials: [
      {
        material: material(),
        chunks: [
          { chunkId: "chunk-1", text: "只有这里写了预算增长 12%。", sourceLocation: "pdf:page=1" },
          { chunkId: "chunk-2", text: "第二页没有对应内容。", sourceLocation: "pdf:page=2" }
        ]
      }
    ]
  });
  const draft = { ...baseDraft, sourceText: "预算增长 12%", sourceLocation: "模型自由描述" };

  const unique = resolveDraftEvidence(draft, uniqueBundle);

  assert.equal(unique.evidence?.[0]?.chunkId, "chunk-1");
  assert.equal(unique.sourceLocation, "pdf:page=1");

  const ambiguousBundle = buildContextBundle({
    projectId: "project-1",
    materials: [
      {
        material: material(),
        chunks: [
          { chunkId: "chunk-a", text: "预算增长 12%", sourceLocation: "pdf:page=1" },
          { chunkId: "chunk-b", text: "预算增长 12%", sourceLocation: "pdf:page=2" }
        ]
      }
    ]
  });
  const ambiguous = resolveDraftEvidence(draft, ambiguousBundle);
  assert.deepEqual(ambiguous.evidence, []);
  assert.equal(ambiguous.sourceLocation, "模型自由描述");
});

test("资料仍在处理或失败时明确阻断事实提取", () => {
  const pending = material({ status: "processing" });
  const failed = material({ id: "material-2", status: "failed", errorMessage: "文件损坏" });

  assert.throws(
    () => assertMaterialsReady([pending, failed]),
    (error: unknown) => {
      assert.ok(error instanceof MaterialsNotReadyError);
      assert.deepEqual(error.materials.map((item) => item.id), ["material-1", "material-2"]);
      return true;
    }
  );
});

test("分页读取整份文档 chunks，不会只取第一页或 top-k", async () => {
  const cursors: number[] = [];
  const gateway = {
    getDocumentChunks: async (_documentId: string, input: { cursor?: number }) => {
      const cursor = input.cursor ?? 0;
      cursors.push(cursor);
      return cursor === 0
        ? {
            documentId: "document-1",
            status: "indexed",
            chunks: [
              {
                chunkId: "chunk-1",
                chunkIndex: 0,
                text: "第一页",
                summary: "",
                headingPath: "",
                sourceLocator: "pdf:page=1",
                tokenCount: 3,
                citation: {},
                metadata: {}
              }
            ],
            nextCursor: 100,
            hasMore: true
          }
        : {
            documentId: "document-1",
            status: "indexed",
            chunks: [
              {
                chunkId: "chunk-2",
                chunkIndex: 1,
                text: "最后一页的重要结论",
                summary: "",
                headingPath: "",
                sourceLocator: "pdf:page=20",
                tokenCount: 9,
                citation: {},
                metadata: {}
              }
            ],
            nextCursor: null,
            hasMore: false
          };
    }
  };

  const sources = await loadMaterialContextSources({
    gateway,
    materials: [material()],
    projectId: "project-1",
    requestHeaders: {}
  });

  assert.deepEqual(cursors, [0, 100]);
  assert.deepEqual(sources[0]?.chunks.map((chunk) => chunk.chunkId), ["chunk-1", "chunk-2"]);
  assert.equal(sources[0]?.chunks[1]?.text, "最后一页的重要结论");
});

test("多批事实扫描保留后续批次事实并绑定各自证据", async () => {
  const bundle = buildContextBundle({
    projectId: "project-1",
    materials: [
      {
        material: material(),
        chunks: [
          { chunkId: "chunk-1", text: "A".repeat(160), sourceLocation: "pdf:page=1" },
          { chunkId: "chunk-2", text: `最后结论：项目收益提升 30%。${"B".repeat(160)}`, sourceLocation: "pdf:page=20" }
        ]
      }
    ]
  });
  let calls = 0;

  const facts = await extractResolvedFactsFromContext({
    bundle,
    maxChars: 220,
    extract: async (_text, batch) => {
      calls += 1;
      const lastBlock = batch.blocks.find((block) => block.text.includes("收益提升 30%"));
      return {
        facts: lastBlock
          ? [
              {
                ...baseDraft,
                content: "项目收益提升 30%",
                sourceText: "项目收益提升 30%",
                sourceLocation: lastBlock.id
              }
            ]
          : [],
        risks: [],
        uncertainties: [],
        nextSteps: []
      };
    }
  });

  assert.ok(calls > 1);
  assert.equal(facts.length, 1);
  assert.equal(facts[0]?.content, "项目收益提升 30%");
  assert.equal(facts[0]?.evidence?.[0]?.sourceLocation, "pdf:page=20");
});

test("持久化 evidence JSON 损坏时安全回退为空数组", () => {
  const valid = parseFactEvidenceJson(JSON.stringify([
    { documentId: "doc-1", chunkId: "chunk-1", sourceLocation: "pdf:page=1", quote: "原文" }
  ]));
  assert.equal(valid[0]?.chunkId, "chunk-1");
  assert.deepEqual(parseFactEvidenceJson("{broken"), []);
  assert.deepEqual(parseFactEvidenceJson(null), []);
});
