import { useEffect, useRef } from "react";
import { api, getCurrentWorkspace } from "@/lib/api";
import { projectMarkdownForUser, sanitizeMarkdownClipboardText } from "@/lib/markdownUserContent";
import { getQuickPanel, type QuickPanelAction, type QuickPanelReply, type QuickQuery } from "@/lib/desktopBridge";
import { getHomeCaptureScope, saveHomeCapture, type HomeCaptureDraft } from "@/lib/homeCapture";

export function useMacQuickPanel(onAction: (action: QuickPanelAction) => void, onSaved?: () => void) {
  const bridge = getQuickPanel();
  const scope = bridge ? getHomeCaptureScope() : "";
  const actions = useRef({ onAction, onSaved });
  actions.current = { onAction, onSaved };
  useEffect(() => {
    if (!bridge) return;
    const requests = new Map<string, AbortController>();
    let attempted: { id: string; title: string; text: string; organize: boolean; target?: { notebookId: string; path: string } } | undefined;
    function cancelReads() {
      for (const [key, controller] of requests) if (key !== "save") controller.abort();
    }
    const offQuery = bridge.onQuery(async (request: QuickQuery) => {
      if (request.kind === "clear") { cancelReads(); return; }
      const lane = request.kind === "preview" ? "search" : request.kind;
      requests.get(lane)?.abort();
      if (!request.query || scope !== getHomeCaptureScope()) return;
      const controller = new AbortController();
      requests.set(lane, controller);
      const { signal } = controller;
      const current = () => !signal.aborted && scope === getHomeCaptureScope();
      const send = (reply: QuickPanelReply) => {
        if (current()) bridge.results({ id: request.id, kind: request.kind, query: request.query, ...reply });
      };
      let paintTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        if (request.kind === "ask") {
          const [{ reliableAsk }, { quickPanelMarkdown }] = await Promise.all([import("@/lib/aiReliable"), import("@/lib/quickPanelPreview")]);
          if (!current()) return;
          let answer = "", lastPaint = -Infinity;
          let hitCount: number | undefined;
          const paint = () => {
            clearTimeout(paintTimer);
            paintTimer = undefined;
            if (!current()) return;
            lastPaint = performance.now();
            send({ answerHtml: quickPanelMarkdown(answer) });
          };
          const final = await reliableAsk({ question: request.query, mode: "knowledge", presentation: "quick-panel" }, {
            onChunk(chunk) {
              if (!current() || hitCount === 0) return;
              answer += chunk;
              const remaining = 50 - (performance.now() - lastPaint);
              if (remaining <= 0) paint();
              else paintTimer ??= setTimeout(paint, remaining);
            },
            onDiagnostics({ hits }) {
              hitCount = hits.length;
              send({ rows: hits.map(hit => ({
                id: hit.noteId, title: hit.title, snippet: sanitizeMarkdownClipboardText(hit.preview), updatedAt: hit.updatedAt,
                notebook: hit.notebook || (hit.kind === "attachment" ? "附件" : "笔记"),
              })) });
            },
          }, signal).catch(error => {
            if (paintTimer !== undefined) paint();
            throw error;
          });
          if (current()) send(hitCount === 0 ? { answerHtml: "", done: true } : final.trim() ? { answerHtml: quickPanelMarkdown(final), done: true } : { error: "没有收到回答，请重试" });
        } else if (request.kind === "detail") {
          const note = await api.getNote(request.query);
          if (!current()) return;
          if (note.isTrashed || (note.workspaceId || "personal") !== getCurrentWorkspace()) throw new Error("这篇笔记在当前工作区不可用");
          const { quickPanelNote } = await import("@/lib/quickPanelPreview");
          send({ detail: await quickPanelNote(note) });
        } else if (request.kind === "save" && request.draft) {
          const draft = request.draft;
          const organize = request.organize === true;
          if (attempted?.id === draft.id) {
            // A lost acknowledgement may follow a committed create. Never file the same ID again.
            const existing = await api.getNote(draft.id).catch(error => {
              if (error?.status === 404) return null;
              throw error;
            });
            if (!current()) return;
            if (existing) {
              if (existing.isTrashed || (existing.workspaceId || "personal") !== getCurrentWorkspace() ||
                existing.title !== (draft.title || draft.text.trim().split(/\r?\n/)[0].replace(/^#{1,6}\s+/, "").slice(0, 60)) ||
                projectMarkdownForUser(existing.content).trim() !== draft.text.trim()) throw new Error("已有笔记与草稿不同，草稿已保留");
              send({ saved: existing.id, folder: attempted.target?.path });
              attempted = undefined;
              actions.current.onSaved?.();
              return;
            }
          }
          if (!attempted || attempted.id !== draft.id || attempted.text !== draft.text || attempted.title !== draft.title || attempted.organize !== organize) {
            attempted = { ...draft, organize };
          }
          const attempt = attempted;
          if (organize && !attempt.target) {
            const { collaborationRequest } = await import("@/lib/aiCollaboration");
            if (!current()) return;
            attempt.target = await collaborationRequest("quick-folder", { title: draft.title, text: draft.text }, signal);
            if (!current()) return;
          }
          const note = await saveHomeCapture({ ...draft, key: scope, files: [], notebookId: attempt.target?.notebookId }, async (step: HomeCaptureDraft) => {
            if (!organize && step.notebookId) attempt.target = { notebookId: step.notebookId, path: "收集箱" };
          }, "收集箱");
          if (current()) {
            send({ saved: note.id, folder: attempt.target?.path });
            attempted = undefined;
            actions.current.onSaved?.();
          }
        } else {
          const notes = await api.searchNotes(request.query, request.kind === "search" ? 50 : 5, signal);
          send({ rows: notes.map(({ id, title, snippet, notebook, updatedAt }) => ({ id, title, snippet, notebook, updatedAt })) });
        }
      } catch (error) {
        send({ error: error instanceof Error && error.message || "操作失败，请重试" });
      } finally {
        clearTimeout(paintTimer);
        if (requests.get(lane) === controller) requests.delete(lane);
      }
    });
    const offAction = bridge.onAction(action => {
      if (scope === getHomeCaptureScope()) actions.current.onAction(action);
    });
    bridge.ready(true);
    return () => {
      for (const controller of requests.values()) controller.abort();
      bridge.ready(false);
      offQuery();
      offAction();
    };
  }, [bridge, scope]);
}
