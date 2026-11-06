// 事業主の画面（窓口が操作）：宿・要員・月の予定と当番・今後の予約・帳簿と freee CSV・定期報告と180日・名簿・印刷待ち
import { Hono } from "hono";
import type { AppEnv } from "../env";
import { Db } from "../db";
import { requireAdmin } from "../auth";
import { html, page, topbar, yen, type Html } from "../lib/html";
import { addDays, datesOfMonth, formatJaShort, monthOf, todayJst, weekday, WEEKDAY_JA, minpakuYearOf } from "../lib/dates";
import { monthlyPayroll } from "../domain/payroll";
import { monthlyLedger } from "../domain/ledger";
import { buildFreeeRows, FREEE_CONFIG_LABELS, freeeConfigFrom, toFreeeCsv, type FreeeConfig } from "../domain/freee";
import { cap180Status } from "../domain/cap180";
import { periodicReport, reportPeriodFor } from "../domain/report";
import { enqueueLedgerPrint, enqueueQrPrint, enqueueSchedulePrint, recomputeDuties, translateGuidesForHouse } from "../services";
import { LANGS } from "../i18n";
import { newId } from "../lib/id";
import { countryJa } from "./guest";

const op = new Hono<AppEnv>();
op.use("/op/*", requireAdmin);
op.use("/op", requireAdmin);

op.get("/op", async (c) => {
  const db = new Db(c.env.DB);
  const ops = await db.operators();
  const body = html`${topbar("事業主の画面")}<div class="wide" style="display:flex;flex-direction:column;gap:12px"><h1>事業主を選ぶ</h1>${ops.map((o) => html`<a class="card" href="/op/${o.id}" style="text-decoration:none"><div style="font-weight:700;font-size:18px">${o.name}</div><div class="mute">${o.kind === "individual" ? "個人事業主" : o.kind}</div></a>`)}<div class="mute"><a href="/board">四国全体の需給ボード →</a></div></div>`;
  return c.html(page({ title: "事業主の画面", body }));
});

op.get("/op/:operatorId", async (c) => {
  const db = new Db(c.env.DB);
  const operator = await db.operator(c.req.param("operatorId"));
  if (!operator) return c.notFound();
  const today = todayJst();
  const month = /^\d{4}-\d{2}$/.test(c.req.query("month") ?? "") ? c.req.query("month")! : monthOf(today);
  const [houses, staff, sched, duties, bookedAll, paid, jobs, upcoming] = await Promise.all([
    db.housesOf(operator.id),
    db.staffOf(operator.id),
    db.scheduleOf(operator.id, month),
    db.dutiesOfOperator(operator.id, month),
    Promise.all((await db.housesOf(operator.id)).map(async (h) => [h.id, await db.bookedCounts(h.id, `${month}-01`, `${month}-31`)] as const)),
    db.paidOfOperator(operator.id, month),
    db.recentJobsOfOperator(operator.id),
    db.upcomingBookingsOfOperator(operator.id, today, addDays(today, 14)),
  ]);
  const dates = datesOfMonth(month);
  const availSet = new Set(sched.filter((s) => s.available).map((s) => `${s.staff_id}|${s.date}`));
  const dutyMap = new Map(duties.map((d) => [`${d.staff_id}|${d.date}`, d]));
  const bookedByDate: Record<string, number> = {};
  for (const [, m] of bookedAll) for (const [d, v] of Object.entries(m)) bookedByDate[d] = (bookedByDate[d] ?? 0) + v.n;
  const availByDate: Record<string, number> = {};
  for (const s of sched) if (s.available) availByDate[s.date] = (availByDate[s.date] ?? 0) + 1;
  const payroll = monthlyPayroll(duties, staff, month);
  const ledger = monthlyLedger(month, paid, payroll.total);
  const freee = freeeConfigFrom(operator.freee_config);
  const guides = new Map<string, Map<string, { guide: string; rules: string; updated_at: string }>>();
  for (const h of houses) {
    const m = new Map<string, { guide: string; rules: string; updated_at: string }>();
    for (const g of await db.houseGuides(h.id)) {
      try { const o = JSON.parse(g.text) as { guide: string; rules: string }; m.set(g.lang, { ...o, updated_at: g.updated_at }); } catch { /* 壊れたキャッシュは無視 */ }
    }
    guides.set(h.id, m);
  }
  const translated = c.req.query("translated");
  const trErr = c.req.query("tr_err");
  const period = reportPeriodFor(today);
  const stays = await db.staysOfOperator(operator.id, period.from, period.to);
  const report = periodicReport(stays, period.from, period.to);
  const caps = await Promise.all(houses.map(async (h) => [h, cap180Status(await db.bookingDatesOfHouse(h.id), minpakuYearOf(today))] as const));
  const register = await db.registerOfOperator(operator.id, `${month}-01`, `${month}-31`);
  const [y, m] = month.split("-").map(Number);
  const prevMonth = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
  const nextMonth = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;

  const body = html`
${topbar(`事業主の画面 · ${operator.name}`, html`<div class="sub">操作：窓口</div>`)}
<div class="wide" style="display:flex;flex-direction:column;gap:18px">
  <nav class="tabs"><a href="#schedule" class="on">要員の予定と当番</a><a href="#bookings">今後の予約</a><a href="#ledger">帳簿</a><a href="#report">定期報告・180日</a><a href="#register">宿泊者名簿</a><a href="#print">印刷待ち</a><a href="#houses">宿の案内</a><a href="/board">需給ボード →</a></nav>

  <section id="schedule" class="card">
    <div class="row"><h2 style="font-size:20px">${y}年${m}月　要員の予定と当番</h2><div class="mute">○＝来られる日　<span class="pill red">当</span>＝泊まりが入り、当番が決まった夜</div><div class="sp" style="flex:1 1 auto"></div><a class="btn sm line" href="/op/${operator.id}?month=${prevMonth}">← ${prevMonth}</a><a class="btn sm line" href="/op/${operator.id}?month=${nextMonth}">${nextMonth} →</a></div>
    <form method="post" action="/op/${operator.id}/schedule"><input type="hidden" name="month" value="${month}">
    <div class="scroll"><table class="t" style="min-width:1100px">
      <thead><tr><th>要員</th><th class="r">日当</th>${dates.map((d) => html`<th style="text-align:center;padding:4px 2px;${weekday(d) === 6 ? "color:#2F5BA8" : weekday(d) === 0 ? "color:#C8401E" : ""}">${Number(d.slice(8))}<br><span style="font-size:10px">${WEEKDAY_JA[weekday(d)]}</span></th>`)}<th></th></tr>
      <tr style="background:#F7F4EC;font-size:12px"><td colspan="2">泊まりの予約</td>${dates.map((d) => html`<td style="text-align:center;${bookedByDate[d] ? "font-weight:700" : "color:#B8B0A3"}">${bookedByDate[d] ?? "–"}</td>`)}<td></td></tr></thead>
      <tbody>${staff.map(
        (s) => html`<tr><td style="white-space:nowrap;font-weight:700">${s.name}</td><td class="r" style="white-space:nowrap">${yen(s.daily_wage)}円</td>${dates.map((d) => {
          const duty = dutyMap.get(`${s.id}|${d}`);
          const on = availSet.has(`${s.id}|${d}`);
          return html`<td style="text-align:center;padding:2px"><label style="display:block;cursor:pointer;${duty ? "background:#C8401E;color:#fff;border-radius:6px;font-weight:900" : ""}"><input type="checkbox" name="a" value="${s.id}|${d}" ${on ? "checked" : ""} style="display:none">${duty ? "当" : on ? "○" : html`<span style="color:#B8B0A3">×</span>`}</label></td>`;
        })}<td style="white-space:nowrap"><button class="btn sm line" type="submit" formaction="/op/${operator.id}/print/schedule" name="staff_id" value="${s.id}">予定表を印刷</button></td></tr>`,
      )}
      <tr style="border-top:2px solid #1F1B16;background:#F7F4EC;font-size:12px"><td colspan="2">受け付けられる夜</td>${dates.map((d) => html`<td style="text-align:center;${availByDate[d] ? "color:#3E6B46" : "color:#C8401E"}">${availByDate[d] ? "◯" : "止"}</td>`)}<td></td></tr></tbody>
    </table></div>
    <div class="row"><button class="btn sm" type="submit">予定を保存（当番も見直す）</button><div class="mute">○×を押して切り替え。誰も○でない夜は、受付を止めます（D-22）</div></div>
    </form>
    <script>document.querySelectorAll('#schedule label').forEach(function(l){var i=l.querySelector('input');l.addEventListener('click',function(e){e.preventDefault();i.checked=!i.checked;if(l.style.background)return;l.innerHTML=(i.checked?'○':'<span style="color:#B8B0A3">×</span>')+'<input type="checkbox" name="a" value="'+i.value+'" '+(i.checked?'checked':'')+' style="display:none">';});});</script>
    <form method="post" action="/op/${operator.id}/staff" class="row"><input type="text" name="name" placeholder="要員の名前" required style="width:200px"><input type="number" name="daily_wage" value="3000" min="0" step="100" style="width:120px"><button class="btn sm" type="submit">要員を追加</button></form>
  </section>

  <section id="bookings" class="card">
    <h2 style="font-size:20px">今後14日の予約</h2>
    ${upcoming.length === 0 ? html`<div class="mute">予約はありません。</div>` : html`<table class="t"><thead><tr><th>夜</th><th>宿</th><th>宿泊者</th><th>読み</th><th>国</th><th>状態</th></tr></thead><tbody>${upcoming.map(
      (b) => html`<tr><td>${formatJaShort(b.date)}</td><td>${b.house_label}</td><td>${b.guest_name}</td><td>${b.name_kana ?? ""}</td><td>${countryJa(b.nationality)}</td><td>${b.status === "paid" ? html`<span class="pill green">支払い済み</span>` : b.status === "checked_in" ? html`<span class="pill amber">チェックイン済み</span>` : html`<span class="pill gray">予約</span>`}</td></tr>`,
    )}</tbody></table>`}
    <div class="row" style="gap:8px"><span class="mute">宿泊者用の入口（QR の先）：</span>${houses.map((h) => html`<a href="/h/${h.id}">${h.label}</a><form method="post" action="/op/${operator.id}/print/qr"><input type="hidden" name="house_id" value="${h.id}"><button class="btn sm line" type="submit">玄関のQRを印刷</button></form>`)}<a class="mute" href="/me/new">利用者の登録 →</a></div>
  </section>

  <section id="ledger" class="card">
    <div class="row"><h2 style="font-size:20px">${y}年${m}月　帳簿（月締め）</h2><div class="mute">計算はすべてコード。Claude は関与しません</div></div>
    <div class="grid2" style="grid-template-columns:repeat(3,minmax(0,1fr))">
      <div class="kpi" style="border:1px solid #E3DDCF;border-radius:10px;padding:12px"><div class="l">収入　宿泊料 ${ledger.nights}泊</div><div class="v">${yen(ledger.income)}円</div><div class="l">うち町への寄付 ${yen(ledger.donations)}円（預かり）</div></div>
      <div class="kpi" style="border:1px solid #E3DDCF;border-radius:10px;padding:12px"><div class="l">支出　日当 ${duties.length}当番</div><div class="v">${yen(ledger.wages)}円</div><div class="l">要員${payroll.lines.length}人</div></div>
      <div class="kpi" style="border:2px solid #1F1B16;border-radius:10px;padding:12px;background:#F7F4EC"><div class="l">お財布に残る</div><div class="v">${yen(ledger.balance)}円</div><div class="l">月末に実際の現金と照合</div></div>
    </div>
    <table class="t"><thead><tr><th>日当の内訳</th><th class="r">当番</th><th class="r">日当</th><th class="r">金額</th></tr></thead><tbody>${payroll.lines.map((l) => html`<tr><td>${l.staff.name}</td><td class="r">${l.days}日</td><td class="r">${yen(l.staff.daily_wage)}円</td><td class="r" style="font-weight:700">${yen(l.amount)}円</td></tr>`)}</tbody></table>
    <div class="row"><a class="btn sm" href="/op/${operator.id}/freee.csv?month=${month}" download="qr-yado-${month}.csv">freee 取引インポート用 CSV をダウンロード</a><form method="post" action="/op/${operator.id}/print/ledger"><input type="hidden" name="month" value="${month}"><button class="btn sm line" type="submit">帳簿を紙で印刷（商工会へ）</button></form></div>
    <div class="mute">CSV の列：収支区分・管理番号・発生日・決済期日・取引先・勘定科目・税区分・金額・税計算区分・税額・備考・品目・決済日・決済口座・決済金額（freee標準形式、D-23。使わない任意の列は出しません）。1泊は「売上高 4,500円」と「預り金 500円（町への寄付の預かり）」の2行の収入、日当は要員ごとに月1行。町へ渡したときの支出は渡したときに。</div>
    <details><summary class="mute" style="cursor:pointer">freee の勘定科目・税区分・口座を合わせる（freee に無い名前だとインポートで止まります）</summary>
    <form method="post" action="/op/${operator.id}/freee" class="grid2" style="margin-top:8px"><input type="hidden" name="month" value="${month}">
      ${(Object.keys(FREEE_CONFIG_LABELS) as (keyof FreeeConfig)[]).map((k) => html`<label style="display:flex;flex-direction:column;gap:4px;font-size:13px">${FREEE_CONFIG_LABELS[k]}<input name="${k}" value="${freee[k]}" style="padding:8px;border:1px solid #E3DDCF;border-radius:8px;font-size:15px"></label>`)}
      <div style="grid-column:1/-1" class="row"><button class="btn sm" type="submit">保存</button><span class="mute">個人事業主の freee は「給料賃金」、法人は「給料手当」などプランで名前が違います。freee の［設定］→［勘定科目の設定］の名前をそのまま入れてください。</span></div>
    </form></details>
  </section>

  <section id="report" class="card">
    <h2 style="font-size:20px">定期報告（${period.from} 〜 ${period.to}）と年180日</h2>
    <div class="grid2" style="grid-template-columns:repeat(3,minmax(0,1fr))">
      <div class="kpi"><div class="l">宿泊日数</div><div class="v">${report.nightsOperated}日</div></div>
      <div class="kpi"><div class="l">宿泊者数</div><div class="v">${report.guests}人</div></div>
      <div class="kpi"><div class="l">延べ宿泊者数</div><div class="v">${report.personNights}人泊</div></div>
    </div>
    <table class="t"><thead><tr><th>国籍別</th><th class="r">延べ宿泊者数</th><th class="r">宿泊者数</th></tr></thead><tbody>${report.byNationality.map((n) => html`<tr><td>${countryJa(n.nationality)}（${n.nationality}）</td><td class="r">${n.personNights}</td><td class="r">${n.guests}</td></tr>`)}</tbody></table>
    <table class="t"><thead><tr><th>宿</th><th class="r">年度（4/1〜）</th><th class="r">使った日数</th><th class="r">残り</th><th></th></tr></thead><tbody>${caps.map(([h, s]) => html`<tr><td>${h.label}</td><td class="r">${s.year}</td><td class="r">${s.used}日</td><td class="r">${s.remaining}日</td><td>${s.full ? html`<span class="pill red">上限</span>` : s.used >= 150 ? html`<span class="pill amber">残りわずか</span>` : html`<span class="pill green">余裕</span>`}</td></tr>`)}</tbody></table>
    <div class="mute">名簿から自動で集計。180日は暦日で数えた概算（法令上は4月1日正午〜翌4月1日正午）。</div>
  </section>

  <section id="register" class="card">
    <h2 style="font-size:20px">宿泊者名簿（${y}年${m}月）</h2>
    <div class="mute">法定の名簿は電子で作成・保存（3年）。旅券番号はここだけに出し、紙には載せません（D-07, D-11）。</div>
    <div class="scroll"><table class="t"><thead><tr><th>宿泊日</th><th>宿</th><th>氏名</th><th>住所</th><th>職業</th><th>国籍</th><th>旅券番号</th><th>チェックイン</th><th>同意</th></tr></thead><tbody>${register.map(
      (r) => html`<tr><td>${formatJaShort(r.date)}</td><td>${r.house_label}</td><td>${r.name}</td><td>${r.address ?? ""}</td><td>${r.occupation ?? ""}</td><td>${r.nationality ?? ""}</td><td>${r.passport_country ?? ""} ${r.passport_no ?? ""}</td><td>${r.checked_in_at.slice(0, 16).replace("T", " ")}</td><td>${r.consent_rules_at ? "✓" : "—"}</td></tr>`,
    )}</tbody></table></div>
  </section>

  <section id="print" class="card">
    <h2 style="font-size:20px">印刷待ち</h2>
    <div class="mute">宿の機器が取りに来ます（scripts/print-agent.sh）。</div>
    ${jobs.map((j) => html`<div style="display:flex;gap:8px;align-items:center;border:1px solid #E3DDCF;border-radius:10px;padding:8px 12px"><div style="flex:1 1 auto"><strong>${j.kind === "checkin" ? "チェックイン" : j.kind === "schedule" ? "勤務予定表" : j.kind === "qr" ? "玄関のQR" : "帳簿"}</strong> ${j.print_no ?? j.ref_id ?? ""} <span class="mute">${j.house_label} · ${j.created_at.slice(5, 16).replace("T", " ")}</span></div>${j.status === "done" ? html`<span class="pill green">印刷済み</span>` : j.status === "failed" ? html`<span class="pill red">失敗</span>` : j.status === "printing" ? html`<span class="pill amber">印刷中</span>` : html`<span class="pill amber">印刷待ち</span>`}<a class="btn sm line" href="/print/${j.id}" target="_blank">見る</a><form method="post" action="/api/print/${j.id}/retry?back=/op/${operator.id}"><button class="btn sm line" type="submit">もう一度</button></form></div>`)}
  </section>

  <section id="houses" class="card">
    <h2 style="font-size:20px">宿の案内と地域のきまり（日本語で書く → Claude が7言語にします）</h2>
    <div class="mute">宿主が話したことを窓口が日本語で書いて保存すると、Claude API が英・仏・独・西・蘭・伊・波の7言語に訳して保存します（住宅宿泊事業法の外国語案内：requirements.md）。宿泊者はチェックインの3/3でこれを母語で読んで同意します。</div>
    ${translated ? html`<div class="notice" style="border-color:#3E6B46;color:#3E6B46">Claude が ${translated} 言語に翻訳しました${trErr ? html`（失敗：${trErr}）` : ""}。</div>` : ""}
    ${houses.map((h) => {
      const m = guides.get(h.id) ?? new Map();
      return html`<form method="post" action="/op/${operator.id}/house/${h.id}/guide" style="display:flex;flex-direction:column;gap:8px;border-top:1px solid #E3DDCF;padding-top:10px"><div class="row"><strong>${h.label}</strong><span class="mute">布団 ${h.capacity}・1泊 ${yen(h.price)}円（うち寄付 ${yen(h.donation)}円）・QR の先：<a href="/h/${h.id}">/h/${h.id}</a></span></div>
      <div class="grid2"><label class="f">宿の案内（お風呂、布団、朝の時間、ごはんのことなど）<textarea name="guide_ja" rows="5">${h.guide_ja ?? ""}</textarea></label><label class="f">地域のきまり（ゴミ、夜の音、近所へのあいさつなど）<textarea name="rules_ja" rows="5">${h.rules_ja ?? ""}</textarea></label></div>
      <div class="row" style="gap:8px"><button class="btn sm" type="submit">保存して Claude で翻訳（10秒ほど）</button><span class="mute">翻訳済み：</span>${LANGS.filter((l) => l.code !== "ja").map((l) => html`<span class="pill ${m.has(l.code) ? "green" : ""}" title="${m.get(l.code)?.updated_at ?? "未翻訳"}">${l.label}</span>`)}</div>
      ${m.size
        ? html`<details><summary class="mute" style="cursor:pointer">翻訳を見る（${m.size}言語）</summary><div class="grid2" style="margin-top:8px">${[...m.entries()].map(([code, g]) => html`<div class="card" style="gap:6px"><div class="eyebrow">${LANGS.find((l) => l.code === code)?.label ?? code}</div><div style="font-size:13px;white-space:pre-wrap">${g.guide}</div><div style="font-size:13px;white-space:pre-wrap;color:#C8401E">${g.rules}</div></div>`)}</div></details>`
        : ""}
      </form>`;
    })}
  </section>
</div>`;
  return c.html(page({ title: `${operator.name} · 事業主の画面`, body, wide: true }));
});

op.post("/op/:operatorId/staff", async (c) => {
  const db = new Db(c.env.DB);
  const f = await c.req.parseBody();
  const name = String(f.name ?? "").trim().slice(0, 40);
  const wage = Math.max(0, Math.min(100000, Number(f.daily_wage ?? 3000) || 0));
  if (name) await db.addStaff({ id: newId("s", 8), operator_id: c.req.param("operatorId"), name, daily_wage: wage });
  return c.redirect(`/op/${c.req.param("operatorId")}`);
});

op.post("/op/:operatorId/schedule", async (c) => {
  const db = new Db(c.env.DB);
  const operatorId = c.req.param("operatorId");
  const f = await c.req.parseBody({ all: true });
  const month = String(f.month ?? "");
  if (!/^\d{4}-\d{2}$/.test(month)) return c.redirect(`/op/${operatorId}`);
  const raw = f.a;
  const on = new Set((Array.isArray(raw) ? raw : raw ? [raw] : []).map(String));
  const staff = await db.staffOf(operatorId);
  for (const s of staff) for (const d of datesOfMonth(month)) await db.setAvailable(s.id, d, on.has(`${s.id}|${d}`));
  await recomputeDuties(db, operatorId, month);
  return c.redirect(`/op/${operatorId}?month=${month}#schedule`);
});

op.post("/op/:operatorId/print/qr", async (c) => {
  const db = new Db(c.env.DB);
  const f = await c.req.parseBody();
  const house = await db.house(String(f.house_id ?? ""));
  if (house && house.operator_id === c.req.param("operatorId")) await enqueueQrPrint(db, house.id);
  return c.redirect(`/op/${c.req.param("operatorId")}#print`);
});

op.post("/op/:operatorId/print/schedule", async (c) => {
  const db = new Db(c.env.DB);
  const operatorId = c.req.param("operatorId");
  const f = await c.req.parseBody();
  const month = String(f.month ?? "");
  const staffId = String(f.staff_id ?? "");
  const houses = await db.housesOf(operatorId);
  if (houses[0] && /^\d{4}-\d{2}$/.test(month) && staffId) await enqueueSchedulePrint(db, houses[0].id, staffId, month);
  return c.redirect(`/op/${operatorId}?month=${month}#print`);
});

op.post("/op/:operatorId/print/ledger", async (c) => {
  const db = new Db(c.env.DB);
  const operatorId = c.req.param("operatorId");
  const f = await c.req.parseBody();
  const month = String(f.month ?? "");
  const houses = await db.housesOf(operatorId);
  if (houses[0] && /^\d{4}-\d{2}$/.test(month)) await enqueueLedgerPrint(db, houses[0].id, operatorId, month);
  return c.redirect(`/op/${operatorId}?month=${month}#print`);
});

op.get("/op/:operatorId/freee.csv", async (c) => {
  const db = new Db(c.env.DB);
  const operatorId = c.req.param("operatorId");
  const month = c.req.query("month") ?? monthOf(todayJst());
  if (!/^\d{4}-\d{2}$/.test(month)) return c.text("month", 400);
  const [paid, staff, duties] = await Promise.all([db.paidOfOperator(operatorId, month), db.staffOf(operatorId), db.dutiesOfOperator(operatorId, month)]);
  const payroll = monthlyPayroll(duties, staff, month);
  const operator = await db.operator(operatorId);
  const csv = toFreeeCsv(buildFreeeRows(month, paid, payroll.lines, freeeConfigFrom(operator?.freee_config)));
  return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="qr-yado-${month}.csv"` } });
});

op.post("/op/:operatorId/freee", async (c) => {
  const db = new Db(c.env.DB);
  const f = await c.req.parseBody();
  const o: Record<string, string> = {};
  for (const k of Object.keys(FREEE_CONFIG_LABELS)) o[k] = String(f[k] ?? "").trim().slice(0, 60);
  await db.updateOperatorFreee(c.req.param("operatorId"), JSON.stringify(o));
  return c.redirect(`/op/${c.req.param("operatorId")}?month=${String(f.month ?? "")}#ledger`);
});

// 保存 → Claude で7言語に翻訳（並列、10秒ほど）。失敗した言語はチェックイン時にもう一度試す（guideFor）
op.post("/op/:operatorId/house/:houseId/guide", async (c) => {
  const db = new Db(c.env.DB);
  const f = await c.req.parseBody();
  const houseId = c.req.param("houseId");
  await db.updateHouseGuide(houseId, String(f.guide_ja ?? "").slice(0, 4000), String(f.rules_ja ?? "").slice(0, 4000));
  const house = await db.house(houseId);
  if (!house) return c.notFound();
  const results = await translateGuidesForHouse(c.env, db, house, LANGS.map((l) => l.code));
  const ok = results.filter((r) => r.ok).map((r) => r.lang).join("・");
  const ng = results.filter((r) => !r.ok).map((r) => `${r.lang}: ${r.error ?? ""}`).join(" / ");
  return c.redirect(`/op/${c.req.param("operatorId")}?translated=${encodeURIComponent(ok || "0")}${ng ? `&tr_err=${encodeURIComponent(ng.slice(0, 300))}` : ""}#houses`);
});

export default op;
export type { Html };
