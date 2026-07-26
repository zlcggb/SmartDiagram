import assert from "node:assert/strict";
import test from "node:test";
import type { SlideDesignVersionDto } from "@ppt-agent/shared";
import {
  resolveAppliedPageStyle,
  styleSelectionNeedsRegeneration
} from "./pageStyleState.js";

const versions: SlideDesignVersionDto[] = [
  {
    id: "version-1",
    slideId: "slide-1",
    svgPreview: "<svg />",
    source: "generated",
    theme: "gold",
    accentId: null,
    surfaceId: null,
    presentationStyle: "consulting",
    createdAt: "2026-07-26T08:00:00.000Z"
  },
  {
    id: "version-2",
    slideId: "slide-1",
    svgPreview: "<svg />",
    source: "generated",
    theme: "gold",
    accentId: null,
    surfaceId: null,
    presentationStyle: "tech-architecture",
    createdAt: "2026-07-26T09:00:00.000Z"
  }
];

test("uses the active design version as the current page style label", () => {
  assert.equal(
    resolveAppliedPageStyle({
      slideId: "slide-1",
      loadedSlideId: "slide-1",
      activeVersionId: "version-1",
      versions,
      fallbackStyle: "apple-minimal"
    }),
    "consulting"
  );
  assert.equal(
    resolveAppliedPageStyle({
      slideId: "slide-1",
      loadedSlideId: "slide-1",
      activeVersionId: "version-2",
      versions,
      fallbackStyle: "apple-minimal"
    }),
    "tech-architecture"
  );
});

test("does not reuse another slide's loaded version metadata", () => {
  assert.equal(
    resolveAppliedPageStyle({
      slideId: "slide-2",
      loadedSlideId: "slide-1",
      activeVersionId: "version-1",
      versions,
      fallbackStyle: "data-story"
    }),
    "data-story"
  );
});

test("only asks for regeneration when the requested visual style differs", () => {
  assert.equal(
    styleSelectionNeedsRegeneration("apple-minimal", "apple-minimal", null),
    false
  );
  assert.equal(
    styleSelectionNeedsRegeneration("apple-minimal", "consulting", null),
    true
  );
  assert.equal(
    styleSelectionNeedsRegeneration("consulting", "consulting", "consulting"),
    false
  );
});
