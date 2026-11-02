export type AICustomHeaders = Record<string, string>;

const TRANSPORT_HEADERS = new Set([
  "host", "content-length", "connection", "transfer-encoding", "upgrade",
  "trailer", "expect", "keep-alive", "proxy-connection", "proxy-authorization",
]);

/** Header values can contain credentials; never include input values in errors. */
export function normalizeAICustomHeaders(input: unknown, previous: AICustomHeaders = {}): AICustomHeaders {
  if (input === undefined) return { ...previous };
  let raw = input;
  if (typeof raw === "string") {
    try { raw = raw.trim() ? JSON.parse(raw) : {}; }
    catch { throw new Error("自定义 Headers 必须是有效的 JSON 对象"); }
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("自定义 Headers 必须是 JSON 对象，值必须是字符串");
  const entries = Object.entries(raw);
  if (entries.length > 32) throw new Error("自定义 Headers 最多 32 项");
  const result: AICustomHeaders = Object.create(null);
  let size = 0;
  for (const [key, value] of entries) {
    const name = key.toLowerCase();
    if (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/.test(name) || TRANSPORT_HEADERS.has(name)) {
      throw new Error("自定义 Headers 包含无效或受限的请求头名称");
    }
    if (typeof value !== "string" || /[^\t\x20-\x7e\x80-\xff]/.test(value) || value.length > 4096) {
      throw new Error("自定义 Headers 的值必须是有效的单行字符串（最多 4096 字符）");
    }
    if (Object.hasOwn(result, name)) throw new Error("自定义 Headers 不能包含大小写重复的名称");
    if (value === "****" && !Object.hasOwn(previous, name)) throw new Error("请填写新增请求头的完整值");
    // Public API returns masks. Unchanged masks preserve stored credentials;
    // deleting a property, or saving {}, removes it explicitly.
    result[name] = value === "****" ? previous[name] : value;
    size += name.length + result[name].length;
  }
  if (size > 8192) throw new Error("自定义 Headers 总长度不能超过 8192 字符");
  return result;
}

export function maskAICustomHeaders(headers: AICustomHeaders): AICustomHeaders {
  return Object.fromEntries(Object.keys(headers).map(name => [name, "****"]));
}

/** Custom headers override defaults case-insensitively (including Authorization). */
export function buildAIRequestHeaders(defaults: Record<string, string>, custom?: unknown): Record<string, string> {
  const result = { ...defaults };
  for (const [name, value] of Object.entries(normalizeAICustomHeaders(custom))) {
    for (const key of Object.keys(result)) if (key.toLowerCase() === name) delete result[key];
    // Some private gateways require this spelling on the wire even though
    // HTTP header names are case-insensitive.
    result[name === "authorization" ? "Authorization" : name] = value;
  }
  const authorization = Object.keys(result).find(name => name.toLowerCase() === "authorization");
  if (authorization && authorization !== "Authorization") {
    result.Authorization = result[authorization];
    delete result[authorization];
  }
  return result;
}

export function redactAIHeaderValues(message: string, custom?: unknown): string {
  for (const value of Object.values(normalizeAICustomHeaders(custom))) {
    if (value) {
      message = message.split(value).join("****");
      const bearerToken = /^Bearer\s+(.+)$/i.exec(value)?.[1];
      if (bearerToken) message = message.split(bearerToken).join("****");
    }
  }
  return message;
}
