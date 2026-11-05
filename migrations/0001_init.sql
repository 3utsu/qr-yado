-- qr-yado 初期スキーマ（D-09, D-11, D-15, D-16, D-17, D-19, D-22）
-- 主キーはすべてランダムな ID（旅券番号は主キーにしない：D-16）

-- 事業主（民泊の届出をする個人・NPO・法人）
CREATE TABLE IF NOT EXISTS operators (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'individual', -- individual / npo / corporation
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 宿（呼び名は集落名＋連番。内部では市町村コード＋集落＋連番で一意：D-19）
CREATE TABLE IF NOT EXISTS houses (
  id TEXT PRIMARY KEY,
  operator_id TEXT NOT NULL REFERENCES operators(id),
  municipality_code TEXT NOT NULL,   -- 例: 38506（愛南町）
  community TEXT NOT NULL,           -- 例: Kaizuka
  seq INTEGER NOT NULL,              -- 例: 1
  label TEXT NOT NULL,               -- 例: Kaizuka #1
  lat REAL, lng REAL,
  section_id INTEGER,                -- 最寄りの遍路道の区間（1〜88）
  capacity INTEGER NOT NULL DEFAULT 6,
  price INTEGER NOT NULL DEFAULT 5000,    -- 1泊の料金（うち donation を寄付：D-20）
  donation INTEGER NOT NULL DEFAULT 500,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (municipality_code, community, seq)
);

-- 要員（事業主が登録する手伝いの人。日当は人ごと：D-22）
CREATE TABLE IF NOT EXISTS staff (
  id TEXT PRIMARY KEY,
  operator_id TEXT NOT NULL REFERENCES operators(id),
  name TEXT NOT NULL,
  daily_wage INTEGER NOT NULL DEFAULT 3000,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 要員の月の予定（○×）
CREATE TABLE IF NOT EXISTS staff_schedule (
  staff_id TEXT NOT NULL REFERENCES staff(id),
  date TEXT NOT NULL,                -- YYYY-MM-DD
  available INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (staff_id, date)
);

-- 宿泊者（外国人の巡礼者）
CREATE TABLE IF NOT EXISTS guests (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  name_kana TEXT,                    -- Claude が作り、本人が直す（D-12）
  nationality TEXT,                  -- ISO 3166-1 alpha-3
  language TEXT,                     -- BCP 47
  occupation TEXT,
  address TEXT,
  passport_no TEXT,
  passport_country TEXT,             -- 発行国コードとの組で保存（D-16）
  photo_key TEXT,                    -- R2（事前登録の顔写真）
  passport_image_key TEXT,           -- R2（旅券の写し。非公開：D-07）
  consent_photo_on_paper INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 予約（1行＝1人×1泊：D-11）
CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY,
  house_id TEXT NOT NULL REFERENCES houses(id),
  guest_id TEXT NOT NULL REFERENCES guests(id),
  date TEXT NOT NULL,                -- 泊まる夜（YYYY-MM-DD）
  room_type TEXT NOT NULL DEFAULT 'shared', -- shared / private
  party_id TEXT,                     -- 同行者グループ
  direction TEXT NOT NULL DEFAULT 'forward', -- forward（順打ち）/ reverse（逆打ち）：D-17
  price INTEGER NOT NULL,
  donation INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'booked', -- booked / checked_in / paid / cancelled
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (guest_id, date)
);

-- 当番（宿泊のある夜に、予定○の要員から1人：D-22）
CREATE TABLE IF NOT EXISTS duties (
  house_id TEXT NOT NULL REFERENCES houses(id),
  date TEXT NOT NULL,
  staff_id TEXT NOT NULL REFERENCES staff(id),
  PRIMARY KEY (house_id, date)
);

-- 宿泊者名簿（法定。電子で作成・保存、3年：D-09, D-11）
CREATE TABLE IF NOT EXISTS register_entries (
  id TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL UNIQUE REFERENCES bookings(id),
  house_id TEXT NOT NULL,
  date TEXT NOT NULL,
  name TEXT NOT NULL,
  address TEXT,
  occupation TEXT,
  nationality TEXT,
  passport_no TEXT,
  passport_country TEXT,
  checked_in_at TEXT NOT NULL,
  consent_rules_at TEXT              -- 地域ルールへの同意
);

-- 現金の受領（宿泊者が「支払った」を押す。紙の受領欄が原本：D-15）
CREATE TABLE IF NOT EXISTS payments (
  booking_id TEXT PRIMARY KEY REFERENCES bookings(id),
  amount INTEGER NOT NULL,
  method TEXT NOT NULL DEFAULT 'cash',
  paid_at TEXT NOT NULL
);

-- 印刷待ち（宿の機器が取りに来る。1泊1枚は一意制約で守る：D-10, D-16）
CREATE TABLE IF NOT EXISTS print_jobs (
  id TEXT PRIMARY KEY,
  house_id TEXT NOT NULL REFERENCES houses(id),
  kind TEXT NOT NULL,                -- checkin / schedule / ledger
  ref_id TEXT,                       -- checkin: booking_id, schedule: staff_id+month, ledger: month
  status TEXT NOT NULL DEFAULT 'queued', -- queued / printing / done / failed
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  printed_at TEXT,
  UNIQUE (kind, ref_id)
);

-- 遍路道の区間（OSM relation 13653655 から。需給ボード用：D-13）
CREATE TABLE IF NOT EXISTS route_sections (
  id INTEGER PRIMARY KEY,            -- 1〜88（88 は 88番→1番）
  from_temple INTEGER NOT NULL,
  to_temple INTEGER NOT NULL,
  name TEXT NOT NULL,
  length_m INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_bookings_house_date ON bookings(house_id, date);
CREATE INDEX IF NOT EXISTS idx_schedule_date ON staff_schedule(date);
CREATE INDEX IF NOT EXISTS idx_print_jobs_status ON print_jobs(house_id, status);
