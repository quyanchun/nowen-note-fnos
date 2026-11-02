import test from "node:test";
import assert from "node:assert/strict";
import { generateOpenAPISpec } from "../src/services/openapi.js";

test("OpenAPI note schemas include contentFormat", () => {
  const spec = generateOpenAPISpec();
  assert.deepEqual(spec.components.schemas.Note.properties.contentFormat.enum, ["tiptap-json", "markdown", "html", "plaintext"]);
  const create = spec.paths["/api/notes"].post.requestBody.content["application/json"].schema;
  assert.equal(create.properties.contentFormat.default, "tiptap-json");
  const update = spec.paths["/api/notes/{id}"].put.requestBody.content["application/json"].schema;
  assert.equal(update.properties.version.type, "integer");
});

test("OpenAPI capture contract distinguishes accepted jobs, original text and committed note results", () => {
  const spec = generateOpenAPISpec();
  const post = spec.paths["/api/captures"].post;
  assert.deepEqual(post.requestBody.content["application/json"].schema.required, ["requestId", "content"]);
  assert.ok(post.responses["202"]);
  assert.ok(post.responses["409"]);
  assert.equal(spec.components.schemas.Capture.properties.originalContent.type, "string");
  assert.ok(spec.components.schemas.Capture.properties.status.enum.includes("filtered"));
  assert.deepEqual(spec.components.schemas.Capture.properties.reasonCode.enum, ["AI_FILTERED"]);
  assert.equal(spec.components.schemas.Capture.properties.result.properties.version.type, "integer");
  assert.ok(spec.paths["/api/captures/{id}/retry"].post.responses["409"]);
});
