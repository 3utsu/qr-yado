-- 利用者（巡礼者）の登録：旅の始まりに1回。開始の札所・方向・最初の夜（D-17）。巡礼カードは /me/:guestId（ランダム id、D-16）
ALTER TABLE guests ADD COLUMN start_temple INTEGER;  -- 1〜88
ALTER TABLE guests ADD COLUMN direction TEXT;        -- forward / reverse
ALTER TABLE guests ADD COLUMN start_date TEXT;       -- 最初の夜 YYYY-MM-DD
ALTER TABLE guests ADD COLUMN registered INTEGER NOT NULL DEFAULT 0; -- 1 = 利用者が自分で登録した（同行者の自動作成と区別）
