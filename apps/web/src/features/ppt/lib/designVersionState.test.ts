import assert from "node:assert/strict";
import test from "node:test";
import type { SlideDesignVersionDto } from "@ppt-agent/shared";
import {
  activeDesignVersionIndex,
  normalizeSlideDesignHistory
} from "./designVersionState.js";

function version(
  id: string,
  slideId: string,
  createdAt: string
): SlideDesignVersionDto {
  return {
    id,
    slideId,
    svgPreview: `<svg><text>${id}</text></svg>`,
    source: "ai",
    theme: null,
    accentId: null,
    surfaceId: null,
    createdAt
  };
}

test("设计版本按创建时间由旧到新排序", () => {
  const history = normalizeSlideDesignHistory(
    {
      activeVersionId: "new",
      versions: [
        version("new", "slide-1", "2026-07-26T00:02:00.000Z"),
        version("old", "slide-1", "2026-07-26T00:01:00.000Z")
      ]
    },
    "slide-1"
  );

  assert.deepEqual(history.versions.map((item) => item.id), ["old", "new"]);
  assert.equal(activeDesignVersionIndex(history.versions, "new"), 1);
});

test("页面不一致的历史不会进入当前页状态", () => {
  const history = normalizeSlideDesignHistory(
    {
      activeVersionId: "foreign",
      versions: [
        version("own", "slide-1", "2026-07-26T00:01:00.000Z"),
        version("foreign", "slide-2", "2026-07-26T00:02:00.000Z")
      ]
    },
    "slide-1"
  );

  assert.deepEqual(history.versions.map((item) => item.id), ["own"]);
  assert.equal(history.activeVersionId, null);
});

test("找不到活跃版本时返回 -1", () => {
  assert.equal(
    activeDesignVersionIndex(
      [version("one", "slide-1", "2026-07-26T00:01:00.000Z")],
      "missing"
    ),
    -1
  );
});
