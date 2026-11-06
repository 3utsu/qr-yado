// 利用者（巡礼者）の登録と巡礼カード：旅の始まりに1回登録 → カード（/me/:guestId、ランダム id：D-16）から道中の宿を予約（D-13、D-17）
import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import type { AppEnv } from "../env";
import { Db, type Guest, type House } from "../db";
import { dict, LANGS, pickLang, type Lang } from "../i18n";
import { html, initials, page, topbar, yen, type Html } from "../lib/html";
import { addDays, nowJstIso, todayJst, WEEKDAY_EN } from "../lib/dates";
import { createBooking, nightsOfHouse, recomputeDuties } from "../services";
import { housesAhead, startSection } from "../domain/route";
import { bookingWindow, FIRST_NIGHT_DAYS_AHEAD } from "../domain/window";
import { newId } from "../lib/id";
import routeData from "../data/route_sections.json";

const me = new Hono<AppEnv>();
export const ME_COOKIE = "qr_me";
const AHEAD_DAYS = FIRST_NIGHT_DAYS_AHEAD; // 最初の夜は60日前から。2泊目からは前々日の正午から（D-13、domain/window.ts）

// その人にとって「最初の夜」か：登録した最初の夜。未設定なら、まだ予約が1つもないとき
function isFirstNight(g: { start_date?: string | null }, date: string, bookings: { date: string }[]): boolean {
  if (g.start_date) return date === g.start_date && !bookings.some((b) => b.date < date);
  return bookings.length === 0;
}
const SECTIONS = (routeData as { sections: { id: number; length_m: number; from: number; to: number }[] }).sections;

function langOf(c: { req: { query: (k: string) => string | undefined; header: (k: string) => string | undefined } }): Lang {
  return pickLang(c.req.query("lang"), getCookie(c as never, "lang"), c.req.header("accept-language"));
}
function langBar(current: Lang, path: string): Html {
  return html`<div class="row" style="gap:6px;font-size:12px">${LANGS.map(
    (l) => html`<a href="${path}?lang=${l.code}" style="padding:4px 8px;border-radius:999px;${l.code === current ? "background:#1F1B16;color:#F7F4EC;text-decoration:none" : "color:#6B6257"}">${l.label}</a>`,
  )}</div>`;
}
const AIRPORTS = [1, 31, 40, 84]; // 徳島・高知・松山・高松から入る人の最初の札所（D-17）
const COUNTRIES = ["GBR", "FRA", "DEU", "NLD", "ESP", "ITA", "POL", "IRL", "SWE", "DNK", "AUS", "CAN", "CZE", "USA", "AUT", "BEL", "CHE", "PRT", "NOR", "FIN", "NZL", "KOR", "TWN", "JPN", "UTO"];

export function setMeCookie(c: { header: (n: string, v: string, o?: { append?: boolean }) => void }, guestId: string) {
  setCookie(c as never, ME_COOKIE, guestId, { path: "/", httpOnly: true, secure: true, sameSite: "Lax", maxAge: 60 * 60 * 24 * 180 });
}

// --- 登録（旅の始まりに1回） ---
me.get("/me/new", (c) => {
  const lang = langOf(c);
  setCookie(c, "lang", lang, { path: "/", maxAge: 60 * 60 * 24 * 90 });
  const t = dict(lang);
  const err = c.req.query("err");
  const back = c.req.query("back") ?? "";
  const body = html`
${topbar(t("app.tagline"))}
<div class="wrap" style="display:flex;flex-direction:column;gap:14px">
  ${langBar(lang, "/me/new")}
  <div><div class="eyebrow">Shikoku 88 · qr-yado</div><h1 class="serif" style="font-size:28px">${t("me.new_title")}</h1><div class="mute">${t("me.new_intro")}</div></div>
  ${err ? html`<div class="notice">${err === "date" ? t("me.date_bad") : t("common.error")}</div>` : ""}
  <form method="post" action="/me" enctype="multipart/form-data" style="display:flex;flex-direction:column;gap:14px">
    <input type="hidden" name="lang" value="${lang}"><input type="hidden" name="back" value="${back}">
    <label class="f">${t("me.name")}<input type="text" name="name" required maxlength="80" autocomplete="name"></label>
    <div class="grid2">
      <label class="f">${t("me.country")}<select name="nationality" style="font:inherit;padding:10px;border:1px solid #E3DDCF;border-radius:10px;background:#fff">${COUNTRIES.map((k) => html`<option value="${k}" ${k === "GBR" ? "selected" : ""}>${k}</option>`)}</select></label>
      <label class="f">${t("me.first_night")}<input type="date" name="start_date" required value="${addDays(todayJst(), 1)}" min="${todayJst()}" max="${addDays(todayJst(), AHEAD_DAYS)}" style="font:inherit"></label>
    </div>
    <div style="font-size:14px;font-weight:700">${t("me.start")} <span class="mute" style="font-weight:400">${t("me.start_hint")}</span></div>
    <div class="grid4">
      ${AIRPORTS.map((n) => html`<label class="night ${n === 40 ? "sel" : ""}"><input type="radio" name="start_temple" value="${n}" ${n === 40 ? "checked" : ""} style="position:absolute;opacity:0;width:0;height:0"><span class="mute" style="font-size:11px">${t(`me.airport.${n}`)}</span><span class="d" style="font-size:15px">${t("me.temple", { n })}</span></label>`)}
    </div>
    <label class="f">${t("me.other_temple")}<input type="number" name="start_temple_other" min="1" max="88" style="font:inherit"></label>
    <div class="grid2">
      <label class="opt"><input type="radio" name="direction" value="forward" checked><span>${t("me.forward")}</span></label>
      <label class="opt"><input type="radio" name="direction" value="reverse"><span>${t("me.reverse")}</span></label>
    </div>
    <label class="f">${t("me.photo")} <span class="mute">${t("me.photo_hint")}</span><input type="file" name="photo" accept="image/*" capture="user" style="font:inherit"></label>
    <button class="btn" type="submit">${t("me.get_card")}</button>
    <div class="mute" style="text-align:center">${t("me.card_note")}</div>
  </form>
</div>
<script>
document.querySelectorAll('.night input').forEach(function(i){i.addEventListener('change',function(){document.querySelectorAll('.night').forEach(function(n){n.classList.remove('sel')});i.closest('.night').classList.add('sel');});});
</script>`;
  return c.html(page({ title: t("me.new_title"), lang, body }));
});

me.post("/me", async (c) => {
  const db = new Db(c.env.DB);
  const f = await c.req.parseBody();
  const lang = pickLang(String(f.lang ?? ""), undefined, undefined);
  const name = String(f.name ?? "").trim().slice(0, 80);
  const startDate = String(f.start_date ?? "");
  if (!name || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return c.redirect(`/me/new?lang=${lang}&err=date`);
  const other = Number(f.start_temple_other ?? 0);
  const temple = other >= 1 && other <= 88 ? Math.floor(other) : Math.min(88, Math.max(1, Number(f.start_temple ?? 1) || 1));
  const direction = f.direction === "reverse" ? "reverse" : "forward";
  const nationality = String(f.nationality ?? "").toUpperCase().slice(0, 3) || null;
  const id = newId("g");
  await db.insertGuest({ id, name, language: lang, nationality, start_temple: temple, direction, start_date: startDate, registered: 1 });
  const photo = f.photo instanceof File ? f.photo : null;
  if (photo && photo.size > 0 && photo.size < 8 * 1024 * 1024) {
    const key = `photos/${id}`;
    await c.env.BUCKET.put(key, await photo.arrayBuffer(), { httpMetadata: { contentType: photo.type || "image/jpeg" } });
    await db.updateGuest(id, { photo_key: key, consent_photo_on_paper: 1 });
  }
  setMeCookie(c, id);
  const back = String(f.back ?? "");
  return c.redirect(back.startsWith("/h/") ? `${back}?lang=${lang}` : `/me/${id}?lang=${lang}&new=1`);
});

// --- 巡礼カード（行程と予約） ---
type Night = { date: string; booking?: Awaited<ReturnType<Db["bookingsOfGuest"]>>[number] };

me.get("/me/:guestId", async (c) => {
  const lang = langOf(c);
  const t = dict(lang);
  const db = new Db(c.env.DB);
  const g = await db.guest(c.req.param("guestId"));
  if (!g) return c.notFound();
  setMeCookie(c, g.id); // リンクを開いた端末をカードの持ち主にする
  const today = todayJst();
  const bookings = await db.bookingsOfGuest(g.id);
  const upcoming = bookings.filter((b) => b.date >= today);
  const tonight = bookings.find((b) => b.date === today);
  const direction = (g.direction === "reverse" ? "reverse" : "forward") as "forward" | "reverse";
  // 次に宿のない夜：予約の最後の翌日（予約がなければ開始日か今日の遅い方）。?date= で変えられる
  const last = upcoming[upcoming.length - 1];
  const defaultNext = last ? addDays(last.date, 1) : (g.start_date && g.start_date >= today ? g.start_date : today);
  const q = c.req.query("date");
  const pickDate = q && /^\d{4}-\d{2}-\d{2}$/.test(q) && q >= today && q <= addDays(today, AHEAD_DAYS) ? q : defaultNext;
  // 現在地の区間：その日より前の最後の予約の宿の区間、なければ開始の札所から
  const before = bookings.filter((b) => b.date < pickDate);
  const fromSection = before.length ? before[before.length - 1].section_id : startSection(g.start_temple ?? 1, direction);
  const houses = (await db.houses()).filter((h): h is House & { section_id: number } => h.status === "open" && h.section_id !== null);
  const ahead = housesAhead(houses, fromSection, direction, SECTIONS).slice(0, 6); // 近い順に6軒（宿が少ないうちは遠くても出す）
  const nights = await Promise.all(ahead.map(async (h) => ({ house: h, night: (await nightsOfHouse(db, h, pickDate, 1))[0] })));
  const alreadyThatNight = bookings.find((b) => b.date === pickDate);
  const win = bookingWindow(pickDate, isFirstNight(g, pickDate, bookings), nowJstIso().slice(0, 16));
  const err = c.req.query("err");
  const w = (d: string) => WEEKDAY_EN[new Date(`${d}T00:00:00Z`).getUTCDay()];
  const short = (d: string) => `${new Date(`${d}T00:00:00Z`).toLocaleString("en", { month: "short", timeZone: "UTC" })} ${Number(d.slice(8, 10))}`;
  const status = (s: string) => (s === "paid" ? t("me.paid") : s === "checked_in" ? t("me.checked") : t("me.booked"));
  const body = html`
${topbar(t("app.tagline"))}
<div class="wrap" style="display:flex;flex-direction:column;gap:14px">
  ${langBar(lang, `/me/${g.id}`)}
  ${c.req.query("new") ? html`<div class="notice" style="border-color:#3E6B46;color:#3E6B46">${t("me.save_link")}：<code style="font-size:12px;word-break:break-all">${new URL(c.req.url).origin}/me/${g.id}</code></div>` : ""}
  ${err ? html`<div class="notice">${err === "already" ? t("me.already") : err === "window" ? t("me.not_open") : t("book.not_available")}</div>` : ""}
  <div class="card" style="flex-direction:row;align-items:center;gap:12px">
    <img src="/g/${g.id}/photo" alt="" width="48" height="48" style="border-radius:50%;object-fit:cover;flex:0 0 auto">
    <div style="flex:1 1 auto;min-width:0"><div class="eyebrow">${t("me.card")}</div><div class="serif" style="font-size:22px;font-weight:700;line-height:1.1">${g.name}</div>
      <div class="mute" style="font-size:12px">${g.start_temple ? t("me.from", { n: g.start_temple }) : ""} · ${direction === "forward" ? "→" : "←"} · ${t("me.nights_booked", { n: upcoming.length })}</div></div>
  </div>
  ${tonight
    ? html`<div class="card" style="background:#1F1B16;color:#F7F4EC;border-color:#1F1B16;flex-direction:row;align-items:center;gap:12px">
        <div style="flex:1 1 auto"><div style="font-size:12px;color:#D9D2C4">${t("me.tonight")} · ${w(today)} ${short(today)}</div><div style="font-size:17px;font-weight:700">${tonight.house_label} · ${tonight.community}</div><div style="font-size:12px;color:#D9D2C4">${tonight.status === "booked" ? t("me.arrived") : status(tonight.status)}</div></div>
        ${tonight.status === "booked" ? html`<a class="btn sm" href="/b/${tonight.id}/checkin?lang=${lang}" style="background:#C8401E;white-space:nowrap">${t("me.checkin_now")}</a>` : html`<a class="btn sm line" href="/b/${tonight.id}/pay?lang=${lang}" style="color:#F7F4EC;border-color:#F7F4EC">→</a>`}
      </div>`
    : ""}
  <div class="row" style="align-items:baseline"><div style="font-size:16px;font-weight:700">${t("me.road")}</div><div class="mute" style="font-size:12px">${t("me.ahead")}</div></div>
  <div style="display:flex;flex-direction:column;gap:8px">
    ${upcoming.map(
      (b) => html`<div style="display:grid;grid-template-columns:54px 1fr;gap:8px;align-items:center">
        <div style="text-align:right;font-size:12px" class="mute"><div style="font-weight:700;color:#1F1B16">${short(b.date)}</div>${w(b.date)}</div>
        <a href="/p/${b.party_id}?lang=${lang}" class="card" style="flex-direction:row;align-items:center;gap:8px;padding:10px 12px;text-decoration:none"><div style="flex:1 1 auto"><div style="font-weight:700">${b.house_label}</div><div class="mute" style="font-size:12px">${b.community} · ${b.room_type === "private" ? t("book.private") : t("book.shared")} · ¥${yen(b.price)}</div></div><div style="font-size:12px;font-weight:700;color:#3E6B46">${status(b.status)}</div></a>
        ${b.status === "booked" ? html`<div></div><form method="post" action="/me/${g.id}/cancel" style="text-align:right"><input type="hidden" name="lang" value="${lang}"><input type="hidden" name="booking_id" value="${b.id}"><button type="submit" class="mute" style="background:none;border:0;font:inherit;font-size:12px;text-decoration:underline;cursor:pointer">${t("me.cancel")}</button></form>` : ""}
      </div>`,
    )}
    <div style="display:grid;grid-template-columns:54px 1fr;gap:8px;align-items:start">
      <div style="text-align:right;font-size:12px;padding-top:8px" class="mute"><div style="font-weight:700;color:#C8401E">${short(pickDate)}</div>${w(pickDate)}</div>
      <div style="display:flex;flex-direction:column;gap:6px">
        <div class="row" style="font-size:12px"><span style="color:#C8401E;font-weight:700">${alreadyThatNight ? t("me.booked") : t("me.no_bed")} · ${t("me.pick")}</span><span><a href="/me/${g.id}?lang=${lang}&date=${addDays(pickDate, -1)}">${t("me.prev")}</a>　<a href="/me/${g.id}?lang=${lang}&date=${addDays(pickDate, 1)}">${t("me.next")}</a></span></div>
        ${!win.open && !alreadyThatNight ? html`<div class="notice" style="font-size:13px">${win.reason === "not_yet" ? t("me.opens_at", { date: short(win.opensAt!.slice(0, 10)), day: w(win.opensAt!.slice(0, 10)) }) : win.reason === "too_far" ? t("me.too_far", { n: AHEAD_DAYS }) : t("book.not_available")}</div>` : ""}
        ${nights.map(({ house, night }) => {
          const open = night.state === "open" && !alreadyThatNight && win.open;
          const label = night.state === "open" ? t("me.beds_duty", { n: night.beds }) : night.state === "full" ? t("me.full") : night.staff === 0 ? t("me.no_host") : t("book.closed");
          return html`<div class="card" style="flex-direction:row;align-items:center;gap:8px;padding:10px 12px"><div style="flex:1 1 auto"><div style="font-weight:700">${house.label}</div><div style="font-size:12px;${open ? "color:#3E6B46;font-weight:500" : ""}" class="${open ? "" : "mute"}">${house.ahead === 0 ? t("me.same_section") : t("me.km_ahead", { km: house.km })} · ${label}</div></div>
            ${open ? html`<form method="post" action="/me/${g.id}/book"><input type="hidden" name="lang" value="${lang}"><input type="hidden" name="house_id" value="${house.id}"><input type="hidden" name="date" value="${pickDate}"><button class="btn sm line" type="submit">${t("me.book")}</button></form>` : ""}
          </div>`;
        })}
        <div class="mute" style="font-size:12px">${t("me.window_rule", { n: AHEAD_DAYS })} ${t("me.standby")}</div>
      </div>
    </div>
  </div>
</div>`;
  return c.html(page({ title: t("me.card"), lang, body }));
});

me.post("/me/:guestId/book", async (c) => {
  const db = new Db(c.env.DB);
  const g = await db.guest(c.req.param("guestId"));
  if (!g) return c.notFound();
  const f = await c.req.parseBody();
  const lang = pickLang(String(f.lang ?? ""), undefined, undefined);
  const date = String(f.date ?? "");
  const house = await db.house(String(f.house_id ?? ""));
  const today = todayJst();
  if (!house || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date < today || date > addDays(today, AHEAD_DAYS)) return c.redirect(`/me/${g.id}?lang=${lang}&err=full`);
  const mine = await db.bookingsOfGuest(g.id);
  const win = bookingWindow(date, isFirstNight(g, date, mine), nowJstIso().slice(0, 16));
  if (!win.open) return c.redirect(`/me/${g.id}?lang=${lang}&date=${date}&err=window`);
  const direction = (g.direction === "reverse" ? "reverse" : "forward") as "forward" | "reverse";
  const r = await createBooking(db, house, { date, people: [{ id: g.id, name: g.name }], room_type: "shared", direction, language: lang });
  if (!r.ok) return c.redirect(`/me/${g.id}?lang=${lang}&date=${date}&err=${r.reason === "already" ? "already" : "full"}`);
  setMeCookie(c, g.id);
  return c.redirect(`/me/${g.id}?lang=${lang}`);
});

// 取り消し（チェックイン前のみ）。その夜の当番は見直す
me.post("/me/:guestId/cancel", async (c) => {
  const db = new Db(c.env.DB);
  const g = await db.guest(c.req.param("guestId"));
  if (!g) return c.notFound();
  const f = await c.req.parseBody();
  const lang = pickLang(String(f.lang ?? ""), undefined, undefined);
  const b = await db.booking(String(f.booking_id ?? ""));
  if (b && b.guest_id === g.id && b.status === "booked") {
    await db.setBookingStatus(b.id, "cancelled");
    const house = await db.house(b.house_id);
    if (house) await recomputeDuties(db, house.operator_id, b.date.slice(0, 7));
  }
  return c.redirect(`/me/${g.id}?lang=${lang}`);
});

export default me;
export type { Guest };
