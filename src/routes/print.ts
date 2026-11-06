// 紙（A4）：チェックインの紙（1人1泊1枚）、要員の月の勤務予定表、月の帳簿。宿の機器が /api/print/queue を取りに来て印刷する（D-10）。
import { Hono } from "hono";
import type { AppEnv } from "../env";
import { Db } from "../db";
import { requireAdmin } from "../auth";
import { esc, html, raw, yen, type Html } from "../lib/html";
import { datesOfMonth, formatJa, formatJaShort, nowJstIso, weekday, WEEKDAY_JA } from "../lib/dates";
import { firstKana } from "../domain/kana";
import { monthlyPayroll } from "../domain/payroll";
import { monthlyLedger } from "../domain/ledger";
import { countryJa } from "./guest";

const print = new Hono<AppEnv>();

const PRINT_CSS = `
@page{size:A4;margin:14mm 14mm 12mm}
*{box-sizing:border-box}
body{margin:0;background:#fff;color:#1F1B16;font-family:'Noto Sans JP',system-ui,sans-serif;line-height:1.35}
.sheet{width:182mm;min-height:270mm;margin:0 auto;display:flex;flex-direction:column;gap:5mm}
.serif{font-family:'Shippori Mincho',serif}
.hdr{display:flex;justify-content:space-between;align-items:baseline;font-size:12pt;color:#4A433B}
.hero{display:flex;align-items:center;gap:8mm;padding:3mm 0 2mm;border-top:1.2mm solid #1F1B16;border-bottom:.4mm solid #CFC7B8}
.photo{width:34mm;height:34mm;border-radius:50%;object-fit:cover;flex:0 0 auto;background:#1F1B16}
.kana{font-size:40pt;font-weight:900;line-height:1.1;letter-spacing:.02em}
.welcome{font-size:30pt;font-weight:700;color:#C8401E;line-height:1.1}
.sub{font-size:13pt;color:#4A433B;margin-top:1.5mm}
.info{display:grid;grid-template-columns:38mm 1fr;row-gap:2.5mm;column-gap:4mm;font-size:17pt;line-height:1.35}
.info .k{color:#6B6257;font-size:13pt;padding-top:1mm}
.info .v{font-weight:700}
.box{border:.6mm solid #1F1B16;border-radius:3mm;padding:3.5mm 4.5mm;display:flex;flex-direction:column;gap:2mm}
.box.paper{background:#F7F4EC}
.two{display:grid;grid-template-columns:1fr 1fr;gap:4mm}
.chk{display:inline-block;width:8mm;height:8mm;border:.8mm solid #C8401E;border-radius:1.5mm;vertical-align:middle;margin-right:3mm}
.chk.s{width:6mm;height:6mm;border:.5mm solid #1F1B16;border-radius:1mm}
.sig{border-bottom:.4mm solid #1F1B16;height:11mm}
.cut{display:flex;align-items:center;gap:3mm;color:#8A8176;font-size:10pt;margin-top:auto}
.cut .l{flex:1 1 auto;border-top:.5mm dashed #8A8176}
.tag{display:flex;align-items:center;gap:6mm;padding:3mm 5mm;border:.6mm solid #1F1B16;border-radius:3mm}
.tag .photo{width:18mm;height:18mm}
.foot{display:flex;justify-content:space-between;font-size:9pt;color:#8A8176}
.cal{display:grid;grid-template-columns:repeat(7,1fr);gap:1.5mm}
.cal .h{text-align:center;font-size:12pt;font-weight:700;color:#6B6257}
.cal .c{border:.4mm solid #CFC7B8;border-radius:2mm;padding:1.5mm 2mm;height:27mm;display:flex;flex-direction:column;justify-content:space-between;background:#F7F4EC}
.cal .c.on{border:.6mm solid #1F1B16;background:#fff}
.cal .c.duty{border:.9mm solid #C8401E;background:#FFF4EF}
.cal .c.blank{border:.3mm dashed #E3DDCF;background:#fff}
.cal .n{font-size:13pt;font-weight:700}
.cal .m{font-size:24pt;text-align:center;line-height:1}
.cal .m.x{color:#8A8176;font-size:20pt}
.cal .d{font-size:9pt;font-weight:900;color:#fff;background:#C8401E;border-radius:1mm;padding:0 1.5mm}
.cal .g{font-size:10.5pt;text-align:center}
.sum{display:grid;grid-template-columns:repeat(3,1fr);gap:3mm}
.sum .b{border:.4mm solid #CFC7B8;border-radius:3mm;padding:3mm 4mm}
.sum .b .l{font-size:10pt;color:#6B6257}.sum .b .v{font-size:22pt;font-weight:900}
table.t{border-collapse:collapse;width:100%;font-size:12pt}
table.t th{text-align:left;color:#6B6257;font-weight:500;border-bottom:.4mm solid #1F1B16;padding:1.5mm 2mm}
table.t td{border-bottom:.2mm solid #CFC7B8;padding:1.5mm 2mm}
table.t .r{text-align:right}
`;

function sheet(title: string, body: Html): Html {
  return html`<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>${title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700;900&family=Shippori+Mincho:wght@500;700&display=swap" rel="stylesheet">
<style>${raw(PRINT_CSS)}</style></head><body><div class="sheet">${body}</div></body></html>`;
}

// --- チェックインの紙 ---
async function checkinSheet(db: Db, bookingId: string): Promise<Html | null> {
  const b = await db.booking(bookingId);
  if (!b) return null;
  const [g, house, duty, job, others] = await Promise.all([db.guest(b.guest_id), db.house(b.house_id), db.duty(b.house_id, b.date), db.printJobByRef("checkin", b.id), db.bookingsOfHouseNight(b.house_id, b.date)]);
  if (!g || !house) return null;
  const kana = g.name_kana;
  const headline = kana ? `${firstKana(kana)}さん` : `${g.name.split(" ")[0]}さん`;
  const roomJa = b.room_type === "private" ? "貸切" : `相部屋（ほかに${Math.max(0, others.length - 1)}人）`;
  const lang = { en: "英語", ja: "日本語", fr: "フランス語", de: "ドイツ語", es: "スペイン語", nl: "オランダ語", it: "イタリア語", pl: "ポーランド語" }[g.language ?? ""] ?? g.language ?? "";
  return sheet(
    `チェックイン ${g.name}`,
    html`
<div class="hdr"><div><strong style="color:#1F1B16">${house.label}</strong>　${formatJa(b.date)}泊</div><div>当番：<strong style="color:#1F1B16">${duty?.name ?? "（未定）"}</strong></div></div>
<div class="hero">
  <img class="photo" src="/g/${g.id}/photo" alt="">
  <div style="flex:1 1 auto">
    <div class="kana">${headline}</div>
    <div class="welcome serif">いらっしゃい！</div>
    <div class="sub">${g.name}${g.nationality ? html` ・ ${countryJa(g.nationality)}から` : ""}${lang ? html` ・ ${lang}` : ""}${kana ? html`<br><span style="font-size:12pt">読み：${kana}</span>` : ""}</div>
  </div>
</div>
<div class="info">
  <div class="k">泊まる日</div><div class="v">${formatJaShort(b.date)}　1泊</div>
  <div class="k">人数</div><div class="v">1人　${roomJa}</div>
  <div class="k">料金</div><div class="v">${yen(b.price)}円　<span style="font-weight:400;font-size:12pt;color:#4A433B">うち${yen(b.donation)}円は町に残ります</span></div>
  <div class="k">ごはん</div><div class="v" style="font-weight:400"><span class="chk s"></span>3,000円のごはんを希望　<span style="font-size:12pt;color:#4A433B">→ 宿主がお店に電話</span></div>
</div>
${g.note_ja ? html`<div class="box paper"><div style="font-size:11pt;color:#6B6257">旅の人からのひとこと　<span style="font-size:9pt">（Claude が日本語にしました）</span></div><div style="font-size:18pt;font-weight:500;line-height:1.4">${g.note_ja}</div></div>` : ""}
<div class="two">
  <div class="box"><div style="font-size:16pt;font-weight:900"><span class="chk"></span>現金 ${yen(b.price)}円 受け取りました</div><div style="display:flex;align-items:flex-end;gap:3mm;font-size:11pt;color:#6B6257;margin-top:2mm"><span>当番のサイン</span><span class="sig" style="flex:1 1 auto"></span></div></div>
  <div class="box"><div style="font-size:13pt;font-weight:700">Guest signature　<span style="font-weight:400;color:#6B6257;font-size:11pt">宿泊者の署名</span></div><div class="sig"></div><div style="font-size:9pt;color:#6B6257">I confirm the details above are correct. この紙が宿の宿泊台帳の原本になります。</div></div>
</div>
<div class="cut"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8A8176" stroke-width="2" aria-hidden="true"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12"/></svg><span class="l"></span><span>きりとり線　下の名札は布団のそばへ</span></div>
<div class="tag"><img class="photo" src="/g/${g.id}/photo" alt=""><div style="flex:1 1 auto"><div style="font-size:24pt;font-weight:900;line-height:1.15">${kana ? firstKana(kana) : g.name.split(" ")[0]}</div><div style="font-size:12pt;color:#4A433B">${g.name.split(" ")[0]} ・ ${countryJa(g.nationality)} ・ ${formatJaShort(b.date)}</div></div><div style="font-size:10pt;color:#6B6257;text-align:right;line-height:1.4">Hello, I'm ${esc(g.name.split(" ")[0])}.<br>Please call me ${kana ? firstKana(kana) : g.name.split(" ")[0]}.</div></div>
<div class="foot"><div>印刷番号 ${job?.print_no ?? ""} ・ 同じ番号は二度と印刷しません</div><div>旅券番号はこの紙に載せません</div></div>`,
  );
}

// --- 要員の月の勤務予定表 ---
async function scheduleSheet(db: Db, staffId: string, month: string, houseId: string): Promise<Html | null> {
  const house = await db.house(houseId);
  if (!house) return null;
  const staff = (await db.staffOf(house.operator_id)).find((s) => s.id === staffId);
  if (!staff) return null;
  const sched = await db.scheduleOf(house.operator_id, month);
  const avail = new Set(sched.filter((s) => s.staff_id === staffId && s.available).map((s) => s.date));
  const duties = (await db.dutiesOfOperator(house.operator_id, month)).filter((d) => d.staff_id === staffId);
  const dutyMap = new Map(duties.map((d) => [d.date, d]));
  const counts = await db.bookedCounts(house.id, `${month}-01`, `${month}-31`);
  const dates = datesOfMonth(month);
  const lead = (weekday(dates[0]) + 6) % 7; // 月曜始まり
  const cells: Html[] = [];
  for (let i = 0; i < lead; i++) cells.push(html`<div class="c blank"></div>`);
  for (const d of dates) {
    const n = Number(d.slice(8, 10));
    const duty = dutyMap.get(d);
    if (duty) cells.push(html`<div class="c duty"><div style="display:flex;justify-content:space-between;align-items:center"><span class="n">${n}</span><span class="d">当番</span></div><div class="g">${duty.house_label}<br>${counts[d]?.n ?? 0}人泊</div></div>`);
    else if (avail.has(d)) cells.push(html`<div class="c on"><div class="n">${n}</div><div class="m">○</div></div>`);
    else cells.push(html`<div class="c"><div class="n" style="color:#8A8176">${n}</div><div class="m x">×</div></div>`);
  }
  while (cells.length % 7 !== 0) cells.push(html`<div class="c blank"></div>`);
  const [y, m] = month.split("-").map(Number);
  const operator = await db.operator(house.operator_id);
  return sheet(
    `${staff.name} ${month} 勤務予定`,
    html`
<div class="hdr"><div><strong style="color:#1F1B16">${house.label}</strong>　事業主：${operator?.name ?? ""}</div><div>印刷日 ${formatJa(nowJstIso().slice(0, 10))}</div></div>
<div class="hero" style="justify-content:space-between;align-items:flex-end">
  <div><div class="kana" style="font-size:32pt">${staff.name}さん</div><div class="serif" style="font-size:20pt;font-weight:700;color:#4A433B">${y}年${m}月の勤務予定</div></div>
  <div style="text-align:right;font-size:12pt;color:#4A433B"><div>日当 <strong style="font-size:16pt;color:#1F1B16">${yen(staff.daily_wage)}円</strong></div><div>○の日のうち、泊まりがある夜に当番</div></div>
</div>
<div class="cal">${["月", "火", "水", "木", "金", "土", "日"].map((w, i) => html`<div class="h" style="${i === 5 ? "color:#2F5BA8" : i === 6 ? "color:#C8401E" : ""}">${w}</div>`)}${cells}</div>
<div class="sum">
  <div class="b"><div class="l">○の日</div><div class="v">${avail.size}日</div></div>
  <div class="b" style="border:.6mm solid #C8401E;background:#FFF4EF"><div class="l">当番（今のところ）</div><div class="v" style="color:#C8401E">${duties.length}日</div></div>
  <div class="b"><div class="l">日当の見込み</div><div class="v">${yen(duties.length * staff.daily_wage)}円</div></div>
</div>
<div style="font-size:11pt;color:#6B6257">予約が入ると当番が増えることがあります。変わったら新しい紙が出ます。予定を変えたいときは、窓口に電話してください。</div>`,
  );
}

// --- 月の帳簿（商工会へ） ---
async function ledgerSheet(db: Db, operatorId: string, month: string): Promise<Html | null> {
  const op = await db.operator(operatorId);
  if (!op) return null;
  const [paid, staff, duties, houses] = await Promise.all([db.paidOfOperator(operatorId, month), db.staffOf(operatorId), db.dutiesOfOperator(operatorId, month), db.housesOf(operatorId)]);
  const payroll = monthlyPayroll(duties, staff, month);
  const ledger = monthlyLedger(month, paid, payroll.total);
  const [y, m] = month.split("-").map(Number);
  return sheet(
    `${op.name} ${month} 帳簿`,
    html`
<div class="hdr"><div><strong style="color:#1F1B16">${op.name}</strong>　${houses.map((h) => h.label).join("・")}</div><div>印刷日 ${formatJa(nowJstIso().slice(0, 10))}</div></div>
<div class="hero" style="justify-content:space-between;align-items:flex-end"><div><div class="kana" style="font-size:30pt">${y}年${m}月の帳簿</div><div class="serif" style="font-size:16pt;color:#4A433B">宿泊料と日当の記録（商工会さんへ）</div></div></div>
<div class="sum">
  <div class="b"><div class="l">収入　宿泊料 ${ledger.nights}泊</div><div class="v">${yen(ledger.income)}円</div><div class="l">うち町への寄付 ${yen(ledger.donations)}円（預かり）</div></div>
  <div class="b"><div class="l">支出　日当 ${duties.length}当番</div><div class="v">${yen(ledger.wages)}円</div></div>
  <div class="b" style="border:.6mm solid #1F1B16;background:#F7F4EC"><div class="l">お財布に残る</div><div class="v">${yen(ledger.balance)}円</div></div>
</div>
<table class="t"><thead><tr><th>日付</th><th>宿</th><th>宿泊者</th><th class="r">宿泊料</th><th class="r">うち寄付</th></tr></thead><tbody>
${paid.map((p) => html`<tr><td>${formatJaShort(p.date)}</td><td>${p.house_label}</td><td>${p.guest_name}</td><td class="r">${yen(p.price)}</td><td class="r">${yen(p.donation)}</td></tr>`)}
<tr><td colspan="3" style="font-weight:700">合計</td><td class="r" style="font-weight:700">${yen(ledger.income)}</td><td class="r" style="font-weight:700">${yen(ledger.donations)}</td></tr>
</tbody></table>
<table class="t"><thead><tr><th>日当</th><th class="r">当番</th><th class="r">日当</th><th class="r">金額</th></tr></thead><tbody>
${payroll.lines.map((l) => html`<tr><td>${l.staff.name}</td><td class="r">${l.days}日</td><td class="r">${yen(l.staff.daily_wage)}</td><td class="r">${yen(l.amount)}</td></tr>`)}
<tr><td colspan="3" style="font-weight:700">合計</td><td class="r" style="font-weight:700">${yen(payroll.total)}</td></tr>
</tbody></table>
<div style="font-size:10pt;color:#6B6257">計算はすべてコードで行っています。源泉徴収などの税務処理は商工会さんにお願いします。</div>`,
  );
}

export async function renderJob(db: Db, job: { kind: string; ref_id: string | null; house_id: string }): Promise<Html | null> {
  if (!job.ref_id) return null;
  if (job.kind === "checkin") return checkinSheet(db, job.ref_id);
  if (job.kind === "schedule") {
    const [staffId, month] = job.ref_id.split(":");
    return scheduleSheet(db, staffId, month, job.house_id);
  }
  if (job.kind === "ledger") {
    const [operatorId, month] = job.ref_id.split(":");
    return ledgerSheet(db, operatorId, month);
  }
  return null;
}

// 紙の HTML（合言葉が要る）
print.get("/print/:jobId", requireAdmin, async (c) => {
  const db = new Db(c.env.DB);
  const job = await db.printJob(c.req.param("jobId")!);
  if (!job) return c.notFound();
  const h = await renderJob(db, job);
  if (!h) return c.notFound();
  return c.html(h);
});

// 宿泊者の画面から見る印刷の状態（番号だけ）
print.get("/api/print/status/:jobId", async (c) => {
  const db = new Db(c.env.DB);
  const job = await db.printJob(c.req.param("jobId"));
  return c.json({ status: job?.status ?? "unknown" });
});

// 宿の機器が取りに来る
print.get("/api/print/queue", requireAdmin, async (c) => {
  const db = new Db(c.env.DB);
  const jobs = await db.queuedJobs(c.req.query("house") ?? null);
  return c.json({ jobs: jobs.map((j) => ({ id: j.id, house_id: j.house_id, kind: j.kind, print_no: j.print_no, url: `/print/${j.id}` })) });
});
print.post("/api/print/:jobId/printing", requireAdmin, async (c) => {
  await new Db(c.env.DB).setPrintStatus(c.req.param("jobId")!, "printing", null);
  return c.json({ ok: true });
});
print.post("/api/print/:jobId/done", requireAdmin, async (c) => {
  await new Db(c.env.DB).setPrintStatus(c.req.param("jobId")!, "done", nowJstIso());
  return c.json({ ok: true });
});
print.post("/api/print/:jobId/failed", requireAdmin, async (c) => {
  await new Db(c.env.DB).setPrintStatus(c.req.param("jobId")!, "failed", null);
  return c.json({ ok: true });
});
print.post("/api/print/:jobId/retry", requireAdmin, async (c) => {
  await new Db(c.env.DB).setPrintStatus(c.req.param("jobId")!, "queued", null);
  const back = c.req.query("back");
  return back && back.startsWith("/") ? c.redirect(back) : c.json({ ok: true });
});

export default print;
