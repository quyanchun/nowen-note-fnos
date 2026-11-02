/**
 * MathView：KaTeX 公式预览 React 组件
 *
 * 用途：
 *   - 编辑器内 MathInline / MathBlock 节点的 NodeView
 *   - 分享页 MD 路径下用于渲染 ReactMarkdown 拦截到的 math 代码
 *   - 任何需要把一段 LaTeX 源码直接显示为 HTML 的地方
 *
 * 行为：
 *   - 异步调用 `renderKatex`，loading 极短（KaTeX 同步渲染，慢点的是首次加载）
 *   - 渲染成功：直接 dangerouslySetInnerHTML 注入 HTML
 *     （KaTeX 的输出是 well-formed；trust:false 已经在 lib 里禁了不安全命令）
 *   - 渲染失败：显示红色错误条 + 折叠的原始源码
 *   - 行内 / 块级两种排版：display=block 时居中并加上下间距
 *   - 编辑器场景下点击会触发 `onClick`（让外层 NodeView 弹源码编辑器）
 */
import React, { useEffect, useRef, useState } from "react";
import { renderKatex } from "@/lib/katexRenderer";
import { AlertTriangle } from "lucide-react";

interface MathViewProps {
  /** LaTeX 源码 */
  source: string;
  /** display=true 渲染为块级（$$...$$），false 渲染为行内（$...$） */
  display?: boolean;
  /** 渲染失败时是否显示折叠的源码（默认 true） */
  showSourceOnError?: boolean;
  /** 点击事件（编辑器场景用于弹源码编辑器） */
  onClick?: (e: React.MouseEvent) => void;
  className?: string;
  /** 编辑器场景下，被选中态视觉强化 */
  selected?: boolean;
  /** 空内容时显示的占位文案，默认 "公式"（块级） / "公式..." （行内） */
  placeholder?: string;
}

export const MathView: React.FC<MathViewProps> = ({
  source,
  display = false,
  showSourceOnError = true,
  onClick,
  className,
  selected = false,
  placeholder,
}) => {
  const [html, setHtml] = useState<string>("");
  const [error, setError] = useState<string>("");
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    if (!source.trim()) {
      setHtml("");
      setError("");
      return;
    }
    renderKatex(source, { displayMode: display }).then((res) => {
      if (cancelledRef.current) return;
      setHtml(res.html);
      setError(res.error);
    });
    return () => {
      cancelledRef.current = true;
    };
  }, [source, display]);

  // 空内容占位
  if (!source.trim()) {
    const ph = placeholder ?? (display ? "公式（双击编辑）" : "公式");
    return (
      <span
        className={`math-view-placeholder ${display ? "block" : "inline"} text-tx-tertiary opacity-60 ${className ?? ""}`}
        onClick={onClick}
        contentEditable={false}
      >
        {display ? <span style={{ display: "block", textAlign: "center", padding: "8px 0" }}>{ph}</span> : <span>{ph}</span>}
      </span>
    );
  }

  if (error) {
    return (
      <span
        className={`math-view-error inline-flex flex-col items-start gap-1 rounded border border-red-300/60 bg-red-50/60 dark:bg-red-900/20 dark:border-red-700/40 px-2 py-1 ${className ?? ""}`}
        onClick={onClick}
        contentEditable={false}
      >
        <span className="flex items-center gap-1 text-red-600 dark:text-red-300 text-[11px]">
          <AlertTriangle size={12} />
          <span className="font-medium">LaTeX 错误</span>
        </span>
        {showSourceOnError && (
          <code className="text-[11px] font-mono text-tx-secondary opacity-90 break-all">
            {source}
          </code>
        )}
        <span className="text-[10px] text-red-500/80 dark:text-red-400/80 break-words">
          {error}
        </span>
      </span>
    );
  }

  // display 模式渲染为 block，行内模式渲染为 inline-block；
  // KaTeX 自己出的根元素已经控制好排版，这里包一层主要负责选中态/点击边界。
  if (display) {
    return (
      <div
        className={`math-view-block ${selected ? "math-selected" : ""} ${className ?? ""}`}
        onClick={onClick}
        contentEditable={false}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }
  return (
    <span
      className={`math-view-inline ${selected ? "math-selected" : ""} ${className ?? ""}`}
      onClick={onClick}
      contentEditable={false}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
};

export default MathView;
