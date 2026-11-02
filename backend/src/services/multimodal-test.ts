import { aiOutboundFetch } from "./ai-outbound-fetch";
import { normalizeAiAssistantMessage } from "./ai-client";
import type { AICustomHeaders } from "./ai-custom-headers";

// A synthetic 32px red square; no user image or note content is sent by this test.
const TEST_IMAGE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKElEQVR4nO3NsQ0AAAzCMP5/un0CNkuZ41wybXsHAAAAAAAAAAAAxR4yw/wuPL6QkAAAAABJRU5ErkJggg==";
export class MultimodalTestError extends Error {}

export async function testMultimodalConnection(channel: { apiUrl: string; apiKey: string; customHeaders: AICustomHeaders }, model: string, signal?: AbortSignal) {
  const started = Date.now();
  let response: Response;
  try {
    response = await aiOutboundFetch(`${channel.apiUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(channel.apiKey ? { Authorization: `Bearer ${channel.apiKey}` } : {}) },
      customHeaders: channel.customHeaders,
      body: JSON.stringify({ model, stream: false, max_tokens: 128, messages: [{ role: "user", content: [
        { type: "text", text: "What is the dominant color of the square in this image? Reply with exactly one word: RED, GREEN, or BLUE." },
        { type: "image_url", image_url: { url: TEST_IMAGE } },
      ] }] }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(25000)]) : AbortSignal.timeout(25000),
    });
  } catch { throw new MultimodalTestError("图片测试连接失败，请检查渠道地址和网络"); }
  if (!response.ok) throw new MultimodalTestError(`图片请求失败（HTTP ${response.status}），请检查模型是否支持图片及渠道权限`);
  let answer: string;
  try { answer = normalizeAiAssistantMessage(await response.json()); }
  catch { throw new MultimodalTestError("图片接口返回了无效响应"); }
  if (!/^red[.!。！]?$/i.test(answer.trim())) throw new MultimodalTestError("未通过图片识别测试，请确认模型支持图片理解");
  return { success: true, message: "图片测试通过", durationMs: Date.now() - started };
}
