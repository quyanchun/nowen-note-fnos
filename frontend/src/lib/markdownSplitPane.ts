export const MARKDOWN_SPLIT_MIN_PERCENT = 25;
export const MARKDOWN_SPLIT_MAX_PERCENT = 75;

export function clampMarkdownSplitPercent(percent: number): number {
  if (!Number.isFinite(percent)) return 50;
  return Math.min(MARKDOWN_SPLIT_MAX_PERCENT, Math.max(MARKDOWN_SPLIT_MIN_PERCENT, percent));
}
