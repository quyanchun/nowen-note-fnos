import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { NowenApiClient } from "../src/api-client.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("MCP uploadAttachment sends multipart data without JSON content type", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "nowen-mcp-"));
  const filePath = path.join(dir, "图片.png");
  await writeFile(filePath, Buffer.from("png-bytes"));

  const calls: Array<{ url: string; init: RequestInit }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init || {} });
    if (calls.length === 1) return jsonResponse({ token: "token-1" });
    return jsonResponse({
      id: "att-1",
      url: "/api/attachments/att-1",
      mimeType: "image/png",
      size: 9,
      filename: "图片.png",
      category: "image",
    }, 201);
  }) as typeof fetch;

  try {
    const client = new NowenApiClient({
      baseUrl: "http://example.test",
      username: "admin",
      password: "pw",
    });

    const result = await client.uploadAttachment({
      filePath,
      noteId: "note-1",
      mimeType: "image/png",
    });

    assert.equal(result.id, "att-1");
    assert.equal(calls[1].url, "http://example.test/api/attachments");
    assert.equal(calls[1].init.method, "POST");
    assert.equal((calls[1].init.headers as Record<string, string>).Authorization, "Bearer token-1");
    assert.equal((calls[1].init.headers as Record<string, string>)["Content-Type"], undefined);
    assert.ok(calls[1].init.body instanceof FormData);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
  }
});

test("MCP attachToNote appends markdown link with current note version", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init || {} });
    if (calls.length === 1) return jsonResponse({ token: "token-1" });
    if (String(url).endsWith("/api/files/att-1")) {
      return jsonResponse({ id: "att-1", filename: "截图.png", mimeType: "image/png", category: "image" });
    }
    if (String(url).endsWith("/api/notes/note-1") && (init?.method || "GET") === "GET") {
      return jsonResponse({ id: "note-1", content: "正文", contentFormat: "markdown", version: 7 });
    }
    return jsonResponse({ id: "note-1", version: 8 });
  }) as typeof fetch;

  try {
    const client = new NowenApiClient({
      baseUrl: "http://example.test",
      username: "admin",
      password: "pw",
    });

    await client.attachToNote({
      noteId: "note-1",
      attachmentId: "att-1",
      alt: "截图",
      mode: "append",
    });

    const update = calls[3];
    assert.equal(update.url, "http://example.test/api/notes/note-1");
    assert.equal(update.init.method, "PUT");
    const body = JSON.parse(String(update.init.body));
    assert.equal(body.version, 7);
    assert.equal(body.contentFormat, "markdown");
    assert.equal(body.content, "正文\n\n![截图](/api/attachments/att-1)");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("MCP server registers attachment tools", async () => {
  const source = await readFile(path.resolve("src/index.ts"), "utf8");

  assert.match(source, /nowen_upload_attachment/);
  assert.match(source, /nowen_list_attachments/);
  assert.match(source, /nowen_attach_to_note/);
});
