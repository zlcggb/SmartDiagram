import type { ColorValue, SlideIrDocument } from "./schema.js";

export class SlideIrTokenError extends Error {
  constructor(token: string) {
    super(`未定义主题 Token：${token}`);
    this.name = "SlideIrTokenError";
  }
}

export function resolveColor(value: ColorValue, document: Pick<SlideIrDocument, "theme">): string {
  if (value.startsWith("#")) return value.toUpperCase();
  const token = value.slice(1);
  const resolved = document.theme.tokens[token];
  if (!resolved) throw new SlideIrTokenError(value);
  return resolved.toUpperCase();
}

export function collectColorReferences(document: SlideIrDocument): string[] {
  const references = JSON.stringify(document).match(/\$[a-z][\w-]*/gi) ?? [];
  return [...new Set(references)];
}

