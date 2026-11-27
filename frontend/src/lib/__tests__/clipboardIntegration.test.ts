import { afterEach, expect, it, vi } from "vitest";
import { clipboardIntegrationApi } from "../clipboardIntegration";
import { fetchWithAuthRefresh } from "../authSession";

vi.mock("@/lib/api", () => ({ getBaseUrl: () => "http://127.0.0.1:3001/api" }));
vi.mock("../authSession", () => ({ fetchWithAuthRefresh: vi.fn(), getAccessToken: () => "synthetic-local-token" }));
afterEach(() => { vi.clearAllMocks(); });

it("preserves the NAS authorization recovery code through the clipboard API", async () => {
  vi.mocked(fetchWithAuthRefresh).mockResolvedValueOnce(Response.json({
    error: "NAS 授权已失效", code: "DESKTOP_NAS_AUTH_EXPIRED",
  }, { status: 409 }));
  await expect(clipboardIntegrationApi.get()).rejects.toMatchObject({
    message: "NAS 授权已失效", code: "DESKTOP_NAS_AUTH_EXPIRED", status: 409,
  });
});
it("sends the selected record filter with its page offset",async()=>{
  vi.mocked(fetchWithAuthRefresh).mockResolvedValueOnce(Response.json({items:[],hasMore:false}));
  await clipboardIntegrationApi.logs(30,"filtered");
  expect(vi.mocked(fetchWithAuthRefresh).mock.calls[0][0]).toBe("http://127.0.0.1:3001/api/clipboard-settings/logs?offset=30&status=filtered");
});
