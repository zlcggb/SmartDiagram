import fs from "node:fs";
import path from "node:path";

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/gu, "");
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnv(path.resolve(".env"));
loadEnv(path.resolve("apps/api/.env"));

const base = (
  process.env.OPENAI_COMPATIBLE_BASE_URL ||
  process.env.TRADINGAGENTS_LLM_BACKEND_URL ||
  process.env.OPENAI_BASE_URL ||
  ""
).replace(/\/+$/u, "");
const key = process.env.OPENAI_COMPATIBLE_API_KEY || process.env.OPENAI_API_KEY || "";
const model = process.env.OPENAI_COMPATIBLE_DESIGN_MODEL || process.env.OPENAI_COMPATIBLE_MODEL || "";

if (!base || !key || !model) {
  throw new Error("缺少 OPENAI_COMPATIBLE_BASE_URL / API_KEY / MODEL，无法诊断。");
}

const url = /\/chat\/completions$/iu.test(base) ? base : `${base}/chat/completions`;
const startedAt = performance.now();
const response = await fetch(url, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Accept: "text/event-stream",
    Authorization: `Bearer ${key}`
  },
  body: JSON.stringify({
    model,
    stream: true,
    temperature: 0.2,
    reasoning_effort: "low",
    messages: [
      { role: "system", content: "只输出用户要求的文本，不要解释。" },
      { role: "user", content: "逐行输出 1 到 30，每行一个数字。" }
    ]
  }),
  signal: AbortSignal.timeout(60_000)
});

console.log(JSON.stringify({
  status: response.status,
  contentType: response.headers.get("content-type"),
  transferEncoding: response.headers.get("transfer-encoding"),
  contentEncoding: response.headers.get("content-encoding")
}));

if (!response.ok || !response.body) {
  console.log((await response.text()).slice(0, 500));
  process.exitCode = 1;
} else {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let chunkIndex = 0;
  let totalBytes = 0;
  let buffer = "";
  let deltaChars = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    chunkIndex += 1;
    totalBytes += value.byteLength;
    const text = decoder.decode(value, { stream: true });
    buffer += text;
    const dataLines = text.split(/\r?\n/u).filter((line) => line.trimStart().startsWith("data:")).length;
    for (const line of text.split(/\r?\n/u)) {
      const data = line.trim().replace(/^data:\s*/u, "");
      if (!data || data === "[DONE]") continue;
      try {
        const payload = JSON.parse(data);
        const content = payload?.choices?.[0]?.delta?.content;
        if (typeof content === "string") deltaChars += content.length;
      } catch {
        // Cross-chunk JSON is counted after the complete diagnostic summary.
      }
    }
    console.log(JSON.stringify({
      chunk: chunkIndex,
      afterMs: Math.round(performance.now() - startedAt),
      bytes: value.byteLength,
      dataLines,
      parsedDeltaChars: deltaChars
    }));
  }
  buffer += decoder.decode();
  console.log(JSON.stringify({
    complete: true,
    afterMs: Math.round(performance.now() - startedAt),
    chunks: chunkIndex,
    bytes: totalBytes,
    parsedDeltaChars: deltaChars,
    hasDone: buffer.includes("[DONE]")
  }));
}
