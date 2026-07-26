import React from "react";
import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { SlideDesignVersionDto } from "@ppt-agent/shared";
import { DesignVersionNavigator } from "./DesignVersionNavigator.js";

function versions(activeIndex: number): {
  items: SlideDesignVersionDto[];
  activeId: string;
} {
  const items = Array.from({ length: 5 }, (_, index) => ({
    id: `version-${index + 1}`,
    slideId: "slide-1",
    svgPreview: `<svg><text>${index + 1}</text></svg>`,
    source: index === activeIndex ? ("manual" as const) : ("ai" as const),
    theme: null,
    accentId: null,
    surfaceId: null,
    presentationStyle: null,
    createdAt: `2026-07-26T00:0${index}:00.000Z`
  }));
  return { items, activeId: items[activeIndex]!.id };
}

test("只显示当前版本序号和总数", () => {
  const fixture = versions(2);
  const html = renderToStaticMarkup(
    <DesignVersionNavigator
      versions={fixture.items}
      activeVersionId={fixture.activeId}
      disabled={false}
      onActivate={() => undefined}
    />
  );

  assert.match(html, /3 \/ 5/);
  assert.doesNotMatch(html, /手动保存|AI 生成|当前|00:02/);
});

test("最旧版本禁用左按钮，最新版本禁用右按钮", () => {
  const oldest = versions(0);
  const oldestHtml = renderToStaticMarkup(
    <DesignVersionNavigator
      versions={oldest.items}
      activeVersionId={oldest.activeId}
      disabled={false}
      onActivate={() => undefined}
    />
  );
  assert.match(oldestHtml, /aria-label="上一个设计版本"[^>]*disabled/);

  const newest = versions(4);
  const newestHtml = renderToStaticMarkup(
    <DesignVersionNavigator
      versions={newest.items}
      activeVersionId={newest.activeId}
      disabled={false}
      onActivate={() => undefined}
    />
  );
  assert.match(newestHtml, /aria-label="下一个设计版本"[^>]*disabled/);
});

test("加载或忙碌时两个方向都禁用", () => {
  const fixture = versions(2);
  const html = renderToStaticMarkup(
    <DesignVersionNavigator
      versions={fixture.items}
      activeVersionId={fixture.activeId}
      disabled
      onActivate={() => undefined}
    />
  );

  const disabledButtons = html.match(/<button[^>]*disabled[^>]*>/g) ?? [];
  assert.equal(disabledButtons.length, 2);
});
