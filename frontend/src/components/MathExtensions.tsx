/**
 * Math Node：Tiptap 数学公式扩展
 *
 * 提供两个 atom 节点：
 *   - MathInline：行内公式，对应 markdown `$...$`
 *   - MathBlock： 块级公式，对应 markdown `$$...$$`
 *
 * 设计要点：
 *   1. atom 节点：内容不参与 PM 编辑（KaTeX 渲染出的 DOM 不希望被 ProseMirror
 *      光标穿透）。源码存在 `latex` attr 里，用户双击节点会弹出小输入框编辑。
 *   2. DOM 序列化：
 *        inline: <span data-math-inline data-latex="...">
 *        block:  <div  data-math-block  data-latex="...">
 *      这种 data-attr 形式让 generateHTML / parseHTML / Turndown 都能稳定捕获，
 *      也方便分享页 PM 路径在 renderNode 里直接识别。
 *   3. Input rule：
 *        `$x^2$ `（行内：在 `$..$` 后输空格触发）
 *        在空段落里输 `$$` 后回车 → 块级
 *   4. 转 markdown：由 contentFormat.ts 里 Turndown 的 rule 处理（addRule）。
 *      generateHTML 出来的 `<span data-math-inline data-latex="x^2">` Turndown
 *      认到后会直接吐 `$x^2$`，回写时再被 lezer 预处理转回 inline node，闭环。
 */

import { Node, mergeAttributes, InputRule } from "@tiptap/core";
import { ReactNodeViewRenderer, NodeViewWrapper, NodeViewProps } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";
import React, { useCallback, useEffect, useRef, useState } from "react";
import MathView from "@/components/MathView";

// ---------------------------------------------------------------------------
// NodeView：把 Math 节点渲染为 MathView + 双击编辑小输入框
// ---------------------------------------------------------------------------
const MathNodeView: React.FC<NodeViewProps & { displayMode: boolean }> = ({
  node,
  selected,
  updateAttributes,
  deleteNode,
  editor,
  getPos,
  displayMode,
}) => {
  const latex: string = node.attrs.latex || "";
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(latex);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // 同步外部 latex 变化（例如撤销/重做）
  useEffect(() => {
    if (!editing) setDraft(latex);
  }, [latex, editing]);

  // 进入编辑态时聚焦 textarea 并选中全文，方便直接覆写
  useEffect(() => {
    if (editing && textareaRef.current) {
      const ta = textareaRef.current;
      ta.focus();
      ta.select();
    }
  }, [editing]);

  const commit = useCallback(() => {
    const next = draft.trim();
    if (!next) {
      // 空内容直接删除节点，避免留一个空占位
      deleteNode();
      return;
    }
    if (next !== latex) {
      updateAttributes({ latex: next });
    }
    setEditing(false);
    // 让光标回到编辑器（点节点外区域时也会触发，这里主动 focus 体验更顺）
    setTimeout(() => editor?.commands.focus(), 0);
  }, [draft, latex, updateAttributes, deleteNode, editor]);

  const cancel = useCallback(() => {
    setDraft(latex);
    setEditing(false);
  }, [latex]);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      // 单击：选中节点（让用户看到选中态）；双击：进入编辑
      if (e.detail >= 2) {
        e.preventDefault();
        e.stopPropagation();
        setEditing(true);
        return;
      }
      // 把 PM 选区设到该节点上
      const pos = typeof getPos === "function" ? getPos() : null;
      if (pos != null && editor) {
        const { state, view } = editor;
        const tr = state.tr.setSelection(TextSelection.create(state.doc, pos));
        view.dispatch(tr);
      }
    },
    [editor, getPos]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Escape") {
        e.preventDefault();
        cancel();
      } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        // Cmd/Ctrl+Enter 保存。普通 Enter 在块级公式里需要保留以便换行。
        e.preventDefault();
        commit();
      } else if (e.key === "Enter" && !displayMode) {
        // 行内公式：Enter 直接保存
        e.preventDefault();
        commit();
      }
    },
    [commit, cancel, displayMode]
  );

  // 编辑态渲染：上方是 textarea，下方实时预览
  if (editing) {
    return (
      <NodeViewWrapper
        as={displayMode ? "div" : "span"}
        className={`math-node-editing ${displayMode ? "block my-2" : "inline-block align-middle mx-0.5"}`}
        contentEditable={false}
      >
        <div className="math-edit-box rounded-md border border-indigo-300 dark:border-indigo-600 bg-app-bg shadow-sm overflow-hidden">
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={handleKeyDown}
            rows={displayMode ? Math.max(2, draft.split("\n").length) : 1}
            className="math-edit-textarea w-full px-2 py-1 text-[12px] font-mono bg-transparent text-tx-primary outline-none resize-none min-w-[120px]"
            placeholder={displayMode ? "输入 LaTeX，Cmd/Ctrl+Enter 保存，Esc 取消" : "输入 LaTeX，Enter 保存"}
            spellCheck={false}
          />
          <div className="math-edit-preview border-t border-bd-secondary px-2 py-1 bg-app-bg-secondary">
            <MathView source={draft} display={displayMode} />
          </div>
        </div>
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper
      as={displayMode ? "div" : "span"}
      className={`math-node ${displayMode ? "math-node-block" : "math-node-inline"} ${selected ? "math-selected" : ""}`}
      // atom 节点：阻止 PM 进入内部，光标只能停在节点的两侧
      contentEditable={false}
      // 阻止拖拽到不合适的位置（例如表头）
      draggable={false}
    >
      <MathView
        source={latex}
        display={displayMode}
        selected={selected}
        onClick={handleClick}
      />
    </NodeViewWrapper>
  );
};

// ---------------------------------------------------------------------------
// MathInline 节点
// ---------------------------------------------------------------------------
export const MathInline = Node.create({
  name: "mathInline",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  // 不参与文本流的 marks
  marks: "",

  addAttributes() {
    return {
      latex: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-latex") || "",
        renderHTML: (attrs) => ({ "data-latex": attrs.latex || "" }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "span[data-math-inline]",
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, { "data-math-inline": "true" }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer((props: NodeViewProps) => (
      <MathNodeView {...props} displayMode={false} />
    ));
  },

  addInputRules() {
    // `$x^2$ ` 触发：识别尾随空格之前的 `$...$`
    return [
      new InputRule({
        find: /(?:^|[^\\$])\$([^$\n]+?)\$\s$/,
        handler: ({ state, range, match, chain }) => {
          const latex = (match[1] || "").trim();
          if (!latex) return null;
          // 起始位置：从匹配文本里 `$` 出现的位置算起
          const matched = match[0];
          const dollarIdx = matched.indexOf("$");
          const start = range.to - (matched.length - dollarIdx);
          const end = range.to;
          chain()
            .deleteRange({ from: start, to: end })
            .insertContent({
              type: "mathInline",
              attrs: { latex },
            })
            // 输入触发后补一个空格，避免光标卡在节点紧贴文字（用户输入连贯）
            .insertContent(" ")
            .run();
        },
      }),
    ];
  },
});

// ---------------------------------------------------------------------------
// MathBlock 节点
// ---------------------------------------------------------------------------
export const MathBlock = Node.create({
  name: "mathBlock",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,
  marks: "",

  addAttributes() {
    return {
      latex: {
        default: "",
        parseHTML: (el) => {
          // 兼容两种存储：data-latex attr，或 textContent（粘贴外部 HTML 时）
          return el.getAttribute("data-latex") || (el.textContent || "").trim();
        },
        renderHTML: (attrs) => ({ "data-latex": attrs.latex || "" }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "div[data-math-block]",
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-math-block": "true" }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer((props: NodeViewProps) => (
      <MathNodeView {...props} displayMode={true} />
    ));
  },

  addInputRules() {
    // 空行输入 `$$` 后回车 → 转为 mathBlock 进入编辑态
    // lezer/markdown 也支持 `$$...$$` 同行写法，这里只做"快捷开局"
    return [
      new InputRule({
        find: /^\$\$$/,
        handler: ({ chain, range }) => {
          chain()
            .deleteRange(range)
            .insertContent({
              type: "mathBlock",
              attrs: { latex: "" },
            })
            .run();
        },
      }),
    ];
  },
});

export const MathExtensions = [MathInline, MathBlock];
