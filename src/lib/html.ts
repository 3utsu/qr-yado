// HTML の部品。テンプレートは hono/html で書き、値は必ずエスケープする。
import { html, raw } from "hono/html";
import type { HtmlEscapedString } from "hono/utils/html";

export { html, raw };
export type Html = HtmlEscapedString | Promise<HtmlEscapedString>;

export function esc(s: unknown): string {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export const CSS_BASE = `
:root{--ink:#1F1B16;--paper:#F7F4EC;--line:#E3DDCF;--mute:#6B6257;--red:#C8401E;--green:#3E6B46;--amber:#D9A93E;--white:#fff}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font-family:'Noto Sans JP',system-ui,-apple-system,sans-serif;line-height:1.5}
a{color:var(--ink)}
h1,h2,h3{margin:0;line-height:1.2}
.serif{font-family:'Shippori Mincho',serif}
.wrap{max-width:480px;margin:0 auto;padding:16px 20px 32px}
.wide{max-width:1200px;margin:0 auto;padding:20px 24px 32px}
.top{background:var(--ink);color:var(--paper);padding:10px 20px;display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center;min-height:52px}
.top .brand{font-family:'Shippori Mincho',serif;font-size:20px;font-weight:700}
.top .sub{font-size:13px;color:#CFC7B8}
.top .sp{flex:1 1 auto}
.card{background:var(--white);border:1px solid var(--line);border-radius:14px;padding:16px 18px;display:flex;flex-direction:column;gap:12px}
.card.red{border:2px solid var(--red)}
.eyebrow{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--mute)}
.mute{color:var(--mute);font-size:13px}
.btn{display:inline-flex;align-items:center;justify-content:center;min-height:52px;padding:0 18px;border:0;border-radius:14px;background:var(--ink);color:var(--white);font:inherit;font-size:16px;font-weight:700;text-decoration:none;cursor:pointer;width:100%}
.btn.red{background:var(--red)}
.btn.line{background:var(--white);color:var(--ink);border:1px solid var(--ink)}
.btn.sm{min-height:40px;font-size:14px;width:auto;border-radius:10px;padding:0 14px}
.btn[disabled]{opacity:.5;cursor:default}
label.f{display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--mute)}
input[type=text],input[type=number],input[type=date],select,textarea{font:inherit;font-size:16px;padding:10px 12px;border:1px solid #CFC7B8;border-radius:10px;background:var(--white);color:var(--ink);width:100%}
textarea{min-height:80px}
.grid4{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
.grid2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
.night{border:1px solid var(--line);border-radius:10px;padding:10px 6px;display:flex;flex-direction:column;align-items:center;gap:2px;background:var(--white);cursor:pointer}
.night.sel{border:2px solid var(--ink)}
.night.off{background:#EFEAE0;cursor:default}
.night .d{font-size:20px;font-weight:700}
.night .s{font-size:11px;font-weight:500}
.ok{color:var(--green)}.ng{color:var(--red)}.amber{color:#8a6a10}
.opt{display:flex;align-items:center;gap:12px;border:1px solid var(--line);border-radius:12px;padding:12px 14px;background:var(--white)}
.opt input{width:20px;height:20px;margin:0;accent-color:var(--red)}
.avatar{border-radius:50%;background:var(--ink);color:var(--paper);display:flex;align-items:center;justify-content:center;font-family:'Shippori Mincho',serif;font-weight:700}
.pill{display:inline-block;padding:3px 10px;border-radius:999px;font-size:12px;font-weight:700}
.pill.red{background:var(--red);color:#fff}.pill.green{background:#E6EFE4;color:var(--green)}.pill.amber{background:#F6E3B8;color:#6b4e00}.pill.gray{background:#EFEAE0;color:var(--mute)}
table.t{border-collapse:collapse;width:100%;font-size:14px}
table.t th{color:var(--mute);font-weight:500;text-align:left;padding:6px 8px;border-bottom:1px solid var(--line)}
table.t td{padding:6px 8px;border-top:1px solid var(--line)}
table.t td.r,table.t th.r{text-align:right}
.scroll{overflow-x:auto}
.row{display:flex;flex-wrap:wrap;gap:12px;align-items:center}
.tabs{display:flex;flex-wrap:wrap;gap:8px}
.tabs a{text-decoration:none;padding:9px 16px;border-radius:999px;border:1px solid #CFC7B8;background:var(--white);font-size:14px;font-weight:500}
.tabs a.on{background:var(--ink);color:var(--paper);border-color:var(--ink);font-weight:700}
.kpi{display:flex;flex-direction:column;gap:2px}.kpi .v{font-size:26px;font-weight:900}.kpi .l{font-size:13px;color:var(--mute)}
.big-ja{font-size:28px;font-weight:900;line-height:1.3}
.notice{background:#FFF4EF;border:2px solid var(--red);border-radius:12px;padding:12px 14px}
`;

export function page(opts: { title: string; lang?: string; body: Html; head?: Html; wide?: boolean }): Html {
  return html`<!doctype html>
<html lang="${opts.lang ?? "ja"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${opts.title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700;900&family=Shippori+Mincho:wght@500;700&display=swap" rel="stylesheet">
<style>${raw(CSS_BASE)}</style>
${opts.head ?? ""}
</head>
<body>${opts.body}</body>
</html>`;
}

export function topbar(sub: string, right?: Html): Html {
  return html`<div class="top"><div class="brand">qr-yado</div><div class="sub">${sub}</div><div class="sp"></div>${right ?? ""}</div>`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const a = parts[0]?.[0] ?? "?";
  const b = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (a + b).toUpperCase();
}

export function yen(n: number): string {
  return n.toLocaleString("ja-JP");
}
