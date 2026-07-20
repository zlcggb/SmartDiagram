import assert from "node:assert/strict";
import test from "node:test";
import {
  DIAGRAM_SHELL_EVENT,
  dispatchDiagramShellCommand
} from "./shellEvents.ts";

test("壳层命令通过固定事件名传递给绘图模块", () => {
  const target = new EventTarget();
  let command = "";
  target.addEventListener(DIAGRAM_SHELL_EVENT, (event) => {
    command = (event as CustomEvent<{ command: string }>).detail.command;
  });

  dispatchDiagramShellCommand("open-history", target);
  assert.equal(command, "open-history");
});
