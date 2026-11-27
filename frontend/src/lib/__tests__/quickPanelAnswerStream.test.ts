// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { reliableAsk } from "../aiReliable";
import { installDesktopNativeHttpBridge } from "../desktopNativeHttpBridge";

vi.mock("@/lib/api", () => ({ getBaseUrl: () => "http://localhost/api", getCurrentWorkspace: () => "personal" }));

it("renders the first answer chunk before the desktop response finishes and keeps its cancellation signal", async () => {
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  const response = new ReadableStream<Uint8Array>({ start(ctrl) { stream = ctrl; } });
  const fetchStream = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(response));
  const nativeJson = vi.fn();
  vi.stubGlobal("nowenDesktop", { isDesktop: true, http: { requestJson: nativeJson } });
  vi.stubGlobal("fetch", fetchStream);
  const uninstall = installDesktopNativeHttpBridge();
  const controller = new AbortController();
  try {
    const onChunk = vi.fn();
    const result = reliableAsk({ mode: "knowledge", question: "时间？" }, { onChunk }, controller.signal);
    const enc = new TextEncoder();
    stream.enqueue(enc.encode('event: message\ndata: {"t":"九点"}\n\n'));
    await vi.waitFor(() => expect(onChunk).toHaveBeenCalledWith("九点"));
    expect(fetchStream.mock.calls[0][1]?.signal).toBe(controller.signal);
    expect(nativeJson).not.toHaveBeenCalled();
    stream.enqueue(enc.encode("event: done\ndata: [DONE]\n\n"));
    stream.close();
    expect(await result).toBe("九点");
  } finally {
    uninstall?.();
    vi.unstubAllGlobals();
  }
});

it("keeps partial panel text but rejects EOF before the answer completion event", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response('event: message\ndata: {"t":"半段"}\n\n')));
  const onChunk = vi.fn();
  try {
    await expect(reliableAsk({ mode: "knowledge", question: "时间？", presentation: "quick-panel" }, { onChunk })).rejects.toThrow("中途断开");
    expect(onChunk).toHaveBeenCalledWith("半段");
  } finally { vi.unstubAllGlobals(); }
});
