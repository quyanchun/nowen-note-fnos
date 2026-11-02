import { useState, useRef, useCallback } from "react";
import type { MindMapData } from "@/types";

export interface HistoryEntry {
  data: MindMapData;
  title?: string;
}

const MAX_HISTORY = 50;

export function useMindMapHistory(triggerSave: (data: MindMapData, title?: string) => void) {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const historyRef = useRef<{ stack: HistoryEntry[]; idx: number }>({ stack: [], idx: -1 });

  const pushHistory = useCallback((data: MindMapData, title?: string) => {
    const h = historyRef.current;
    h.stack = h.stack.slice(0, h.idx + 1);
    h.stack.push({ data: JSON.parse(JSON.stringify(data)), title });
    if (h.stack.length > MAX_HISTORY) h.stack.shift();
    h.idx = h.stack.length - 1;
    setHistory([...h.stack]);
    setHistoryIndex(h.idx);
  }, []);

  const canUndo = historyIndex > 0;
  const canRedo = historyIndex < history.length - 1;

  const handleUndo = useCallback(() => {
    const h = historyRef.current;
    if (h.idx <= 0) return;
    h.idx--;
    const entry = h.stack[h.idx];
    setHistoryIndex(h.idx);
    triggerSave(entry.data, entry.title);
    return entry.data;
  }, [triggerSave]);

  const handleRedo = useCallback(() => {
    const h = historyRef.current;
    if (h.idx >= h.stack.length - 1) return;
    h.idx++;
    const entry = h.stack[h.idx];
    setHistoryIndex(h.idx);
    triggerSave(entry.data, entry.title);
    return entry.data;
  }, [triggerSave]);

  const initHistory = useCallback((data: MindMapData) => {
    const entry: HistoryEntry = { data: JSON.parse(JSON.stringify(data)) };
    historyRef.current = { stack: [entry], idx: 0 };
    setHistory([entry]);
    setHistoryIndex(0);
  }, []);

  const clearHistory = useCallback(() => {
    historyRef.current = { stack: [], idx: -1 };
    setHistory([]);
    setHistoryIndex(-1);
  }, []);

  return { history, historyIndex, canUndo, canRedo, handleUndo, handleRedo, pushHistory, initHistory, clearHistory };
}
