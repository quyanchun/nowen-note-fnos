/**
 * SDK 客户端的精简内联版
 * 由于 nowen-cli 和 @nowen/sdk 是独立包，为避免复杂的本地引用，内联核心客户端
 */

export interface NowenConfig {
  baseUrl: string;
  username: string;
  password: string;
}

export class NowenClient {
  private baseUrl: string;
  private username: string;
  private password: string;
  private token: string | null = null;

  constructor(config: NowenConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.username = config.username;
    this.password = config.password;
  }

  private async login(): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: this.username, password: this.password }),
    });
    if (!res.ok) throw new Error(`登录失败 (${res.status})`);
    const data = await res.json() as { token: string };
    this.token = data.token;
  }

  private async ensureAuth(): Promise<void> {
    if (!this.token) await this.login();
  }

  async request<T = any>(
    path: string,
    options: { method?: string; body?: any; query?: Record<string, string | undefined> } = {}
  ): Promise<T> {
    await this.ensureAuth();

    let url = `${this.baseUrl}${path}`;
    if (options.query) {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(options.query)) {
        if (v !== undefined && v !== null && v !== "") params.set(k, v);
      }
      const qs = params.toString();
      if (qs) url += `?${qs}`;
    }

    const headers: Record<string, string> = { "Authorization": `Bearer ${this.token}` };
    if (options.body) headers["Content-Type"] = "application/json";

    let res = await fetch(url, {
      method: options.method || "GET",
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    if (res.status === 401) {
      this.token = null;
      await this.login();
      headers["Authorization"] = `Bearer ${this.token}`;
      res = await fetch(url, {
        method: options.method || "GET",
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
      });
    }

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`API 错误 (${res.status}): ${err}`);
    }

    return res.json() as Promise<T>;
  }

  async readSSE(path: string, body: any): Promise<{ text: string; metadata?: any }> {
    await this.ensureAuth();
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.token}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`API 错误 (${res.status})`);

    const responseText = await res.text();
    let result = "";
    let metadata: any = undefined;
    for (const line of responseText.split("\n")) {
      if (line.startsWith("event: references")) continue;
      if (line.startsWith("data: ")) {
        const data = line.slice(6);
        if (data === "[DONE]") break;
        try {
          const parsed = JSON.parse(data);
          if (Array.isArray(parsed) && parsed[0]?.id) { metadata = parsed; continue; }
        } catch { /* text */ }
        result += data;
      }
    }
    return { text: result, metadata };
  }
}
