export type Bindings = {
  APP_ENV: string;
  CLAUDE_MODEL: string;
  DB: D1Database;
  BUCKET: R2Bucket;
  ANTHROPIC_API_KEY?: string;
  INVOICE_API_ID?: string;
  ADMIN_TOKEN?: string; // 事業主の画面・需給ボード・印刷スクリプト・seed の合言葉（wrangler secret）
};

export type AppEnv = { Bindings: Bindings; Variables: { lang: string } };
