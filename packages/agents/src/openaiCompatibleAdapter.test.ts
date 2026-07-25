import assert from "node:assert/strict";
import test from "node:test";
import { OpenAiCompatibleAdapter, parseOpenAiChatSseBuffer } from "./openaiCompatibleAdapter.js";

test("parses chat completion SSE with or without a space after data colon", () => {
  const parsed = parseOpenAiChatSseBuffer(
    'data:{"choices":[{"delta":{"content":"<svg"}}]}\r\n\r\n' +
      'data: {"choices":[{"delta":{"content":" viewBox=\\"0 0 1280 720\\">"}}]}\n\n' +
      'data: [DONE]\n\n'
  );
  assert.deepEqual(parsed.deltas, ["<svg", ' viewBox="0 0 1280 720">']);
  assert.equal(parsed.remaining, "");
});

test("keeps a cross-chunk SSE event until the JSON is complete", () => {
  const first = parseOpenAiChatSseBuffer('data: {"choices":[{"delta":{"content":"hello');
  assert.deepEqual(first.deltas, []);
  const second = parseOpenAiChatSseBuffer(`${first.remaining} world"}}]}\n\n`);
  assert.deepEqual(second.deltas, ["hello world"]);
});

test("startBrief asks the model for topic-specific questions instead of returning the fixed template", async () => {
  const adapter = new OpenAiCompatibleAdapter();
  let modelPrompt = "";
  let callCount = 0;
  const testAdapter = adapter as unknown as {
    generateJson: (input: string) => Promise<unknown>;
  };
  testAdapter.generateJson = async (input) => {
    callCount += 1;
    modelPrompt = input;
    return {
      questions: [
        { id: "current_level", question: "你当前具备哪些工程能力？" },
        { id: "target_role", question: "你想进入哪类 AI 应用岗位？" },
        { id: "learning_window", question: "计划用多长时间完成学习？" }
      ]
    };
  };

  const result = await adapter.startBrief("AI 应用工程师学习路线");

  assert.equal(callCount, 1);
  assert.match(modelPrompt, /AI 应用工程师学习路线/);
  assert.equal(result.source, "ai");
  assert.equal(result.questions[0]?.id, "current_level");
});
