// 事業主の画面・需給ボード・印刷スクリプト・seed の合言葉（ADMIN_TOKEN）。宿泊者の画面は QR から誰でも開ける。
import type { Context, Next } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import type { AppEnv } from "./env";

const COOKIE = "qr_admin";

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export function tokenOk(c: Context<AppEnv>): boolean {
  const expected = c.env.ADMIN_TOKEN;
  if (!expected) return false;
  const q = c.req.query("token");
  const h = c.req.header("authorization")?.replace(/^Bearer\s+/i, "");
  const ck = getCookie(c, COOKIE);
  return [q, h, ck].some((v) => !!v && constantTimeEqual(v, expected));
}

export async function requireAdmin(c: Context<AppEnv>, next: Next) {
  if (!tokenOk(c)) {
    return c.html(
      `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>合言葉</title><body style="font-family:system-ui;padding:24px;max-width:420px;margin:auto"><h1 style="font-size:20px">qr-yado 事業主の画面</h1><p>合言葉（ADMIN_TOKEN）を入れてください。</p><form method="get"><input name="token" type="password" style="font-size:16px;padding:10px;width:100%" autofocus><button style="margin-top:10px;font-size:16px;padding:10px 16px">入る</button></form>${c.env.ADMIN_TOKEN ? "" : "<p style='color:#C8401E'>ADMIN_TOKEN が未設定です。Cloudflare のシークレットに登録してください。</p>"}</body></html>`,
      401,
    );
  }
  if (c.req.query("token")) setCookie(c, COOKIE, c.req.query("token")!, { path: "/", httpOnly: true, secure: true, sameSite: "Lax", maxAge: 60 * 60 * 24 * 30 });
  await next();
}
