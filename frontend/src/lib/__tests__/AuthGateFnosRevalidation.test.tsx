import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@/store/AppContext", async (original) => ({
  ...await original<typeof import("@/store/AppContext")>(),
  AppProvider: () => {
    const [draft, setDraft] = useState("");
    return <input aria-label="open dialog draft" value={draft} onChange={(event) => setDraft(event.target.value)} />;
  },
}));
vi.mock("@/lib/syncEngine", async (original) => ({ ...await original<typeof import("@/lib/syncEngine")>(), bootstrap: vi.fn(async () => {}), teardown: vi.fn(), syncNow: vi.fn() }));
vi.mock("@/components/WhatsNewModal", () => ({ default: () => null, useWhatsNew: () => [false, vi.fn()] }));
vi.mock("@/components/LoginPage", () => ({ default: () => <p>Sign in again</p> }));
vi.mock("@/lib/accountLoginHistory", async (original) => ({
  ...await original<typeof import("@/lib/accountLoginHistory")>(),
  isAccountLoginHistorySupported: () => false,
}));

import { AuthGate } from "../../App";
import * as api from "@/lib/api";
import * as auth from "@/lib/authSession";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement;
let root: Root;
let pending: Array<(response: Response) => void>;
const user = { id: "nas-user", username: "fnos_1000", role: "admin" };
const token = `header.${btoa(JSON.stringify({ userId: user.id, username: user.username, exp: 2200000000 }))}.signature`;

beforeEach(() => {
  vi.stubGlobal("__APP_VERSION__", "test");
  localStorage.clear();
  localStorage.setItem("nowen-token", token);
  window.history.replaceState(null, "", "/app/nowen-note-private/");
  vi.spyOn(api, "getServerUrl").mockReturnValue("");
  vi.spyOn(api, "getBaseUrl").mockReturnValue("/app/nowen-note-private/api");
  vi.spyOn(api, "broadcastLogout").mockImplementation(async () => auth.clearAuthTokens());
  pending = [];
  vi.spyOn(auth, "fetchWithAuthRefresh").mockImplementation(() => new Promise<Response>((resolve) => pending.push(resolve)));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount()); host.remove();
  vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear();
  window.history.replaceState(null, "", "/");
});
async function finish(status = 200) {
  await act(async () => pending.splice(0).forEach(resolve => resolve(Response.json(status === 200 ? user : { code: "FNOS_IDENTITY_MISMATCH" }, { status }))));
}

it("keeps the dialog subtree and unsaved input during focus and visibility revalidation", async () => {
  await act(async () => root.render(<AuthGate />));
  await finish();
  const input = host.querySelector("input")!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "unsaved embedding model");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  act(() => {
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(pending.length).toBeGreaterThan(0);
  expect(host.querySelector("input")).toBe(input);
  expect(input.value).toBe("unsaved embedding model");
  await finish();
  expect(host.querySelector("input")).toBe(input);
  expect(input.value).toBe("unsaved embedding model");
});

it("does not show a cached NAS workspace before the first verification (DCC-006)", async () => {
  localStorage.setItem(`nowen-auth-user:${window.location.origin}`, JSON.stringify({ token, user }));
  await act(async () => root.render(<AuthGate />));
  expect(host.querySelector("input")).toBeNull();
  await finish();
  expect(host.querySelector("input")).not.toBeNull();
});

it("removes the previous workspace when NAS identity verification is rejected (DCC-006)", async () => {
  await act(async () => root.render(<AuthGate />)); await finish();
  expect(host.querySelector("input")).not.toBeNull();
  act(() => window.dispatchEvent(new Event("focus")));
  await finish(401);
  expect(host.querySelector("input")).toBeNull();
  expect(host.textContent).toContain("Sign in again");
  expect(auth.getAccessToken()).toBeNull();
});
