import test from "node:test";
import assert from "node:assert/strict";
import { generateOpenAPISpec } from "../src/services/openapi";

test("OpenAPI exposes existing attachment and file endpoints", () => {
  const spec = generateOpenAPISpec();
  const paths = spec.paths;

  assert.ok(paths["/api/attachments"]);
  assert.ok(paths["/api/attachments/{id}"]);
  assert.ok(paths["/api/files"]);
  assert.ok(paths["/api/files/stats"]);
  assert.ok(paths["/api/files/{id}"]);
  assert.ok(paths["/api/files/upload"]);
  assert.ok(paths["/api/files/batch-delete"]);

  assert.ok(paths["/api/attachments"].post.requestBody.content["multipart/form-data"]);
  assert.ok(paths["/api/files/upload"].post.requestBody.content["multipart/form-data"]);

  const fileListSchemaRef = paths["/api/files"].get.responses["200"].content["application/json"].schema.$ref;
  assert.equal(fileListSchemaRef, "#/components/schemas/FileListResponse");
  assert.equal(spec.components.schemas.FileListResponse.properties.items.type, "array");
});
