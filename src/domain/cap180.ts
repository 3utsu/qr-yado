// 年間提供日数の上限（住宅宿泊事業法：180日）。4/1 始まりの年度で、宿泊者がいた夜の数を数える。計算はコード（D-06）。

import { minpakuYearOf } from "../lib/dates";

export const MINPAKU_LIMIT_DAYS = 180;

export function nightsOperated(bookingDates: string[], year: string): number {
  const nights = new Set(bookingDates.filter((d) => minpakuYearOf(d) === year));
  return nights.size;
}

export function cap180Status(bookingDates: string[], year: string, limit = MINPAKU_LIMIT_DAYS) {
  const used = nightsOperated(bookingDates, year);
  return { year, used, limit, remaining: Math.max(0, limit - used), exceeded: used > limit, full: used >= limit };
}

// 新しい夜を足しても上限を超えないか（すでにその夜に宿泊があれば日数は増えない）
export function canAddNight(bookingDates: string[], date: string, limit = MINPAKU_LIMIT_DAYS): boolean {
  const year = minpakuYearOf(date);
  if (bookingDates.includes(date)) return true;
  return nightsOperated(bookingDates, year) + 1 <= limit;
}
