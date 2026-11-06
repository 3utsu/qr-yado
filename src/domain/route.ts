// 環状ルート上の「この先」の計算（D-17）。札所 1〜88 を結ぶ 88 区間（88→1 を含む）。計算だけ。Claude は関与しない。

export type SectionLite = { id: number; length_m: number };
export type HouseOnRoute = { id: string; section_id: number };

export const N_SECTIONS = 88;

// 区間 id（1〜88）を環の中で正規化
export function wrapSection(n: number): number {
  return ((((n - 1) % N_SECTIONS) + N_SECTIONS) % N_SECTIONS) + 1;
}

// from から to まで、方向どおりに進んだときの区間数（0 = 同じ区間）
export function sectionsAhead(from: number, to: number, direction: "forward" | "reverse"): number {
  const d = direction === "forward" ? to - from : from - to;
  return ((d % N_SECTIONS) + N_SECTIONS) % N_SECTIONS;
}

// from から to まで進んだときの距離（m）。同じ区間なら 0。区間の長さは sections から引く
export function metersAhead(from: number, to: number, direction: "forward" | "reverse", sections: SectionLite[]): number {
  const len = new Map(sections.map((s) => [s.id, s.length_m]));
  const n = sectionsAhead(from, to, direction);
  let m = 0;
  for (let i = 0; i < n; i++) {
    const sid = direction === "forward" ? wrapSection(from + i) : wrapSection(from - i);
    m += len.get(sid) ?? 0;
  }
  return m;
}

// 現在の区間から方向どおりに見て、近い順に宿を並べる（同じ区間の宿が先頭）。maxSections で先の区間を絞る
export function housesAhead<T extends HouseOnRoute>(
  houses: T[],
  fromSection: number,
  direction: "forward" | "reverse",
  sections: SectionLite[],
  maxSections = N_SECTIONS - 1,
): (T & { ahead: number; km: number })[] {
  return houses
    .map((h) => ({ ...h, ahead: sectionsAhead(fromSection, h.section_id, direction), km: Math.round(metersAhead(fromSection, h.section_id, direction, sections) / 1000) }))
    .filter((h) => h.ahead <= maxSections)
    .sort((a, b) => a.ahead - b.ahead || a.id.localeCompare(b.id));
}

// 開始の札所から見た最初の区間（順打ちは札所 n から n+1 へ＝区間 n、逆打ちは札所 n から n−1 へ＝区間 n−1）
export function startSection(temple: number, direction: "forward" | "reverse"): number {
  return direction === "forward" ? wrapSection(temple) : wrapSection(temple - 1);
}
