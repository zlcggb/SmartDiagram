import assert from "node:assert/strict";
import test from "node:test";
import type { GeminiAdapter } from "@ppt-agent/agents";
import { wrapAdapterWithUsage } from "./aiUsage.js";

test("usage wrapper forwards SVG token callback and generation options", async () => {
  const received: { onToken?: (token: string) => void; options?: { revisionNotes?: string[]; accentId?: string | null; surfaceId?: string | null } } = {};
  const adapter = {
    async generateSvgPreview(_slide, _facts, _theme, onToken, options) {
      received.onToken = onToken;
      received.options = options;
      onToken?.("<svg");
      return '<svg viewBox="0 0 1280 720"></svg>';
    }
  } as GeminiAdapter;
  const wrapped = wrapAdapterWithUsage(adapter);
  const tokens: string[] = [];
  const options = { accentId: "cyan", surfaceId: "flat", revisionNotes: ["fix"] };

  await wrapped.generateSvgPreview({} as never, [], "white-blue", (token) => tokens.push(token), options);

  assert.deepEqual(tokens, ["<svg"]);
  assert.equal(received.onToken instanceof Function, true);
  assert.deepEqual(received.options, options);
});
