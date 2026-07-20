import assert from "node:assert/strict";
import test from "node:test";
import {
  listConversationHistory,
  listDiagramHistory
} from "./diagramHistory.ts";

test("绘图历史请求包含代码、数量与搜索参数", async () => {
  const originalFetch = globalThis.fetch;
  let requested = "";
  let requestedHeaders: HeadersInit | undefined;
  globalThis.fetch = async (input, init) => {
    requested = String(input);
    requestedHeaders = init?.headers;
    return new Response(JSON.stringify({
      diagrams: [{ diagram_id: "d1", title: "年度流程" }]
    }), { status: 200 });
  };

  try {
    const diagrams = await listDiagramHistory("年度 流程");
    assert.equal(diagrams[0]?.diagram_id, "d1");
    assert.match(requested, /\/api\/diagrams\/history/);
    assert.match(requested, /include_code=true/);
    assert.match(requested, /limit=20/);
    assert.match(requested, /query=/);
    assert.ok(requestedHeaders);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("会话历史请求需要消息和当前画布快照", async () => {
  const originalFetch = globalThis.fetch;
  let requested = "";
  globalThis.fetch = async (input) => {
    requested = String(input);
    return new Response(JSON.stringify({
      conversations: [{ conversation_id: "c1", title: "季度复盘" }]
    }), { status: 200 });
  };

  try {
    const conversations = await listConversationHistory();
    assert.equal(conversations[0]?.conversation_id, "c1");
    assert.match(requested, /include_messages=true/);
    assert.match(requested, /include_current_diagram=true/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("缺失列表字段时返回空数组", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({}), { status: 200 });

  try {
    assert.deepEqual(await listDiagramHistory(), []);
    assert.deepEqual(await listConversationHistory(), []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("非 2xx 响应抛出可展示错误", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("无权限", { status: 403 });

  try {
    await assert.rejects(() => listConversationHistory(), /无权限/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
