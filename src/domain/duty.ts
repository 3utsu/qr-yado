// 当番の割当（D-22）：宿泊のある夜に、予定が○の要員から1人を選ぶ。
// 公平になるよう、その月の当番回数が少ない人を優先し、同数なら登録順。計算はコードで行う。

export type StaffLite = { id: string; name: string; daily_wage: number };

export function pickDuty(
  available: StaffLite[],
  monthCounts: Record<string, number>,
): StaffLite | null {
  if (available.length === 0) return null;
  const sorted = [...available].sort((a, b) => {
    const ca = monthCounts[a.id] ?? 0;
    const cb = monthCounts[b.id] ?? 0;
    if (ca !== cb) return ca - cb;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return sorted[0];
}

// 「予定○の要員がいない夜は予約を受けない」：その夜に受け付けられるか
export function canAcceptNight(availableCount: number, capacity: number, booked: number, party: number): boolean {
  if (availableCount <= 0) return false;
  return booked + party <= capacity;
}
