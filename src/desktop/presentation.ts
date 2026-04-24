/**
 * Formats a Board Install Tool version line into a concise player-facing value when possible.
 *
 * @param value Raw version text reported by the desktop host.
 * @param fallback Fallback text to use when no version text is available.
 * @returns A shorter display value suitable for UI chips and readonly fields.
 */
export function formatBoardInstallToolVersion(
  value: string | null | undefined,
  fallback = "Unavailable",
): string {
  if (value === null || value === undefined) {
    return fallback;
  }

  const trimmedValue = value.trim();
  if (trimmedValue.length === 0) {
    return fallback;
  }

  return trimmedValue.replace(/^Board OS Version:\s*/i, "").trim();
}
