import type { EditorView } from "@codemirror/view";

export interface MarkdownScrollAnchor {
  pos: number;
  top: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function interpolateScrollByPosition(
  anchors: MarkdownScrollAnchor[],
  pos: number,
  fallbackMax: number,
  documentLength: number,
): number {
  if (anchors.length < 2) {
    return documentLength > 0 ? (clamp(pos, 0, documentLength) / documentLength) * fallbackMax : 0;
  }

  const sorted = [...anchors].sort((a, b) => a.pos - b.pos);
  const target = clamp(pos, sorted[0].pos, sorted[sorted.length - 1].pos);
  let previous = sorted[0];
  for (let index = 1; index < sorted.length; index += 1) {
    const next = sorted[index];
    if (target <= next.pos) {
      const span = next.pos - previous.pos;
      const ratio = span > 0 ? (target - previous.pos) / span : 0;
      return previous.top + (next.top - previous.top) * ratio;
    }
    previous = next;
  }
  return sorted[sorted.length - 1].top;
}

export function interpolatePositionByScroll(
  anchors: MarkdownScrollAnchor[],
  scrollTop: number,
  fallbackMax: number,
  documentLength: number,
): number {
  if (anchors.length < 2) {
    return fallbackMax > 0 ? Math.round((clamp(scrollTop, 0, fallbackMax) / fallbackMax) * documentLength) : 0;
  }

  const sorted = [...anchors].sort((a, b) => a.top - b.top);
  const target = clamp(scrollTop, sorted[0].top, sorted[sorted.length - 1].top);
  let previous = sorted[0];
  for (let index = 1; index < sorted.length; index += 1) {
    const next = sorted[index];
    if (target <= next.top) {
      const span = next.top - previous.top;
      const ratio = span > 0 ? (target - previous.top) / span : 0;
      return Math.round(previous.pos + (next.pos - previous.pos) * ratio);
    }
    previous = next;
  }
  return sorted[sorted.length - 1].pos;
}

export function collectMarkdownPreviewAnchors(root: HTMLElement, documentLength: number): MarkdownScrollAnchor[] {
  const rootRect = root.getBoundingClientRect();
  const anchors = Array.from(root.querySelectorAll<HTMLElement>("[data-md-pos]"))
    .map((element) => ({
      pos: Number(element.dataset.mdPos),
      top: element.getBoundingClientRect().top - rootRect.top + root.scrollTop,
    }))
    .filter((anchor) => Number.isFinite(anchor.pos) && Number.isFinite(anchor.top));

  anchors.push({ pos: 0, top: 0 });
  anchors.push({
    pos: documentLength,
    top: Math.max(0, root.scrollHeight - root.clientHeight),
  });

  const byPosition = new Map<number, MarkdownScrollAnchor>();
  for (const anchor of anchors) {
    const existing = byPosition.get(anchor.pos);
    if (!existing || anchor.top < existing.top) byPosition.set(anchor.pos, anchor);
  }
  return [...byPosition.values()].sort((a, b) => a.pos - b.pos);
}

function sourceTopPosition(view: EditorView): number {
  try {
    return view.lineBlockAtHeight(view.scrollDOM.scrollTop).from;
  } catch {
    const max = Math.max(1, view.scrollDOM.scrollHeight - view.scrollDOM.clientHeight);
    return Math.round((view.scrollDOM.scrollTop / max) * view.state.doc.length);
  }
}

function sourceTopForPosition(view: EditorView, pos: number): number {
  try {
    return view.lineBlockAt(clamp(pos, 0, view.state.doc.length)).top;
  } catch {
    const max = Math.max(0, view.scrollDOM.scrollHeight - view.scrollDOM.clientHeight);
    return view.state.doc.length > 0 ? (pos / view.state.doc.length) * max : 0;
  }
}

/**
 * Synchronize CodeMirror and Markdown preview using source offsets emitted by
 * react-markdown nodes. A short directional lock prevents feedback loops.
 */
export function attachMarkdownSplitScrollSync(view: EditorView, previewRoot: HTMLElement): () => void {
  let lock: "source" | "preview" | null = null;
  let unlockTimer: number | null = null;
  let frame = 0;
  let disposed = false;

  const setLock = (side: "source" | "preview") => {
    lock = side;
    if (unlockTimer !== null) window.clearTimeout(unlockTimer);
    unlockTimer = window.setTimeout(() => { lock = null; }, 90);
  };

  const schedule = (callback: () => void) => {
    window.cancelAnimationFrame(frame);
    frame = window.requestAnimationFrame(() => {
      if (!disposed) callback();
    });
  };

  const syncFromSource = () => {
    if (lock === "preview") return;
    setLock("source");
    schedule(() => {
      const docLength = view.state.doc.length;
      const anchors = collectMarkdownPreviewAnchors(previewRoot, docLength);
      const previewMax = Math.max(0, previewRoot.scrollHeight - previewRoot.clientHeight);
      previewRoot.scrollTop = interpolateScrollByPosition(
        anchors,
        sourceTopPosition(view),
        previewMax,
        docLength,
      );
    });
  };

  const syncFromPreview = () => {
    if (lock === "source") return;
    setLock("preview");
    schedule(() => {
      const docLength = view.state.doc.length;
      const anchors = collectMarkdownPreviewAnchors(previewRoot, docLength);
      const previewMax = Math.max(0, previewRoot.scrollHeight - previewRoot.clientHeight);
      const pos = interpolatePositionByScroll(anchors, previewRoot.scrollTop, previewMax, docLength);
      view.scrollDOM.scrollTop = sourceTopForPosition(view, pos);
    });
  };

  view.scrollDOM.addEventListener("scroll", syncFromSource, { passive: true });
  previewRoot.addEventListener("scroll", syncFromPreview, { passive: true });

  // Entering split mode should immediately preserve the source editor's context.
  // Waiting one frame lets React finish laying out the preview before measuring anchors.
  syncFromSource();

  return () => {
    disposed = true;
    view.scrollDOM.removeEventListener("scroll", syncFromSource);
    previewRoot.removeEventListener("scroll", syncFromPreview);
    window.cancelAnimationFrame(frame);
    if (unlockTimer !== null) window.clearTimeout(unlockTimer);
  };
}
