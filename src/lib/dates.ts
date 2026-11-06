// 日付はすべて JST の暦日（YYYY-MM-DD）で扱う。計算はコードで行う（D-06）。

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

export function todayJst(now: Date = new Date()): string {
  return new Date(now.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
}

export function nowJstIso(now: Date = new Date()): string {
  return new Date(now.getTime() + JST_OFFSET_MS).toISOString().replace("Z", "+09:00");
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

export function monthOf(date: string): string {
  return date.slice(0, 7);
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function datesOfMonth(month: string): string[] {
  const n = daysInMonth(month);
  return Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
}

// 0=日 … 6=土
export function weekday(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

export const WEEKDAY_JA = ["日", "月", "火", "水", "木", "金", "土"];
export const WEEKDAY_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function formatJa(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return `${y}年${m}月${d}日（${WEEKDAY_JA[weekday(date)]}）`;
}

export function formatJaShort(date: string): string {
  const [, m, d] = date.split("-").map(Number);
  return `${m}月${d}日（${WEEKDAY_JA[weekday(date)]}）`;
}

// 住宅宿泊事業法の年間提供日数は 4月1日正午〜翌年4月1日正午で数える。暦日で近似し、4/1 始まりの年度を返す。
export function minpakuYearOf(date: string): string {
  const [y, m] = date.split("-").map(Number);
  return String(m >= 4 ? y : y - 1);
}

export function isValidDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
}
