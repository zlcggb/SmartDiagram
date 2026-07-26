import fs from "node:fs";
import path from "node:path";
import { parseFile } from "music-metadata";

export interface TtsOptions {
  voice?: string;
  model?: string;
  prompt?: string | null;
  languageCode?: string;
}

const fallbackVoices = ["Kore", "Puck", "Charon", "Aoede", "Zephyr", "Fenrir", "Leda", "Callirrhoe"];
const fallbackModels = [
  "gemini-3.1-flash-tts-preview",
  "gemini-2.5-flash-tts",
  "gemini-2.5-pro-tts",
  "gemini-2.5-flash-lite-preview-tts"
];

function setting(name: string, fallback = "") {
  return (process.env[name] || fallback).trim();
}

export function ttsRuntimeStatus() {
  return {
    configured: Boolean(setting("TTS_API_KEY")),
    baseUrl: setting("TTS_API_BASE_URL", "https://api.example.com/tts"),
    model: setting("TTS_DEFAULT_MODEL", "gemini-3.1-flash-tts-preview"),
    voice: setting("TTS_DEFAULT_VOICE", "Kore"),
    languageCode: setting("TTS_LANGUAGE_CODE", "cmn-CN")
  };
}

export async function ttsCatalog() {
  const apiKey = setting("TTS_API_KEY");
  const baseUrl = setting("TTS_API_BASE_URL", "https://api.example.com/tts").replace(/\/+$/, "");
  if (!apiKey) return { voices: fallbackVoices, models: fallbackModels };
  try {
    const response = await fetch(`${baseUrl}/v1/tts/models`, {
      headers: { "X-API-Key": apiKey },
      signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok) throw new Error(`TTS catalog ${response.status}`);
    const payload = await response.json() as { voices?: unknown; models?: unknown };
    const voices = Array.isArray(payload.voices) ? payload.voices.filter((item): item is string => typeof item === "string") : [];
    const models = Array.isArray(payload.models) ? payload.models.filter((item): item is string => typeof item === "string") : [];
    return {
      voices: voices.length ? voices : fallbackVoices,
      models: models.length ? models : fallbackModels
    };
  } catch {
    return { voices: fallbackVoices, models: fallbackModels };
  }
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function synthesizeToFile(text: string, outputPath: string, options: TtsOptions = {}) {
  const apiKey = setting("TTS_API_KEY");
  if (!apiKey) throw new Error("未配置 TTS_API_KEY");
  const baseUrl = setting("TTS_API_BASE_URL", "https://api.example.com/tts").replace(/\/+$/, "");
  const payload = {
    text,
    voice: options.voice || setting("TTS_DEFAULT_VOICE", "Kore"),
    model: options.model || setting("TTS_DEFAULT_MODEL", "gemini-3.1-flash-tts-preview"),
    prompt: options.prompt || undefined,
    language_code: options.languageCode || setting("TTS_LANGUAGE_CODE", "cmn-CN"),
    response_format: "binary"
  };

  let lastError = "TTS 调用失败";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(`${baseUrl}/v1/tts/synthesize`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(60_000)
    });
    if (response.ok) {
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!bytes.length) throw new Error("TTS 返回了空音频");
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, bytes);
      const metadata = await parseFile(outputPath, { duration: true });
      return { outputPath, durationMs: Math.round((metadata.format.duration || 0) * 1000), ...payload };
    }
    lastError = `TTS ${response.status}: ${(await response.text()).slice(0, 300)}`;
    if (response.status !== 502 || attempt === 2) break;
    await wait(2_000 * (attempt + 1));
  }
  throw new Error(lastError);
}
