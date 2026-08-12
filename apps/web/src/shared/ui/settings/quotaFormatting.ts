export function formatQuotaUsage(
  used: number,
  limit: number | null | undefined,
  unlimitedLabel: string,
): string {
  const limitText = !limit || limit <= 0 ? unlimitedLabel : limit.toLocaleString();
  return `${used.toLocaleString()} / ${limitText}`;
}
