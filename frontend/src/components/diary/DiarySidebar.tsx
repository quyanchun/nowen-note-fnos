import React, { useMemo } from "react";
import { Calendar, TrendingUp, Smile, BarChart3 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { Diary, DiaryStats } from "@/types";

// 心情选项
const MOODS = [
  { value: "happy", emoji: "😊" },
  { value: "excited", emoji: "🥳" },
  { value: "peaceful", emoji: "😌" },
  { value: "thinking", emoji: "🤔" },
  { value: "tired", emoji: "😴" },
  { value: "sad", emoji: "😢" },
  { value: "angry", emoji: "😤" },
  { value: "sick", emoji: "🤒" },
  { value: "love", emoji: "🥰" },
  { value: "cool", emoji: "😎" },
  { value: "laugh", emoji: "🤣" },
  { value: "shock", emoji: "😱" },
];

function getMoodEmoji(mood: string): string {
  return MOODS.find((m) => m.value === mood)?.emoji || "";
}

interface DiarySidebarProps {
  stats: DiaryStats | null;
  moodFilter: string;
  onMoodFilterChange: (mood: string) => void;
  onOpenCalendar: () => void;
  recentItems: Diary[];
}

/**
 * 说说模块右侧面板（桌面端）
 *
 * 包含：
 * - 日历入口卡片
 * - 今日统计
 * - 心情筛选
 * - 最近动态
 */
export default function DiarySidebar({
  stats,
  moodFilter,
  onMoodFilterChange,
  onOpenCalendar,
  recentItems,
}: DiarySidebarProps) {
  const { t } = useTranslation();

  // 统计心情分布
  const moodDistribution = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const item of recentItems) {
      if (item.mood) {
        counts[item.mood] = (counts[item.mood] || 0) + 1;
      }
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);
  }, [recentItems]);

  return (
    <div className="space-y-4">
      {/* 日历入口卡片 */}
      <button
        onClick={onOpenCalendar}
        className="w-full p-4 rounded-xl bg-gradient-to-br from-violet-500/5 to-pink-500/5 border border-violet-200/30 dark:border-violet-500/10 hover:from-violet-500/10 hover:to-pink-500/10 transition-all group"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-pink-500 flex items-center justify-center shadow-lg shadow-violet-500/20">
            <Calendar size={20} className="text-white" />
          </div>
          <div className="text-left">
            <div className="text-sm font-semibold text-tx-primary">
              {t("diary.calendarTitle") || "日历视图"}
            </div>
            <div className="text-[11px] text-tx-tertiary">
              {t("diary.calendarSubtitle", { defaultValue: "按日期浏览说说" })}
            </div>
          </div>
        </div>
      </button>

      {/* 今日统计卡片 */}
      {stats && (
        <div className="p-4 rounded-xl bg-app-surface border border-app-border">
          <div className="flex items-center gap-2 mb-3">
            <BarChart3 size={14} className="text-accent-primary" />
            <span className="text-xs font-semibold text-tx-secondary">
              {t("diary.statsTitle", { defaultValue: "统计" })}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="text-center p-2 rounded-lg bg-app-hover/50">
              <div className="text-lg font-bold text-accent-primary">{stats.total}</div>
              <div className="text-[10px] text-tx-tertiary">{t("diary.statsTotal", { defaultValue: "总计" })}</div>
            </div>
            <div className="text-center p-2 rounded-lg bg-app-hover/50">
              <div className="text-lg font-bold text-accent-primary">{stats.todayCount}</div>
              <div className="text-[10px] text-tx-tertiary">{t("diary.statsToday", { defaultValue: "今日" })}</div>
            </div>
          </div>
        </div>
      )}

      {/* 心情筛选 */}
      <div className="p-4 rounded-xl bg-app-surface border border-app-border">
        <div className="flex items-center gap-2 mb-3">
          <Smile size={14} className="text-accent-primary" />
          <span className="text-xs font-semibold text-tx-secondary">
            {t("diary.moodFilterTitle", { defaultValue: "心情" })}
          </span>
        </div>
        <div className="grid grid-cols-4 gap-2">
          <button
            onClick={() => onMoodFilterChange("")}
            className={cn(
              "p-2 rounded-lg text-xs font-medium transition-all whitespace-nowrap",
              !moodFilter
                ? "bg-accent-primary/15 text-accent-primary"
                : "text-tx-tertiary hover:bg-app-hover hover:text-tx-secondary",
            )}
          >
            {t("diary.filterMoodAll")}
          </button>
          {MOODS.map(({ value: v, emoji }) => (
            <button
              key={v}
              onClick={() => onMoodFilterChange(moodFilter === v ? "" : v)}
              className={cn(
                "p-2 rounded-lg text-lg transition-all",
                moodFilter === v
                  ? "bg-accent-primary/15 scale-110 ring-1 ring-accent-primary/30"
                  : "hover:bg-app-hover hover:scale-105",
              )}
              title={t(`diary.mood${v.charAt(0).toUpperCase() + v.slice(1)}`)}
            >
              {emoji}
            </button>
          ))}
        </div>
      </div>

      {/* 心情分布（最近说说） */}
      {moodDistribution.length > 0 && (
        <div className="p-4 rounded-xl bg-app-surface border border-app-border">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp size={14} className="text-accent-primary" />
            <span className="text-xs font-semibold text-tx-secondary">
              {t("diary.moodDistribution", { defaultValue: "心情分布" })}
            </span>
          </div>
          <div className="space-y-2">
            {moodDistribution.map(([mood, count]) => (
              <div key={mood} className="flex items-center gap-2">
                <span className="text-sm w-6 text-center">{getMoodEmoji(mood)}</span>
                <div className="flex-1 h-1.5 bg-app-hover rounded-full overflow-hidden">
                  <div
                    className="h-full bg-accent-primary/60 rounded-full"
                    style={{ width: `${Math.min(100, (count / recentItems.length) * 100)}%` }}
                  />
                </div>
                <span className="text-[10px] text-tx-tertiary w-6 text-right">{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
