import { describe, expect, it } from "vitest";
import { findTextAction, getTokenAtOffset, normalizeUrl } from "../textActions";

describe("textActions", () => {
  it("detects 11 digit mainland mobile numbers only on mobile", () => {
    expect(findTextAction("联系我 13800138000", true)).toEqual({
      type: "phone",
      value: "13800138000",
      href: "tel:13800138000",
    });
    expect(findTextAction("联系我 13800138000", false)).toBeNull();
    expect(findTextAction("编号 12800138000", true)).toBeNull();
  });

  it("detects and normalizes urls", () => {
    expect(normalizeUrl("www.example.com/a")).toBe("https://www.example.com/a");
    expect(findTextAction("看 https://example.com/a?b=1", false)).toEqual({
      type: "url",
      value: "https://example.com/a?b=1",
      href: "https://example.com/a?b=1",
    });
    expect(findTextAction("看 www.example.com/a", false)).toEqual({
      type: "url",
      value: "www.example.com/a",
      href: "https://www.example.com/a",
    });
  });

  it("prefers phone actions on mobile when both phone and url exist", () => {
    expect(findTextAction("13800138000 https://example.com", true)?.type).toBe("phone");
  });

  it("extracts the clicked token instead of the whole line", () => {
    const text = "电话 13800138000，网站 https://example.com/a?b=1。";
    expect(getTokenAtOffset(text, text.indexOf("3800"))).toBe("13800138000");
    expect(getTokenAtOffset(text, text.indexOf("example"))).toBe("https://example.com/a?b=1");
  });
});
