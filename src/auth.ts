// 事業主の画面・需給ボード・印刷スクリプト・seed の合言葉（ADMIN_TOKEN）。宿泊者の画面は QR から誰でも開ける。
import { Hono, type Context, type Next } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import type { AppEnv } from "./env";
import { html, page, topbar } from "./lib/html";

const COOKIE = "qr_admin";

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function expectedToken(c: Context<AppEnv>): string | null {
  const v = c.env.ADMIN_TOKEN?.trim();
  return v ? v : null;
}

export function tokenOk(c: Context<AppEnv>): boolean {
  const expected = expectedToken(c);
  if (!expected) return false;
  const q = c.req.query("token");
  const h = c.req.header("authorization")?.replace(/^Bearer\s+/i, "") ?? c.req.header("x-admin-token");
  const ck = getCookie(c, COOKIE);
  return [q, h, ck].some((v) => !!v && constantTimeEqual(v.trim(), expected));
}

function setAdminCookie(c: Context<AppEnv>, token: string) {
  setCookie(c, COOKIE, token, { path: "/", httpOnly: true, secure: true, sameSite: "Lax", maxAge: 60 * 60 * 24 * 30 });
}

export async function requireAdmin(c: Context<AppEnv>, next: Next) {
  if (!tokenOk(c)) {
    const accept = c.req.header("accept") ?? "";
    if (!accept.includes("text/html")) return c.json({ error: "unauthorized" }, 401);
    return c.redirect(`/login?next=${encodeURIComponent(c.req.path)}`);
  }
  const q = c.req.query("token");
  if (q) setAdminCookie(c, q.trim());
  await next();
}

function loginPage(c: Context<AppEnv>, next: string, error?: string) {
  const configured = !!expectedToken(c);
  return c.html(
    page({
      title: "合言葉",
      body: html`${topbar("事業主の画面")}<div class="wrap" style="display:flex;flex-direction:column;gap:14px">
<h1 class="serif" style="font-size:26px">合言葉を入れてください</h1>
<div class="mute">Cloudflare のシークレット <code>ADMIN_TOKEN</code> と同じ文字列です。この端末に30日残ります。URL には出しません。</div>
${configured ? "" : html`<div class="notice">サーバー側に ADMIN_TOKEN が設定されていません。Cloudflare の qr-yado → Settings → Variables and Secrets で Secret として登録し、Deploy してください。</div>`}
${error ? html`<div class="notice">${error}</div>` : ""}
<form method="post" action="/login" style="display:flex;flex-direction:column;gap:10px">
  <input type="hidden" name="next" value="${next}">
  <input type="password" name="token" autocomplete="current-password" autofocus required>
  <button class="btn" type="submit">入る</button>
</form></div>`,
    }),
    error ? 401 : 200,
  );
}

export const auth = new Hono<AppEnv>();

auth.get("/login", (c) => {
  const next = c.req.query("next") ?? "/op";
  if (tokenOk(c)) return c.redirect(next.startsWith("/") ? next : "/op");
  return loginPage(c, next.startsWith("/") ? next : "/op");
});

auth.post("/login", async (c) => {
  const f = await c.req.parseBody();
  const token = String(f.token ?? "").trim();
  const next = String(f.next ?? "/op");
  const expected = expectedToken(c);
  if (expected && token && constantTimeEqual(token, expected)) {
    setAdminCookie(c, token);
    return c.redirect(next.startsWith("/") ? next : "/op");
  }
  const why = !expected
    ? "サーバー側に ADMIN_TOKEN がありません。"
    : token.length !== expected.length
      ? `合言葉が違います（入力 ${token.length} 文字、登録 ${expected.length} 文字）。前後の空白や改行が入っていないか確かめてください。`
      : "合言葉が違います（文字数は合っています）。";
  return loginPage(c, next.startsWith("/") ? next : "/op", why);
});

auth.get("/logout", (c) => {
  setCookie(c, COOKIE, "", { path: "/", maxAge: 0 });
  return c.redirect("/");
});
