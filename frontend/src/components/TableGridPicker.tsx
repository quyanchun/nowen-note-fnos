/**
 * TableGridPicker —— 工具栏"插入表格"按钮 + 群晖 Note Station 风格的 hover 网格选择器。
 *
 * 交互：
 *   1) 点击按钮展开浮层
 *   2) 浮层里 maxCols × maxRows 的小方格，鼠标移到 (r, c) 时左上角到该位置都高亮
 *   3) 底部实时显示 "{r} × {c}"
 *   4) 点击 → 插入对应行列的表格 → 关闭浮层
 *   5) 点击外部 / Esc 关闭
 *
 * 设计取舍：
 *   - 用本地 React state 而不是动 DOM；网格小（10×8=80 格），重渲染开销可忽略
 *   - 浮层用 createPortal 渲染到 document.body + position: fixed 定位。
 *     必须用 portal 的原因：工具栏祖先如果有 transform/filter 会创建新的
 *     containing block，导致 fixed 退化为相对祖先的定位，又会被
 *     overflow-x-auto 裁切。项目里 FontSizePopover 等其它弹层也是这么处理的。
 *   - 打开后若窗口滚动/resize，跟随重算坐标（不关闭体验更好）。
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Table2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "../lib/utils";

interface TableGridPickerProps {
  iconSize: number;
  /** 用户选定行列后回调，由父组件去调 editor.insertTable */
  onPick: (rows: number, cols: number) => void;
  /** 网格最大列数，默认 10 */
  maxCols?: number;
  /** 网格最大行数，默认 8 */
  maxRows?: number;
}

export function TableGridPicker({
  iconSize,
  onPick,
  maxCols = 10,
  maxRows = 8,
}: TableGridPickerProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  // hover 到的 (row, col)；0 表示鼠标尚未进入网格
  const [hover, setHover] = useState<{ r: number; c: number }>({ r: 0, c: 0 });
  // popup 在 viewport 中的左上角坐标（fixed 定位）
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  // 打开时根据按钮位置计算 popup 坐标；不够空间时自动翻到按钮上方
  const computePos = () => {
    const btn = btnRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    // 估算 popup 高度：maxRows*18 + gap + padding + 底部提示行 ≈ maxRows*19 + 36
    const estH = maxRows * 19 + 36;
    const spaceBelow = window.innerHeight - rect.bottom;
    const top = spaceBelow < estH + 8 && rect.top > estH + 8
      ? rect.top - estH - 4   // 翻到上方
      : rect.bottom + 4;       // 默认下方
    // 估算 popup 宽度：maxCols*18 + gap + padding ≈ maxCols*19 + 16
    const estW = maxCols * 19 + 16;
    const left = Math.min(rect.left, window.innerWidth - estW - 8);
    setPos({ top, left: Math.max(8, left) });
  };

  // 打开后：初次定位 + 跟随滚动/resize 重算（与项目里 FontSizePopover 等弹层一致）
  useEffect(() => {
    if (!open) return;
    computePos();
    window.addEventListener("scroll", computePos, true);
    window.addEventListener("resize", computePos);
    return () => {
      window.removeEventListener("scroll", computePos, true);
      window.removeEventListener("resize", computePos);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // 点击外部 / Esc 关闭
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (wrapRef.current?.contains(target)) return;
      if (popupRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const handlePick = (r: number, c: number) => {
    onPick(r, c);
    setOpen(false);
    setHover({ r: 0, c: 0 });
  };

  return (
    <div ref={wrapRef} className="relative">
      <button
        ref={btnRef}
        type="button"
        title={t("tiptap.insertTable")}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "p-1.5 rounded-md transition-colors",
          open
            ? "bg-accent-primary/20 text-accent-primary"
            : "text-tx-secondary hover:bg-app-hover hover:text-tx-primary"
        )}
      >
        <Table2 size={iconSize} />
      </button>

      {open && createPortal(
        <div
          ref={popupRef}
          // portal 到 body + fixed：彻底避开工具栏 overflow 裁切与祖先 transform 创建的包含块
          style={{ position: "fixed", top: pos.top, left: pos.left }}
          className="z-[1000] bg-app-elevated border border-app-border rounded-lg shadow-lg p-2"
          // 防止 mousedown 让编辑器失焦后浮层关闭
          onMouseDown={(e) => e.preventDefault()}
        >
          <div
            className="grid gap-0.5"
            style={{
              gridTemplateColumns: `repeat(${maxCols}, 18px)`,
              gridTemplateRows: `repeat(${maxRows}, 18px)`,
            }}
            onMouseLeave={() => setHover({ r: 0, c: 0 })}
          >
            {Array.from({ length: maxRows }).map((_, ri) =>
              Array.from({ length: maxCols }).map((_, ci) => {
                const r = ri + 1;
                const c = ci + 1;
                const active = r <= hover.r && c <= hover.c;
                return (
                  <div
                    key={`${r}-${c}`}
                    onMouseEnter={() => setHover({ r, c })}
                    onClick={() => handlePick(r, c)}
                    className={cn(
                      "border cursor-pointer transition-colors",
                      active
                        ? "bg-accent-primary/40 border-accent-primary"
                        : "bg-app-bg border-app-border hover:border-tx-secondary"
                    )}
                  />
                );
              })
            )}
          </div>
          <div className="mt-1.5 text-center text-xs text-tx-secondary tabular-nums">
            {hover.r > 0 ? `${hover.r} × ${hover.c}` : t("tiptap.tablePickerHint")}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
/* ------------------------------------------------------------------ */
/* TableResizeDialog —— 调整表格尺寸对话框                              */
/* ------------------------------------------------------------------ */

interface TableResizeDialogProps {
  open: boolean;
  /** 当前表格的行列数（仅用于 input 默认值） */
  initialRows: number;
  initialCols: number;
  onCancel: () => void;
  onConfirm: (rows: number, cols: number) => void;
}

export function TableResizeDialog({
  open,
  initialRows,
  initialCols,
  onCancel,
  onConfirm,
}: TableResizeDialogProps) {
  const { t } = useTranslation();
  const [rows, setRows] = useState(initialRows);
  const [cols, setCols] = useState(initialCols);

  // 每次打开时重置默认值
  useEffect(() => {
    if (open) {
      setRows(initialRows);
      setCols(initialCols);
    }
  }, [open, initialRows, initialCols]);

  // Esc 关闭、Enter 确认
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter") onConfirm(rows, cols);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, rows, cols, onCancel, onConfirm]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40"
      onClick={onCancel}
    >
      <div
        className="bg-app-elevated border border-app-border rounded-lg shadow-xl p-4 w-72"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-sm font-medium text-tx-primary mb-3">
          {t("tiptap.resizeTableTitle")}
        </div>
        <div className="space-y-2.5">
          <label className="flex items-center gap-2 text-sm text-tx-secondary">
            <span className="w-12">{t("tiptap.rows")}</span>
            <input
              type="number"
              min={1}
              max={50}
              value={rows}
              onChange={(e) => setRows(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
              className="flex-1 px-2 py-1 bg-app-bg border border-app-border rounded text-tx-primary text-sm focus:outline-none focus:border-accent-primary"
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-tx-secondary">
            <span className="w-12">{t("tiptap.cols")}</span>
            <input
              type="number"
              min={1}
              max={20}
              value={cols}
              onChange={(e) => setCols(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
              className="flex-1 px-2 py-1 bg-app-bg border border-app-border rounded text-tx-primary text-sm focus:outline-none focus:border-accent-primary"
            />
          </label>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1 text-sm rounded text-tx-secondary hover:bg-app-hover"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={() => onConfirm(rows, cols)}
            className="px-3 py-1 text-sm rounded bg-accent-primary text-white hover:opacity-90"
          >
            {t("common.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
