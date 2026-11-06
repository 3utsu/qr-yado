// 給与（D-22）：当番の回数 × 日当。宿泊がなかった夜は当番にならないので 0 円。

import type { StaffLite } from "./duty";

export type DutyLite = { date: string; staff_id: string };

export type PayrollLine = { staff: StaffLite; days: number; amount: number };

export function monthlyPayroll(duties: DutyLite[], staff: StaffLite[], month: string): { lines: PayrollLine[]; total: number } {
  const byId = new Map(staff.map((s) => [s.id, s]));
  const counts = new Map<string, number>();
  for (const d of duties) {
    if (!d.date.startsWith(month)) continue;
    counts.set(d.staff_id, (counts.get(d.staff_id) ?? 0) + 1);
  }
  const lines: PayrollLine[] = [];
  for (const s of staff) {
    const days = counts.get(s.id) ?? 0;
    if (days === 0) continue;
    lines.push({ staff: byId.get(s.id)!, days, amount: days * s.daily_wage });
  }
  return { lines, total: lines.reduce((a, l) => a + l.amount, 0) };
}
