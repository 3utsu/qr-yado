// 定期報告（住宅宿泊事業法：2か月ごと）：宿泊日数、宿泊者数、延べ宿泊者数、国籍別の内訳。計算はコード（D-06）。

export type Stay = { guest_id: string; date: string; nationality: string | null };

export type PeriodicReport = {
  from: string;
  to: string;
  nightsOperated: number; // 宿泊日数（宿泊者がいた夜）
  guests: number; // 宿泊者数（人）
  personNights: number; // 延べ宿泊者数（人泊）
  byNationality: { nationality: string; personNights: number; guests: number }[];
};

// 2か月の報告期間：4-5月、6-7月、8-9月、10-11月、12-1月、2-3月
export function reportPeriodFor(date: string): { from: string; to: string } {
  let y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  let start = m % 2 === 0 ? m : m - 1; // 偶数月始まり
  if (start === 0) {
    start = 12;
    y -= 1; // 1月は前年12月始まりの期間
  }
  const from = `${y}-${String(start).padStart(2, "0")}-01`;
  const endMonth = start + 1;
  const endY = endMonth > 12 ? y + 1 : y;
  const endM = endMonth > 12 ? endMonth - 12 : endMonth;
  const lastDay = new Date(Date.UTC(endY, endM, 0)).getUTCDate();
  return { from, to: `${endY}-${String(endM).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}` };
}

export function periodicReport(stays: Stay[], from: string, to: string): PeriodicReport {
  const inRange = stays.filter((s) => s.date >= from && s.date <= to);
  const nights = new Set(inRange.map((s) => s.date));
  const guests = new Set(inRange.map((s) => s.guest_id));
  const byNat = new Map<string, { pn: number; g: Set<string> }>();
  for (const s of inRange) {
    const key = s.nationality ?? "不明";
    const e = byNat.get(key) ?? { pn: 0, g: new Set<string>() };
    e.pn += 1;
    e.g.add(s.guest_id);
    byNat.set(key, e);
  }
  return {
    from,
    to,
    nightsOperated: nights.size,
    guests: guests.size,
    personNights: inRange.length,
    byNationality: [...byNat.entries()]
      .map(([nationality, e]) => ({ nationality, personNights: e.pn, guests: e.g.size }))
      .sort((a, b) => b.personNights - a.personNights || a.nationality.localeCompare(b.nationality)),
  };
}
