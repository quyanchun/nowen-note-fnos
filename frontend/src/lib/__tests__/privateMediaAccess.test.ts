import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ token: "login-one", request: vi.fn() }));
vi.mock("../api.impl", () => ({ getBaseUrl: () => "https://notes.test/api" }));
vi.mock("../authSession", () => ({ getAccessToken: () => mocks.token, fetchWithAuthRefresh: mocks.request }));
import { resolvePrivateMediaUrl, resetPrivateMediaAccess } from "../privateMediaAccess";
const id = "11111111-1111-4111-8111-111111111111";
const raw = `https://notes.test/api/task-attachments/${id}`;
describe("private media capabilities", () => {
  beforeEach(() => { resetPrivateMediaAccess(); mocks.token = "login-one"; mocks.request.mockReset(); });
  it("does not send credentials to foreign origins or unrelated routes", async () => {
    const foreign = raw.replace("notes.test", "evil.test");
    expect(await resolvePrivateMediaUrl(foreign)).toBe(foreign);
    expect(await resolvePrivateMediaUrl("https://notes.test/api/notes/x")).toContain("/notes/x");
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it("uses a per-file capability, preserves download options and caches it", async () => {
    mocks.request.mockResolvedValue({ ok: true, json: async () => ({ url: `/api/task-attachments/${id}?mediaAccess=signed`, expiresAt: Date.now()+600_000 }) });
    const signed = await resolvePrivateMediaUrl(raw+"?download=1");
    expect(signed).toContain("mediaAccess=signed"); expect(signed).toContain("download=1");
    expect(signed).not.toContain("login-one");
    await resolvePrivateMediaUrl(raw); expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(mocks.request.mock.calls[0][0]).toBe(raw+"?access=1");
  });
  it("keeps successful refreshes within the same account session", async () => {
    const token = (iat: number) => `header.${btoa(JSON.stringify({ userId: "owner", jti: "session", iat }))}.signature`;
    mocks.token = token(1);
    mocks.request.mockImplementation(async () => { mocks.token = token(2); return { ok: true, json: async () => ({ url: raw+"?mediaAccess=refreshed", expiresAt: Date.now()+600_000 }) }; });
    expect(await resolvePrivateMediaUrl(raw)).toContain("mediaAccess=refreshed");
  });
  it("rejects a capability response pointing at another origin", async () => {
    mocks.request.mockResolvedValue({ ok: true, json: async () => ({ url: "https://evil.test/api/task-attachments/"+id+"?mediaAccess=x", expiresAt: Date.now()+600_000 }) });
    await expect(resolvePrivateMediaUrl(raw)).rejects.toThrow("origin");
  });
  it("discards late responses after switching accounts", async () => {
    mocks.request.mockImplementation(async () => { mocks.token = "login-two"; return { ok: true, json: async () => ({ url: raw+"?mediaAccess=old", expiresAt: Date.now()+600_000 }) }; });
    await expect(resolvePrivateMediaUrl(raw)).rejects.toThrow("session changed");
  });
});
