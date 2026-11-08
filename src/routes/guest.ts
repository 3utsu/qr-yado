// 宿泊者（外国人の巡礼者）の流れ：QR → 空き状況・予約 → チェックイン（旅券の読み取り → 確認）→ きまりに同意 → 紙が出る → 支払った
import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import type { AppEnv } from "../env";
import { Db, type Booking, type Guest, type House } from "../db";
import { dict, LANGS, pickLang, type Lang } from "../i18n";
import { esc, html, initials, page, raw, topbar, yen, type Html } from "../lib/html";
import { addDays, formatJa, todayJst, WEEKDAY_EN } from "../lib/dates";
import { completeCheckin, createBooking, markPaid, nightsOfHouse } from "../services";
import { kanaForName, noteToJapanese, readPassport, translateGuide } from "../claude";
import { verifyTd3 } from "../domain/mrz";
import { isKatakanaName } from "../domain/kana";
import { newId } from "../lib/id";
import { bookingWindow } from "../domain/window";
import { nowJstIso } from "../lib/dates";

const guest = new Hono<AppEnv>();

function langOf(c: { req: { query: (k: string) => string | undefined; header: (k: string) => string | undefined } }): Lang {
  return pickLang(c.req.query("lang"), getCookie(c as never, "lang"), c.req.header("accept-language"));
}

function langBar(current: Lang, path: string): Html {
  return html`<div class="row" style="gap:6px;font-size:12px">${LANGS.map(
    (l) => html`<a href="${path}?lang=${l.code}" style="padding:4px 8px;border-radius:999px;${l.code === current ? "background:#1F1B16;color:#F7F4EC;text-decoration:none" : "color:#6B6257"}">${l.label}</a>`,
  )}</div>`;
}

const COUNTRY_JA: Record<string, string> = {
  GBR: "イギリス", FRA: "フランス", DEU: "ドイツ", NLD: "オランダ", SWE: "スウェーデン", DNK: "デンマーク", ESP: "スペイン", POL: "ポーランド",
  IRL: "アイルランド", ITA: "イタリア", AUS: "オーストラリア", CAN: "カナダ", CZE: "チェコ", USA: "アメリカ", UTO: "ユートピア（見本）", JPN: "日本",
  AUT: "オーストリア", BEL: "ベルギー", CHE: "スイス", PRT: "ポルトガル", NOR: "ノルウェー", FIN: "フィンランド", NZL: "ニュージーランド", KOR: "韓国", TWN: "台湾",
};
export function countryJa(code: string | null | undefined): string {
  return (code && COUNTRY_JA[code]) || code || "";
}

// --- 空き状況と予約 ---
guest.get("/h/:houseId", async (c) => {
  const lang = langOf(c);
  setCookie(c, "lang", lang, { path: "/", maxAge: 60 * 60 * 24 * 90 });
  const t = dict(lang);
  const db = new Db(c.env.DB);
  const house = await db.house(c.req.param("houseId"));
  if (!house) return c.notFound();
  const from = todayJst();
  const nights = await nightsOfHouse(db, house, from, 14);
  const err = c.req.query("err");
  // 巡礼カードを持つ人（クッキー）：今夜のこの宿の予約があればチェックインへ。なければその人として予約
  const meId = getCookie(c, "qr_me");
  const meGuest = meId ? await db.guest(meId) : null;
  const all = meGuest ? await db.bookingsOfGuest(meGuest.id) : [];
  const mine = all.filter((b) => b.house_id === house.id && b.date >= from);
  const tonight = mine.find((b) => b.date === from);
  // カードを持つ人：2泊目からは前々日の正午から（D-13）。カードなしの人は最初の夜なので60日先まで
  const windowOf = (date: string) => bookingWindow(date, meGuest ? (meGuest.start_date ? date === meGuest.start_date && !all.some((b) => b.date < date) : all.length === 0) : true, nowJstIso().slice(0, 16));
  const body = html`
${topbar(t("app.tagline"))}
<div class="wrap" style="display:flex;flex-direction:column;gap:14px">
  ${langBar(lang, `/h/${house.id}`)}
  <div><div class="eyebrow">Shikoku 88 · ${house.community}</div><h1 class="serif" style="font-size:30px">${house.label}</h1><div class="mute">${t("book.price_per_night", { price: yen(house.price) })}</div></div>
  ${meGuest
    ? html`<div class="card" style="${tonight ? "background:#1F1B16;color:#F7F4EC;border-color:#1F1B16;" : ""}flex-direction:row;align-items:center;gap:12px">
        <img src="/g/${meGuest.id}/photo" alt="" width="44" height="44" style="border-radius:50%;object-fit:cover;flex:0 0 auto">
        <div style="flex:1 1 auto;min-width:0"><div style="font-weight:700">${t("me.hello", { name: meGuest.name })}</div><div style="font-size:12px;${tonight ? "color:#D9D2C4" : "color:#6B6257"}">${tonight ? (tonight.status === "booked" ? t("me.arrived") : tonight.status === "paid" ? t("me.paid") : t("me.checked")) : mine[0] ? `${t("me.booked")} ${mine[0].date}` : t("me.book_as", { name: meGuest.name })}</div></div>
        ${tonight ? (tonight.status === "booked" ? html`<a class="btn sm" href="/b/${tonight.id}/checkin?lang=${lang}" style="background:#C8401E;white-space:nowrap">${t("me.checkin_now")}</a>` : html`<a class="btn sm line" href="/b/${tonight.id}/pay?lang=${lang}" style="color:#F7F4EC;border-color:#F7F4EC">→</a>`) : html`<a class="btn sm line" href="/me/${meGuest.id}?lang=${lang}">${t("me.card")}</a>`}
      </div>`
    : html`<div class="mute" style="font-size:13px"><a href="/me/new?lang=${lang}&back=/h/${house.id}">${t("me.get_card_link")}</a></div>`}
  ${err ? html`<div class="notice">${err === "full" ? t("book.not_available") : err === "select" ? t("book.select_night") : err === "already" ? t("me.already") : err === "window" ? t("me.not_open") : t("common.error")}</div>` : ""}
  <form method="post" action="/h/${house.id}/book" style="display:flex;flex-direction:column;gap:14px">
    <input type="hidden" name="lang" value="${lang}">${meGuest ? html`<input type="hidden" name="guest_id" value="${meGuest.id}">` : ""}
    <div style="font-size:16px;font-weight:700">${t("book.title")}</div>
    <div class="grid4">
      ${nights.map((n) => {
        const d = Number(n.date.slice(8, 10));
        const w = WEEKDAY_EN[new Date(`${n.date}T00:00:00Z`).getUTCDay()];
        const win = windowOf(n.date);
        const off = n.state !== "open" || !win.open;
        const label = n.state === "open" ? (win.open ? t("book.beds", { n: n.beds }) : win.reason === "not_yet" ? t("me.opens_short", { date: `${Number(win.opensAt!.slice(5, 7))}/${Number(win.opensAt!.slice(8, 10))}` }) : t("book.closed")) : n.state === "full" ? t("book.full") : n.state === "closed" ? (n.staff === 0 ? t("book.no_host") : t("book.closed")) : t("book.closed");
        return html`<label class="night ${off ? "off" : ""}"><input type="radio" name="date" value="${n.date}" ${off ? "disabled" : ""} style="position:absolute;opacity:0;width:0;height:0"><span class="mute" style="font-size:11px">${w}</span><span class="d" style="${off ? "color:#8A8176" : ""}">${d}</span><span class="s ${off ? "mute" : "ok"}">${label}</span></label>`;
      })}
    </div>
    <div style="font-size:16px;font-weight:700">${t("book.room")}</div>
    <label class="opt"><input type="radio" name="room_type" value="shared" checked><div style="flex:1 1 auto"><div style="font-weight:700">${t("book.shared")}</div><div class="mute">${t("book.shared_desc")}</div></div><div style="font-weight:700">¥${yen(house.price)}</div></label>
    <label class="opt"><input type="radio" name="room_type" value="private"><div style="flex:1 1 auto"><div style="font-weight:700">${t("book.private")}</div><div class="mute">${t("book.private_desc")}</div></div><div style="font-weight:700">¥${yen(house.price)}</div></label>
    <div style="font-size:16px;font-weight:700">${t("book.direction")}</div>
    <div class="grid2">
      <label class="opt"><input type="radio" name="direction" value="forward" checked><span>${t("book.forward")}</span></label>
      <label class="opt"><input type="radio" name="direction" value="reverse"><span>${t("book.reverse")}</span></label>
    </div>
    <label class="f">${t("book.your_name")}<input type="text" name="name" ${meGuest ? html`value="${meGuest.name}" readonly` : "required"} maxlength="80" autocomplete="name"></label>
    <label class="f">${t("book.companions")}<textarea name="companions" maxlength="300" rows="2"></textarea></label>
    <div class="card" style="flex-direction:row;gap:10px;align-items:flex-start"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#C8401E" stroke-width="2" aria-hidden="true"><path d="M12 21s-7-6.1-7-11a7 7 0 0 1 14 0c0 4.9-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg><div style="font-size:13px">${t("book.cash_note", { donation: yen(house.donation) })}</div></div>
    <button class="btn" type="submit">${t("book.book")}</button>
    <div class="mute" style="text-align:center">${t("book.host_note")}</div>
  </form>
</div>
<script>
document.querySelectorAll('.night input').forEach(function(i){i.addEventListener('change',function(){document.querySelectorAll('.night').forEach(function(n){n.classList.remove('sel')});i.closest('.night').classList.add('sel');});});
</script>`;
  return c.html(page({ title: house.label, lang, body }));
});

guest.post("/h/:houseId/book", async (c) => {
  const db = new Db(c.env.DB);
  const house = await db.house(c.req.param("houseId"));
  if (!house) return c.notFound();
  const f = await c.req.parseBody();
  const lang = pickLang(String(f.lang ?? ""), undefined, undefined);
  const date = String(f.date ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return c.redirect(`/h/${house.id}?lang=${lang}&err=select`);
  const name = String(f.name ?? "").trim().slice(0, 80);
  if (!name && !f.guest_id) return c.redirect(`/h/${house.id}?lang=${lang}&err=select`);
  const companions = String(f.companions ?? "").split(/\r?\n/).map((s) => s.trim().slice(0, 80)).filter(Boolean).slice(0, 5);
  const room_type = f.room_type === "private" ? "private" : "shared";
  const direction = f.direction === "reverse" ? "reverse" : "forward";
  // 巡礼カードを持っている人（クッキー）は、その人として予約する（D-16：id はランダム）
  const me = getCookie(c, "qr_me");
  const meGuest = me && String(f.guest_id ?? "") === me ? await db.guest(me) : null;
  if (meGuest) {
    const all = await db.bookingsOfGuest(meGuest.id);
    const first = meGuest.start_date ? date === meGuest.start_date && !all.some((b) => b.date < date) : all.length === 0;
    if (!bookingWindow(date, first, nowJstIso().slice(0, 16)).open) return c.redirect(`/h/${house.id}?lang=${lang}&err=window`);
  }
  const people = [meGuest ? { id: meGuest.id, name: meGuest.name } : { name }, ...companions.map((n) => ({ name: n }))];
  const r = await createBooking(db, house, { date, people, room_type, direction, language: lang });
  if (!r.ok) return c.redirect(`/h/${house.id}?lang=${lang}&err=${r.reason === "already" ? "already" : "full"}`);
  return c.redirect(`/p/${r.partyId}?lang=${lang}`);
});

// --- 予約の確認（同行者ごとのチェックイン） ---
guest.get("/p/:partyId", async (c) => {
  const lang = langOf(c);
  const t = dict(lang);
  const db = new Db(c.env.DB);
  const bookings = await db.bookingsOfParty(c.req.param("partyId"));
  if (bookings.length === 0) return c.notFound();
  const house = (await db.house(bookings[0].house_id))!;
  const body = html`
${topbar(t("app.tagline"))}
<div class="wrap" style="display:flex;flex-direction:column;gap:14px">
  ${langBar(lang, `/p/${bookings[0].party_id}`)}
  <h1 class="serif" style="font-size:28px">${t("booking.title")}</h1>
  <div class="card">
    <div><div class="eyebrow">${t("booking.house")}</div><div style="font-weight:700;font-size:18px">${house.label}</div></div>
    <div><div class="eyebrow">${t("booking.night")}</div><div style="font-weight:700;font-size:18px">${bookings[0].date}</div></div>
    <div class="mute">${t("booking.checkin_hint")}</div>
  </div>
  <div class="eyebrow">${t("booking.guests")}</div>
  ${bookings.map(
    (b) => html`<div class="card" style="flex-direction:row;align-items:center;gap:12px">
      <div style="flex:1 1 auto"><div style="font-weight:700">${b.guest_name}</div><div class="mute">${b.status === "paid" ? t("booking.paid") : b.status === "checked_in" ? t("booking.checked_in") : "—"}</div></div>
      ${b.status === "booked" ? html`<a class="btn sm" href="/b/${b.id}/checkin?lang=${lang}">${t("booking.checkin")}</a>` : html`<a class="btn sm line" href="/b/${b.id}/pay?lang=${lang}">→</a>`}
    </div>`,
  )}
  <div class="mute">${t("booking.each_guest")}</div>
</div>`;
  return c.html(page({ title: t("booking.title"), lang, body }));
});

// --- チェックイン 1/3：旅券の撮影 ---
guest.get("/b/:bookingId/checkin", async (c) => {
  const lang = langOf(c);
  const t = dict(lang);
  const db = new Db(c.env.DB);
  const booking = await db.booking(c.req.param("bookingId"));
  if (!booking) return c.notFound();
  if (booking.status !== "booked") return c.redirect(`/b/${booking.id}/pay?lang=${lang}`);
  const g = (await db.guest(booking.guest_id))!;
  // 旅券が登録済み（この旅で前の宿が読み取った）なら、撮り直さずに確認へ進める。名簿は夜ごとに作る（D-09）
  const onFile = !!(g.passport_no && g.passport_image_key);
  const body = html`
${topbar(t("checkin.title"))}
<div class="wrap" style="display:flex;flex-direction:column;gap:14px">
  ${langBar(lang, `/b/${booking.id}/checkin`)}
  <div><div class="eyebrow">${t("checkin.step", { n: 1 })}</div><h1 class="serif" style="font-size:26px">${onFile ? t("checkin.on_file_title") : t("checkin.take_passport")}</h1><div class="mute">${onFile ? t("checkin.on_file_hint") : t("checkin.photo_hint")}</div></div>
  ${onFile
    ? html`<div class="card" style="background:#1F1B16;color:#F7F4EC;border-color:#1F1B16;gap:10px">
        <div class="row" style="gap:12px;align-items:center"><img src="/g/${g.id}/photo" alt="" width="44" height="44" style="border-radius:50%;object-fit:cover"><div style="flex:1 1 auto"><div style="font-weight:700;font-size:17px">${g.name}</div><div style="font-size:13px;color:#D9D2C4">${countryJa(g.passport_country ?? g.nationality ?? "")} · ${(g.passport_no ?? "").slice(0, 3)}••••••${g.name_kana ? ` · ${g.name_kana}` : ""}</div></div></div>
        <a class="btn" href="/b/${booking.id}/checkin/known?lang=${lang}" style="background:#C8401E">${t("checkin.use_on_file")}</a>
      </div>
      <details><summary class="mute" style="cursor:pointer">${t("checkin.read_again")}</summary>`
    : ""}
  <form id="readForm" method="post" action="/b/${booking.id}/checkin/read" enctype="multipart/form-data" style="display:flex;flex-direction:column;gap:12px">
    <input type="hidden" name="lang" value="${lang}">
    <label class="f">${t("checkin.take_passport")}<input type="file" name="passport" accept="image/*" capture="environment" required style="font:inherit"></label>
    <label class="f">${t("checkin.selfie")}<input type="file" name="selfie" accept="image/*" capture="user" style="font:inherit"></label>
    <button class="btn red" type="submit" id="readBtn">${t("checkin.upload")}</button>
    <div class="mute">${g.name}</div>
  </form>
  <form method="post" action="/b/${booking.id}/checkin/read" style="text-align:center"><input type="hidden" name="lang" value="${lang}"><input type="hidden" name="specimen" value="churchill"><button type="submit" class="mute" style="background:none;border:0;font:inherit;font-size:13px;text-decoration:underline;cursor:pointer">${t("checkin.specimen")}</button></form>
  ${onFile ? html`</details>` : ""}
  <script>
  // スマホの写真はそのままだと大きい（HEIC・数MB）ので、送る前に縮めて JPEG にする。読み取りが速く、確実になる
  (function(){
    var form=document.getElementById('readForm'), btn=document.getElementById('readBtn');
    function shrink(file, max){ return new Promise(function(res){ if(!file||!file.size) return res(null);
      var img=new Image(); var url=URL.createObjectURL(file);
      img.onload=function(){ var w=img.naturalWidth,h=img.naturalHeight,sc=Math.min(1,max/Math.max(w,h)); var cv=document.createElement('canvas'); cv.width=Math.round(w*sc); cv.height=Math.round(h*sc); cv.getContext('2d').drawImage(img,0,0,cv.width,cv.height); URL.revokeObjectURL(url); cv.toBlob(function(b){ res(b?new File([b],'photo.jpg',{type:'image/jpeg'}):file); },'image/jpeg',0.86); };
      img.onerror=function(){ URL.revokeObjectURL(url); res(file); };
      img.src=url; }); }
    form.addEventListener('submit', function(ev){ if(form.dataset.ready) return; ev.preventDefault(); btn.disabled=true; btn.textContent='…';
      var fd=new FormData(); fd.append('lang', form.lang.value);
      Promise.all([shrink(form.passport.files[0],1800), shrink(form.selfie.files[0],900)]).then(function(r){ if(r[0]) fd.append('passport', r[0]); if(r[1]) fd.append('selfie', r[1]);
        return fetch(form.action,{method:'POST',body:fd,credentials:'same-origin'}); })
      .then(function(resp){ return resp.text(); })
      .then(function(htmlText){ history.replaceState(null,'',form.action); document.open(); document.write(htmlText); document.close(); })
      .catch(function(){ form.dataset.ready='1'; btn.disabled=false; form.submit(); });
    });
  })();
  </script>
  <details><summary class="mute">${t("checkin.read_failed").split(".")[0]}…</summary>
  <form method="post" action="/b/${booking.id}/checkin/confirm" style="display:flex;flex-direction:column;gap:10px;margin-top:10px">
    <input type="hidden" name="lang" value="${lang}">
    ${confirmFields(t, { name: g.name, kana: "", nationality: g.nationality ?? "", passport_no: "", passport_country: "", address: "", occupation: "", note: "" }, null)}
    <button class="btn" type="submit">${t("checkin.confirm_btn")}</button>
  </form></details>
</div>`;
  return c.html(page({ title: t("checkin.title"), lang, body }));
});

function confirmFields(
  t: (k: string, v?: Record<string, string | number>) => string,
  v: { name: string; kana: string; nationality: string; passport_no: string; passport_country: string; address: string; occupation: string; note: string },
  mrz: { ok: boolean } | null,
): Html {
  return html`
    <label class="f">${t("checkin.name")}<input type="text" name="name" value="${v.name}" required maxlength="80"></label>
    <label class="f">${t("checkin.kana")} <span style="color:#C8401E">· ${t("checkin.kana_by")}</span><input type="text" name="kana" value="${v.kana}" maxlength="40" style="font-size:18px"></label>
    <div class="grid2">
      <label class="f">${t("checkin.nationality")}<input type="text" name="nationality" value="${v.nationality}" maxlength="3" style="text-transform:uppercase"></label>
      <label class="f">${t("checkin.passport_no")}<input type="text" name="passport_no" value="${v.passport_no}" maxlength="9" style="text-transform:uppercase"></label>
    </div>
    <label class="f">${t("checkin.passport_country")}<input type="text" name="passport_country" value="${v.passport_country}" maxlength="3" style="text-transform:uppercase"></label>
    ${mrz ? html`<div class="${mrz.ok ? "ok" : "ng"}" style="font-size:12px;display:flex;gap:6px;align-items:center">${mrz.ok ? "✓" : "✕"} ${mrz.ok ? t("checkin.checkdigit_ok") : t("checkin.checkdigit_ng")}</div>` : ""}
    <label class="f">${t("checkin.address")} <span class="mute">· ${t("checkin.address_hint")}</span><input type="text" name="address" value="${v.address}" maxlength="200" required></label>
    <label class="f">${t("checkin.occupation")}<input type="text" name="occupation" value="${v.occupation}" maxlength="60" required></label>
    <label class="f">${t("checkin.note")}<textarea name="note" maxlength="200" rows="2" placeholder="${t("checkin.note_hint")}">${v.note}</textarea></label>
    <label class="opt" style="font-size:14px"><input type="checkbox" name="photo_ok" value="1" checked><span>${t("checkin.photo_consent")}</span></label>
    <div class="mute">${t("checkin.privacy")}</div>`;
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
}

// --- チェックイン 2/3：Claude が読み取り → 本人が確認 ---
guest.post("/b/:bookingId/checkin/read", async (c) => {
  const db = new Db(c.env.DB);
  const booking = await db.booking(c.req.param("bookingId"));
  if (!booking) return c.notFound();
  const g = (await db.guest(booking.guest_id))!;
  const f = await c.req.parseBody();
  const lang = pickLang(String(f.lang ?? ""), undefined, undefined);
  const t = dict(lang);
  let passport = f.passport instanceof File ? f.passport : null;
  const selfie = f.selfie instanceof File && f.selfie.size > 0 ? f.selfie : null;
  // デモ用：見本の旅券（Utopia・SPECIMEN、リポジトリの fixtures）で読み取りを試す。本物の旅券は使わない
  if (!passport && typeof f.specimen === "string" && /^[a-z]+$/.test(f.specimen)) {
    const r = await fetch(`https://raw.githubusercontent.com/3utsu/qr-yado/main/fixtures/specimen-passport-${f.specimen}.png`);
    if (r.ok) passport = new File([await r.arrayBuffer()], `specimen-${f.specimen}.png`, { type: "image/png" });
  }
  let values = { name: g.name, kana: "", nationality: g.nationality ?? "", passport_no: "", passport_country: "", address: g.address ?? "", occupation: g.occupation ?? "", note: g.note ?? "" };
  let mrz: { ok: boolean } | null = null;
  let error: string | null = null;
  const okType = passport ? /^image\/(jpeg|png|webp|gif)$/.test(passport.type || "image/jpeg") : false;
  if (passport && passport.size > 0 && passport.size < 5 * 1024 * 1024 && okType) {
    const buf = await passport.arrayBuffer();
    const key = `passports/${g.id}/${newId("img", 8)}`;
    await c.env.BUCKET.put(key, buf, { httpMetadata: { contentType: passport.type || "image/jpeg" } });
    await db.updateGuest(g.id, { passport_image_key: key });
    try {
      const read = await readPassport(c.env, toBase64(buf), passport.type || "image/jpeg");
      const fullName = `${read.given_names} ${read.surname}`.replace(/\s+/g, " ").trim();
      values = { ...values, name: fullName, nationality: read.nationality, passport_no: read.passport_no, passport_country: read.issuing_country };
      if (read.mrz_line1 && read.mrz_line2) {
        const v = verifyTd3(read.mrz_line1, read.mrz_line2);
        if (v) {
          mrz = { ok: v.documentNumberOk };
          if (v.documentNumberOk) values.passport_no = v.documentNumber;
        }
      }
      try {
        const k = await kanaForName(c.env, fullName, read.nationality, lang);
        if (isKatakanaName(k.kana)) values.kana = k.kana;
      } catch {
        /* 読みは本人が入力できる */
      }
    } catch (e) {
      error = t("checkin.read_failed");
    }
  } else {
    error = passport && passport.size > 0 && (!okType || passport.size >= 5 * 1024 * 1024) ? t("checkin.photo_too_big") : t("checkin.read_failed");
  }
  if (selfie && selfie.size < 8 * 1024 * 1024) {
    const key = `photos/${g.id}`;
    await c.env.BUCKET.put(key, await selfie.arrayBuffer(), { httpMetadata: { contentType: selfie.type || "image/jpeg" } });
    await db.updateGuest(g.id, { photo_key: key });
  }
  const body = html`
${topbar(t("checkin.title"))}
<div class="wrap" style="display:flex;flex-direction:column;gap:14px">
  <div><div class="eyebrow">${t("checkin.step", { n: 2 })}</div><h1 class="serif" style="font-size:26px">${t("checkin.confirm_title")}</h1><div class="mute">${t("checkin.confirm_hint")}</div></div>
  ${error ? html`<div class="notice">${error}</div>` : ""}
  <form method="post" action="/b/${booking.id}/checkin/confirm" style="display:flex;flex-direction:column;gap:10px">
    <input type="hidden" name="lang" value="${lang}">
    ${confirmFields(t, values, mrz)}
    <button class="btn red" type="submit">${t("checkin.confirm_btn")}</button>
  </form>
</div>`;
  return c.html(page({ title: t("checkin.title"), lang, body }));
});

// 旅券が登録済みのとき：確認画面（2/3）を記録から埋めて出す。写真は撮らない
guest.get("/b/:bookingId/checkin/known", async (c) => {
  const lang = langOf(c);
  const t = dict(lang);
  const db = new Db(c.env.DB);
  const booking = await db.booking(c.req.param("bookingId"));
  if (!booking) return c.notFound();
  if (booking.status !== "booked") return c.redirect(`/b/${booking.id}/pay?lang=${lang}`);
  const g = (await db.guest(booking.guest_id))!;
  if (!(g.passport_no && g.passport_image_key)) return c.redirect(`/b/${booking.id}/checkin?lang=${lang}`);
  const values = { name: g.name, kana: g.name_kana ?? "", nationality: g.nationality ?? "", passport_no: g.passport_no, passport_country: g.passport_country ?? g.nationality ?? "", address: g.address ?? "", occupation: g.occupation ?? "", note: "" };
  const body = html`
${topbar(t("checkin.title"))}
<div class="wrap" style="display:flex;flex-direction:column;gap:14px">
  <div><div class="eyebrow">${t("checkin.step", { n: 2 })}</div><h1 class="serif" style="font-size:26px">${t("checkin.confirm_title")}</h1><div class="mute">${t("checkin.on_file_confirm")}</div></div>
  <form method="post" action="/b/${booking.id}/checkin/confirm" style="display:flex;flex-direction:column;gap:10px">
    <input type="hidden" name="lang" value="${lang}">
    ${confirmFields(t, values, { ok: true })}
    <button class="btn red" type="submit">${t("checkin.confirm_btn")}</button>
  </form>
</div>`;
  return c.html(page({ title: t("checkin.title"), lang, body }));
});

guest.post("/b/:bookingId/checkin/confirm", async (c) => {
  const db = new Db(c.env.DB);
  const booking = await db.booking(c.req.param("bookingId"));
  if (!booking) return c.notFound();
  const g = (await db.guest(booking.guest_id))!;
  const f = await c.req.parseBody();
  const lang = pickLang(String(f.lang ?? ""), undefined, undefined);
  const t = dict(lang);
  const s = (k: string, max: number) => String(f[k] ?? "").trim().slice(0, max);
  const kanaIn = s("kana", 40);
  const kana = kanaIn ? (isKatakanaName(kanaIn) ? kanaIn : null) : null;
  if (kanaIn && !kana) {
    return c.html(page({ title: t("checkin.title"), lang, body: html`${topbar(t("checkin.title"))}<div class="wrap"><div class="notice">${t("checkin.kana_invalid")}</div><p><a href="javascript:history.back()">${t("common.back")}</a></p></div>` }), 400);
  }
  const note = s("note", 200) || null;
  let noteJa: string | null = null;
  if (note) {
    try {
      noteJa = await noteToJapanese(c.env, note, lang);
    } catch {
      noteJa = null;
    }
  }
  const nat = s("nationality", 3).toUpperCase() || null;
  await completeCheckin(db, booking, g, {
    name: s("name", 80) || g.name,
    name_kana: kana,
    nationality: nat && /^[A-Z]{3}$/.test(nat) ? nat : null,
    passport_no: s("passport_no", 9).toUpperCase() || null,
    passport_country: s("passport_country", 3).toUpperCase() || null,
    address: s("address", 200) || null,
    occupation: s("occupation", 60) || null,
    note,
    note_ja: noteJa,
    consent_photo_on_paper: f.photo_ok === "1",
  });
  return c.redirect(`/b/${booking.id}/rules?lang=${lang}`);
});

// --- チェックイン 3/3：宿の案内と地域のきまり（Claude が各言語にし、キャッシュ） ---
async function guideFor(c: { env: AppEnv["Bindings"] }, db: Db, house: House, lang: Lang): Promise<{ guide: string; rules: string }> {
  const guideJa = house.guide_ja ?? "";
  const rulesJa = house.rules_ja ?? "";
  if (lang === "ja" || (!guideJa && !rulesJa)) return { guide: guideJa, rules: rulesJa };
  const cached = await db.houseGuide(house.id, lang);
  if (cached) return JSON.parse(cached);
  try {
    const tr = await translateGuide(c.env, guideJa, rulesJa, lang);
    await db.setHouseGuide(house.id, lang, JSON.stringify(tr));
    return tr;
  } catch {
    return { guide: guideJa, rules: rulesJa };
  }
}

guest.get("/b/:bookingId/rules", async (c) => {
  const lang = langOf(c);
  const t = dict(lang);
  const db = new Db(c.env.DB);
  const booking = await db.booking(c.req.param("bookingId"));
  if (!booking) return c.notFound();
  const house = (await db.house(booking.house_id))!;
  const g = await guideFor(c, db, house, lang);
  const para = (s: string) => raw(esc(s).replaceAll("\n", "<br>"));
  const body = html`
${topbar(t("checkin.title"))}
<div class="wrap" style="display:flex;flex-direction:column;gap:14px">
  <div><div class="eyebrow">${t("checkin.step", { n: 3 })}</div><h1 class="serif" style="font-size:26px">${t("rules.title")}</h1><div class="mute">${t("rules.intro")}</div></div>
  ${g.guide ? html`<div class="card"><div style="font-size:15px;line-height:1.6">${para(g.guide)}</div></div>` : ""}
  ${g.rules ? html`<div class="card red"><div style="font-size:15px;line-height:1.6">${para(g.rules)}</div></div>` : ""}
  <form method="post" action="/b/${booking.id}/rules"><input type="hidden" name="lang" value="${lang}"><button class="btn red" type="submit">${t("rules.agree")}</button></form>
</div>`;
  return c.html(page({ title: t("rules.title"), lang, body }));
});

guest.post("/b/:bookingId/rules", async (c) => {
  const db = new Db(c.env.DB);
  const booking = await db.booking(c.req.param("bookingId"));
  if (!booking) return c.notFound();
  const f = await c.req.parseBody();
  const lang = pickLang(String(f.lang ?? ""), undefined, undefined);
  await db.setRulesConsent(booking.id, new Date().toISOString());
  return c.redirect(`/b/${booking.id}/pay?lang=${lang}`);
});

// --- 紙が出る → 支払った ---
guest.get("/b/:bookingId/pay", async (c) => {
  const lang = langOf(c);
  const t = dict(lang);
  const db = new Db(c.env.DB);
  const booking = await db.booking(c.req.param("bookingId"));
  if (!booking) return c.notFound();
  const g = (await db.guest(booking.guest_id))!;
  const house = (await db.house(booking.house_id))!;
  const job = await db.printJobByRef("checkin", booking.id);
  const paid = booking.status === "paid";
  const body = html`
${topbar(t("app.tagline"))}
<div class="wrap" style="display:flex;flex-direction:column;gap:14px">
  <h1 class="serif" style="font-size:26px">${paid ? t("paid.done") : t("paid.title")}</h1>
  <div class="card" style="flex-direction:row;align-items:center;gap:12px">
    <div class="avatar" style="width:56px;height:56px;font-size:22px">${initials(g.name)}</div>
    <div><div style="font-weight:700;font-size:18px">${g.name_kana ?? ""}</div><div class="mute">${g.name} · ${house.label} · ${booking.date}</div></div>
  </div>
  ${
    paid
      ? html`<div class="card"><div class="ok" style="font-weight:700">✓ ${t("booking.paid")}</div><div class="mute">${t("paid.dinner")}</div></div>`
      : html`
  <div class="card"><div id="pstat" class="mute">${t("paid.printing", { price: yen(booking.price) })}</div><div class="mute">${t("paid.donation", { donation: yen(booking.donation) })}</div>${job?.print_no ? html`<div class="mute">No. ${job.print_no}</div>` : ""}</div>
  <form method="post" action="/b/${booking.id}/pay"><input type="hidden" name="lang" value="${lang}"><button class="btn red" type="submit">${t("paid.button", { price: yen(booking.price) })}</button></form>
  <details class="card"><summary>${t("paid.not_printed")}</summary><div class="big-ja" style="margin-top:8px">紙が出ませんでした。窓口に連絡してください。<br>${g.name_kana ?? g.name}（${g.name}）<br>${formatJa(booking.date)}　${yen(booking.price)}円</div></details>
  <div class="mute">${t("paid.dinner")}</div>
  ${job ? html`<script>(function(){var el=document.getElementById('pstat');function tick(){fetch('/api/print/status/${job.id}').then(function(r){return r.json()}).then(function(j){if(j.status==='done'){el.innerHTML='✓ '+el.textContent;}else{setTimeout(tick,3000);}}).catch(function(){setTimeout(tick,5000)});}tick();})();</script>` : ""}`
  }
</div>`;
  return c.html(page({ title: t("paid.title"), lang, body }));
});

guest.post("/b/:bookingId/pay", async (c) => {
  const db = new Db(c.env.DB);
  const booking = await db.booking(c.req.param("bookingId"));
  if (!booking) return c.notFound();
  const f = await c.req.parseBody();
  const lang = pickLang(String(f.lang ?? ""), undefined, undefined);
  if (booking.status !== "paid") await markPaid(db, booking);
  return c.redirect(`/b/${booking.id}/pay?lang=${lang}`);
});

// 顔写真：事前登録があれば R2 から、なければイニシャルの図柄（D-26）
guest.get("/g/:guestId/photo", async (c) => {
  const db = new Db(c.env.DB);
  const g = await db.guest(c.req.param("guestId"));
  if (!g) return c.notFound();
  if (g.photo_key && g.consent_photo_on_paper) {
    const obj = await c.env.BUCKET.get(g.photo_key);
    if (obj) return new Response(obj.body, { headers: { "content-type": obj.httpMetadata?.contentType ?? "image/jpeg", "cache-control": "private, max-age=300" } });
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><circle cx="100" cy="100" r="100" fill="#1F1B16"/><text x="100" y="128" text-anchor="middle" font-family="Shippori Mincho, serif" font-size="80" font-weight="700" fill="#FFFFFF">${esc(initials(g.name))}</text></svg>`;
  return new Response(svg, { headers: { "content-type": "image/svg+xml", "cache-control": "private, max-age=300" } });
});

export type { Booking, Guest };
export default guest;
