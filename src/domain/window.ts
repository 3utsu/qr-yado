// 受付の窓（D-13）：最初の夜は60日前から。2泊目からは前々日の正午（JST）から。
// 歩く速さは人それぞれなので、先の夜を早くから押さえさせず、近い夜から順に埋める。計算だけ。

export const FIRST_NIGHT_DAYS_AHEAD = 60;
export const OPEN_DAYS_BEFORE = 2; // 前々日
export const OPEN_HOUR_JST = 12; // 正午

export type WindowResult = { open: boolean; reason: "first" | "window" | "too_far" | "past" | "not_yet"; opensAt?: string /* YYYY-MM-DD 12:00 JST */ };

// nowJst: "YYYY-MM-DDTHH:mm" 形式（JST）。date: 泊まる夜。isFirstNight: その人の最初の夜か
export function bookingWindow(date: string, isFirstNight: boolean, nowJst: string): WindowResult {
  const today = nowJst.slice(0, 10);
  if (date < today) return { open: false, reason: "past" };
  if (isFirstNight) {
    const limit = addDaysIso(today, FIRST_NIGHT_DAYS_AHEAD);
    return date <= limit ? { open: true, reason: "first" } : { open: false, reason: "too_far" };
  }
  const opensDay = addDaysIso(date, -OPEN_DAYS_BEFORE);
  const opensAt = `${opensDay}T${String(OPEN_HOUR_JST).padStart(2, "0")}:00`;
  return nowJst >= opensAt ? { open: true, reason: "window" } : { open: false, reason: "not_yet", opensAt };
}

function addDaysIso(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
