import assert from "node:assert/strict";
import test from "node:test";
import { parseSingleHttpRange } from "../src/lib/http-range";

test("parses bounded, open-ended and suffix byte ranges", () => {
  assert.deepEqual(parseSingleHttpRange("bytes=2-5", 8), {
    ok: true,
    start: 2,
    end: 5,
    length: 4,
  });
  assert.deepEqual(parseSingleHttpRange("bytes=6-", 8), {
    ok: true,
    start: 6,
    end: 7,
    length: 2,
  });
  assert.deepEqual(parseSingleHttpRange("bytes=-3", 8), {
    ok: true,
    start: 5,
    end: 7,
    length: 3,
  });
});

test("clamps a valid end and rejects unsupported or impossible ranges", () => {
  assert.deepEqual(parseSingleHttpRange("bytes=2-99", 8), {
    ok: true,
    start: 2,
    end: 7,
    length: 6,
  });
  assert.deepEqual(parseSingleHttpRange("bytes=8-9", 8), {
    ok: false,
    reason: "unsatisfiable",
  });
  assert.deepEqual(parseSingleHttpRange("bytes=0-1,4-5", 8), {
    ok: false,
    reason: "multiple",
  });
  assert.deepEqual(parseSingleHttpRange("items=0-1", 8), {
    ok: false,
    reason: "malformed",
  });
  assert.equal(parseSingleHttpRange(undefined, 8), null);
});
