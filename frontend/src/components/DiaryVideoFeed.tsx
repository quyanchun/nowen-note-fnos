import React, { useState, useEffect, useCallback, useRef } from "react";
import { X, Volume2, VolumeX, ChevronUp, ChevronDown, Loader2, Play } from "lucide-react";
import { Diary } from "@/types";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import SayMarkdownContent from "@/components/diary/SayMarkdownContent";

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------
function diaryMediaFromItem(item: Diary): DiaryMediaItem[] {
  if (Array.isArray(item.media) && item.media.length > 0) return item.media;
  return (item.images || []).map((id) => ({ id, type: "image" as const }));
}

function timeAgo(dateStr: string, t: (key: string) => string): string {
  const now = new Date();
  const date = new Date(dateStr.replace(" ", "T") + "Z");
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);
  if (diffSec < 60) return t("diary.justNow");
  if (diffMin < 60) return t("diary.minutesAgo").replace("{{n}}", String(diffMin));
  if (diffHour < 24) return t("diary.hoursAgo").replace("{{n}}", String(diffHour));
  if (diffDay < 7) return t("diary.daysAgo").replace("{{n}}", String(diffDay));
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  if (y === now.getFullYear()) return `${m}-${d} ${h}:${min}`;
  return `${y}-${m}-${d} ${h}:${min}`;
}

function getMoodEmoji(mood: string): string {
  const MOODS: Record<string, string> = {
    happy: "\u{1f60a}", excited: "\u{1f973}", peaceful: "\u{1f60c}", thinking: "\u{1f914}",
    tired: "\u{1f634}", sad: "\u{1f622}", angry: "\u{1f624}", sick: "\u{1f912}",
    love: "\u{1f970}", cool: "\u{1f60e}", laugh: "\u{1f923}", shock: "\u{1f631}",
  };
  return MOODS[mood] || "";
}

import type { DiaryMediaItem } from "@/types";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
interface DiaryVideoFeedProps {
  open: boolean;
  items: Diary[];
  index: number;
  hasMore: boolean;
  loadingMore: boolean;
  loading: boolean;
  onClose: () => void;
  onIndexChange: (idx: number) => void;
  onLoadMore: () => void;
}

// ---------------------------------------------------------------------------
// 组件
// ---------------------------------------------------------------------------
export default function DiaryVideoFeed({
  open,
  items,
  index,
  hasMore,
  loadingMore,
  loading,
  onClose,
  onIndexChange,
  onLoadMore,
}: DiaryVideoFeedProps) {
  const { t } = useTranslation();
  const [muted, setMuted] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const touchStartRef = useRef<{ y: number; time: number } | null>(null);
  const wheelCooldownRef = useRef(false);

  const currentItem = items[index];
  const videoId = currentItem
    ? diaryMediaFromItem(currentItem).find((m) => m.type === "video")?.id
    : null;
  const videoUrl = videoId ? api.diaryImages.urlFor(videoId) : null;
  const total = items.length;

  // 切换视频时尝试播放
  useEffect(() => {
    if (!videoRef.current || !videoUrl) return;
    videoRef.current.load();
    videoRef.current.play().catch(() => {});
  }, [videoUrl]);

  // 自动加载更多
  useEffect(() => {
    if (open && index >= items.length - 3 && hasMore && !loadingMore) {
      onLoadMore();
    }
  }, [open, index, items.length, hasMore, loadingMore, onLoadMore]);

  // 键盘
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
      if (e.key === "ArrowDown" || e.key === "ArrowRight") { e.preventDefault(); goNext(); }
      if (e.key === "ArrowUp" || e.key === "ArrowLeft") { e.preventDefault(); goPrev(); }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, items.length, index]);

  const goNext = useCallback(() => {
    if (index < items.length - 1) {
      onIndexChange(index + 1);
    }
  }, [index, items.length, onIndexChange]);

  const goPrev = useCallback(() => {
    if (index > 0) {
      onIndexChange(index - 1);
    }
  }, [index, onIndexChange]);

  // 滚轮
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (wheelCooldownRef.current) return;
    if (Math.abs(e.deltaY) < 30) return;
    wheelCooldownRef.current = true;
    setTimeout(() => { wheelCooldownRef.current = false; }, 400);
    if (e.deltaY > 0) goNext();
    else goPrev();
  }, [goNext, goPrev]);

  // 触摸
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartRef.current = { y: e.touches[0].clientY, time: Date.now() };
  }, []);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!touchStartRef.current) return;
    const deltaY = touchStartRef.current.y - e.changedTouches[0].clientY;
    const elapsed = Date.now() - touchStartRef.current.time;
    touchStartRef.current = null;
    if (elapsed > 1000) return;
    if (deltaY > 50) goNext();
    else if (deltaY < -50) goPrev();
  }, [goNext, goPrev]);

  if (!open) return null;

  // 空状态
  if (!loading && items.length === 0) {
    return (
      <div className="fixed inset-0 z-[120] bg-black flex flex-col items-center justify-center text-white">
        <Play size={48} className="mb-4 opacity-40" />
        <p className="text-sm opacity-60">{t("diary.noVideoPosts")}</p>
        <button
          onClick={onClose}
          className="mt-6 px-4 py-2 rounded-full bg-white/10 hover:bg-white/20 text-sm transition-colors"
        >
          {t("diary.exitVideoFeed")}
        </button>
      </div>
    );
  }

  // 加载中
  if (loading) {
    return (
      <div className="fixed inset-0 z-[120] bg-black flex items-center justify-center">
        <Loader2 size={32} className="animate-spin text-white/60" />
      </div>
    );
  }

  const contentText = currentItem?.contentText?.trim() || "";
  const moodEmoji = currentItem?.mood ? getMoodEmoji(currentItem.mood) : "";
  const creatorName = currentItem?.creatorName;

  return (
    <div
      className="fixed inset-0 z-[120] bg-black text-white flex flex-col"
      onWheel={handleWheel}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* 顶部栏 */}
      <div className="flex items-center justify-between px-4 py-3 shrink-0">
        <button
          onClick={onClose}
          className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
          title={t("diary.exitVideoFeed")}
        >
          <X size={18} />
        </button>
        <span className="text-sm font-medium opacity-70">
          {index + 1} / {total}
        </span>
        <button
          onClick={() => setMuted(!muted)}
          className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
          title={muted ? t("diary.unmuted") : t("diary.muted")}
        >
          {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
        </button>
      </div>

      {/* 视频区域 */}
      <div className="flex-1 flex items-center justify-center relative min-h-0 px-2">
        {/* 上一条按钮（桌面端） */}
        <button
          onClick={goPrev}
          disabled={index <= 0}
          className={cn(
            "hidden md:flex absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 items-center justify-center transition-colors",
            index > 0 ? "hover:bg-white/20" : "opacity-30 cursor-not-allowed",
          )}
        >
          <ChevronUp size={20} />
        </button>

        {/* 视频播放器 */}
        <div className="w-full max-w-[480px] h-full flex items-center justify-center">
          {videoUrl && (
            <video
              ref={videoRef}
              src={videoUrl}
              className="max-w-full max-h-full object-contain rounded-lg bg-black"
              controls
              playsInline
              muted={muted}
              preload="metadata"
            />
          )}
        </div>

        {/* 下一条按钮（桌面端） */}
        <button
          onClick={goNext}
          disabled={index >= items.length - 1 && !hasMore}
          className={cn(
            "hidden md:flex absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 items-center justify-center transition-colors",
            index < items.length - 1 || hasMore ? "hover:bg-white/20" : "opacity-30 cursor-not-allowed",
          )}
        >
          <ChevronDown size={20} />
        </button>
      </div>

      {/* 底部信息层 */}
      <div className="shrink-0 px-4 py-3 bg-gradient-to-t from-black/80 to-transparent">
        {moodEmoji && (
          <span className="text-lg mr-2">{moodEmoji}</span>
        )}
        {creatorName && (
          <span className="text-xs opacity-60 mr-2">@{creatorName}</span>
        )}
        {currentItem?.createdAt && (
          <span className="text-xs opacity-40">{timeAgo(currentItem.createdAt, t)}</span>
        )}
        {contentText && (
          <div
            className={cn(
              "mt-1.5 text-sm leading-relaxed opacity-90",
              !expanded && "line-clamp-3",
            )}
            onClick={() => setExpanded(!expanded)}
          >
            <SayMarkdownContent content={contentText} />
          </div>
        )}

        {/* 加载更多提示 */}
        {loadingMore && (
          <div className="flex items-center gap-2 mt-2 text-xs opacity-40">
            <Loader2 size={12} className="animate-spin" />
            <span>{t("diary.loadingVideos")}</span>
          </div>
        )}
        {!hasMore && index >= items.length - 1 && (
          <p className="mt-2 text-xs opacity-30 text-center">{t("diary.noMoreVideos")}</p>
        )}
      </div>
    </div>
  );
}
