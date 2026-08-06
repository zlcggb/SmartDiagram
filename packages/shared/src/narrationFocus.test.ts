import assert from "node:assert/strict";
import test from "node:test";
import {
  NarrationAlignmentSchema,
  NarrationFocusPlanSchema,
  SpeechScriptPlanSchema
} from "./index.js";

test("SpeechScriptPlan requires semantic targets without coordinates", () => {
  const plan = SpeechScriptPlanSchema.parse({
    scriptText: "核心结论是职责分离。",
    focusTargets: [{
      narrationText: "核心结论是职责分离。",
      anchors: ["职责分离"],
      targetTextIds: ["text-3"],
      mode: "text"
    }]
  });

  assert.equal(plan.focusTargets[0]?.targetTextIds[0], "text-3");
  assert.throws(() => SpeechScriptPlanSchema.parse({
    scriptText: "非法坐标",
    focusTargets: [{ narrationText: "非法坐标", anchors: ["非法"], targetTextIds: [], mode: "text", x: 0.2 }]
  }));
});

test("NarrationFocusPlan is versioned and tied to the prepared SVG", () => {
  const plan = NarrationFocusPlanSchema.parse({
    version: 1,
    svgHash: "a".repeat(64),
    targets: [{
      narrationText: "关注三层隔离机制。",
      anchors: ["三层隔离机制"],
      targetTextIds: ["text-8"],
      mode: "container"
    }]
  });

  assert.equal(plan.version, 1);
  assert.throws(() => NarrationFocusPlanSchema.parse({ ...plan, version: 2 }));
});

test("NarrationAlignment accepts measured audio cues and rejects gaps", () => {
  const alignment = NarrationAlignmentSchema.parse({
    version: 1,
    audioDurationMs: 5_000,
    source: "audio-silence",
    cues: [
      { startMs: 0, endMs: 2_400, text: "第一句。", focusTargetIndexes: [0] },
      { startMs: 2_400, endMs: 5_000, text: "第二句。", focusTargetIndexes: [1] }
    ]
  });

  assert.equal(alignment.cues.at(-1)?.endMs, 5_000);
  assert.throws(() => NarrationAlignmentSchema.parse({
    ...alignment,
    cues: [
      { startMs: 0, endMs: 2_000, text: "第一句。", focusTargetIndexes: [0] },
      { startMs: 2_100, endMs: 5_000, text: "第二句。", focusTargetIndexes: [1] }
    ]
  }));
});

test("transcript alignment carries an auditable coverage score", () => {
  const alignment = NarrationAlignmentSchema.parse({
    version: 1,
    audioDurationMs: 3_000,
    source: "transcript",
    quality: { coverage: 0.92, meanConfidence: 0.88 },
    cues: [{ startMs: 0, endMs: 3_000, text: "最终音频对齐。", focusTargetIndexes: [0] }]
  });

  assert.equal(alignment.quality?.coverage, 0.92);
  assert.throws(() => NarrationAlignmentSchema.parse({
    ...alignment,
    quality: undefined
  }));
});
