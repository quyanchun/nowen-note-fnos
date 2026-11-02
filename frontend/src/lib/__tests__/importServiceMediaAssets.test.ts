import { describe, expect, it } from "vitest";
import { markdownToSimpleHtml } from "@/lib/importService";

describe("importService media asset resolution", () => {
  it("replaces local image and video asset sources with data URIs", () => {
    const html = markdownToSimpleHtml([
      "![image](assets/image.png)",
      "",
      "<video controls src=\"assets/video.mp4\"></video>",
    ].join("\n"), {
      "assets/image.png": "data:image/png;base64,aW1hZ2U=",
      "assets/video.mp4": "data:video/mp4;base64,dmlkZW8=",
    });

    expect(html).toContain("data:image/png;base64,aW1hZ2U=");
    expect(html).toContain("data:video/mp4;base64,dmlkZW8=");
    expect(html).not.toContain("assets/image.png");
    expect(html).not.toContain("assets/video.mp4");
  });
});
