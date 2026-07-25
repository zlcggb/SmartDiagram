import assert from "node:assert/strict";
import test from "node:test";
import { resolveHorizontalDropHint } from "./stickyBoardDrag.js";

const targets = [
  { id: "page-1", left: 0, right: 216 },
  { id: "page-2", left: 232, right: 448 },
  { id: "page-3", left: 464, right: 680 },
  { id: "page-4", left: 696, right: 912 }
];

test("指针位于中间卡片左半区时提示插到该卡片之前", () => {
  assert.deepEqual(resolveHorizontalDropHint(250, targets, "page-1"), {
    targetId: "page-2",
    place: "before"
  });
});

test("指针位于两张中间卡片之间时提示插入相邻位置而不是行尾", () => {
  assert.deepEqual(resolveHorizontalDropHint(456, targets, "page-1"), {
    targetId: "page-3",
    place: "before"
  });
});

test("只有指针越过最后一张可放置卡片时才提示放到行尾", () => {
  assert.deepEqual(resolveHorizontalDropHint(980, targets, "page-1"), {
    targetId: "page-4",
    place: "after"
  });
});

test("计算目标时排除正在拖拽的卡片", () => {
  assert.deepEqual(resolveHorizontalDropHint(350, targets, "page-2"), {
    targetId: "page-3",
    place: "before"
  });
});
