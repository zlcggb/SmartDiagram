import assert from "node:assert/strict";
import test from "node:test";
import { buildExtractFactsPrompt, extractFactsSystemPrompt } from "./prompts.js";

test("事实提取提示要求 sourceLocation 原样返回证据块 ID", () => {
  const prompt = buildExtractFactsPrompt("【证据块 chunk:abc｜pdf:page=3】\n营收增长 20%" );

  assert.match(extractFactsSystemPrompt, /证据块 ID/);
  assert.match(prompt, /sourceLocation/);
  assert.match(prompt, /chunk:abc/);
  assert.match(prompt, /不要把页码或自由描述替代证据块 ID/);
});
