import assert from "node:assert/strict";
import test from "node:test";

type Box = { x: number; y: number; w: number; h: number };

interface Candidate {
  id: string;
  text: string;
  box: Box;
}

interface Resolution {
  status: "resolved" | "rejected";
  box?: Box;
  matchedCandidateIds?: string[];
  score?: number;
  qa?: {
    selectedTextCoverage: number;
    tightness: number;
    unrelatedTextIds: string[];
  };
  rejectionReasons?: string[];
}

async function loadFocusResolver() {
  return await import("./focusResolver.js") as unknown as {
    extractSvgTextCandidates(svg: string): {
      viewBox: Box;
      candidates: Candidate[];
    };
    resolveFocusTarget(
      target: {
        anchors: string[];
        targetTextIds: string[];
        mode: "text" | "container";
        allowEdge?: boolean;
      },
      candidates: Candidate[],
      options?: {
        viewBox?: Box;
        padding?: number;
        minScore?: number;
        ambiguityDelta?: number;
        minCoverage?: number;
        minTightness?: number;
      }
    ): Resolution;
  };
}

function candidate(id: string, text: string, box: Box): Candidate {
  return { id, text, box };
}

test("extractSvgTextCandidates uses data-w/data-h with tspans, anchoring, and nested translate", async () => {
  const { extractSvgTextCandidates } = await loadFocusResolver();
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720">',
    '<g transform="translate(40 30)">',
    '<g transform="translate(100, 50)">',
    '<text id="core-conclusion" x="300" y="200" data-w="400" data-h="80" ',
    'font-size="24" text-anchor="middle">',
    '<tspan x="300" y="200">核心结论：职责分离与双层隔离</tspan>',
    '<tspan x="300" y="240">奠定了安全基础</tspan>',
    '</text></g></g></svg>'
  ].join("");

  const result = extractSvgTextCandidates(svg);

  assert.deepEqual(result.viewBox, { x: 0, y: 0, w: 1280, h: 720 });
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0]?.id, "core-conclusion");
  assert.equal(result.candidates[0]?.text, "核心结论：职责分离与双层隔离 奠定了安全基础");
  assert.deepEqual(result.candidates[0]?.box, {
    x: 240,
    y: 253.6,
    w: 400,
    h: 80
  });
});

test("extractSvgTextCandidates does not guess geometry when data-w/data-h are absent", async () => {
  const { extractSvgTextCandidates } = await loadFocusResolver();
  const svg = [
    '<svg viewBox="0 0 1280 720">',
    '<text id="structured" x="80" y="120" data-w="510" data-h="64" font-size="24">',
    '这是一段很长但几何必须完全信任 data-w 的文字</text>',
    '<text id="unstructured" x="80" y="240" font-size="24">不得使用平均字宽猜测</text>',
    '</svg>'
  ].join("");

  const result = extractSvgTextCandidates(svg);

  assert.deepEqual(result.candidates.map(({ id }) => id), ["structured"]);
  assert.equal(result.candidates[0]?.box.w, 510);
  assert.equal(result.candidates[0]?.box.h, 64);
});

test("resolveFocusTarget enforces the default semantic score floor of 0.58", async () => {
  const { resolveFocusTarget } = await loadFocusResolver();
  const result = resolveFocusTarget(
    { anchors: ["零信任网络"], targetTextIds: [], mode: "text" },
    [candidate("finance", "财务增长预测", { x: 120, y: 140, w: 220, h: 48 })],
    { viewBox: { x: 0, y: 0, w: 1280, h: 720 }, padding: 0 }
  );

  assert.equal(result.status, "rejected");
  assert.ok(result.rejectionReasons?.includes("match_score_below_minimum"));
  assert.ok((result.score ?? 1) < 0.58);
});

test("resolveFocusTarget rejects a nearly equal ambiguous match without an explicit text id", async () => {
  const { resolveFocusTarget } = await loadFocusResolver();
  const result = resolveFocusTarget(
    { anchors: ["三层隔离机制"], targetTextIds: [], mode: "text" },
    [
      candidate("left-copy", "三层隔离机制", { x: 100, y: 180, w: 260, h: 56 }),
      candidate("right-copy", "三层隔离机制", { x: 820, y: 180, w: 260, h: 56 })
    ],
    { viewBox: { x: 0, y: 0, w: 1280, h: 720 }, padding: 0 }
  );

  assert.equal(result.status, "rejected");
  assert.ok(result.rejectionReasons?.includes("ambiguous_match"));
});

test("resolveFocusTarget lets an explicit text id disambiguate equal anchor matches", async () => {
  const { resolveFocusTarget } = await loadFocusResolver();
  const candidates = [
    candidate("left-copy", "三层隔离机制", { x: 100, y: 180, w: 260, h: 56 }),
    candidate("right-copy", "三层隔离机制", { x: 820, y: 180, w: 260, h: 56 })
  ];

  const result = resolveFocusTarget(
    { anchors: ["三层隔离机制"], targetTextIds: ["right-copy"], mode: "text" },
    candidates,
    { viewBox: { x: 0, y: 0, w: 1280, h: 720 }, padding: 0 }
  );

  assert.equal(result.status, "resolved");
  assert.deepEqual(result.matchedCandidateIds, ["right-copy"]);
  assert.deepEqual(result.box, candidates[1]?.box);
  assert.ok((result.score ?? 0) >= 0.58);
  assert.ok((result.qa?.selectedTextCoverage ?? 0) >= 0.98);
  assert.ok((result.qa?.tightness ?? 0) >= 0.35);
});

test("resolveFocusTarget rejects spatially separate selections below 0.35 tightness", async () => {
  const { resolveFocusTarget } = await loadFocusResolver();
  const result = resolveFocusTarget(
    {
      anchors: ["左侧要点", "右侧要点"],
      targetTextIds: ["left", "right"],
      mode: "text"
    },
    [
      candidate("left", "左侧要点", { x: 100, y: 240, w: 180, h: 48 }),
      candidate("right", "右侧要点", { x: 980, y: 240, w: 180, h: 48 })
    ],
    { viewBox: { x: 0, y: 0, w: 1280, h: 720 }, padding: 0 }
  );

  assert.equal(result.status, "rejected");
  assert.ok(result.rejectionReasons?.includes("tightness_below_minimum"));
  assert.ok((result.qa?.tightness ?? 1) < 0.35);
});

test("resolveFocusTarget rejects edge-touching focus unless allowEdge is explicit", async () => {
  const { resolveFocusTarget } = await loadFocusResolver();
  const candidates = [candidate("edge-title", "边缘标题", { x: 0, y: 80, w: 260, h: 52 })];

  const rejected = resolveFocusTarget(
    { anchors: ["边缘标题"], targetTextIds: ["edge-title"], mode: "text" },
    candidates,
    { viewBox: { x: 0, y: 0, w: 1280, h: 720 }, padding: 0 }
  );
  const allowed = resolveFocusTarget(
    { anchors: ["边缘标题"], targetTextIds: ["edge-title"], mode: "text", allowEdge: true },
    candidates,
    { viewBox: { x: 0, y: 0, w: 1280, h: 720 }, padding: 0 }
  );

  assert.equal(rejected.status, "rejected");
  assert.ok(rejected.rejectionReasons?.includes("touches_slide_edge"));
  assert.equal(allowed.status, "resolved");
});

test("resolveFocusTarget rejects a text-mode box that swallows unrelated text by at least 50%", async () => {
  const { resolveFocusTarget } = await loadFocusResolver();
  const result = resolveFocusTarget(
    { anchors: ["核心结论"], targetTextIds: ["target"], mode: "text" },
    [
      candidate("target", "核心结论", { x: 180, y: 220, w: 420, h: 100 }),
      candidate("unrelated", "与本次讲解无关的风险备注", { x: 260, y: 240, w: 180, h: 48 })
    ],
    { viewBox: { x: 0, y: 0, w: 1280, h: 720 }, padding: 0 }
  );

  assert.equal(result.status, "rejected");
  assert.ok(result.rejectionReasons?.includes("contains_unrelated_text"));
  assert.deepEqual(result.qa?.unrelatedTextIds, ["unrelated"]);
});

test("container mode fails closed until audited SVG container geometry exists", async () => {
  const { resolveFocusTarget } = await loadFocusResolver();
  const resolution = resolveFocusTarget({
    anchors: ["核心结论"],
    targetTextIds: ["text-1"],
    mode: "container"
  }, [{ id: "text-1", text: "核心结论", box: { x: 100, y: 100, w: 180, h: 40 } }]);

  assert.equal(resolution.status, "rejected");
  assert.deepEqual(resolution.rejectionReasons, ["container_geometry_unavailable"]);
});
