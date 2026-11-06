-- 宿の案内・地域ルール（日本語の原文は houses に、各言語への翻訳はキャッシュ）と、宿泊者のひとこと

ALTER TABLE houses ADD COLUMN guide_ja TEXT;   -- 宿主が話した案内（日本語）。Claude が各言語にする
ALTER TABLE houses ADD COLUMN rules_ja TEXT;   -- 地域のきまり（日本語）

ALTER TABLE guests ADD COLUMN note TEXT;       -- 宿主へのひとこと（宿泊者の言語）
ALTER TABLE guests ADD COLUMN note_ja TEXT;    -- Claude が日本語にしたもの

ALTER TABLE print_jobs ADD COLUMN print_no TEXT; -- 紙に載せる印刷番号 P-YYYYMMDD-NNNN

CREATE TABLE IF NOT EXISTS house_guides (
  house_id TEXT NOT NULL REFERENCES houses(id),
  lang TEXT NOT NULL,
  text TEXT NOT NULL,                -- JSON: { guide: string, rules: string }
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (house_id, lang)
);
