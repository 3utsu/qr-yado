// 四国全体の需給ボード（D-13, D-24）：表と地図。需要と布団はコードで計算し、Claude は依頼文・告知の下書きだけ。
import { Hono } from "hono";
import type { AppEnv } from "../env";
import { Db } from "../db";
import { requireAdmin } from "../auth";
import { html, page, raw, topbar } from "../lib/html";
import { addDays, todayJst, WEEKDAY_JA, weekday } from "../lib/dates";
import { boardFor, bottlenecks, DEFAULT_PARAMS, type Section } from "../domain/capacity";
import routeData from "../data/route_sections.json";
import facilityData from "../data/facilities_near_route.json";
import { draftPilgrimNotice, draftRequestLetter } from "../claude";

const board = new Hono<AppEnv>();
board.use("/board", requireAdmin);
board.use("/board/*", requireAdmin);
board.use("/api/board/*", requireAdmin);

const SECTIONS: Section[] = routeData.sections.map((s) => ({ id: s.id, from: s.from, to: s.to, from_name: s.from_name, to_name: s.to_name, length_m: s.length_m }));
const FACILITIES = facilityData.facilities as { name: string; kind: string; muni: string; addr: string; lat: number; lng: number; section: number; km: number }[];
const MUNI: Record<string, string> = { "36201": "徳島市", "36206": "阿波市", "37205": "観音寺市", "38506": "愛南町", "39201": "高知市" };

function secName(s: Section): string {
  return `${s.from}→${s.to}　${s.from_name}〜${s.to_name}`;
}

function params(c: { req: { query: (k: string) => string | undefined } }) {
  const starts = Math.max(1, Math.min(1000, Number(c.req.query("starts") ?? DEFAULT_PARAMS.startsPerDay) || DEFAULT_PARAMS.startsPerDay));
  const from = /^\d{4}-\d{2}-\d{2}$/.test(c.req.query("from") ?? "") ? c.req.query("from")! : todayJst();
  const days = Math.max(7, Math.min(21, Number(c.req.query("days") ?? 14) || 14));
  return { starts, from, days };
}

async function compute(db: Db, starts: number, from: string, days: number) {
  const houses = await db.houses();
  const dates = Array.from({ length: days }, (_, i) => addDays(from, i));
  const cells = boardFor(SECTIONS, dates, { ...DEFAULT_PARAMS, startsPerDay: starts }, houses);
  const bn = bottlenecks(cells).map((b) => {
    const s = SECTIONS.find((x) => x.id === b.sectionId)!;
    return { ...b, name: secName(s), km: Math.round(s.length_m / 100) / 10, facilities: FACILITIES.filter((f) => f.section === b.sectionId).slice(0, 8) };
  });
  const onRoad = Math.round((starts * SECTIONS.reduce((a, s) => a + s.length_m, 0)) / 1000 / DEFAULT_PARAMS.kmPerDay);
  return { dates, cells, bottlenecks: bn, houses, onRoad };
}

board.get("/api/board/data", async (c) => {
  const { starts, from, days } = params(c);
  const r = await compute(new Db(c.env.DB), starts, from, days);
  const bySection = new Map<number, typeof r.cells>();
  for (const cell of r.cells) bySection.set(cell.sectionId, [...(bySection.get(cell.sectionId) ?? []), cell]);
  return c.json({
    starts, from, days, onRoad: r.onRoad, dates: r.dates,
    sections: SECTIONS.map((s) => ({ id: s.id, name: secName(s), km: Math.round(s.length_m / 100) / 10, cells: (bySection.get(s.id) ?? []).map((x) => ({ date: x.date, demand: x.demand, supply: x.supply, ratio: Math.round(x.ratio * 100), state: x.state })) })),
    bottlenecks: r.bottlenecks,
    houses: r.houses.map((h) => ({ id: h.id, label: h.label, lat: h.lat, lng: h.lng, section_id: h.section_id, capacity: h.capacity })),
    facilitiesTotal: FACILITIES.length,
    note: "宿の布団の数と需要は架空。距離は OpenStreetMap（ODbL）。公民館・集会所は国土数値情報 P05（CC BY 4.0）。",
  });
});

board.get("/api/board/route", (c) => c.json(routeData));

board.post("/api/board/draft", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { kind?: string; sectionId?: number; dates?: string[]; shortage?: number };
  const s = SECTIONS.find((x) => x.id === Number(body.sectionId));
  if (!s) return c.json({ error: "section" }, 400);
  const dates = (body.dates ?? []).slice(0, 14).join("、");
  try {
    if (body.kind === "notice") {
      const d = await draftPilgrimNotice(c.env, { sectionName: secName(s), dates, langs: ["en", "fr", "de", "es", "nl", "it", "pl", "ja"] });
      return c.json(d);
    }
    const fac = FACILITIES.filter((f) => f.section === s.id).slice(0, 5);
    const muni = fac[0] ? (MUNI[fac[0].muni] ?? `市町村コード ${fac[0].muni}`) : "沿線の市町村";
    const d = await draftRequestLetter(c.env, { municipality: muni, sectionName: secName(s), dates, shortage: Number(body.shortage ?? 0), facilities: fac.map((f) => f.name) });
    return c.json(d);
  } catch (e) {
    return c.json({ error: String(e) }, 502);
  }
});

const CONTROLS = (starts: number, from: string, view: "table" | "map") => html`
<div class="card" style="gap:8px">
  <form method="get" id="ctl" style="display:flex;flex-wrap:wrap;gap:12px 20px;align-items:flex-end">
    <label class="f" style="flex:2 1 320px"><span>1日に歩き始める人数　<strong id="sv" style="font-size:18px;color:#1F1B16">${starts}人</strong>／日</span><input type="range" name="starts" min="5" max="1000" value="${starts}" style="width:100%;accent-color:#C8401E" oninput="document.getElementById('sv').textContent=this.value+'人'"><span style="display:flex;justify-content:space-between"><span>5人（2023年の実績の水準）</span><span>1,000人（旗）</span></span></label>
    <label class="f">見る期間の初日<input type="date" name="from" value="${from}"></label>
    <button class="btn sm" type="submit">計算</button>
  </form>
  <div class="mute">平均 50日で全工程（1日 23km）・順打ち 85%・入口は1番札所と4つの空港。宿の布団の数と需要は架空（デモ）。</div>
</div>`;

board.get("/board", async (c) => {
  const { starts, from, days } = params(c);
  const db = new Db(c.env.DB);
  const r = await compute(db, starts, from, days);
  const bySection = new Map<number, typeof r.cells>();
  for (const cell of r.cells) bySection.set(cell.sectionId, [...(bySection.get(cell.sectionId) ?? []), cell]);
  const over = r.bottlenecks.length;
  const body = html`
${topbar("運営者 · 四国全体の需給ボード", html`<nav class="tabs"><a class="on" href="/board?starts=${starts}&from=${from}">表</a><a href="/board/map?starts=${starts}&from=${from}">地図</a><a href="/op">事業主の画面</a></nav><span class="pill" style="border:1px solid #C8401E;color:#F7F4EC">架空データ（デモ）</span>`)}
<div class="wide" style="display:flex;flex-direction:column;gap:16px">
  ${CONTROLS(starts, from, "table")}
  <div class="row" style="gap:12px">
    <div class="card kpi" style="flex:1 1 180px"><div class="l">今夜、四国の道にいる人</div><div class="v">${r.onRoad.toLocaleString()}人</div><div class="l">${starts}人 × 50日</div></div>
    <div class="card kpi" style="flex:1 1 180px"><div class="l">受付を止めている区間</div><div class="v" style="color:#C8401E">${over}</div><div class="l">60日前の受付で先に知らせる</div></div>
    <div class="card kpi" style="flex:1 1 180px"><div class="l">遍路道から1km以内の公民館・集会所</div><div class="v">${FACILITIES.length.toLocaleString()}</div><div class="l">国土数値情報 P05（2022）</div></div>
    <div class="card kpi" style="flex:1 1 180px"><div class="l">qr-yado の宿</div><div class="v">${r.houses.length}軒</div><div class="l">既存の宿 617軒（架空の布団 ${DEFAULT_PARAMS.existingBeds.toLocaleString()}）</div></div>
  </div>
  <div style="display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start">
    <section class="card" style="flex:999 1 640px;min-width:0">
      <div class="row"><h2 style="font-size:18px">区間 × 日付　宿の埋まり方</h2><div class="mute">数字＝その夜の需要 ÷ 布団の数（%）</div><div style="flex:1 1 auto"></div><div class="mute"><span class="pill green">余裕</span> <span class="pill amber">8割超</span> <span class="pill red">足りない＝受付停止</span></div></div>
      <div class="scroll"><table class="t" style="font-size:12px;border-collapse:separate;border-spacing:2px"><thead><tr><th style="white-space:nowrap">泊地（区間）</th><th class="r">距離</th>${r.dates.map((d) => html`<th style="text-align:center;white-space:nowrap">${d.slice(5).replace("-", "/")}<br><span style="font-size:10px">${WEEKDAY_JA[weekday(d)]}</span></th>`)}</tr></thead><tbody>
      ${SECTIONS.map((s) => {
        const cells = bySection.get(s.id) ?? [];
        const bad = cells.some((x) => x.state === "over");
        return html`<tr><td style="white-space:nowrap;${bad ? "font-weight:700" : ""}">${secName(s)}</td><td class="r" style="white-space:nowrap;color:#6B6257">${(s.length_m / 1000).toFixed(1)}km</td>${cells.map((x) => html`<td style="text-align:center;border-radius:4px;padding:5px 2px;${x.state === "over" ? "background:#C8401E;color:#fff;font-weight:700" : x.state === "tight" ? "background:#F6E3B8" : "background:#E6EFE4"}" title="需要 ${x.demand}人 / 布団 ${x.supply}">${Math.round(x.ratio * 100)}%</td>`)}</tr>`;
      })}</tbody></table></div>
      <div class="mute">距離は OpenStreetMap の遍路道（© OpenStreetMap contributors, ODbL）。計算はすべてコード（domain/capacity.ts）。</div>
    </section>
    <aside style="flex:1 1 300px;min-width:0;display:flex;flex-direction:column;gap:12px">
      ${r.bottlenecks.slice(0, 3).map(
        (b, i) => html`<section class="card ${i === 0 ? "red" : ""}" id="bn-${b.sectionId}">
        <div class="row" style="justify-content:space-between"><h2 style="font-size:16px">詰まり　${b.name}</h2><span style="font-size:12px;color:#C8401E;font-weight:700">${b.dates.length}夜</span></div>
        <div class="grid2" style="grid-template-columns:repeat(3,minmax(0,1fr));font-size:12px;color:#6B6257"><div>区間<div style="font-size:18px;font-weight:900;color:#1F1B16">${b.km}km</div></div><div>不足（最大）<div style="font-size:18px;font-weight:900;color:#C8401E">${b.shortage}人</div></div><div>公民館候補<div style="font-size:18px;font-weight:900;color:#1F1B16">${b.facilities.length}件</div></div></div>
        <div class="mute">${b.dates.map((d) => d.slice(5).replace("-", "/")).join("、")} は新規の受付を止めています。近くの公民館・集会所を1〜2週間だけ開けてもらえれば解けます。</div>
        <details><summary class="mute">候補（遍路道から1km以内）</summary><ul style="margin:6px 0 0;padding-left:18px;font-size:13px">${b.facilities.map((f) => html`<li>${f.name}（${f.kind}・${f.km}km）<span class="mute"> ${f.addr}</span></li>`)}</ul></details>
        <button class="btn sm" type="button" onclick="draft(${b.sectionId},'letter',${JSON.stringify(b.dates)},${b.shortage},this)">市町村への開放依頼文を下書き（Claude）</button>
        <button class="btn sm red" type="button" onclick="draft(${b.sectionId},'notice',${JSON.stringify(b.dates)},${b.shortage},this)">巡礼者への告知を各言語で下書き（Claude）</button>
        <pre id="draft-${b.sectionId}" style="white-space:pre-wrap;font:inherit;font-size:13px;display:none;background:#F7F4EC;border-radius:10px;padding:10px;margin:0"></pre>
      </section>`,
      )}
      ${r.bottlenecks.length === 0 ? html`<section class="card"><h2 style="font-size:16px">詰まりはありません</h2><div class="mute">人数を増やすと、長い区間から先に詰まります。</div></section>` : ""}
      <section class="card"><h2 style="font-size:16px">閉めてよい宿への連絡</h2><div class="mute">余裕のある区間の宿には「この期間は閉めてよい」と紙で知らせます（D-20）。</div></section>
    </aside>
  </div>
</div>
<script>
async function draft(sectionId, kind, dates, shortage, btn){
  var pre=document.getElementById('draft-'+sectionId); pre.style.display='block'; pre.textContent='Claude が下書きしています…'; btn.disabled=true;
  try{ var r=await fetch('/api/board/draft',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({kind:kind,sectionId:sectionId,dates:dates,shortage:shortage})}); var j=await r.json(); pre.textContent=j.error?('失敗: '+j.error):(j.subject+'\\n\\n'+j.body);}catch(e){pre.textContent='失敗: '+e}
  btn.disabled=false;
}
</script>`;
  return c.html(page({ title: "四国全体の需給ボード", body, wide: true }));
});

board.get("/board/map", async (c) => {
  const { starts, from, days } = params(c);
  const body = html`
${topbar("運営者 · 四国全体の需給ボード · 地図", html`<nav class="tabs"><a href="/board?starts=${starts}&from=${from}">表</a><a class="on" href="/board/map?starts=${starts}&from=${from}">地図</a><a href="/op">事業主の画面</a></nav><span class="pill" style="border:1px solid #C8401E;color:#F7F4EC">架空データ（デモ）</span>`)}
<div class="wide" style="display:flex;flex-direction:column;gap:16px">
  ${CONTROLS(starts, from, "map")}
  <div style="display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start">
    <section class="card" style="flex:999 1 640px;min-width:0;padding:12px">
      <div class="row"><h2 style="font-size:18px" id="ttl">の夜　区間ごとの埋まり方</h2><div style="flex:1 1 auto"></div><label class="f" style="min-width:220px"><span>見る夜 <strong id="dv"></strong></span><input type="range" id="day" min="0" max="${days - 1}" value="0" style="width:100%;accent-color:#C8401E"></label></div>
      <div id="map" style="height:640px;border-radius:10px;overflow:hidden"></div>
      <div class="mute">線の太さと色が、その夜の埋まり方（<span style="color:#6a9a66">■</span>余裕 <span style="color:#D9A93E">■</span>8割超 <span style="color:#C8401E">■</span>受付停止）。■ qr-yado の宿、● 詰まりの近くの公民館・集会所（遍路道から1km以内）、▲ 空港。背景：地理院タイル。遍路道：© OpenStreetMap contributors（ODbL）。公民館・集会所：国土数値情報 P05（CC BY 4.0）。</div>
    </section>
    <aside style="flex:1 1 280px;min-width:0;display:flex;flex-direction:column;gap:12px" id="side"></aside>
  </div>
</div>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css">
<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"></script>
<script>
(async function(){
  var q=new URLSearchParams(location.search); var starts=q.get('starts')||'${starts}'; var from=q.get('from')||'${from}';
  var data=await (await fetch('/api/board/data?starts='+starts+'&from='+from+'&days=${days}')).json();
  var route=await (await fetch('/api/board/route')).json();
  var map=L.map('map',{zoomControl:true}).setView([33.65,133.4],8);
  L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png',{attribution:'<a href="https://maps.gsi.go.jp/development/ichiran.html">地理院タイル</a> | © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors | 国土数値情報 P05',maxZoom:18}).addTo(map);
  var col={ok:'#6a9a66',tight:'#D9A93E',over:'#C8401E'}, wid={ok:4,tight:6,over:8};
  var lines={}; var layer=L.layerGroup().addTo(map);
  route.sections.forEach(function(s){ lines[s.id]=L.polyline(s.coords,{color:col.ok,weight:4,opacity:.9}).addTo(layer); });
  data.houses.forEach(function(h){ if(h.lat&&h.lng) L.marker([h.lat,h.lng],{icon:L.divIcon({className:'',html:'<div style="width:16px;height:16px;background:#1F1B16;border:2px solid #fff;border-radius:3px"></div><div style="font-size:12px;font-weight:700;white-space:nowrap;margin-left:-20px">'+h.label+'</div>',iconSize:[16,16]})}).addTo(map).bindPopup(h.label+'（布団 '+h.capacity+'）'); });
  var airports=[['高知龍馬空港',33.5461,133.6694],['松山空港',33.8272,132.6997],['徳島阿波おどり空港',34.1328,134.6067],['高松空港',34.2142,134.0156]];
  airports.forEach(function(a){ L.marker([a[1],a[2]],{icon:L.divIcon({className:'',html:'<div style="color:#2F5BA8;font-size:16px;line-height:1">▲</div><div style="font-size:11px;color:#2F5BA8;white-space:nowrap;margin-left:-30px">'+a[0]+'</div>',iconSize:[16,16]})}).addTo(map); });
  var facLayer=L.layerGroup().addTo(map); var badgeLayer=L.layerGroup().addTo(map);
  function show(i){
    var date=data.dates[i]; document.getElementById('dv').textContent=date; document.getElementById('ttl').textContent=date+' の夜　区間ごとの埋まり方';
    facLayer.clearLayers(); badgeLayer.clearLayers();
    var side=document.getElementById('side'); side.innerHTML='';
    var overs=[];
    data.sections.forEach(function(s){ var c=s.cells[i]; var l=lines[s.id]; l.setStyle({color:col[c.state],weight:wid[c.state]}); l.bindTooltip(s.name+'　需要 '+c.demand+'人 / 布団 '+c.supply+'（'+c.ratio+'%）'); if(c.state==='over') overs.push({s:s,c:c}); });
    overs.sort(function(a,b){return (b.c.demand-b.c.supply)-(a.c.demand-a.c.supply)});
    overs.slice(0,3).forEach(function(o){ var b=data.bottlenecks.find(function(x){return x.sectionId===o.s.id}); var pts=route.sections.find(function(x){return x.id===o.s.id}).coords; var mid=pts[Math.floor(pts.length/2)];
      L.marker(mid,{icon:L.divIcon({className:'',html:'<div style="background:#fff;border:2px solid #C8401E;border-radius:8px;padding:4px 8px;font-size:12px;font-weight:900;color:#C8401E;white-space:nowrap">'+o.s.name.split('　')[0]+' 受付停止 ・ 不足 '+(o.c.demand-o.c.supply)+'人</div>',iconSize:[10,10]})}).addTo(badgeLayer);
      (b?b.facilities:[]).forEach(function(f){ L.circleMarker([f.lat,f.lng],{radius:6,color:'#fff',weight:1.5,fillColor:'#C8401E',fillOpacity:1}).addTo(facLayer).bindPopup(f.name+'（'+f.kind+'）<br>'+f.addr+'<br>遍路道から '+f.km+'km'); });
      var sec=document.createElement('section'); sec.className='card red';
      sec.innerHTML='<h2 style="font-size:16px">詰まり　'+o.s.name+'</h2><div class="grid2" style="grid-template-columns:repeat(3,minmax(0,1fr));font-size:12px;color:#6B6257"><div>需要<div style="font-size:18px;font-weight:900;color:#1F1B16">'+o.c.demand+'人</div></div><div>布団<div style="font-size:18px;font-weight:900;color:#1F1B16">'+o.c.supply+'</div></div><div>不足<div style="font-size:18px;font-weight:900;color:#C8401E">'+(o.c.demand-o.c.supply)+'人</div></div></div><div class="mute">公民館・集会所の候補 '+(b?b.facilities.length:0)+'件（地図の●）</div>';
      side.appendChild(sec);
    });
    if(overs.length===0){ var s=document.createElement('section'); s.className='card'; s.innerHTML='<h2 style="font-size:16px">この夜は詰まりなし</h2><div class="mute">人数を増やすと、長い区間から先に詰まります。</div>'; side.appendChild(s); }
    var k=document.createElement('section'); k.className='card'; k.innerHTML='<h2 style="font-size:16px">四国全体</h2><div class="row" style="justify-content:space-between"><span>今夜、道にいる人</span><strong>'+data.onRoad.toLocaleString()+'人</strong></div><div class="row" style="justify-content:space-between"><span>qr-yado の宿</span><strong>'+data.houses.length+'軒</strong></div><div class="row" style="justify-content:space-between"><span>道から1km以内の公民館・集会所</span><strong>'+data.facilitiesTotal.toLocaleString()+'</strong></div>'; side.appendChild(k);
  }
  document.getElementById('day').addEventListener('input',function(){show(Number(this.value))}); show(0);
})();
</script>`;
  return c.html(page({ title: "需給ボード · 地図", body, wide: true }));
});

export default board;
export { raw };
