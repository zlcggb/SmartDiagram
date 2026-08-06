import assert from "node:assert/strict";
import test from "node:test";

interface AlignmentSegment {
  text: string;
  focusTargetIndexes: number[];
}

async function loadAudioAlignment() {
  return await import("./audioAlignment.js") as unknown as {
    buildNarrationAlignment(input: {
      audioDurationMs: number;
      segments: AlignmentSegment[];
      silences: Array<{ startMs: number; endMs: number }>;
      minimumSilenceMs?: number;
    }): {
      version: 1;
      audioDurationMs: number;
      source: "transcript" | "audio-silence" | "page";
      cues: Array<{
        startMs: number;
        endMs: number;
        text: string;
        focusTargetIndexes: number[];
      }>;
    };
    buildNarrationAlignmentFromTranscript(input: {
      audioDurationMs: number;
      segments: AlignmentSegment[];
      tokens: Array<{ text: string; startMs: number; endMs: number; confidence?: number }>;
      minimumCoverage?: number;
    }): {
      source: "transcript";
      quality?: { coverage: number; meanConfidence?: number };
      cues: Array<{ startMs: number; endMs: number; text: string; focusTargetIndexes: number[] }>;
    } | null;
    isFocusAlignmentTrusted(alignment: unknown): boolean;
  };
}

test("transcript alignment keeps authored captions and uses final-waveform timestamps", async () => {
  const { buildNarrationAlignmentFromTranscript, isFocusAlignmentTrusted } = await loadAudioAlignment();
  const alignment = buildNarrationAlignmentFromTranscript({
    audioDurationMs: 4_000,
    segments: [
      { text: "关注核心结论。", focusTargetIndexes: [0] },
      { text: "然后验证隔离机制。", focusTargetIndexes: [1] }
    ],
    tokens: [
      { text: "关注核心结论", startMs: 300, endMs: 1_500, confidence: 0.96 },
      { text: "然后验证隔离机制", startMs: 2_100, endMs: 3_600, confidence: 0.94 }
    ]
  });

  assert.ok(alignment);
  assert.equal(alignment.source, "transcript");
  assert.equal(alignment.cues[0]?.text, "关注核心结论。");
  assert.equal(alignment.cues[0]?.endMs, 1_800);
  assert.equal(alignment.cues[1]?.startMs, 1_800);
  assert.equal(alignment.quality?.coverage, 1);
  assert.equal(isFocusAlignmentTrusted(alignment), true);
});

test("low-coverage transcript is rejected instead of driving a wrong focus event", async () => {
  const { buildNarrationAlignmentFromTranscript, isFocusAlignmentTrusted } = await loadAudioAlignment();
  const alignment = buildNarrationAlignmentFromTranscript({
    audioDurationMs: 3_000,
    segments: [{ text: "职责分离与双层隔离。", focusTargetIndexes: [0] }],
    tokens: [{ text: "完全无关内容", startMs: 200, endMs: 2_700, confidence: 0.9 }]
  });

  assert.equal(alignment, null);
  assert.equal(isFocusAlignmentTrusted({ source: "audio-silence" }), false);
});

test("buildNarrationAlignment uses measured silence midpoints instead of character proportions", async () => {
  const { buildNarrationAlignment } = await loadAudioAlignment();
  const alignment = buildNarrationAlignment({
    audioDurationMs: 10_000,
    segments: [
      { text: "短句。", focusTargetIndexes: [0] },
      { text: "这是一段明显更长的旁白文字，它不应该按字数挤压前一段的播放时间。", focusTargetIndexes: [1] }
    ],
    silences: [{ startMs: 3_800, endMs: 4_200 }]
  });

  assert.equal(alignment.source, "audio-silence");
  assert.deepEqual(alignment.cues, [
    { startMs: 0, endMs: 4_000, text: "短句。", focusTargetIndexes: [0] },
    {
      startMs: 4_000,
      endMs: 10_000,
      text: "这是一段明显更长的旁白文字，它不应该按字数挤压前一段的播放时间。",
      focusTargetIndexes: [1]
    }
  ]);
});

test("buildNarrationAlignment emits one full-page cue when no usable silence exists", async () => {
  const { buildNarrationAlignment } = await loadAudioAlignment();
  const alignment = buildNarrationAlignment({
    audioDurationMs: 8_000,
    segments: [
      { text: "第一句。", focusTargetIndexes: [0] },
      { text: "第二句比第一句长很多，但不能据此猜测时间。", focusTargetIndexes: [1] },
      { text: "第三句。", focusTargetIndexes: [2] }
    ],
    silences: []
  });

  assert.equal(alignment.source, "page");
  assert.deepEqual(alignment.cues, [{
    startMs: 0,
    endMs: 8_000,
    text: "第一句。第二句比第一句长很多，但不能据此猜测时间。第三句。",
    focusTargetIndexes: [0, 1, 2]
  }]);
});

test("buildNarrationAlignment merges adjacent semantic segments when pauses are fewer than targets", async () => {
  const { buildNarrationAlignment } = await loadAudioAlignment();
  const alignment = buildNarrationAlignment({
    audioDurationMs: 9_000,
    segments: [
      { text: "职责分离。", focusTargetIndexes: [0] },
      { text: "双层隔离。", focusTargetIndexes: [1] },
      { text: "优先治理。", focusTargetIndexes: [2] }
    ],
    silences: [{ startMs: 4_300, endMs: 4_700 }]
  });

  assert.equal(alignment.source, "audio-silence");
  assert.equal(alignment.cues.length, 2);
  assert.equal(alignment.cues[0]?.endMs, 4_500);
  assert.equal(alignment.cues[1]?.startMs, 4_500);
  assert.deepEqual(
    alignment.cues.flatMap((cue) => cue.focusTargetIndexes),
    [0, 1, 2]
  );
  assert.equal(alignment.cues.map((cue) => cue.text).join(""), "职责分离。双层隔离。优先治理。");
});

test("buildNarrationAlignment ignores too-short silence and still avoids proportional cues", async () => {
  const { buildNarrationAlignment } = await loadAudioAlignment();
  const alignment = buildNarrationAlignment({
    audioDurationMs: 6_000,
    segments: [
      { text: "甲。", focusTargetIndexes: [0] },
      { text: "乙乙乙乙乙乙乙乙乙乙。", focusTargetIndexes: [1] }
    ],
    silences: [{ startMs: 2_000, endMs: 2_080 }],
    minimumSilenceMs: 200
  });

  assert.equal(alignment.source, "page");
  assert.equal(alignment.cues.length, 1);
  assert.deepEqual(alignment.cues[0], {
    startMs: 0,
    endMs: 6_000,
    text: "甲。乙乙乙乙乙乙乙乙乙乙。",
    focusTargetIndexes: [0, 1]
  });
});

test("buildNarrationAlignment ignores leading and trailing silence as semantic boundaries", async () => {
  const { buildNarrationAlignment } = await loadAudioAlignment();
  const alignment = buildNarrationAlignment({
    audioDurationMs: 8_000,
    segments: [
      { text: "第一句。", focusTargetIndexes: [0] },
      { text: "第二句。", focusTargetIndexes: [1] }
    ],
    silences: [
      { startMs: 0, endMs: 500 },
      { startMs: 3_800, endMs: 4_200 },
      { startMs: 7_600, endMs: 8_000 }
    ]
  });

  assert.deepEqual(alignment.cues.map(({ startMs, endMs }) => ({ startMs, endMs })), [
    { startMs: 0, endMs: 4_000 },
    { startMs: 4_000, endMs: 8_000 }
  ]);

  const edgeOnly = buildNarrationAlignment({
    audioDurationMs: 8_000,
    segments: [
      { text: "第一句。", focusTargetIndexes: [0] },
      { text: "第二句。", focusTargetIndexes: [1] }
    ],
    silences: [
      { startMs: 0, endMs: 500 },
      { startMs: 7_600, endMs: 8_000 }
    ]
  });
  assert.equal(edgeOnly.source, "page");
  assert.equal(edgeOnly.cues.length, 1);
});
