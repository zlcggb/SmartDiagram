const ICON_SEGMENT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

function iconParts(value: string): [string, string] | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;

  const separator = normalized.includes(":") ? ":" : normalized.includes("/") ? "/" : null;
  const parts = separator ? normalized.split(separator) : ["lucide", normalized];
  if (
    parts.length !== 2
    || !ICON_SEGMENT.test(parts[0] ?? "")
    || !ICON_SEGMENT.test(parts[1] ?? "")
  ) {
    return null;
  }
  return [parts[0]!, parts[1]!];
}

export function iconifyResourceUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const parts = iconParts(value);
  if (!parts) return null;
  return `https://api.iconify.design/${parts[0]}/${parts[1]}.svg`;
}
