import assert from "node:assert/strict";
import test from "node:test";
import { buildFocusOverlaySvg, renderFocusOverlayPng } from "./focusOverlay.js";

test("focus overlay maps normalized geometry and renders a transparent PNG buffer", () => {
  const box = { x: 0.25, y: 0.2, w: 0.5, h: 0.3 };
  const svg = buildFocusOverlaySvg(box, { width: 1280, height: 720 });

  assert.match(svg, /<rect x="320" y="144" width="640" height="216"/);
  assert.match(svg, /fill-rule="evenodd"/);

  const png = renderFocusOverlayPng(box, { width: 1280, height: 720 });
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
});
