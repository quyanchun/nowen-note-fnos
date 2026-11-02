import { describe, expect, it } from "vitest";
import {
  highlightText,
  sanitizeSearchHtml,
  splitSearchTerms,
  stripSearchMarks,
} from "@/lib/searchHighlight";

const client = "\u5ba2\u6237\u7aef";
const install = "\u5b89\u88c5";

describe("searchHighlight", () => {
  it("keeps contiguous Chinese text as a phrase term", () => {
    expect(splitSearchTerms(`${client}${install}`)).toEqual([`${client}${install}`]);
  });

  it("highlights Chinese phrase matches in plain text", () => {
    expect(highlightText(`windows${client}${install}`, client)).toContain(
      `<mark class="search-result-highlight">${client}</mark>`,
    );
  });

  it("strips backend snippet marks for plain text fallback", () => {
    expect(stripSearchMarks(`windows<mark>${client}</mark>${install}`)).toBe(`windows${client}${install}`);
  });

  it("keeps only mark tags in backend search html", () => {
    expect(sanitizeSearchHtml(`<img src=x onerror=alert(1)>a<mark class="x">${client}</mark>`)).toBe(
      `a<mark>${client}</mark>`,
    );
  });
});
