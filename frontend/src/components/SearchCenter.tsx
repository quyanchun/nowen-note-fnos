import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  BrainCircuit,
  Clock3,
  Table2,
  FileCode2,
  FileText,
  Filter,
  Folder,
  Loader2,
  Menu,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import SearchNotebookExclusionsPanel from "@/components/SearchNotebookExclusionsPanel";
import { useApp, useAppActions } from "@/store/AppContext";
import { useNoteLoader } from "@/hooks/useNoteLoader";
import { getHomeCaptureScope } from "@/lib/homeCapture";
import { api } from "@/lib/api";
import { pushMindMapAppPath } from "@/lib/mindMapDeepLink";
import { pushSheetAppPath } from "@/lib/sheetDeepLink";
import { searchIncludingExcludedNotebooks } from "@/lib/searchNotebookExclusions";
import { highlightTextNode, sanitizeSearchHtml } from "@/lib/searchHighlight";
import { cn } from "@/lib/utils";
import type { SearchResult } from "@/types";

type MatchFilter = "all" | "title" | "content";
type SortMode = "relevance" | "recent";

type EnhancedSearchResult = SearchResult & {
  matchCount?: number;
  contentFormat?: string;
  notebookName?: string | null;
};

function normalizeTimestamp(value: string): number {
  if (!value) return 0;
  const normalized = /Z$|[+-]\d{2}:?\d{2}$/.test(value)
    ? value
    : `${value.replace(" ", "T")}Z`;
  const timestamp = new Date(normalized).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function formatResultDate(value: string, language: string): string {
  const timestamp = normalizeTimestamp(value);
  if (!timestamp) return value || "";
  return new Intl.DateTimeFormat(language.startsWith("zh") ? "zh-CN" : undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(timestamp);
}

export interface SearchSession {
  query: string;
  results: EnhancedSearchResult[];
  filter: MatchFilter;
  sortMode: SortMode;
  activeIndex: number;
  includeExcluded: boolean;
  scrollTop: number;
}

export default function SearchCenter({ session, onOpenResult, onExit }: {
  session?: SearchSession;
  onOpenResult?: (result: SearchResult, session: SearchSession) => void;
  onExit?: () => void;
} = {}) {
  const { state } = useApp();
  const actions = useAppActions();
  const { loadNote } = useNoteLoader();
  const { i18n } = useTranslation();
  const language = (i18n.resolvedLanguage || i18n.language || "zh").toLowerCase();
  const isZh = language.startsWith("zh");

  const copy = useMemo(() => (isZh ? {
    title: "搜索笔记",
    placeholder: "搜索笔记标题与正文…",
    result: "个搜索结果",
    filteredResult: "个筛选结果",
    all: "全部",
    titleOnly: "仅标题",
    contentOnly: "仅正文",
    relevance: "相关度",
    recent: "最近更新",
    matches: "个匹配项",
    titleMatch: "标题命中",
    contentMatch: "正文命中",
    bothMatch: "标题与正文",
    semanticMatch: "语义命中",
    semanticRelevance: "语义相关度",
    semanticHint: "由向量距离换算的相对相关度，不代表准确率。",
    emptyTitle: "输入关键词开始搜索",
    emptyDescription: "支持标题和正文全文检索，点击结果即可打开笔记。",
    noResultTitle: "没有找到匹配的笔记",
    noResultDescription: "尝试更换关键词，或切换到“全部”范围。",
    loadFailed: "搜索失败，请稍后重试",
    unknownNotebook: "未知笔记本",
    mindmap: "思维导图",
    openFailed: "打开内容失败",
    close: "退出搜索",
  } : {
    title: "Search notes",
    placeholder: "Search note titles and content…",
    result: " results",
    filteredResult: " filtered results",
    all: "All",
    titleOnly: "Title",
    contentOnly: "Content",
    relevance: "Relevance",
    recent: "Recently updated",
    matches: " matches",
    titleMatch: "Title match",
    contentMatch: "Content match",
    bothMatch: "Title & content",
    semanticMatch: "Semantic match",
    semanticRelevance: "Semantic relevance",
    semanticHint: "Relative similarity derived from vector distance, not an accuracy probability.",
    emptyTitle: "Type to search your notes",
    emptyDescription: "Search across note titles and content, then open a result in one click.",
    noResultTitle: "No matching notes",
    noResultDescription: "Try another keyword or switch the scope back to All.",
    loadFailed: "Search failed. Please try again.",
    unknownNotebook: "Unknown notebook",
    mindmap: "Mind map",
    openFailed: "Failed to open content",
    close: "Exit search",
  }), [isZh]);

  const [initialSession] = useState(() => session?.query === state.searchQuery ? session : undefined);
  const restoreRef = useRef(initialSession);
  const [query, setQuery] = useState(initialSession?.query || state.searchQuery || "");
  const [results, setResults] = useState<EnhancedSearchResult[]>(initialSession?.results || []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<MatchFilter>(initialSession?.filter || "all");
  const [sortMode, setSortMode] = useState<SortMode>(initialSession?.sortMode || "relevance");
  const [activeIndex, setActiveIndex] = useState(initialSession?.activeIndex || 0);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [includeExcluded, setIncludeExcluded] = useState(initialSession?.includeExcluded || false);
  const [searchScopeRevision, setSearchScopeRevision] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const resultRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const requestSequence = useRef(0);

  const isVisible = state.viewMode === "search";
  const accountScope = getHomeCaptureScope();
  const restoreScope = useRef(accountScope);


  useEffect(() => {
    if (state.searchQuery !== query) setQuery(state.searchQuery || "");
  }, [state.searchQuery]);

  useEffect(() => {
    if (!isVisible) return;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [isVisible]);

  useLayoutEffect(() => {
    if (scrollRef.current && initialSession) scrollRef.current.scrollTop = initialSession.scrollTop;
  }, [initialSession]);

  useEffect(() => {
    if (!isVisible) return;
    const normalized = query.trim();
    const sequence = ++requestSequence.current;

    if (!normalized) {
      restoreRef.current = undefined;
      setResults([]);
      setLoading(false);
      setError("");
      return;
    }

    if (restoreRef.current && restoreScope.current === accountScope
      && restoreRef.current.query === normalized
      && restoreRef.current.includeExcluded === includeExcluded && searchScopeRevision === 0) return;
    restoreRef.current = undefined;
    const abort = new AbortController();
    setResults([]);
    setLoading(true);
    setError("");
    const timer = window.setTimeout(async () => {
      try {
        const rows = (includeExcluded
          ? await searchIncludingExcludedNotebooks(normalized, abort.signal, true)
          : await api.search(normalized, { signal: abort.signal, semantic: true, skipProgressiveDelay: true })) as EnhancedSearchResult[];
        if (abort.signal.aborted || sequence !== requestSequence.current) return;
        setResults(rows);
        setActiveIndex(0);
      } catch (searchError) {
        if (abort.signal.aborted || sequence !== requestSequence.current) return;
        console.warn("[SearchCenter] search failed:", searchError);
        setResults([]);
        setError(copy.loadFailed);
      } finally {
        if (sequence === requestSequence.current) setLoading(false);
      }
    }, 350);

    return () => { window.clearTimeout(timer); abort.abort(); };
  }, [accountScope, copy.loadFailed, includeExcluded, isVisible, query, searchScopeRevision]);

  const notebookPaths = useMemo(() => {
    const notebooks = new Map(state.notebooks.map((notebook) => [notebook.id, notebook]));
    const paths = new Map<string, string>();

    const resolve = (notebookId: string, fallback?: string | null) => {
      if (paths.has(notebookId)) return paths.get(notebookId)!;
      const labels: string[] = [];
      const visited = new Set<string>();
      let currentId: string | null | undefined = notebookId;
      while (currentId && !visited.has(currentId)) {
        visited.add(currentId);
        const notebook = notebooks.get(currentId);
        if (!notebook) break;
        labels.unshift(`${notebook.icon || "📒"} ${notebook.name}`);
        currentId = notebook.parentId;
      }
      const path = labels.length > 0 ? labels.join(" / ") : (fallback || copy.unknownNotebook);
      paths.set(notebookId, path);
      return path;
    };

    for (const result of results) {
      if (result.resourceType !== "mindmap") resolve(result.notebookId, result.notebookName);
    }
    return paths;
  }, [copy.unknownNotebook, results, state.notebooks]);

  const visibleResults = useMemo(() => {
    const filtered = results.filter((result) => {
      if (filter === "all") return true;
      if (filter === "title") return result.matchedField === "title" || result.matchedField === "title+content";
      return result.matchedField === "content" || result.matchedField === "title+content" || result.matchedField === "semantic";
    });
    if (sortMode === "relevance") return filtered;
    return [...filtered].sort((a, b) => normalizeTimestamp(b.updatedAt) - normalizeTimestamp(a.updatedAt));
  }, [filter, results, sortMode]);

  useEffect(() => {
    setActiveIndex((index) => Math.min(index, Math.max(visibleResults.length - 1, 0)));
  }, [visibleResults.length]);

  useEffect(() => {
    const active = visibleResults[activeIndex];
    if (!active) return;
    resultRefs.current.get(active.id)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, visibleResults]);

  const setSearchQuery = useCallback((value: string) => {
    setQuery(value);
    actions.setSearchQuery(value);
    if (state.viewMode !== "search") actions.setViewMode("search");
  }, [actions, state.viewMode]);

  const exitSearch = useCallback(() => {
    setSearchQuery("");
    setIncludeExcluded(false);
    onExit?.();
    actions.setViewMode(state.selectedNotebookId ? "notebook" : "all");
  }, [actions, onExit, setSearchQuery, state.selectedNotebookId]);

  const openResult = useCallback(async (result: EnhancedSearchResult) => {
    if (getHomeCaptureScope() !== accountScope) return;
    setOpeningId(result.id);
    onOpenResult?.(result, { query, results, filter, sortMode, activeIndex, includeExcluded,
      scrollTop: scrollRef.current?.scrollTop || 0 });
    if (result.resourceType === "sheet") {
      actions.clearSelectedTags();
      actions.setSearchQuery("");
      actions.setMobileSidebar(false);
      pushSheetAppPath(result.id);
      setOpeningId(null);
      return;
    }
    if (result.resourceType === "mindmap") {
      actions.clearSelectedTags();
      actions.setSearchQuery("");
      actions.setMobileSidebar(false);
      pushMindMapAppPath(result.id);
      setOpeningId(null);
      return;
    }
    actions.setSelectedNotebook(result.notebookId);
    actions.clearSelectedTags();
    actions.setSearchQuery("");
    actions.setViewMode("notebook");
    actions.setMobileSidebar(false);
    actions.setMobileView("editor");

    await loadNote({
      noteId: result.id,
      summary: {
        title: result.title || copy.emptyTitle,
        notebookId: result.notebookId,
        contentFormat: result.contentFormat,
      },
      request: () => api.getNote(result.id),
      onSuccess: (note) => {
        actions.setActiveNote(note);
        actions.setSelectedNotebook(note.notebookId);
      },
      onError: (openError) => {
        console.error("[SearchCenter] open note failed:", openError);
      },
    });
    setOpeningId((current) => current === result.id ? null : current);
  }, [accountScope, actions, copy.emptyTitle, loadNote, onOpenResult, query, results, filter, sortMode, activeIndex, includeExcluded]);

  const onSearchKeyDown = useCallback((event: React.KeyboardEvent<HTMLElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    const target = event.target as HTMLElement;
    if (target !== inputRef.current && !target.closest("[data-search-result]")) return;
    if (event.key === "Escape") {
      event.preventDefault();
      exitSearch();
      return;
    }
    if (visibleResults.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      event.stopPropagation();
      const next = Math.min(activeIndex + 1, visibleResults.length - 1);
      setActiveIndex(next);
      if (target !== inputRef.current) resultRefs.current.get(visibleResults[next].id)?.focus({ preventScroll: true });
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      const next = Math.max(activeIndex - 1, 0);
      setActiveIndex(next);
      if (target !== inputRef.current) resultRefs.current.get(visibleResults[next].id)?.focus({ preventScroll: true });
    } else if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      const active = visibleResults[activeIndex];
      if (active) void openResult(active);
    }
  }, [activeIndex, exitSearch, openResult, visibleResults]);

  useEffect(() => {
    if (!isVisible) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      exitSearch();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [exitSearch, isVisible]);

  if (!isVisible || typeof document === "undefined") return null;

  const content = (
    <section
      className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-app-bg text-tx-primary"
      aria-label={copy.title}
      onKeyDown={onSearchKeyDown}
      data-swipe-blocker="search-center"
    >
      <header className="box-border flex h-12 shrink-0 items-center gap-3 border-b border-app-border bg-app-surface/95 px-4 md:px-6">
        <button
          type="button"
          onClick={() => actions.setMobileSidebar(true)}
          className="rounded-lg p-2 text-tx-secondary hover:bg-app-hover md:hidden"
          aria-label="Menu"
        >
          <Menu size={20} />
        </button>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-primary/10 text-accent-primary">
          <Search size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-semibold">{copy.title}</h1>
        </div>
        <button
          type="button"
          onClick={exitSearch}
          className="rounded-lg p-2 text-tx-tertiary hover:bg-app-hover hover:text-tx-primary"
          title={copy.close}
          aria-label={copy.close}
        >
          <X size={18} />
        </button>
      </header>

      <div ref={scrollRef} data-search-scroll className="flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto w-full px-4 py-5 md:px-8 md:py-8">
          <div className="rounded-2xl border border-app-border bg-app-surface shadow-sm">
            <div className="flex items-center gap-2 px-3 py-3 md:gap-3 md:px-5 md:py-4">
              <Search size={20} className="shrink-0 text-tx-tertiary" />
              <input
                aria-label={copy.placeholder}
                ref={inputRef}
                value={query}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder={copy.placeholder}
                className="min-w-0 flex-1 bg-transparent text-base text-tx-primary outline-none placeholder:text-tx-tertiary md:text-lg"
                autoComplete="off"
                spellCheck={false}
              />
              {loading && <Loader2 size={18} className="shrink-0 animate-spin text-accent-primary" />}
              {query && !loading && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="rounded-lg p-1.5 text-tx-tertiary hover:bg-app-hover hover:text-tx-primary"
                  aria-label="Clear"
                >
                  <X size={16} />
                </button>
              )}
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-2 text-sm text-tx-secondary">
              <span className="font-medium tabular-nums text-tx-primary">
                {filter === "all" ? results.length : visibleResults.length}
              </span>
              <span>{filter === "all" ? copy.result : copy.filteredResult}</span>
              {filter !== "all" && results.length !== visibleResults.length && (
                <span className="text-xs text-tx-tertiary">/ {results.length}</span>
              )}
            </div>

            <div className="flex min-w-0 items-center gap-2 overflow-x-auto pb-1 sm:pb-0">
              <div className="inline-flex shrink-0 items-center rounded-lg border border-app-border bg-app-surface p-1">
                <span className="px-1.5 text-tx-tertiary"><Filter size={13} /></span>
                {(["all", "title", "content"] as MatchFilter[]).map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => { setFilter(value); setActiveIndex(0); }}
                    className={cn(
                      "rounded-md px-2.5 py-1 text-xs transition-colors",
                      filter === value
                        ? "bg-accent-primary/12 font-medium text-accent-primary"
                        : "text-tx-secondary hover:bg-app-hover hover:text-tx-primary",
                    )}
                  >
                    {value === "all" ? copy.all : value === "title" ? copy.titleOnly : copy.contentOnly}
                  </button>
                ))}
              </div>

              <div className="inline-flex shrink-0 items-center rounded-lg border border-app-border bg-app-surface p-1">
                <span className="px-1.5 text-tx-tertiary"><SlidersHorizontal size={13} /></span>
                {(["relevance", "recent"] as SortMode[]).map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => { setSortMode(value); setActiveIndex(0); }}
                    className={cn(
                      "rounded-md px-2.5 py-1 text-xs transition-colors",
                      sortMode === value
                        ? "bg-accent-primary/12 font-medium text-accent-primary"
                        : "text-tx-secondary hover:bg-app-hover hover:text-tx-primary",
                    )}
                  >
                    {value === "relevance" ? copy.relevance : copy.recent}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <SearchNotebookExclusionsPanel
            includeExcluded={includeExcluded}
            onIncludeExcludedChange={setIncludeExcluded}
            onScopeChanged={() => setSearchScopeRevision((value) => value + 1)}
          />

          {error && (
            <div className="mt-4 rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-500">
              {error}
            </div>
          )}

          {!query.trim() ? (
            <div className="flex min-h-[360px] flex-col items-center justify-center text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-primary/10 text-accent-primary">
                <Search size={26} />
              </div>
              <h2 className="mt-4 text-base font-semibold">{copy.emptyTitle}</h2>
              <p className="mt-2 max-w-md text-sm leading-6 text-tx-tertiary">{copy.emptyDescription}</p>
            </div>
          ) : !loading && visibleResults.length === 0 ? (
            <div className="flex min-h-[360px] flex-col items-center justify-center text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-app-surface text-tx-tertiary ring-1 ring-app-border">
                <Search size={25} />
              </div>
              <h2 className="mt-4 text-base font-semibold">{copy.noResultTitle}</h2>
              <p className="mt-2 max-w-md text-sm leading-6 text-tx-tertiary">{copy.noResultDescription}</p>
            </div>
          ) : (
            <div className="mt-4 space-y-3 pb-8">
              {visibleResults.map((result, index) => {
                const active = index === activeIndex;
                const snippetHtml = result.snippetHtml || result.snippet || "";
                const matchCount = result.matchCount || 0;
                const matchedLabel = result.matchedField === "title"
                  ? copy.titleMatch
                  : result.matchedField === "content"
                    ? copy.contentMatch
                    : result.matchedField === "semantic" ? copy.semanticMatch : copy.bothMatch;
                const mindmap = result.resourceType === "mindmap";
                const sheet = result.resourceType === "sheet";
                const markdown = !mindmap && !sheet && result.contentFormat === "markdown";

                return (
                  <button
                    key={result.id}
                    ref={(element) => {
                      if (element) resultRefs.current.set(result.id, element);
                      else resultRefs.current.delete(result.id);
                    }}
                    type="button"
                    data-search-result={result.id}
                    aria-current={active ? "true" : undefined}
                    onFocus={() => setActiveIndex(index)}
                    onClick={() => void openResult(result)}
                    className={cn(
                      "group w-full rounded-2xl border bg-app-surface px-4 py-4 text-left shadow-sm transition-all md:px-5",
                      active
                        ? "border-accent-primary/45 bg-accent-primary/[0.035] shadow-md shadow-black/[0.04]"
                        : "border-app-border hover:border-accent-primary/25 hover:shadow-md hover:shadow-black/[0.035]",
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <div className={cn(
                        "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
                        mindmap
                          ? "bg-violet-500/10 text-violet-500"
                          : markdown
                            ? "bg-emerald-500/10 text-emerald-500"
                            : "bg-accent-primary/10 text-accent-primary",
                      )}>
                        {mindmap
                          ? <BrainCircuit size={17} />
                          : sheet
                            ? <Table2 size={17} />
                            : markdown
                            ? <FileCode2 size={17} />
                            : <FileText size={17} />}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0 flex-1">
                            <h3 className="search-result-html line-clamp-2 break-words text-sm font-semibold leading-6 text-tx-primary md:text-[15px] [&_mark]:rounded-sm [&_mark]:bg-amber-200/80 [&_mark]:px-0.5 [&_mark]:text-amber-950 dark:[&_mark]:bg-amber-400/30 dark:[&_mark]:text-amber-100">
                              {result.titleHtml ? (
                                <span dangerouslySetInnerHTML={{ __html: sanitizeSearchHtml(result.titleHtml) }} />
                              ) : (
                                highlightTextNode(result.title || "(Untitled)", query)
                              )}
                            </h3>
                            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-tx-tertiary">
                              {mindmap ? (
                                <span className="flex min-w-0 max-w-full items-center gap-1">
                                  <BrainCircuit size={11} className="shrink-0" />
                                  <span className="truncate">{copy.mindmap}</span>
                                </span>
                              ) : (
                                <span className="flex min-w-0 max-w-full items-center gap-1" title={notebookPaths.get(result.notebookId)}>
                                  <Folder size={11} className="shrink-0" />
                                  <span className="truncate">{notebookPaths.get(result.notebookId) || result.notebookName || copy.unknownNotebook}</span>
                                </span>
                              )}
                              <span className="flex items-center gap-1 whitespace-nowrap">
                                <Clock3 size={11} />
                                {formatResultDate(result.updatedAt, language)}
                              </span>
                              <span className="rounded-full bg-app-hover px-2 py-0.5 text-[10px] text-tx-secondary">
                                {matchedLabel}
                              </span>
                            </div>
                          </div>

                          <div className="flex shrink-0 flex-wrap items-center gap-2 self-start">
                            {typeof result.semanticRelevance === "number" && <span title={copy.semanticHint} className="rounded-full bg-accent-primary/10 px-2.5 py-1 text-[11px] font-medium tabular-nums text-accent-primary">{copy.semanticRelevance} {(result.semanticRelevance * 100).toFixed(1)}%</span>}
                            {matchCount > 0 && <span className="rounded-full bg-app-hover px-2.5 py-1 text-[11px] tabular-nums text-tx-secondary">{matchCount}{copy.matches}</span>}
                          </div>
                        </div>

                        {snippetHtml && (
                          <div
                            className="search-result-html mt-3 line-clamp-4 break-words rounded-xl border border-app-border/70 bg-app-bg/70 px-3.5 py-3 text-xs leading-6 text-tx-secondary [overflow-wrap:anywhere] [&_mark]:rounded-sm [&_mark]:bg-amber-200/80 [&_mark]:px-0.5 [&_mark]:font-medium [&_mark]:text-amber-950 dark:[&_mark]:bg-amber-400/30 dark:[&_mark]:text-amber-100"
                            dangerouslySetInnerHTML={{ __html: sanitizeSearchHtml(snippetHtml) }}
                          />
                        )}
                      </div>

                      <div className="hidden shrink-0 items-center gap-1 text-tx-tertiary md:flex">
                        {active ? <ArrowDown size={14} className="rotate-[-90deg] text-accent-primary" /> : null}
                        {openingId === result.id && <Loader2 size={14} className="animate-spin text-accent-primary" />}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

    </section>
  );

  return content;
}
