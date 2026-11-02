import React, { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";

// 预设颜色面板 — 16 种常用标签颜色
const PRESET_COLORS = [
  "#f85149", // 红
  "#f0883e", // 橙
  "#d29922", // 黄
  "#7ee787", // 绿
  "#58a6ff", // 蓝
  "#bc8cff", // 紫
  "#f778ba", // 粉
  "#79c0ff", // 浅蓝
  "#56d4dd", // 青
  "#a5d6ff", // 天蓝
  "#ffa657", // 浅橙
  "#d2a8ff", // 浅紫
  "#ff7b72", // 浅红
  "#8b949e", // 灰
  "#e6edf3", // 浅灰
  "#ffffff", // 白
];

interface TagColorPickerProps {
  currentColor: string;
  onColorChange: (color: string) => void;
  /** 触发器大小 — xs=6px（侧边栏 mini）、sm=8px（sidebar 常规/TagInput）、md=12px */
  size?: "xs" | "sm" | "md";
}

export default function TagColorPicker({ currentColor, onColorChange, size = "sm" }: TagColorPickerProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelPos, setPanelPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  // 计算面板位置（基于触发器的绝对屏幕坐标）
  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const panelWidth = 168;
    const panelHeight = 80; // 大约高度
    const spaceBelow = window.innerHeight - rect.bottom;

    let top: number;
    if (spaceBelow < panelHeight + 8 && rect.top > spaceBelow) {
      // 向上弹出
      top = rect.top - panelHeight - 4;
    } else {
      // 向下弹出
      top = rect.bottom + 4;
    }

    // 水平居中对齐触发器
    let left = rect.left + rect.width / 2 - panelWidth / 2;
    // 防止超出左边界
    if (left < 4) left = 4;
    // 防止超出右边界
    if (left + panelWidth > window.innerWidth - 4) {
      left = window.innerWidth - panelWidth - 4;
    }

    setPanelPos({ top, left });
  }, []);

  // 打开时计算位置
  useEffect(() => {
    if (open) updatePosition();
  }, [open, updatePosition]);

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        triggerRef.current && !triggerRef.current.contains(target) &&
        panelRef.current && !panelRef.current.contains(target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // 滚动/resize 时关闭面板
  useEffect(() => {
    if (!open) return;
    const handleClose = () => setOpen(false);
    window.addEventListener("scroll", handleClose, true);
    window.addEventListener("resize", handleClose);
    return () => {
      window.removeEventListener("scroll", handleClose, true);
      window.removeEventListener("resize", handleClose);
    };
  }, [open]);

  const dotSize = size === "xs" ? "w-1.5 h-1.5" : size === "sm" ? "w-2 h-2" : "w-3 h-3";

  return (
    <>
      {/* 触发器：颜色圆点 */}
      <button
        ref={triggerRef}
        type="button"
        className={`${dotSize} rounded-full shrink-0 ring-1 ring-transparent hover:ring-accent-primary/40 transition-all cursor-pointer`}
        style={{ backgroundColor: currentColor }}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(!open);
        }}
        title={t("tags.changeColor")}
      />

      {/* 颜色面板 — Portal 到 body，避免被任何父容器裁剪 */}
      {open && createPortal(
        <div
          ref={panelRef}
          className="tag-input-area fixed z-[200] w-[168px] p-2 bg-app-elevated border border-app-border rounded-lg shadow-xl animate-in fade-in zoom-in-95 duration-100"
          style={{ top: panelPos.top, left: panelPos.left }}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <p className="text-[10px] text-tx-tertiary mb-1.5 px-0.5">{t("tags.tagColor")}</p>
          <div className="grid grid-cols-8 gap-1">
            {PRESET_COLORS.map((color) => {
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
                    onColorChange(color);
                    setOpen(false);
                  }}
                >
                  {isActive && (
                    <Check size={10} className={color === "#ffffff" || color === "#e6edf3" ? "text-zinc-600" : "text-white"} strokeWidth={3} />
                  )}
                </button>
              );
            })}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
