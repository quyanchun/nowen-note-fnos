import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import test from "node:test";
import { Hono } from "hono";
import { normalizeAICustomHeaders, buildAIRequestHeaders } from "../src/services/ai-custom-headers";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nowen-custom-headers-"));
process.env.DB_PATH = path.join(directory, "test.db");
delete process.env.NOWEN_AI_PROXY_URL;

test("validates header JSON and rejects invalid values without echoing credentials", () => {
  for (const input of ['{"zhixing":"secret"', [], { zhixing: 7 }, { zhixing: "Bearer secret\r\ninjected: yes" }, { Host: "secret" }, { zhixing: "a", ZHIXING: "b" }]) {
    assert.throws(() => normalizeAICustomHeaders(input), error => !String(error).includes("secret"));
  }
  const merged = buildAIRequestHeaders({ Authorization: "Bearer api-key", Accept: "application/json" }, { authorization: "Bearer custom-key", zhixing: "Bearer gateway" });
  assert.equal(merged.Authorization, "Bearer custom-key");
  assert.equal(merged.authorization, undefined);
  assert.equal(merged.zhixing, "Bearer gateway");
  assert.equal(merged.Accept, "application/json");
});

test("profile headers persist, stay masked, reach chat and embedding, and remain user-scoped (DCC-006)", async () => {
  const schema = await import("../src/db/schema");
  const settings = await import("../src/services/user-ai-settings");
  const profiles = await import("../src/routes/user-preferences");
  const ai = await import("../src/routes/ai");
  const reliable = await import("../src/routes/ai-reliable");
  const { callAIChatStream } = await import("../src/services/ai-client");
  const { callEmbeddings } = await import("../src/services/embedding-client");
  const { resolveEmbeddingConfig } = await import("../src/services/embedding-config");
  const db = schema.getDb();
  for (const id of ["header-user", "other-user"]) db.prepare("INSERT INTO users (id, username, passwordHash) VALUES (?, ?, 'unused')").run(id, id);
  const app = new Hono(); app.route("/preferences", profiles.default); app.route("/ai", ai.default); app.route("/reliable", reliable.default);
  const seen: Array<{ path: string; gateway?: string; authorization?: string }> = [];
  const gatewaySecret = "Bearer synthetic-gateway-token";
  const server = http.createServer(async (request, response) => {
    seen.push({ path: request.url!, gateway: request.headers.zhixing as string | undefined, authorization: request.headers.authorization });
    let body = ""; for await (const chunk of request) body += chunk;
    if (request.headers.zhixing !== gatewaySecret) { response.writeHead(401); response.end('{"error":"missing custom header"}'); return; }
    response.setHeader("Content-Type", "application/json");
    if (body && JSON.parse(body).model === "echo-secret") { response.writeHead(500); response.end(JSON.stringify({ error: request.headers.zhixing })); return; }
    if (request.url === "/v1/models") response.end(JSON.stringify({ data: [{ id: "qwen-plus" }, { id: "bge-m3" }] }));
    else if (request.url === "/v1/embeddings") response.end(JSON.stringify({ data: [{ embedding: [0.1, 0.2, 0.3], index: 0 }] }));
    else if (JSON.parse(body).stream) { response.setHeader("Content-Type", "text/event-stream"); response.end('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n'); }
    else response.end(JSON.stringify({ choices: [{ message: { content: "ok" } }] }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
  async function request(method: string, url: string, body?: unknown, user = "header-user") {
    const response = await app.request(url, { method, headers: { "X-User-Id": user, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await response.json() as any;
    assert.doesNotMatch(JSON.stringify(data), /synthetic-gateway-token/);
    return { status: response.status, data };
  }
  try {
    const created = await request("POST", "/preferences/ai-profiles", { name: "Header gateway", provider: "custom", apiUrl: address, apiKey: "synthetic-api-key", model: "qwen-plus", customHeaders: JSON.stringify({ zhixing: gatewaySecret }) });
    assert.equal(created.status, 201);
    const profile = created.data.profile;
    assert.deepEqual(profile.customHeaders, { zhixing: "****" });
    assert.equal(JSON.parse(settings.getUserAISettings("header-user").ai_custom_headers!).zhixing, gatewaySecret);
    const updated = await request("PUT", `/preferences/ai-profiles/${profile.id}`, { ...profile, name: "renamed" });
    assert.equal(updated.status, 200);
    assert.equal(JSON.parse(settings.getUserAISettings("header-user").ai_custom_headers!).zhixing, gatewaySecret);
    const models = await request("POST", "/preferences/ai-profiles/discover-models", { ...profile, profileId: profile.id });
    assert.equal(models.status, 200);
    assert.deepEqual(models.data.models.map((item: { id: string }) => item.id), ["qwen-plus"]);
    assert.equal((await request("POST", "/preferences/ai-profiles/test-draft", { ...profile, profileId: profile.id })).status, 200);
    assert.equal((await request("POST", "/preferences/ai-profiles/test-draft", { ...profile, model: "echo-secret", profileId: profile.id })).status, 502);
    let streamed = "";
    for await (const chunk of callAIChatStream(settings.getUserAISettings("header-user"), [{ role: "user", content: "Hi" }])) streamed += chunk;
    assert.equal(streamed, "ok");
    settings.setUserAISettings("header-user", [{ key: "ai_embedding_profile_id", value: profile.id }, { key: "ai_embedding_model", value: "bge-m3" }]);
    const probe = await request("POST", "/ai/embeddings/test", { source: "profile", profileId: profile.id, model: "bge-m3" });
    assert.equal(probe.status, 200); assert.equal(probe.data.dimension, 3);
    assert.equal((await request("POST", "/ai/embeddings/models", { source: "profile", profileId: profile.id })).status, 200);
    assert.deepEqual(await callEmbeddings(resolveEmbeddingConfig("header-user").config!, ["synthetic test"]), [[0.1, 0.2, 0.3]]);
    assert.equal((await request("POST", "/ai/embeddings/test", { source: "chat", model: "bge-m3" })).status, 200);
    assert.ok(seen.length >= 7);
    assert.ok(seen.every(call => call.gateway === gatewaySecret && call.authorization === "Bearer synthetic-api-key"));
    await request("GET", "/preferences/ai-profiles");
    await request("GET", "/ai/settings");
    assert.equal((await request("POST", "/preferences/ai-profiles/test-draft", { profileId: profile.id }, "other-user")).status, 404);
    const isolated = await request("POST", "/ai/embeddings/test", { source: "custom", url: address, apiKey: "synthetic-api-key", model: "bge-m3" });
    assert.equal(isolated.status, 502); assert.equal(seen.at(-1)?.gateway, undefined);
    assert.equal((await request("PUT", "/reliable/config-enabled", { enabled: false })).status, 200);
    assert.equal(settings.getUserAISettings("header-user").ai_custom_headers, "");
    assert.equal((await request("PUT", "/reliable/config-enabled", { enabled: true })).status, 200);
    assert.equal(JSON.parse(settings.getUserAISettings("header-user").ai_custom_headers!).zhixing, gatewaySecret);
    const cleared = await request("PUT", `/preferences/ai-profiles/${profile.id}`, { customHeaders: {} });
    assert.equal(cleared.status, 200);
    assert.deepEqual(JSON.parse(settings.getUserAISettings("header-user").ai_custom_headers!), {});
    assert.equal((await request("POST", `/preferences/ai-profiles/${profile.id}/test`, {})).status, 502);
  } finally {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    schema.closeDb(); fs.rmSync(directory, { recursive: true, force: true });
  }
});
