// freee会計「取引インポート（freee標準形式）」の CSV（D-23）。
// 列は freee のヘルプの表の順。勘定科目・税区分は設定データとして持ち、免税・簡易課税などに応じて変えられる。

export type FreeeConfig = {
  incomeAccount: string; // 例: 売上高
  incomeTax: string; // 例: 課税売上10%
  wageAccount: string; // 例: 給料賃金
  wageTax: string; // 例: 対象外
  donationAccount: string; // 例: 寄付金（1泊500円を町へ。D-20）
  donationTax: string; // 例: 対象外
  donationPartner: string; // 例: 自治体
  cashAccount: string; // 決済口座（freee に登録した口座名）例: 現金
};

// 既定値。freee に無い名前はインポートで止まるので、事業主の画面で freee の勘定科目一覧に合わせて直せる。
// 町への寄付は帳簿どおり「預かり」として出す（経費か預り金かの扱いは商工会・税理士の判断。設定で変えられる）
export const DEFAULT_FREEE_CONFIG: FreeeConfig = {
  incomeAccount: "売上高",
  incomeTax: "課税売上10%",
  wageAccount: "給料賃金",
  wageTax: "対象外",
  donationAccount: "預り金",
  donationTax: "対象外",
  donationPartner: "町（宿泊者からの寄付の預かり）",
  cashAccount: "現金",
};

export const FREEE_CONFIG_LABELS: Record<keyof FreeeConfig, string> = {
  incomeAccount: "宿泊料の勘定科目",
  incomeTax: "宿泊料の税区分",
  wageAccount: "日当の勘定科目",
  wageTax: "日当の税区分",
  donationAccount: "町への寄付の勘定科目",
  donationTax: "町への寄付の税区分",
  donationPartner: "町への寄付の取引先",
  cashAccount: "決済口座（freee に登録した口座名）",
};

// 保存された JSON（部分でも可）と既定値を合わせる
export function freeeConfigFrom(json: string | null | undefined): FreeeConfig {
  let o: Partial<FreeeConfig> = {};
  try {
    if (json) o = JSON.parse(json);
  } catch {
    o = {};
  }
  const cfg = { ...DEFAULT_FREEE_CONFIG };
  for (const k of Object.keys(cfg) as (keyof FreeeConfig)[]) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) cfg[k] = v.trim();
  }
  return cfg;
}

// freee の管理番号は20文字まで
export const FREEE_REF_MAX = 20;
export function freeeRef(s: string): string {
  return s.slice(0, FREEE_REF_MAX);
}

// freee の列のうち、使わない任意の列（取引先コード・部門・メモタグ・セグメント1〜3）は出さない。
// プランによって「無効な列」の警告になるため（2026-11-06 の取り込みテストで確認）
export const FREEE_HEADERS = [
  "収支区分", "管理番号", "発生日", "決済期日", "取引先", "勘定科目", "税区分", "金額",
  "税計算区分", "税額", "備考", "品目",
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
        r.kind, r.ref, slash(r.date), "", r.partner, r.account, r.tax, r.amount,
        "", "", r.memo, r.item ?? "",
        settled ? slash(r.settledOn!) : "", settled ? (r.settleAccount ?? "") : "", settled ? r.amount : "",
      ].map(cell).join(","),
    );
  }
  return "﻿" + lines.join("\r\n") + "\r\n"; // BOM 付き UTF-8（Excel と freee の両方で読める）
}

// 収入：1泊1行。支出：要員ごとに月1行（給与）と、町への寄付を月1行（未決済。帳簿の「お財布に残る」と一致させる）。
export function buildFreeeRows(
  month: string,
  paid: { date: string; price: number; donation?: number; paid_at: string; guest_name: string; house_label: string; booking_id: string }[],
  payroll: { staff: { id: string; name: string }; days: number; amount: number }[],
  cfg: FreeeConfig = DEFAULT_FREEE_CONFIG,
): FreeeRow[] {
  const rows: FreeeRow[] = [];
  const inMonth = paid.filter((x) => x.date.startsWith(month));
  for (const p of inMonth) {
    rows.push({
      kind: "収入", ref: freeeRef(p.booking_id), date: p.date, partner: p.guest_name, account: cfg.incomeAccount, tax: cfg.incomeTax,
      amount: p.price, memo: `宿泊料 ${p.house_label} ${p.date}`, item: "宿泊料", settledOn: p.paid_at.slice(0, 10), settleAccount: cfg.cashAccount,
    });
  }
  const lastDay = `${month}-${String(new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate()).padStart(2, "0")}`;
  const yymm = month.slice(2, 4) + month.slice(5, 7); // 2026-10 → 2610
  for (const l of payroll) {
    rows.push({
      kind: "支出", ref: freeeRef(`W${yymm}-${l.staff.id}`), date: lastDay, partner: l.staff.name, account: cfg.wageAccount, tax: cfg.wageTax,
      amount: l.amount, memo: `${month} 当番 ${l.days}日`, item: "日当", settledOn: lastDay, settleAccount: cfg.cashAccount,
    });
  }
  const donation = inMonth.reduce((a, p) => a + (p.donation ?? 0), 0);
  if (donation > 0) {
    rows.push({
      kind: "支出", ref: `D${yymm}-town`, date: lastDay, partner: cfg.donationPartner, account: cfg.donationAccount, tax: cfg.donationTax,
      amount: donation, memo: `${month} 町への寄付の預かり ${inMonth.length}泊分`, item: "町への寄付",
    });
  }
  return rows;
}
