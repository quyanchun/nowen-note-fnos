import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";

describe("getSiteSettingsPublic", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("公开站点设置请求禁用浏览器缓存", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      site_title: "nowen-note",
      site_favicon: "",
      site_icp_beian: "粤ICP备12345678号-1",
      editor_font_family: "",
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await api.getSiteSettingsPublic();

    expect(fetchMock).toHaveBeenCalledWith("/api/settings", expect.objectContaining({
      cache: "no-store",
    }));
  });
});
