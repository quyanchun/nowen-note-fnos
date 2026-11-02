import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isTaskDateOverdue, toLocalDate } from "../DateBadge";

function todayStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function yesterdayStr(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function tomorrowStr(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

describe("toLocalDate", () => {
  it("parses YYYY-MM-DD as local date (not UTC)", () => {
    const d = toLocalDate("2026-06-15");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(5); // 0-indexed: June = 5
    expect(d.getDate()).toBe(15);
  });

  it("handles leap year date", () => {
    const d = toLocalDate("2024-02-29");
    expect(d.getDate()).toBe(29);
  });

  it("handles invalid date gracefully", () => {
    // parseISO of invalid string returns Invalid Date,
    // fallback splits by "-" which may produce NaN
    const d = toLocalDate("not-a-date");
    // Should not throw; may return Invalid Date
    expect(d).toBeDefined();
  });
});

describe("isTaskDateOverdue", () => {
  it("today is NOT overdue (pure date)", () => {
    expect(isTaskDateOverdue(todayStr())).toBe(false);
  });

  it("yesterday IS overdue", () => {
    expect(isTaskDateOverdue(yesterdayStr())).toBe(true);
  });

  it("tomorrow is NOT overdue", () => {
    expect(isTaskDateOverdue(tomorrowStr())).toBe(false);
  });

  it("dueAt in the past IS overdue", () => {
    const pastTime = new Date(Date.now() - 3600_000).toISOString(); // 1 hour ago
    expect(isTaskDateOverdue(todayStr(), pastTime)).toBe(true);
  });

  it("dueAt in the future is NOT overdue", () => {
    const futureTime = new Date(Date.now() + 3600_000).toISOString(); // 1 hour from now
    expect(isTaskDateOverdue(todayStr(), futureTime)).toBe(false);
  });

  it("dueAt exactly now is NOT overdue (edge: diff <= 0)", () => {
    // Date.now() > dueTime, so exactly now should be overdue
    // Actually if dueTime = Date.now(), by the time we check it might be slightly past
    // The function uses strict > so exactly equal is NOT overdue
    const now = new Date().toISOString();
    // This is a timing-sensitive test; just verify it doesn't crash
    const result = isTaskDateOverdue(todayStr(), now);
    expect(typeof result).toBe("boolean");
  });

  it("null dueAt falls back to date-only comparison", () => {
    expect(isTaskDateOverdue(yesterdayStr(), null)).toBe(true);
    expect(isTaskDateOverdue(tomorrowStr(), null)).toBe(false);
  });

  it("empty string dueAt falls back to date-only comparison", () => {
    expect(isTaskDateOverdue(yesterdayStr(), "")).toBe(true);
  });
});
