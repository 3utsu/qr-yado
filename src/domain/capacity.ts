// 四国全体の需給（D-13, D-24）：区間ごとに「その夜に泊まりたい人」と「布団の数」を比べ、足りない区間と夜に受付のブレーキをかける。
// 需要は「1日に歩き始める人数」から、歩く速さと入口（1番札所・4つの空港）の分布で推定する。すべてコードで計算し、Claude は関与しない。
// 既存の宿の布団の数は架空の推定値（四国遍路の宿 617件 × 平均8人を、区間の長さに比例して配る）。

export type Section = { id: number; from: number; to: number; from_name: string; to_name: string; length_m: number };

export type DemandParams = {
  startsPerDay: number; // 1日に歩き始める人数
  kmPerDay: number; // 1日に歩く距離（既定 23km ≒ 1,146km ÷ 50日）
  forwardShare: number; // 順打ちの割合（0〜1）
  entries: { sectionId: number; share: number }[]; // 入口（区間 id と割合）
  existingBeds: number; // 既存の宿の布団の総数（架空）
};

export const DEFAULT_PARAMS: DemandParams = {
  startsPerDay: 120,
  kmPerDay: 23,
  forwardShare: 0.85,
  // 1番札所（区間1）、徳島空港→17番付近、高松空港→82番付近、高知空港→27番付近、松山空港→51番付近
  entries: [
    { sectionId: 1, share: 0.5 },
    { sectionId: 17, share: 0.1 },
    { sectionId: 82, share: 0.15 },
    { sectionId: 27, share: 0.1 },
    { sectionId: 51, share: 0.15 },
  ],
  existingBeds: 617 * 8,
};

// 区間ごとの「泊地」としての需要：その夜にその区間で泊まる人数の期待値（定常状態）
export function nightlyDemand(sections: Section[], p: DemandParams): Map<number, number> {
  const n = sections.length;
  const total = sections.reduce((a, s) => a + s.length_m, 0) / 1000;
  const daysTotal = total / p.kmPerDay; // 全工程の日数
  // 定常状態では、道の上にいる人は startsPerDay × daysTotal 人。各区間の人数は区間の長さに比例（入口の偏りは小さく補正）。
  const onRoad = p.startsPerDay * daysTotal;
  const demand = new Map<number, number>();
  for (const s of sections) demand.set(s.id, (onRoad * (s.length_m / 1000)) / total);
  // 入口の近くは、歩き始めの人が多い分だけ人が多い（入口から 2 日分の区間に、その入口の割合 × startsPerDay を上乗せ）
  for (const e of p.entries) {
    const add = p.startsPerDay * e.share;
    const dirs = [
      { dir: 1, share: p.forwardShare },
      { dir: -1, share: 1 - p.forwardShare },
    ];
    for (const d of dirs) {
      let km = 0;
      for (let k = 0; k < n && km < p.kmPerDay * 2; k++) {
        const idx = (((e.sectionId - 1 + d.dir * k) % n) + n) % n;
        const s = sections[idx];
        demand.set(s.id, (demand.get(s.id) ?? 0) + add * d.share * (s.length_m / 1000 / (p.kmPerDay * 2)));
        km += s.length_m / 1000;
      }
    }
  }
  return demand;
}

// 区間ごとの布団の数：既存の宿（架空の推定）＋ qr-yado の宿
export function nightlySupply(sections: Section[], existingBeds: number, houses: { section_id: number | null; capacity: number }[]): Map<number, number> {
  const total = sections.reduce((a, s) => a + s.length_m, 0);
  const supply = new Map<number, number>();
  for (const s of sections) supply.set(s.id, Math.round((existingBeds * s.length_m) / total));
  for (const h of houses) if (h.section_id) supply.set(h.section_id, (supply.get(h.section_id) ?? 0) + h.capacity);
  return supply;
}

export type SectionNight = { sectionId: number; date: string; demand: number; supply: number; ratio: number; state: "ok" | "tight" | "over" };

// 日ごとの揺らぎ：週末と日付で決まる決定的な係数（0.75〜1.3）。乱数は使わない（再現性のため）。
export function dayFactor(date: string, sectionId: number): number {
  const d = new Date(`${date}T00:00:00Z`);
  const dow = d.getUTCDay();
  const weekend = dow === 5 || dow === 6 ? 1.15 : dow === 0 ? 1.05 : 1.0;
  const wave = 1 + 0.15 * Math.sin((d.getUTCDate() + sectionId * 7) / 3.1);
  return weekend * wave;
}

export function boardFor(sections: Section[], dates: string[], p: DemandParams, houses: { section_id: number | null; capacity: number }[]): SectionNight[] {
  const demand = nightlyDemand(sections, p);
  const supply = nightlySupply(sections, p.existingBeds, houses);
  const out: SectionNight[] = [];
  for (const s of sections) {
    for (const date of dates) {
      const dmd = (demand.get(s.id) ?? 0) * dayFactor(date, s.id);
      const sup = Math.max(1, supply.get(s.id) ?? 0);
      const ratio = dmd / sup;
      out.push({ sectionId: s.id, date, demand: Math.round(dmd), supply: sup, ratio, state: ratio > 1 ? "over" : ratio > 0.8 ? "tight" : "ok" });
    }
  }
  return out;
}

// 詰まり：ratio>1 の区間と夜。不足人数 = 需要 − 布団
export function bottlenecks(cells: SectionNight[]): { sectionId: number; dates: string[]; shortage: number }[] {
  const by = new Map<number, { dates: string[]; shortage: number }>();
  for (const c of cells) {
    if (c.state !== "over") continue;
    const e = by.get(c.sectionId) ?? { dates: [], shortage: 0 };
    e.dates.push(c.date);
    e.shortage = Math.max(e.shortage, c.demand - c.supply);
    by.set(c.sectionId, e);
  }
  return [...by.entries()].map(([sectionId, e]) => ({ sectionId, ...e })).sort((a, b) => b.shortage - a.shortage);
}
