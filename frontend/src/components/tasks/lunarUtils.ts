import { Solar, Lunar } from "lunar-javascript";

export interface LunarInfo {
  lunarYear: number;
  lunarMonth: number;
  lunarDay: number;
  monthChinese: string;
  dayChinese: string;
}

export function solarToLunar(dateStr: string): LunarInfo {
  const [y, m, d] = dateStr.split("-").map(Number);
  const solar = Solar.fromYmd(y, m, d);
  const lunar = solar.getLunar();
  return {
    lunarYear: lunar.getYear(),
    lunarMonth: Math.abs(lunar.getMonth()),
    lunarDay: lunar.getDay(),
    monthChinese: lunar.getMonthInChinese(),
    dayChinese: lunar.getDayInChinese(),
  };
}

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

export interface LunarRepeatRule {
  interval: number;
  lunarMonth: number;
  lunarDay: number;
}

export function getNextLunarYearDate(baseDate: Date, rule: LunarRepeatRule): Date | null {
  const baseStr = `${baseDate.getFullYear()}-${String(baseDate.getMonth() + 1).padStart(2, "0")}-${String(baseDate.getDate()).padStart(2, "0")}`;
  const lunarInfo = solarToLunar(baseStr);
  const nextLunarYear = lunarInfo.lunarYear + rule.interval;
  const solarStr = lunarToSolar(nextLunarYear, rule.lunarMonth, rule.lunarDay);
  if (!solarStr) return null;
  const [y, m, d] = solarStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export const LUNAR_MONTH_NAMES = [
  "正月", "二月", "三月", "四月", "五月", "六月",
  "七月", "八月", "九月", "十月", "冬月", "腊月",
];

export const LUNAR_DAY_NAMES = [
  "初一", "初二", "初三", "初四", "初五", "初六", "初七", "初八", "初九", "初十",
  "十一", "十二", "十三", "十四", "十五", "十六", "十七", "十八", "十九", "二十",
  "廿一", "廿二", "廿三", "廿四", "廿五", "廿六", "廿七", "廿八", "廿九", "三十",
];
