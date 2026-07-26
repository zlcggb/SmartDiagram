import assert from "node:assert/strict";
import test from "node:test";

import { streamProjectProgress } from "./progressStream.ts";

test("streams progress through a relative PPT API base with identity headers", async () => {
  const encoder = new TextEncoder();
  const chunks = [
    ": connected\n\ndata: {\"stage\":\"design\",\"status\":\"pro",
    "gress\",\"message\":\"generating\",\"delta\":\"<svg\"}\n\n",
    "data: {\"stage\":\"design\",\"status\":\"done\",\"message\":\"done\"}\n\n",
  ];
  let requestedUrl = "";
  let requestedHeaders = new Headers();
  const fetcher: typeof fetch = async (input, init) => {
    requestedUrl = String(input);
    requestedHeaders = new Headers(init?.headers);
    return new Response(new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }), { status: 200, headers: { "Content-Type": "text/event-stream" } });
  };
  const events: Array<{ status: string; delta?: string }> = [];

  await streamProjectProgress({
    apiBase: "/ppt-api",
    projectId: "project/one",
    identityHeaders: { Authorization: "Bearer test-token" },
    fetcher,
    onEvent: (event) => events.push(event),
  });

  assert.equal(requestedUrl, "/ppt-api/api/projects/project%2Fone/progress");
  assert.equal(requestedHeaders.get("Authorization"), "Bearer test-token");
  assert.equal(requestedHeaders.get("Accept"), "text/event-stream");
  assert.deepEqual(events, [
    { stage: "design", status: "progress", message: "generating", delta: "<svg" },
    { stage: "design", status: "done", message: "done" },
  ]);
});

test("rejects a progress response that is not successful", async () => {
  await assert.rejects(
    streamProjectProgress({
      apiBase: "https://ppt.example.test",
      projectId: "project-1",
      identityHeaders: {},
      fetcher: async () => new Response("forbidden", { status: 403 }),
      onEvent: () => undefined,
    }),
    /HTTP 403/,
  );
});
