/**
 * TASK-RECURRENCE-LUNAR-01: 农历转换适配层
 *
 * 封装 lunar-javascript 库，提供：
 * - 公历转农历
 * - 农历转公历（含日期溢出兜底）
 * - 计算农历年循环的下一次公历日期
 *
 * V1 策略：不处理闰月选择，闰月一律按普通月处理。
 */

import { Solar, Lunar } from "lunar-javascript";

export interface LunarInfo {
  lunarYear: number;
  lunarMonth: number; // 1-12，不含闰月标记
  lunarDay: number;
  monthChinese: string; // "正"~"腊"
  dayChinese: string; // "初一"~"三十"
}

export interface LunarRepeatRule {
  interval: number;
  lunarMonth: number; // 1-12
  lunarDay: number; // 1-30
}

/** 公历日期字符串 → 农历信息 */
export function solarToLunar(dateStr: string): LunarInfo {
  const [y, m, d] = dateStr.split("-").map(Number);
  const solar = Solar.fromYmd(y, m, d);
  const lunar = solar.getLunar();
  return {
    lunarYear: lunar.getYear(),
    lunarMonth: Math.abs(lunar.getMonth()), // 闰月取绝对值，V1 不区分
    lunarDay: lunar.getDay(),
    monthChinese: lunar.getMonthInChinese(),
    dayChinese: lunar.getDayInChinese(),
  };
}

/** 农历 → 公历日期字符串，日期不存在时向下兜底 */
export function lunarToSolar(lunarYear: number, lunarMonth: number, lunarDay: number): string | null {
  for (let day = lunarDay; day >= 1; day--) {
    try {
      const lunar = Lunar.fromYmd(lunarYear, lunarMonth, day, false);
      const solar = lunar.getSolar();
      return solar.toYmd();
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * 计算农历年循环的下一次公历日期。
 *
 * 规则：
 * 1. baseDate 转换为农历，取 lunarYear
 * 2. nextLunarYear = lunarYear + interval
 * 3. 用 rule.lunarMonth / rule.lunarDay 转换为目标公历
 * 4. 如果 lunarDay 不存在（如小月三十），落到该月最后一天
 */
export function getNextLunarYearDate(baseDate: Date, rule: LunarRepeatRule): Date | null {
  const baseStr = `${baseDate.getFullYear()}-${String(baseDate.getMonth() + 1).padStart(2, "0")}-${String(baseDate.getDate()).padStart(2, "0")}`;
  const lunarInfo = solarToLunar(baseStr);
  const nextLunarYear = lunarInfo.lunarYear + rule.interval;
  const solarStr = lunarToSolar(nextLunarYear, rule.lunarMonth, rule.lunarDay);
  if (!solarStr) return null;
  const [y, m, d] = solarStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}
