declare module "lunar-javascript" {
  export class Solar {
    static fromYmd(year: number, month: number, day: number): Solar;
    getLunar(): Lunar;
    toYmd(): string;
  }
  export class Lunar {
    static fromYmd(year: number, month: number, day: number, leapMonth?: boolean): Lunar;
    getYear(): number;
    getMonth(): number;
    getDay(): number;
    getMonthInChinese(): string;
    getDayInChinese(): string;
    getSolar(): Solar;
  }
}
