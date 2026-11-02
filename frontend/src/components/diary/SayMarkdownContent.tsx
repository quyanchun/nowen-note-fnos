import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * 说说 Markdown 渲染组件
 *
 * 轻量级 Markdown 渲染，用于说说卡片展示。
 * 安全策略：禁止原始 HTML，只允许 Markdown 语法。
 *
 * V1 支持：粗体、斜体、删除线、行内代码、代码块、引用、列表、链接
 * V1 不支持：图片语法、表格、Mermaid、数学公式
 */

interface SayMarkdownContentProps {
  content: string;
  className?: string;
}

export default function SayMarkdownContent({ content, className }: SayMarkdownContentProps) {
  return (
    <div
      className={
        className ||
        `markdown-body break-words prose prose-sm dark:prose-invert max-w-none
        prose-p:my-1 prose-p:leading-relaxed
        prose-headings:my-1.5 prose-headings:font-semibold
        prose-h1:text-sm prose-h2:text-sm prose-h3:text-xs
        prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5
        prose-code:text-xs prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:bg-black/5 dark:prose-code:bg-white/10 prose-code:before:content-none prose-code:after:content-none
        prose-pre:my-1.5 prose-pre:rounded-lg prose-pre:bg-black/5 dark:prose-pre:bg-white/5 prose-pre:p-2 prose-pre:text-xs
        prose-blockquote:my-1.5 prose-blockquote:border-violet-400 prose-blockquote:text-tx-secondary prose-blockquote:pl-3
        prose-hr:my-2
        prose-a:text-accent-primary prose-a:no-underline hover:prose-a:underline
        prose-strong:text-tx-primary`
      }
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        // 禁止原始 HTML 渲染，防止 XSS
        disallowedElements={["script", "style", "iframe", "object", "embed", "form", "input", "textarea", "select", "button"]}
        // 链接安全处理
        components={{
          a: ({ href, children, ...props }) => {
            // 禁止 javascript: 和 data: 链接
            if (href && (href.startsWith("javascript:") || href.startsWith("data:"))) {
              return <span>{children}</span>;
            }
            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer nofollow"
                {...props}
              >
                {children}
              </a>
            );
          },
          // 图片语法不渲染，显示为纯文本
          img: ({ alt, src }) => {
            return <span>![{alt}]({src})</span>;
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
