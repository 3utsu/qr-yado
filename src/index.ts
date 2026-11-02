import { Hono } from "hono";

export type Bindings = {
  APP_ENV: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.get("/", (c) =>
  c.html(`<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>qr-yado</title>
</head>
<body>
  <main>
    <h1>qr-yado</h1>
    <p>スマホを使えない高齢者でも、自宅や空き家で遍路宿を開ける仕組み（開発中）。</p>
    <p lang="en">A guesthouse system for the Shikoku pilgrimage — hosts only need a QR code and a printer. (Work in progress)</p>
  </main>
</body>
</html>`),
);

app.get("/health", (c) => c.json({ ok: true, env: c.env?.APP_ENV ?? "unknown" }));

export default app;
