export type AiContextStrategy = "direct" | "trimmed" | "chunked" | "rag";

export interface NoteChunk {
  index: number;
  text: string;
  tokens: number;
  heading?: string;
}

export interface BuildAiContextInput {
  action: string;
  title?: string;
  contentText: string;
  selectedText?: string;
  question?: string;
  maxInputTokens: number;
}

export interface BuildAiContextResult {
  promptText: string;
  strategy: AiContextStrategy;
  truncated: boolean;
  notice?: string;
  chunks?: NoteChunk[];
}

const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff]/g;
const WORD_RE = /[a-zA-Z0-9_\-]+/g;
const DEFAULT_CHUNK_TOKENS = 1800;

export function estimateTokens(text: string): number {
  if (!text) return 0;
  const cjk = text.match(CJK_RE)?.length ?? 0;
  const words = text.match(WORD_RE)?.length ?? 0;
  const other = Math.max(0, text.length - cjk);
  return Math.ceil(cjk * 1.1 + words * 1.3 + other / 6);
}

function takeByTokens(text: string, maxTokens: number): string {
  if (estimateTokens(text) <= maxTokens) return text.trim();
  const ratio = Math.max(0.05, maxTokens / Math.max(estimateTokens(text), 1));
  let end = Math.max(200, Math.floor(text.length * ratio));
  let candidate = text.slice(0, end);
  while (estimateTokens(candidate) > maxTokens && end > 100) {
    end = Math.floor(end * 0.86);
    candidate = text.slice(0, end);
  }
  return candidate.trim();
}

function normalizeText(text: string): string {
  return (text || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractHeadings(text: string, limit = 12): string[] {
  return [...text.matchAll(/^#{1,4}\s+(.+)$/gm)]
    .map((m) => m[1]?.trim())
    .filter(Boolean)
    .slice(0, limit);
}

function extractFirstParagraphs(text: string, maxTokens: number): string {
  const paragraphs = normalizeText(text)
    .split(/\n\s*\n+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .slice(0, 6);
  return takeByTokens(paragraphs.join("\n\n"), maxTokens);
}

function extractListSamples(text: string, limit = 10): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^([-*+]|\d+[.)、])\s+/.test(line))
    .slice(0, limit)
    .map((line) => line.replace(/^([-*+]|\d+[.)、])\s+/, ""));
}

function extractKeywords(text: string, limit = 12): string[] {
  const stop = new Set([
    "这个", "那个", "以及", "还有", "然后", "如果", "因为", "所以", "但是", "可以", "需要", "进行", "一个", "用户",
    "the", "and", "for", "with", "this", "that", "from", "have", "your", "note",
  ]);
  const freq = new Map<string, number>();
  const tokens = text.match(/[\u4e00-\u9fff]{2,6}|[a-zA-Z][a-zA-Z0-9_-]{2,}/g) || [];
  for (const raw of tokens) {
    const key = raw.toLowerCase();
    if (stop.has(key)) continue;
    freq.set(key, (freq.get(key) || 0) + 1);
  }
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => k)
    .slice(0, limit);
}

export function splitNoteIntoChunks(
  content: string,
  options: { maxTokensPerChunk?: number; preserveMarkdownStructure?: boolean } = {},
): NoteChunk[] {
  const maxTokens = options.maxTokensPerChunk ?? DEFAULT_CHUNK_TOKENS;
  const text = normalizeText(content);
  if (!text) return [];

  const blocks = options.preserveMarkdownStructure !== false
    ? text.split(/(?=^#{1,3}\s+)/m).flatMap((section) => section.split(/\n\s*\n+/))
    : text.split(/\n\s*\n+/);

  const chunks: NoteChunk[] = [];
  let current: string[] = [];
  let currentTokens = 0;
  let heading = "";

  const push = () => {
    const chunkText = current.join("\n\n").trim();
    if (!chunkText) return;
    chunks.push({ index: chunks.length, text: chunkText, tokens: estimateTokens(chunkText), heading });
    current = [];
    currentTokens = 0;
  };

  for (const block of blocks.map((b) => b.trim()).filter(Boolean)) {
    const blockHeading = block.match(/^#{1,3}\s+(.+)$/m)?.[1]?.trim();
    if (blockHeading) heading = blockHeading;
    const tokens = estimateTokens(block);
    if (tokens > maxTokens) {
      push();
      let rest = block;
      while (estimateTokens(rest) > maxTokens) {
        const part = takeByTokens(rest, maxTokens);
        chunks.push({ index: chunks.length, text: part, tokens: estimateTokens(part), heading });
        rest = rest.slice(part.length).trim();
      }
      if (rest) {
        current = [rest];
        currentTokens = estimateTokens(rest);
      }
      continue;
    }
    if (currentTokens + tokens > maxTokens) push();
    current.push(block);
    currentTokens += tokens;
  }
  push();
  return chunks.map((chunk, index) => ({ ...chunk, index }));
}

function buildCompactNoteBrief(title: string | undefined, contentText: string, maxTokens: number): string {
  const text = normalizeText(contentText);
  const headings = extractHeadings(text);
  const first = extractFirstParagraphs(text, Math.floor(maxTokens * 0.5));
  const listSamples = extractListSamples(text);
  const keywords = extractKeywords(text);
  const parts = [
    title ? `当前标题：${title}` : "",
    first ? `首段/开头：\n${first}` : "",
    headings.length ? `主要小标题：\n${headings.map((h) => `- ${h}`).join("\n")}` : "",
    listSamples.length ? `列表/要点样例：\n${listSamples.map((h) => `- ${h}`).join("\n")}` : "",
    keywords.length ? `关键词：${keywords.join("、")}` : "",
  ].filter(Boolean).join("\n\n");
  return takeByTokens(parts, maxTokens);
}

function rankParagraphsByQuestion(contentText: string, question: string, maxTokens: number): string {
  const queryTerms = new Set((question.match(/[\u4e00-\u9fff]{2,6}|[a-zA-Z][a-zA-Z0-9_-]{2,}/g) || []).map((s) => s.toLowerCase()));
  const paragraphs = normalizeText(contentText).split(/\n\s*\n+/).map((p) => p.trim()).filter(Boolean);
  const ranked = paragraphs
    .map((p, index) => {
      const lower = p.toLowerCase();
      let score = 0;
      for (const term of queryTerms) if (lower.includes(term)) score += term.length;
      if (/^#{1,4}\s/.test(p)) score += 2;
      return { p, index, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 8)
    .sort((a, b) => a.index - b.index)
    .map((item) => item.p);

  const selected = ranked.length ? ranked.join("\n\n---\n\n") : extractFirstParagraphs(contentText, maxTokens);
  return takeByTokens(selected, maxTokens);
}

export function buildAiContext(input: BuildAiContextInput): BuildAiContextResult {
  const action = input.action;
  const contentText = normalizeText(input.contentText);
  const selectedText = normalizeText(input.selectedText || "");
  const maxInputTokens = Math.max(300, input.maxInputTokens);
  const source = selectedText || contentText;
  const sourceTokens = estimateTokens(source);

  if (!source) {
    return { promptText: "", strategy: "direct", truncated: false };
  }

  if (["title", "tags"].includes(action)) {
    const promptText = buildCompactNoteBrief(input.title, contentText, maxInputTokens);
    return {
      promptText,
      strategy: sourceTokens > maxInputTokens ? "trimmed" : "direct",
      truncated: sourceTokens > maxInputTokens,
      notice: sourceTokens > maxInputTokens ? "当前笔记较长，AI 已自动提取标题、首段、小标题和关键词处理。" : undefined,
    };
  }

  if (action === "summarize") {
    if (sourceTokens <= maxInputTokens) {
      return { promptText: source, strategy: "direct", truncated: false };
    }
    const chunks = splitNoteIntoChunks(source, { maxTokensPerChunk: Math.min(maxInputTokens, DEFAULT_CHUNK_TOKENS), preserveMarkdownStructure: true });
    return {
      promptText: buildCompactNoteBrief(input.title, source, maxInputTokens),
      strategy: "chunked",
      truncated: true,
      chunks,
      notice: `当前笔记过长，已分为 ${chunks.length} 段进行处理。`,
    };
  }

  if (action === "ask" && input.question) {
    const promptText = rankParagraphsByQuestion(contentText, input.question, maxInputTokens);
    return {
      promptText,
      strategy: sourceTokens > maxInputTokens ? "rag" : "direct",
      truncated: sourceTokens > maxInputTokens,
      notice: sourceTokens > maxInputTokens ? "当前笔记较长，AI 已优先提取与问题相关的片段。" : undefined,
    };
  }

  const editActions = new Set(["rewrite", "polish", "shorten", "expand", "fix_grammar", "format_markdown", "format_code"]);
  if (editActions.has(action) && !selectedText && sourceTokens > maxInputTokens) {
    const chunks = splitNoteIntoChunks(source, { maxTokensPerChunk: maxInputTokens, preserveMarkdownStructure: true });
    return {
      promptText: takeByTokens(source, maxInputTokens),
      strategy: "chunked",
      truncated: true,
      chunks,
      notice: "当前笔记较长，建议先选中一段文字处理，或使用分段处理全文。",
    };
  }

  if (sourceTokens <= maxInputTokens) {
    return { promptText: source, strategy: "direct", truncated: false };
  }

  return {
    promptText: takeByTokens(source, maxInputTokens),
    strategy: "trimmed",
    truncated: true,
    notice: "当前内容较长，AI 已自动提取前部关键内容处理。",
  };
}
