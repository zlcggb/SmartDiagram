import { parseDocument, stringify } from "yaml";
import { SlideIrSchema, type SlideIrDocument } from "./schema.js";

export class SmartSlideParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SmartSlideParseError";
  }
}

export function parseSmartSlide(source: string): SlideIrDocument {
  if (source.length > 2_500_000) {
    throw new SmartSlideParseError("SmartSlide 源码超过 2.5 MB 限制");
  }
  const document = parseDocument(source, {
    prettyErrors: true,
    strict: true,
    uniqueKeys: true
  });
  if (document.errors.length > 0) {
    throw new SmartSlideParseError(
      document.errors.map((error) => error.message).join("；")
    );
  }
  let value: unknown;
  try {
    value = document.toJS({ maxAliasCount: 0 });
  } catch (error) {
    throw new SmartSlideParseError(
      error instanceof Error ? error.message : "SmartSlide YAML 无法解析"
    );
  }
  const parsed = SlideIrSchema.safeParse(value);
  if (!parsed.success) {
    const message = parsed.error.issues
      .slice(0, 12)
      .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
      .join("；");
    throw new SmartSlideParseError(message);
  }
  return parsed.data;
}

export function stringifySmartSlide(input: SlideIrDocument): string {
  const document = SlideIrSchema.parse(input);
  return stringify(document, {
    aliasDuplicateObjects: false,
    indent: 2,
    lineWidth: 0,
    simpleKeys: true
  });
}

