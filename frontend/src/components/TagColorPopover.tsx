import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";

// 预设颜色面板 — 与 TagColorPicker 保持一致的 16 色
export const PRESET_TAG_COLORS = [
  "#f85149", "#f0883e", "#d29922", "#7ee787",
  "#58a6ff", "#bc8cff", "#f778ba", "#79c0ff",
  "#56d4dd", "#a5d6ff", "#ffa657", "#d2a8ff",
  "#ff7b72", "#8b949e", "#e6edf3", "#ffffff",
];

interface TagColorPopoverProps {
  /** 锚点坐标（通常为右键/长按位置） */
  x: number;
  y: number;
  currentColor: string;
  onPick: (color: string) => void;
  onClose: () => void;
  title?: string;
}

/**
 * 独立的颜色选择浮层：由外部传入坐标，自身处理边界修正、外点关闭。
 * 适用于右键菜单 / 长按菜单触发的颜色选择场景。
 */
export default function TagColorPopover({
  x, y, currentColor, onPick, onClose, title,
}: TagColorPopoverProps) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: y, left: x });

  // 边界修正
  useEffect(() => {
    requestAnimationFrame(() => {
      const el = panelRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let left = x;
      let top = y;
      if (left + rect.width > vw - 8) left = vw - rect.width - 8;
      if (top + rect.height > vh - 8) top = vh - rect.height - 8;
      if (left < 8) left = 8;
      if (top < 8) top = 8;
      if (left !== x || top !== y) setPos({ top, left });
    });
  }, [x, y]);

  // 外点/ESC/滚动/resize 关闭
  useEffect(() => {
    const handleDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (panelRef.current && !panelRef.current.contains(target)) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const handleClose = () => onClose();
    document.addEventListener("mousedown", handleDown);
    document.addEventListener("touchstart", handleDown, { passive: true });
    document.addEventListener("keydown", handleKey);
    window.addEventListener("scroll", handleClose, true);
    window.addEventListener("resize", handleClose);
    return () => {
      document.removeEventListener("mousedown", handleDown);
      document.removeEventListener("touchstart", handleDown);
      document.removeEventListener("keydown", handleKey);
      window.removeEventListener("scroll", handleClose, true);
      window.removeEventListener("resize", handleClose);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={panelRef}
      className="tag-input-area fixed z-[200] w-[180px] p-2 bg-app-elevated border border-app-border rounded-lg shadow-xl animate-in fade-in zoom-in-95 duration-100 select-none"
      style={{ top: pos.top, left: pos.left }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <p className="text-[10px] text-tx-tertiary mb-1.5 px-0.5 truncate">
        {title || t("tags.tagColor")}
      </p>
      <div className="grid grid-cols-8 gap-1">
        {PRESET_TAG_COLORS.map((color) => {
          const isActive = currentColor.toLowerCase() === color.toLowerCase();
          return (
            <button
              key={color}
              type="button"
              className={`w-4 h-4 rounded-full flex items-center justify-center transition-transform hover:scale-125 ${
                isActive ? "ring-2 ring-accent-primary ring-offset-1 ring-offset-app-elevated" : ""
              } ${color === "#ffffff" || color === "#e6edf3" ? "border border-app-border" : ""}`}
              style={{ backgroundColor: color }}
              onClick={() => {
                onPick(color);
                onClose();
              }}
            >
              {isActive && (
                <Check
                  size={10}
                  className={color === "#ffffff" || color === "#e6edf3" ? "text-zinc-600" : "text-white"}
                  strokeWidth={3}
                />
              )}
            </button>
          );
        })}
      </div>
    </div>,
    document.body
  );
}
