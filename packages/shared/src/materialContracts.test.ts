import assert from "node:assert/strict";
import test from "node:test";
import {
  ContextBundleSchema,
  FactEvidenceSchema,
  MaterialRouteModeSchema,
  extractFactsRequestSchema
} from "./index.js";

test("资料契约只接受已声明的处理路由", () => {
  assert.equal(MaterialRouteModeSchema.parse("auto"), "auto");
  assert.equal(MaterialRouteModeSchema.parse("full-context"), "full-context");
  assert.throws(() => MaterialRouteModeSchema.parse("provider-magic"));
});

test("事实证据保留材料、文档、chunk 和稳定定位符", () => {
  const evidence = FactEvidenceSchema.parse({
    materialId: "material-1",
    documentId: "document-1",
    chunkId: "chunk-1",
    sourceLocation: "pptx:slide=4",
    quote: "第四页的可引用原文"
  });

  assert.equal(evidence.chunkId, "chunk-1");
  assert.equal(evidence.sourceLocation, "pptx:slide=4");
});

test("ContextBundle 要求每个证据块具有稳定 id 和非空文本", () => {
  const bundle = ContextBundleSchema.parse({
    version: "v1",
    projectId: "project-1",
    blocks: [
      {
        id: "chunk:chunk-1",
        text: "资料正文",
        evidence: {
          materialId: "material-1",
          documentId: "document-1",
          chunkId: "chunk-1",
          sourceLocation: "pdf:page=3",
          quote: "资料正文"
        }
      }
    ]
  });

  assert.equal(bundle.blocks[0]?.id, "chunk:chunk-1");
  assert.throws(() =>
    ContextBundleSchema.parse({ version: "v1", projectId: "project-1", blocks: [] })
  );
});

test("事实提取请求兼容旧 text，并允许显式选择材料", () => {
  assert.deepEqual(extractFactsRequestSchema.parse({ materialIds: ["m1", "m2"] }), {
    materialIds: ["m1", "m2"]
  });
  assert.deepEqual(extractFactsRequestSchema.parse({ text: "这是至少二十个字符的用户补充资料正文，用来兼容旧接口。" }), {
    text: "这是至少二十个字符的用户补充资料正文，用来兼容旧接口。"
  });
});
