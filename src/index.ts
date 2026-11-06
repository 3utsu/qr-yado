import { Hono } from "hono";
import type { AppEnv, Bindings } from "./env";
import { html, page, topbar } from "./lib/html";
import guest from "./routes/guest";
import me from "./routes/me";
import print from "./routes/print";
import operator from "./routes/operator";
import admin from "./routes/admin";
import board from "./routes/board";
import { auth } from "./auth";

export type { Bindings };

const app = new Hono<AppEnv>();

app.get("/", (c) =>
  c.html(
    page({
      title: "qr-yado（QRやど）",
      body: html`${topbar("スマホを使えない高齢者でも、遍路宿を開ける仕組み")}
<div class="wrap" style="display:flex;flex-direction:column;gap:14px">
  <h1 class="serif" style="font-size:30px">qr-yado（QRやど）</h1>
  <p>スマホを使えない高齢者でも、自宅や空き家で遍路宿を開ける仕組み。宿主は玄関にQRを貼り、紙を受け取るだけ。予約・チェックイン・宿泊者名簿・案内・帳簿の手続きは、外国人宿泊者のスマホと Claude が引き受けます。</p>
  <p lang="en" class="mute">A guesthouse system for the Shikoku pilgrimage — hosts only need a QR code and a printer.</p>
  <div class="card"><div class="eyebrow">入口</div><a href="/login?next=/op">事業主の画面（合言葉）</a><a href="/login?next=/board">四国全体の需給ボード（合言葉）</a><a href="https://github.com/3utsu/qr-yado">GitHub</a></div>
  <div class="mute">Built with Claude: Japan 2026（2026/11/2〜11/8）の制作物。このリポジトリのコードはすべて期間中に新しく書いたものです。</div>
</div>`,
    }),
  ),
);

// 秘密情報は値を出さず、設定されているかどうかだけを返す（設定場所の確認用）
app.get("/health", (c) =>
  c.json({
    ok: true,
    env: c.env?.APP_ENV ?? "unknown",
    model: c.env?.CLAUDE_MODEL ?? null,
    secrets: { ANTHROPIC_API_KEY: !!c.env?.ANTHROPIC_API_KEY, INVOICE_API_ID: !!c.env?.INVOICE_API_ID, ADMIN_TOKEN: !!c.env?.ADMIN_TOKEN },
    bindings: { DB: !!c.env?.DB, BUCKET: !!c.env?.BUCKET },
  }),
);

app.route("/", auth);
app.route("/", guest);
app.route("/", me);
app.route("/", print);
app.route("/", operator);
app.route("/", admin);
app.route("/", board);

app.onError((err, c) => {
  console.error(err);
  return c.html(page({ title: "エラー", body: html`${topbar("エラー")}<div class="wrap"><div class="notice">うまくいきませんでした。もう一度お試しください。</div><div class="mute" style="margin-top:8px">${c.env?.APP_ENV === "production" ? "" : String(err)}</div></div>` }), 500);
});

export default app;
