#!/usr/bin/env bash
# qr-yado 印刷スクリプト（宿の機器用。デモでは Mac ＋ 手元のレーザー）
# 1分ごとに印刷待ちを取りに行き、A4 の PDF にして lpr で印刷する。宿主の操作はない（D-10）。
#
# 使い方:
#   export QR_YADO_URL=https://shikoku88.3utsu.com
#   export ADMIN_TOKEN=（Cloudflare に登録した合言葉）
#   export PRINTER=（lpstat -p で出るプリンター名。省略すると既定のプリンター）
#   export HOUSE_ID=h-kaizuka-1   # 省略すると全部の宿の分を印刷
#   bash scripts/print-agent.sh
#
# 必要なもの: Google Chrome（PDF 化）、lpr（macOS 標準）、curl、python3

set -u
: "${QR_YADO_URL:?QR_YADO_URL を設定してください}"
: "${ADMIN_TOKEN:?ADMIN_TOKEN を設定してください}"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
INTERVAL="${INTERVAL:-20}"
WORK="${TMPDIR:-/tmp}/qr-yado-print"
mkdir -p "$WORK"

if [ ! -x "$CHROME" ]; then echo "Google Chrome が見つかりません: $CHROME" >&2; exit 1; fi

echo "qr-yado 印刷スクリプト: $QR_YADO_URL （${INTERVAL}秒ごと）"
while true; do
  q="$QR_YADO_URL/api/print/queue"
  [ -n "${HOUSE_ID:-}" ] && q="$q?house=$HOUSE_ID"
  jobs=$(curl -sS -m 20 -H "Authorization: Bearer $ADMIN_TOKEN" "$q" 2>/dev/null | python3 -c 'import json,sys
try:
    d=json.load(sys.stdin)
    for j in d.get("jobs",[]): print(j["id"], j["kind"], j.get("print_no") or "-")
except Exception: pass')
  while read -r id kind no; do
    [ -z "$id" ] && continue
    echo "$(date '+%H:%M:%S') 印刷 $kind $no ($id)"
    curl -sS -m 10 -X POST -H "Authorization: Bearer $ADMIN_TOKEN" "$QR_YADO_URL/api/print/$id/printing" >/dev/null
    pdf="$WORK/$id.pdf"
    "$CHROME" --headless=new --disable-gpu --no-pdf-header-footer --print-to-pdf="$pdf" --virtual-time-budget=8000 \
      "$QR_YADO_URL/print/$id?token=$ADMIN_TOKEN" >/dev/null 2>&1
    if [ -s "$pdf" ]; then
      if lpr ${PRINTER:+-P "$PRINTER"} -o media=A4 "$pdf"; then
        curl -sS -m 10 -X POST -H "Authorization: Bearer $ADMIN_TOKEN" "$QR_YADO_URL/api/print/$id/done" >/dev/null
        echo "  → 印刷しました"
      else
        curl -sS -m 10 -X POST -H "Authorization: Bearer $ADMIN_TOKEN" "$QR_YADO_URL/api/print/$id/failed" >/dev/null
        echo "  → lpr に失敗" >&2
      fi
    else
      curl -sS -m 10 -X POST -H "Authorization: Bearer $ADMIN_TOKEN" "$QR_YADO_URL/api/print/$id/failed" >/dev/null
      echo "  → PDF を作れませんでした" >&2
    fi
  done <<< "$jobs"
  sleep "$INTERVAL"
done
