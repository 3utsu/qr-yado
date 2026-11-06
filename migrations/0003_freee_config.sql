-- 事業主ごとの freee の設定（勘定科目・税区分・決済口座）。JSON。空なら既定値（D-23）
ALTER TABLE operators ADD COLUMN freee_config TEXT;
