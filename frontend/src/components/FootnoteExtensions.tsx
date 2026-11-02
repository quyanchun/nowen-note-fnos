/**
 * Footnote 脚注扩展（Tiptap）
 *
 * 提供两个节点：
 *   - FootnoteReference：行内 atom，attr `identifier` 存脚注 ID（如 "1" / "note-a"）。
 *     正文中渲染为上标 `[n]`，n 是按文档中出现顺序自动计算的序号（仅渲染层；
 *     原始 identifier 永远保留以便回写 markdown）。
 *   - FootnoteDefinition：块级节点，attr `identifier` + `content`（纯文本）。
 *     渲染为带左侧编号标记的小卡片，双击编辑 content。
 *
 * 之所以让 FootnoteDefinition 的 content 用 attr 而不是 PM 子节点：
 *   1) 简化序列化：markdown 里 `[^x]: ...` 通常就是一行短文本，富文本嵌套
 *      会让 turndown / lezer 双向闭环非常脆弱；
 *   2) 编辑体验更可控：用户双击进入小输入框即可，避免 PM 选区跨节点跳跃。
 *   后续真要支持多行内容也可平滑扩展（attr 里允许 \n，渲染时 split）。
 *
 * Markdown 对应（Pandoc / GFM）：
 *   - 正文：This is a sentence.[^1]
 *   - 末尾：[^1]: 脚注说明文本
 *
 * 编号策略：序号是渲染层的"显示序号"，不是 identifier。文档里同一个 identifier
 * 多次引用时，所有 ref 都显示同一个序号。这与 Pandoc 行为一致。
 */

import { Node, mergeAttributes, InputRule } from "@tiptap/core";
import { ReactNodeViewRenderer, NodeViewWrapper, NodeViewProps } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";
import React, { useCallback, useEffect, useRef, useState, useMemo } from "react";

// ---------------------------------------------------------------------------
// 工具：扫描整个文档，按出现顺序为每个 identifier 分配显示序号
// ---------------------------------------------------------------------------
function computeFootnoteIndex(doc: any, identifier: string): number {
  if (!identifier || !doc || typeof doc.descendants !== "function") return 0;
  let seen = 0;
  const order: string[] = [];
  doc.descendants((node: any) => {
    if (node.type?.name === "footnoteReference") {
      const id = node.attrs?.identifier || "";
      if (id && !order.includes(id)) order.push(id);
    }
    seen++;
    return true;
  });
  void seen;
  const idx = order.indexOf(identifier);
  return idx >= 0 ? idx + 1 : 0;
}

// ---------------------------------------------------------------------------
// FootnoteReference NodeView
// ---------------------------------------------------------------------------
const FootnoteRefView: React.FC<NodeViewProps> = ({
  node,
  editor,
  getPos,
  selected,
  updateAttributes,
  deleteNode,
}) => {
  const identifier: string = node.attrs.identifier || "";
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(identifier);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // 序号：依赖 editor.state.doc，会随文档变化更新（NodeView 在文档结构变化时
  // 会被 Tiptap 触发重渲染）
  const index = useMemo(() => {
    if (!editor?.state?.doc) return 0;
    return computeFootnoteIndex(editor.state.doc, identifier);
  }, [editor?.state?.doc, identifier]);

  useEffect(() => {
    if (!editing) setDraft(identifier);
  }, [identifier, editing]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const commit = useCallback(() => {
    const next = draft.trim();
    if (!next) {
      deleteNode();
      return;
    }
    if (next !== identifier) updateAttributes({ identifier: next });
    setEditing(false);
    setTimeout(() => editor?.commands.focus(), 0);
  }, [draft, identifier, updateAttributes, deleteNode, editor]);

  const cancel = useCallback(() => {
    setDraft(identifier);
    setEditing(false);
  }, [identifier]);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.detail >= 2) {
        // 双击：编辑 identifier
        e.preventDefault();
        e.stopPropagation();
        setEditing(true);
        return;
      }
      // 单击：选中节点 + 尝试滚到对应 definition
      const pos = typeof getPos === "function" ? getPos() : null;
      if (pos != null && editor) {
        const { state, view } = editor;
        const tr = state.tr.setSelection(TextSelection.create(state.doc, pos));
        view.dispatch(tr);
      }
      // 滚动到对应 def：在 DOM 里找 [data-footnote-def="${identifier}"]
      if (identifier) {
        const root = editor?.view?.dom as HTMLElement | undefined;
        const def = root?.querySelector(
          `[data-footnote-def="${cssEscape(identifier)}"]`
        );
        if (def) {
          def.scrollIntoView({ behavior: "smooth", block: "center" });
          // 临时高亮
          def.classList.add("footnote-flash");
          window.setTimeout(() => def.classList.remove("footnote-flash"), 1200);
        }
      }
    },
    [editor, getPos, identifier]
  );

  if (editing) {
    return (
      <NodeViewWrapper
        as="span"
        className="footnote-ref-editing inline-block align-baseline mx-0.5"
        contentEditable={false}
      >
        <span className="inline-flex items-center rounded border border-indigo-300 dark:border-indigo-600 bg-app-bg overflow-hidden">
          <span className="text-[11px] text-tx-tertiary px-1 select-none">[^</span>
          <input
            ref={inputRef}
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                cancel();
              } else if (e.key === "Enter") {
                e.preventDefault();
                commit();
              }
            }}
            className="text-[11px] bg-transparent text-tx-primary outline-none min-w-[40px] max-w-[120px] px-0.5"
            placeholder="id"
            spellCheck={false}
          />
          <span className="text-[11px] text-tx-tertiary px-1 select-none">]</span>
        </span>
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper
      as="span"
      className={`footnote-ref ${selected ? "footnote-ref-selected" : ""}`}
      contentEditable={false}
      data-footnote-ref={identifier}
      onClick={handleClick}
    >
      <sup className="footnote-ref-sup">[{index || "?"}]</sup>
    </NodeViewWrapper>
  );
};

// ---------------------------------------------------------------------------
// FootnoteDefinition NodeView
// ---------------------------------------------------------------------------
const FootnoteDefView: React.FC<NodeViewProps> = ({
  node,
  editor,
  getPos,
  selected,
  updateAttributes,
  deleteNode,
}) => {
  const identifier: string = node.attrs.identifier || "";
  const content: string = node.attrs.content || "";
  const [editing, setEditing] = useState(false);
  const [draftContent, setDraftContent] = useState(content);
  const [draftId, setDraftId] = useState(identifier);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const index = useMemo(() => {
    if (!editor?.state?.doc) return 0;
    return computeFootnoteIndex(editor.state.doc, identifier);
  }, [editor?.state?.doc, identifier]);

  useEffect(() => {
    if (!editing) {
      setDraftContent(content);
      setDraftId(identifier);
    }
  }, [content, identifier, editing]);

  useEffect(() => {
    if (editing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.setSelectionRange(
        textareaRef.current.value.length,
        textareaRef.current.value.length
      );
    }
  }, [editing]);

  const commit = useCallback(() => {
    const nextId = draftId.trim();
    const nextContent = draftContent.trim();
    if (!nextId && !nextContent) {
      // identifier 和 content 都空 → 删除整个 def
      deleteNode();
      return;
    }
    const updates: Record<string, string> = {};
    if (nextId && nextId !== identifier) updates.identifier = nextId;
    if (nextContent !== content) updates.content = nextContent;
    if (Object.keys(updates).length > 0) updateAttributes(updates);
    setEditing(false);
    setTimeout(() => editor?.commands.focus(), 0);
  }, [draftId, draftContent, identifier, content, updateAttributes, deleteNode, editor]);

  const cancel = useCallback(() => {
    setDraftContent(content);
    setDraftId(identifier);
    setEditing(false);
  }, [content, identifier]);

  const handleJumpBack = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!identifier) return;
      const root = editor?.view?.dom as HTMLElement | undefined;
      const ref = root?.querySelector(
        `[data-footnote-ref="${cssEscape(identifier)}"]`
      );
      if (ref) {
        ref.scrollIntoView({ behavior: "smooth", block: "center" });
        ref.classList.add("footnote-flash");
        window.setTimeout(() => ref.classList.remove("footnote-flash"), 1200);
      }
    },
    [editor, identifier]
  );

  const handleContainerClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.detail >= 2) {
        e.preventDefault();
        e.stopPropagation();
        setEditing(true);
        return;
      }
      const pos = typeof getPos === "function" ? getPos() : null;
      if (pos != null && editor) {
        const { state, view } = editor;
        const tr = state.tr.setSelection(TextSelection.create(state.doc, pos));
        view.dispatch(tr);
      }
    },
    [editor, getPos]
  );

  if (editing) {
    return (
      <NodeViewWrapper
        as="div"
        className="footnote-def-editing my-1.5"
        contentEditable={false}
      >
        <div className="footnote-edit-box rounded-md border border-indigo-300 dark:border-indigo-600 bg-app-bg shadow-sm overflow-hidden p-2">
          <div className="flex items-center gap-2 text-[11px] text-tx-tertiary mb-1.5">
            <span className="font-mono">[^</span>
            <input
              type="text"
              value={draftId}
              onChange={(e) => setDraftId(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  cancel();
                }
              }}
              className="bg-transparent text-tx-primary outline-none border-b border-bd-secondary min-w-[40px] max-w-[120px] px-0.5"
              placeholder="id"
              spellCheck={false}
            />
            <span className="font-mono">]:</span>
            <span className="ml-auto text-[10px] opacity-70">Esc 取消 · Cmd/Ctrl+Enter 保存</span>
          </div>
          <textarea
            ref={textareaRef}
            value={draftContent}
            onChange={(e) => setDraftContent(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                cancel();
              } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                commit();
              }
            }}
            rows={Math.max(2, draftContent.split("\n").length)}
            className="w-full text-[13px] bg-transparent text-tx-primary outline-none resize-none"
            placeholder="脚注内容"
            spellCheck={false}
          />
        </div>
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper
      as="div"
      className={`footnote-def ${selected ? "footnote-def-selected" : ""}`}
      contentEditable={false}
      draggable={false}
      data-footnote-def={identifier}
      onClick={handleContainerClick}
    >
      <span className="footnote-def-marker">
        <button
          type="button"
          className="footnote-def-back"
          onClick={handleJumpBack}
          title="跳回正文引用"
          tabIndex={-1}
        >
          ↩
        </button>
        <span className="footnote-def-index">{index || "?"}.</span>
      </span>
      <span className="footnote-def-content">
        {content || <span className="footnote-def-empty">（点击双击编辑）</span>}
      </span>
      <span className="footnote-def-id" title="标识符">[^{identifier}]</span>
    </NodeViewWrapper>
  );
};

// ---------------------------------------------------------------------------
// FootnoteReference 节点
// ---------------------------------------------------------------------------
export const FootnoteReference = Node.create({
  name: "footnoteReference",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  marks: "",

  addAttributes() {
    return {
      identifier: {
        default: "",
        parseHTML: (el) =>
          el.getAttribute("data-footnote-identifier") ||
          el.getAttribute("data-identifier") ||
          "",
        renderHTML: (attrs) => ({
          "data-footnote-identifier": attrs.identifier || "",
        }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "sup[data-footnote-ref]",
      },
      {
        tag: "span[data-footnote-ref]",
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    // 输出 <sup data-footnote-ref="id" data-footnote-identifier="id">[id]</sup>
    // turndown / 分享页 PM 路径都靠这两个 data-* 识别
    const identifier = HTMLAttributes["data-footnote-identifier"] || "";
    return [
      "sup",
      mergeAttributes(HTMLAttributes, {
        "data-footnote-ref": identifier,
      }),
      `[^${identifier}]`,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(FootnoteRefView);
  },

  addInputRules() {
    // 输入 `[^foo] ` 后空格自动转 footnoteRef（identifier="foo"）
    // identifier 允许字母数字+连字符+下划线，不允许空格
    return [
      new InputRule({
        find: /\[\^([A-Za-z0-9_-]+)\]\s$/,
        handler: ({ chain, range, match }) => {
          const identifier = (match[1] || "").trim();
          if (!identifier) return null;
          chain()
            .deleteRange(range)
            .insertContent({
              type: "footnoteReference",
              attrs: { identifier },
            })
            .insertContent(" ")
            .run();
        },
      }),
    ];
  },
});

// ---------------------------------------------------------------------------
// FootnoteDefinition 节点
// ---------------------------------------------------------------------------
export const FootnoteDefinition = Node.create({
  name: "footnoteDefinition",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,
  marks: "",
  // defining: true，避免 def 被合并进段落
  defining: true,

  addAttributes() {
    return {
      identifier: {
        default: "",
        parseHTML: (el) =>
          el.getAttribute("data-footnote-identifier") ||
          el.getAttribute("data-identifier") ||
          "",
        renderHTML: (attrs) => ({
          "data-footnote-identifier": attrs.identifier || "",
        }),
      },
      content: {
        default: "",
        parseHTML: (el) =>
          el.getAttribute("data-footnote-content") ||
          (el.textContent || "").trim(),
        renderHTML: (attrs) => ({
          "data-footnote-content": attrs.content || "",
        }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "div[data-footnote-def]",
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const identifier = HTMLAttributes["data-footnote-identifier"] || "";
    const content = HTMLAttributes["data-footnote-content"] || "";
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-footnote-def": identifier,
      }),
      `[^${identifier}]: ${content}`,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(FootnoteDefView);
  },
});

export const FootnoteExtensions = [FootnoteReference, FootnoteDefinition];

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
/**
 * 转义 CSS 选择器里的特殊字符，避免 identifier 含 `:` / `.` / 空格 时
 * querySelector 报错。优先用浏览器原生 `CSS.escape`，旧环境兜底手写。
 */
function cssEscape(value: string): string {
  if (typeof window !== "undefined" && (window as any).CSS && typeof (window as any).CSS.escape === "function") {
    return (window as any).CSS.escape(value);
  }
  return String(value).replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`);
}

/**
 * 在给定 editor 实例上，根据已存在的 footnote identifier 找一个未占用的数字。
 * 比如已有 1/2/note-x，则返回 "3"。供 SlashCommand 自动起名用。
 */
export function nextFootnoteIdentifier(editor: any): string {
  if (!editor?.state?.doc) return "1";
  const used = new Set<string>();
  editor.state.doc.descendants((node: any) => {
    if (node.type?.name === "footnoteReference" || node.type?.name === "footnoteDefinition") {
      const id = node.attrs?.identifier || "";
      if (id) used.add(id);
    }
    return true;
  });
  for (let i = 1; i < 10000; i++) {
    const cand = String(i);
    if (!used.has(cand)) return cand;
  }
  return String(Date.now());
}
