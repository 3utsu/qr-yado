// 月の帳簿（D-15, D-22）：収入は受領済みの宿泊料、支出は給与。寄付分は町へ渡す預かり金として分けて見せる。

export type PaidBooking = { date: string; price: number; donation: number; paid_at: string; guest_name: string; house_label: string };

export type Ledger = {
  month: string;
  nights: number; // 受領済みの人泊
  income: number; // 宿泊料の合計（寄付分を含む）
  donations: number; // うち町への寄付（預かり）
  wages: number;
  balance: number; // お財布に残る = income - donations - wages
};

export function monthlyLedger(month: string, paid: PaidBooking[], wages: number): Ledger {
  const inMonth = paid.filter((p) => p.date.startsWith(month));
  const income = inMonth.reduce((a, p) => a + p.price, 0);
  const donations = inMonth.reduce((a, p) => a + p.donation, 0);
  return { month, nights: inMonth.length, income, donations, wages, balance: income - donations - wages };
}
