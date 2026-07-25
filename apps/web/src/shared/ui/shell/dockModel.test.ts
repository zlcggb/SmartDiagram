import assert from "node:assert/strict";
import test from "node:test";
import {
  DOCK_AUTO_HIDE_DELAY_MS,
  DOCK_PEEK_HEIGHT_PX,
  DOCK_REVEAL_ZONE_HEIGHT_PX,
  dockScaleForItem
} from "./dockModel.ts";

test("Dock 离开后给用户 7 秒选择时间", () => {
  assert.equal(DOCK_AUTO_HIDE_DELAY_MS, 7000);
  assert.ok(DOCK_AUTO_HIDE_DELAY_MS >= 5000);
  assert.ok(DOCK_AUTO_HIDE_DELAY_MS <= 10000);
});

test("Dock 隐藏时保留 12px 可发现顶沿", () => {
  assert.equal(DOCK_PEEK_HEIGHT_PX, 12);
  assert.ok(DOCK_REVEAL_ZONE_HEIGHT_PX > DOCK_PEEK_HEIGHT_PX);
});

test("Dock 只放大当前悬浮的图标", () => {
  assert.equal(dockScaleForItem("diagram", "diagram", false), 1.25);
  assert.equal(dockScaleForItem("ppt", "diagram", false), 1);
  assert.equal(dockScaleForItem("diagram", null, false), 1);
  assert.equal(dockScaleForItem("diagram", "diagram", true), 1);
});
