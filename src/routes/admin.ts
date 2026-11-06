// seed：架空データ（fixtures/demo.json）と、3か月分の宿泊・勤務の記録を入れる（D-26）。合言葉が要る。
import { Hono } from "hono";
import type { AppEnv } from "../env";
import { Db } from "../db";
import { requireAdmin } from "../auth";
import { html, page, topbar } from "../lib/html";
import demo from "../../fixtures/demo.json";
import { addDays, datesOfMonth, todayJst, weekday } from "../lib/dates";
import { pickDuty } from "../domain/duty";
import { newId, printNumber } from "../lib/id";

const admin = new Hono<AppEnv>();
admin.use("/admin/*", requireAdmin);
admin.use("/admin", requireAdmin);

admin.get("/admin", (c) =>
  c.html(
    page({
      title: "管理",
      body: html`${topbar("管理（seed）")}<div class="wrap" style="display:flex;flex-direction:column;gap:14px">
<h1>架空データを入れる</h1>
<div class="mute">fixtures/demo.json の事業主・宿・要員・宿泊者と、8〜10月の宿泊・勤務の記録、12月の予約を入れます。既存のデータは消えます。</div>
<form method="post" action="/admin/seed?mode=demo"><button class="btn" type="submit">架空データを入れる（デモ用）</button></form>
<form method="post" action="/admin/seed?mode=reset" onsubmit="return confirm('全部消します。よいですか？')"><button class="btn line" type="submit">全部消す</button></form>
<div class="mute"><a href="/op">事業主の画面へ</a> · <a href="/board">需給ボードへ</a></div></div>`,
    }),
  ),
);

const GUIDE_JA = `お風呂は夜9時まで。布団は押し入れにあります。朝ごはんは6時半、味噌汁とごはんです。\n出発は何時でもどうぞ。玄関の鍵は閉めなくていいです。\n近くの「あかつき食堂」で3,000円の夕ごはんが食べられます。頼みたいときは、紙の「ごはん」に印をつけてください。電話します。`;
const RULES_JA = `夜10時から朝6時までは静かに。\nゴミは台所の箱へ。分けなくていいです。\n近所の人に会ったら「こんにちは」と言ってください。それだけで喜びます。`;

// 決定的な擬似乱数（再現できるように）
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

admin.post("/admin/seed", async (c) => {
  const d1 = c.env.DB;
  const db = new Db(d1);
  const mode = c.req.query("mode") ?? "demo"; // demo: 架空データと3か月分 / reset: 全部消す
  const tables = ["payments", "register_entries", "print_jobs", "duties", "bookings", "guests", "staff_schedule", "staff", "house_guides", "houses", "operators"];
  for (const t of tables) await d1.prepare(`DELETE FROM ${t}`).run();
  if (mode === "reset") return c.json({ ok: true, reset: true });

  for (const o of demo.operators) await d1.prepare("INSERT INTO operators (id, name, kind) VALUES (?,?,?)").bind(o.id, o.name, o.kind).run();
  for (const h of demo.houses)
    await d1
      .prepare("INSERT INTO houses (id, operator_id, municipality_code, community, seq, label, lat, lng, section_id, capacity, price, donation, status, guide_ja, rules_ja) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'open',?,?)")
      .bind(h.id, h.operator_id, h.municipality_code, h.community, h.seq, h.label, h.lat, h.lng, h.section_id, h.capacity, h.price, h.donation, GUIDE_JA, RULES_JA)
      .run();
  for (const s of demo.staff) await d1.prepare("INSERT INTO staff (id, operator_id, name, daily_wage) VALUES (?,?,?,?)").bind(s.id, s.operator_id, s.name, s.daily_wage).run();

  // 要員の予定：8月〜翌1月。各要員は週に3〜4日○（決定的）。Kaizuka #1 の11月・12月は毎日誰かが○になるようにする
  const today = todayJst();
  const months = ["2026-08", "2026-09", "2026-10", "2026-11", "2026-12", "2027-01"];
  const rand = rng(88);
  const staffByOp = new Map<string, typeof demo.staff>();
  for (const s of demo.staff) staffByOp.set(s.operator_id, [...(staffByOp.get(s.operator_id) ?? []), s]);
  const availability = new Map<string, Set<string>>(); // staff_id -> dates
  for (const s of demo.staff) {
    const set = new Set<string>();
    const offDays = new Set([Math.floor(rand() * 7), Math.floor(rand() * 7), Math.floor(rand() * 7)]);
    for (const m of months) for (const d of datesOfMonth(m)) if (!offDays.has(weekday(d)) && rand() < 0.85) set.add(d);
    availability.set(s.id, set);
  }
  // Kaizuka #1（op-inukai）：デモで予約できるよう、今日から45日は毎日1人は○
  for (const m of months) for (const d of datesOfMonth(m)) {
    if (d < today || d > addDays(today, 45)) continue;
    const list = staffByOp.get("op-inukai")!;
    if (!list.some((s) => availability.get(s.id)!.has(d))) availability.get(list[0].id)!.add(d);
  }
  const stmts: D1PreparedStatement[] = [];
  for (const [sid, set] of availability) for (const d of set) stmts.push(d1.prepare("INSERT INTO staff_schedule (staff_id, date, available) VALUES (?,?,1)").bind(sid, d));
  for (let i = 0; i < stmts.length; i += 50) await d1.batch(stmts.slice(i, i + 50));

  // 8〜10月の宿泊（過去）：各宿に、泊まりのある夜を作る。名前は故人の各国首相クラス（D-26）
  const guestsPool = demo.guests;
  const dutyCounts = new Map<string, Record<string, number>>(); // op|month -> staff_id -> n
  let guestIdx = 0;
  const pastStmts: D1PreparedStatement[] = [];
  const printSeq: Record<string, number> = {};
  for (const h of demo.houses) {
    const staffList = staffByOp.get(h.operator_id)!;
    const nightsPerMonth = h.id === "h-kaizuka-1" ? 9 : 5;
    for (const m of ["2026-08", "2026-09", "2026-10"]) {
      const dates = datesOfMonth(m).filter((d) => d < today);
      const chosen = new Set<string>();
      while (chosen.size < Math.min(nightsPerMonth, dates.length)) chosen.add(dates[Math.floor(rand() * dates.length)]);
      for (const d of [...chosen].sort()) {
        const avail = staffList.filter((s) => availability.get(s.id)!.has(d));
        const key = `${h.operator_id}|${m}`;
        const counts = dutyCounts.get(key) ?? {};
        const duty = pickDuty(avail.length ? avail : staffList, counts);
        if (!duty) continue;
        counts[duty.id] = (counts[duty.id] ?? 0) + 1;
        dutyCounts.set(key, counts);
        if (!avail.some((s) => s.id === duty.id)) { availability.get(duty.id)!.add(d); pastStmts.push(d1.prepare("INSERT OR IGNORE INTO staff_schedule (staff_id, date, available) VALUES (?,?,1)").bind(duty.id, d)); }
        pastStmts.push(d1.prepare("INSERT INTO duties (house_id, date, staff_id) VALUES (?,?,?)").bind(h.id, d, duty.id));
        const party = 1 + Math.floor(rand() * 3);
        const partyId = newId("pt", 8);
        for (let k = 0; k < party; k++) {
          const g = guestsPool[guestIdx++ % guestsPool.length];
          const gid = newId("g");
          const bid = newId("bk");
          pastStmts.push(
            d1
              .prepare("INSERT INTO guests (id, name, name_kana, nationality, language, occupation, address, passport_no, passport_country) VALUES (?,?,?,?,?,?,?,?,?)")
              .bind(gid, g.name, g.kana_expected, g.nationality, g.language, g.occupation, g.address, `${g.passport_no}${k}`.slice(0, 9), g.passport_country),
          );
          pastStmts.push(
            d1
              .prepare("INSERT INTO bookings (id, house_id, guest_id, date, room_type, party_id, direction, price, donation, status, created_at) VALUES (?,?,?,?,?,?,?,?,?,'paid',?)")
              .bind(bid, h.id, gid, d, party > 1 && rand() < 0.3 ? "private" : "shared", partyId, rand() < 0.85 ? "forward" : "reverse", h.price, h.donation, `${addDays(d, -3)}T10:00:00+09:00`),
          );
          pastStmts.push(
            d1
              .prepare("INSERT INTO register_entries (id, booking_id, house_id, date, name, address, occupation, nationality, passport_no, passport_country, checked_in_at, consent_rules_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
              .bind(newId("rg"), bid, h.id, d, g.name, g.address, g.occupation, g.nationality, `${g.passport_no}${k}`.slice(0, 9), g.passport_country, `${d}T16:${String(10 + k * 7).padStart(2, "0")}:00+09:00`, `${d}T16:${String(12 + k * 7).padStart(2, "0")}:00+09:00`),
          );
          pastStmts.push(d1.prepare("INSERT INTO payments (booking_id, amount, method, paid_at) VALUES (?,?,'cash',?)").bind(bid, h.price, `${d}T18:00:00+09:00`));
          printSeq[d] = (printSeq[d] ?? 0) + 1;
          pastStmts.push(
            d1
              .prepare("INSERT INTO print_jobs (id, house_id, kind, ref_id, status, created_at, printed_at, print_no) VALUES (?,?,?,?,'done',?,?,?)")
              .bind(newId("pj"), h.id, "checkin", bid, `${d}T16:${String(11 + k * 7).padStart(2, "0")}:00+09:00`, `${d}T16:${String(12 + k * 7).padStart(2, "0")}:00+09:00`, printNumber(d, printSeq[d])),
          );
        }
      }
    }
  }
  for (let i = 0; i < pastStmts.length; i += 50) await d1.batch(pastStmts.slice(i, i + 50));

  // 12月の予約（これから）：Kaizuka #1 に数件。当番は services の規則で決まる
  const dec = ["2026-12-09", "2026-12-09", "2026-12-09", "2026-12-10", "2026-12-16", "2026-12-16", "2026-12-23", "2026-12-23"];
  const futStmts: D1PreparedStatement[] = [];
  const h = demo.houses[0];
  const list = staffByOp.get(h.operator_id)!;
  const counts: Record<string, number> = {};
  for (const d of dec) {
    const g = guestsPool[guestIdx++ % guestsPool.length];
    const gid = newId("g");
    futStmts.push(d1.prepare("INSERT INTO guests (id, name, nationality, language) VALUES (?,?,?,?)").bind(gid, g.name, g.nationality, g.language));
    futStmts.push(
      d1
        .prepare("INSERT INTO bookings (id, house_id, guest_id, date, room_type, party_id, direction, price, donation, status) VALUES (?,?,?,?,?,?,?,?,?,'booked')")
        .bind(newId("bk"), h.id, gid, d, "shared", newId("pt", 8), "forward", h.price, h.donation),
    );
    const avail = list.filter((s) => availability.get(s.id)!.has(d));
    const duty = pickDuty(avail, counts);
    if (duty) {
      counts[duty.id] = (counts[duty.id] ?? 0) + 1;
      futStmts.push(d1.prepare("INSERT OR IGNORE INTO duties (house_id, date, staff_id) VALUES (?,?,?)").bind(h.id, d, duty.id));
    }
  }
  await d1.batch(futStmts);

  const n = await d1.prepare("SELECT (SELECT COUNT(*) FROM bookings) AS bookings, (SELECT COUNT(*) FROM guests) AS guests, (SELECT COUNT(*) FROM duties) AS duties, (SELECT COUNT(*) FROM staff_schedule) AS schedule").first();
  if ((c.req.header("accept") ?? "").includes("text/html")) return c.redirect("/op/op-inukai");
  return c.json({ ok: true, ...n });
});

export default admin;
