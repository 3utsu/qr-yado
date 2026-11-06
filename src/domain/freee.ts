// freee会計「取引インポート（freee標準形式）」の CSV（D-23）。
// 列は freee のヘルプの表の順。勘定科目・税区分は設定データとして持ち、免税・簡易課税などに応じて変えられる。

export type FreeeConfig = {
  incomeAccount: string; // 例: 売上高
  incomeTax: string; // 例: 課税売上10%
  wageAccount: string; // 例: 給料賃金
  wageTax: string; // 例: 対象外
  cashAccount: string; // 決済口座（freee に登録した口座名）例: 現金
};

export const DEFAULT_FREEE_CONFIG: FreeeConfig = {
  incomeAccount: "売上高",
  incomeTax: "課税売上10%",
  wageAccount: "給料賃金",
  wageTax: "対象外",
  cashAccount: "現金",
};

export const FREEE_HEADERS = [
  "収支区分", "管理番号", "発生日", "決済期日", "取引先コード", "取引先", "勘定科目", "税区分", "金額",
  "税計算区分", "税額", "備考", "品目", "部門", "メモタグ", "セグメント1", "セグメント2", "セグメント3",
  "決済日", "決済口座", "決済金額",
] as const;

export type FreeeRow = {
  kind: "収入" | "支出";
  ref: string; // 管理番号
  date: string; // YYYY-MM-DD → YYYY/MM/DD
  partner: string;
  account: string;
  tax: string;
  amount: number;
  memo: string;
  item?: string;
  settledOn?: string; // 決済日（省略で未決済）
  settleAccount?: string;
};

function slash(d: string): string {
  return d.replaceAll("-", "/");
}

function cell(v: string | number | undefined): string {
  if (v === undefined || v === null) return "";
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export function toFreeeCsv(rows: FreeeRow[]): string {
  const lines = [FREEE_HEADERS.join(",")];
  for (const r of rows) {
    const settled = r.settledOn !== undefined;
    lines.push(
      [
        r.kind, r.ref, slash(r.date), "", "", r.partner, r.account, r.tax, r.amount,
        "", "", r.memo, r.item ?? "", "", "", "", "", "",
        settled ? slash(r.settledOn!) : "", settled ? (r.settleAccount ?? "") : "", settled ? r.amount : "",
      ].map(cell).join(","),
    );
  }
  return "﻿" + lines.join("\r\n") + "\r\n"; // BOM 付き UTF-8（Excel と freee の両方で読める）
}

// 収入：1泊1行。支出：要員ごとに月1行（給与）。
export function buildFreeeRows(
  month: string,
  paid: { date: string; price: number; paid_at: string; guest_name: string; house_label: string; booking_id: string }[],
  payroll: { staff: { id: string; name: string }; days: number; amount: number }[],
  cfg: FreeeConfig = DEFAULT_FREEE_CONFIG,
): FreeeRow[] {
  const rows: FreeeRow[] = [];
  for (const p of paid.filter((x) => x.date.startsWith(month))) {
    rows.push({
      kind: "収入", ref: p.booking_id, date: p.date, partner: p.guest_name, account: cfg.incomeAccount, tax: cfg.incomeTax,
      amount: p.price, memo: `宿泊料 ${p.house_label} ${p.date}`, item: "宿泊料", settledOn: p.paid_at.slice(0, 10), settleAccount: cfg.cashAccount,
    });
  }
  const lastDay = `${month}-${String(new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate()).padStart(2, "0")}`;
  for (const l of payroll) {
    rows.push({
      kind: "支出", ref: `wage-${month}-${l.staff.id}`, date: lastDay, partner: l.staff.name, account: cfg.wageAccount, tax: cfg.wageTax,
      amount: l.amount, memo: `${month} 当番 ${l.days}日`, item: "日当", settledOn: lastDay, settleAccount: cfg.cashAccount,
    });
  }
  return rows;
}
