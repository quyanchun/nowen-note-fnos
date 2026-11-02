import { describe, expect, it } from "vitest";
import { hasUnsavedEditorChanges } from "../editorSyncGuards";

const current = { content: '{"type":"doc","content":[]}', contentText: "", title: "Test" };
const normalized = { ...current, content: '{"type":"doc","content":[{"type":"paragraph"}]}' };
describe("remote rich-text refresh safety", () => {
  it("allows an untouched normalized rich-text document to receive a remote body (DCC-011)", () => {
    expect(hasUnsavedEditorChanges({ current, snapshot: normalized, pendingChanges: false, saving: false, failedDraft: false })).toBe(false);
  });
  it("protects debounced edits even when the optimistic note already matches the snapshot", () => {
    expect(hasUnsavedEditorChanges({ current, snapshot: current, pendingChanges: true, saving: false, failedDraft: false })).toBe(true);
  });
  it("protects in-flight saves and failed local drafts after the debounce timer clears", () => {
    for (const status of [{saving:true,failedDraft:false},{saving:false,failedDraft:true}]) {
      expect(hasUnsavedEditorChanges({current,snapshot:normalized,pendingChanges:false,...status})).toBe(true);
    }
  });
  it("retains snapshot comparison for editors without a pending-edit capability", () => {
    expect(hasUnsavedEditorChanges({current,snapshot:normalized,saving:false,failedDraft:false})).toBe(true);
    expect(hasUnsavedEditorChanges({current,snapshot:current,saving:false,failedDraft:false})).toBe(false);
  });
});
