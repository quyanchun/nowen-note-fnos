import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, AlertCircle, Info, AlertTriangle, X } from "lucide-react";
import { subscribeToasts, ToastItem, toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

const ICONS: Record<ToastItem["type"], React.ReactNode> = {
  success: <CheckCircle2 size={16} className="text-emerald-500" />,
  error: <AlertCircle size={16} className="text-red-500" />,
  info: <Info size={16} className="text-blue-500" />,
  warning: <AlertTriangle size={16} className="text-amber-500" />,
};

const ACCENTS: Record<ToastItem["type"], string> = {
  success: "border-emerald-500/30",
  error: "border-red-500/30",
  info: "border-blue-500/30",
  warning: "border-amber-500/30",
};

export default function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => subscribeToasts(setItems), []);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="pointer-events-none fixed top-4 left-1/2 -translate-x-1/2 z-[9999] flex flex-col items-center gap-2"
      role="status"
      aria-live="polite"
    >
      {items.map((it) => (
        <div
          key={it.id}
          className={cn(
            "pointer-events-auto flex items-center gap-2 px-3.5 py-2.5 rounded-lg shadow-lg",
            "bg-app-elevated border text-sm text-tx-primary max-w-[480px]",
            "animate-in fade-in slide-in-from-top-2 duration-200",
            ACCENTS[it.type]
          )}
        >
          {ICONS[it.type]}
          <span className="flex-1 break-words">{it.message}</span>
          <button
            onClick={() => toast.dismiss(it.id)}
            className="p-0.5 rounded hover:bg-app-hover text-tx-tertiary hover:text-tx-secondary transition-colors"
            aria-label="dismiss"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>,
    document.body
  );
}
