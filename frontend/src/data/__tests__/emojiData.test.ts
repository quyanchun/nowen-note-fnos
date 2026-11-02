import { describe, expect, it } from "vitest";
import {
  ALL_EMOJIS,
  EMOJI_CATEGORIES,
  EMOJI_RECENT_LIMIT,
  filterEmojis,
  parseRecentEmojis,
  pushRecentEmoji,
} from "@/data/emojiData";

describe("emoji data", () => {
  it("ships a broad, categorized local emoji set without duplicates", () => {
    expect(EMOJI_CATEGORIES.length).toBeGreaterThanOrEqual(8);
    expect(ALL_EMOJIS.length).toBeGreaterThan(1000);
    expect(new Set(ALL_EMOJIS).size).toBe(ALL_EMOJIS.length);
  });

  it("searches common Chinese and English aliases", () => {
    expect(filterEmojis("文件夹").map((item) => item.emoji)).toContain("📁");
    expect(filterEmojis("cat").map((item) => item.emoji)).toContain("🐱");
    expect(filterEmojis("rocket").map((item) => item.emoji)).toContain("🚀");
  });

  it("keeps recent emojis in MRU order and rejects invalid stored values", () => {
    const recent = pushRecentEmoji(["📁", "🐱", "🚀"], "🐱");
    expect(recent.slice(0, 3)).toEqual(["🐱", "📁", "🚀"]);

    const oversized = Array.from({ length: EMOJI_RECENT_LIMIT + 10 }, (_, index) => ALL_EMOJIS[index]);
    expect(pushRecentEmoji(oversized, "📁")).toHaveLength(EMOJI_RECENT_LIMIT);
    expect(parseRecentEmojis(JSON.stringify(["📁", "not-an-emoji", "📁", "🐱"]))).toEqual(["📁", "🐱"]);
    expect(parseRecentEmojis("invalid-json")).toEqual([]);
  });
});
