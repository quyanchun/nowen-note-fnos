/**
 * SQL Dialect Helper 测试
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  nowExpression,
  placeholder,
  convertPlaceholders,
  booleanValue,
  conflictDoNothing,
} from "../src/db/dialect";

// ============================================================
// nowExpression
// ============================================================

test("sqlite nowExpression returns datetime('now')", () => {
  assert.equal(nowExpression("sqlite"), "datetime('now')");
});

test("postgres nowExpression returns NOW()", () => {
  assert.equal(nowExpression("postgres"), "NOW()");
});

// ============================================================
// placeholder
// ============================================================

test("sqlite placeholder returns ?", () => {
  assert.equal(placeholder(1, "sqlite"), "?");
  assert.equal(placeholder(2, "sqlite"), "?");
});

test("postgres placeholder returns $N", () => {
  assert.equal(placeholder(1, "postgres"), "$1");
  assert.equal(placeholder(2, "postgres"), "$2");
  assert.equal(placeholder(10, "postgres"), "$10");
});

// ============================================================
// convertPlaceholders
// ============================================================

test("sqlite convertPlaceholders returns sql unchanged", () => {
  const sql = "SELECT * FROM t WHERE a = ? AND b = ?";
  assert.equal(convertPlaceholders(sql, "sqlite"), sql);
});

test("postgres convertPlaceholders converts ? to $1, $2", () => {
  const sql = "SELECT * FROM t WHERE a = ? AND b = ?";
  assert.equal(convertPlaceholders(sql, "postgres"), "SELECT * FROM t WHERE a = $1 AND b = $2");
});

test("postgres convertPlaceholders handles single ?", () => {
  assert.equal(convertPlaceholders("SELECT ? FROM t", "postgres"), "SELECT $1 FROM t");
});

test("postgres convertPlaceholders handles no ?", () => {
  const sql = "SELECT * FROM t";
  assert.equal(convertPlaceholders(sql, "postgres"), sql);
});

test("postgres convertPlaceholders handles three ?", () => {
  const sql = "INSERT INTO t (a, b, c) VALUES (?, ?, ?)";
  assert.equal(convertPlaceholders(sql, "postgres"), "INSERT INTO t (a, b, c) VALUES ($1, $2, $3)");
});

// ============================================================
// booleanValue
// ============================================================

test("sqlite booleanValue returns 1/0", () => {
  assert.equal(booleanValue(true, "sqlite"), 1);
  assert.equal(booleanValue(false, "sqlite"), 0);
});

test("postgres booleanValue returns true/false", () => {
  assert.equal(booleanValue(true, "postgres"), true);
  assert.equal(booleanValue(false, "postgres"), false);
});

// ============================================================
// conflictDoNothing
// ============================================================

test("sqlite conflictDoNothing returns INSERT OR IGNORE", () => {
  assert.equal(conflictDoNothing("sqlite"), "INSERT OR IGNORE");
});

test("postgres conflictDoNothing returns ON CONFLICT DO NOTHING", () => {
  assert.equal(conflictDoNothing("postgres"), "ON CONFLICT DO NOTHING");
});
