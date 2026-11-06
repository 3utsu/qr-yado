import { describe, expect, it } from "vitest";
import { canAcceptNight, pickDuty } from "../src/domain/duty";
import { monthlyPayroll } from "../src/domain/payroll";
import { monthlyLedger } from "../src/domain/ledger";
import { buildFreeeRows, FREEE_HEADERS, toFreeeCsv } from "../src/domain/freee";
import { buildTd3, mrzCheckDigit, verifyTd3 } from "../src/domain/mrz";
import { firstKana, isKatakanaName } from "../src/domain/kana";
import { canAddNight, cap180Status } from "../src/domain/cap180";
import { periodicReport, reportPeriodFor } from "../src/domain/report";
import { addDays, datesOfMonth, formatJa, minpakuYearOf } from "../src/lib/dates";

const staff = [
  { id: "s-a", name: "樋口一葉", daily_wage: 3000 },
  { id: "s-b", name: "与謝野晶子", daily_wage: 3000 },
  { id: "s-c", name: "津田梅子", daily_wage: 3500 },
];

describe("当番の割当（D-22）", () => {
  it("予定○の要員がいなければ当番は決まらない", () => {
    expect(pickDuty([], {})).toBeNull();
  });
  it("その月の当番回数が少ない人を選ぶ", () => {
    expect(pickDuty(staff, { "s-a": 3, "s-b": 1, "s-c": 2 })?.id).toBe("s-b");
  });
  it("同数なら登録順（id順）", () => {
    expect(pickDuty(staff, {})?.id).toBe("s-a");
  });
  it("要員がいない夜は予約を受けない。布団の数も超えない", () => {
    expect(canAcceptNight(0, 6, 0, 1)).toBe(false);
    expect(canAcceptNight(1, 6, 5, 1)).toBe(true);
    expect(canAcceptNight(1, 6, 5, 2)).toBe(false);
  });
});

describe("給与と帳簿（D-22, D-15）", () => {
  const duties = [
    { date: "2026-11-09", staff_id: "s-a" },
    { date: "2026-11-10", staff_id: "s-a" },
    { date: "2026-11-16", staff_id: "s-c" },
    { date: "2026-12-01", staff_id: "s-a" }, // 別の月
  ];
  it("当番の回数 × 日当。当番がない人は載らない", () => {
    const p = monthlyPayroll(duties, staff, "2026-11");
    expect(p.lines.map((l) => [l.staff.id, l.days, l.amount])).toEqual([["s-a", 2, 6000], ["s-c", 1, 3500]]);
    expect(p.total).toBe(9500);
  });
  it("帳簿：収入 − 寄付 − 給与 = お財布に残る", () => {
    const paid = [
      { date: "2026-11-09", price: 5000, donation: 500, paid_at: "2026-11-09T18:00:00+09:00", guest_name: "A", house_label: "Kaizuka #1" },
      { date: "2026-11-09", price: 5000, donation: 500, paid_at: "2026-11-09T18:00:00+09:00", guest_name: "B", house_label: "Kaizuka #1" },
      { date: "2026-10-31", price: 5000, donation: 500, paid_at: "2026-10-31T18:00:00+09:00", guest_name: "C", house_label: "Kaizuka #1" },
    ];
    const l = monthlyLedger("2026-11", paid, 9500);
    expect(l.nights).toBe(2);
    expect(l.income).toBe(10000);
    expect(l.donations).toBe(1000);
    expect(l.balance).toBe(10000 - 1000 - 9500);
  });
});

describe("freee 取引インポート CSV（D-23）", () => {
  it("ヘッダーは freee の列順で、収入は1泊1行、給与は要員ごとに1行", () => {
    const rows = buildFreeeRows(
      "2026-11",
      [{ date: "2026-11-09", price: 5000, paid_at: "2026-11-09T18:00:00+09:00", guest_name: "Winston Churchill", house_label: "Kaizuka #1", booking_id: "bk_1" }],
      [{ staff: { id: "s-a", name: "樋口一葉" }, days: 2, amount: 6000 }],
    );
    const csv = toFreeeCsv(rows);
    const lines = csv.replace("﻿", "").trim().split("\r\n");
    expect(lines[0]).toBe(FREEE_HEADERS.join(","));
    expect(lines[0].split(",")[0]).toBe("収支区分");
    expect(lines[1]).toContain("収入,bk_1,2026/11/09,,,Winston Churchill,売上高,課税売上10%,5000");
    expect(lines[1]).toContain(",2026/11/09,現金,5000");
    expect(lines[2]).toContain("支出,wage-2026-11-s-a,2026/11/30,,,樋口一葉,給料賃金,対象外,6000");
    expect(lines).toHaveLength(3);
  });
  it("カンマや引用符を含む値は引用する", () => {
    const csv = toFreeeCsv([{ kind: "収入", ref: "x", date: "2026-11-01", partner: 'A, "B"', account: "売上高", tax: "課税売上10%", amount: 1, memo: "" }]);
    expect(csv).toContain('"A, ""B"""');
  });
});

describe("旅券の機械読取欄（ICAO 9303）", () => {
  it("チェックディジットの例（仕様書の例 L898902C3 → 6）", () => {
    expect(mrzCheckDigit("L898902C3")).toBe(6);
  });
  it("見本を作って検算できる", () => {
    const [l1, l2] = buildTd3({ issuing: "UTO", surname: "CHURCHILL", given: "WINSTON", number: "TEST00101", nationality: "UTO", birth: "741130", sex: "M", expiry: "301130" });
    expect(l1).toHaveLength(44);
    expect(l2).toHaveLength(44);
    const r = verifyTd3(l1, l2)!;
    expect(r.documentNumber).toBe("TEST00101");
    expect(r.documentNumberOk).toBe(true);
    expect(r.surname).toBe("CHURCHILL");
    expect(r.givenNames).toBe("WINSTON");
    expect(r.issuingCountry).toBe("UTO");
    expect(r.birthDateOk).toBe(true);
    expect(r.expiryDateOk).toBe(true);
  });
  it("読み違い（1文字）を検出する", () => {
    const [l1, l2] = buildTd3({ issuing: "UTO", surname: "CHURCHILL", given: "WINSTON", number: "TEST00101", nationality: "UTO", birth: "741130", sex: "M", expiry: "301130" });
    const bad = "TEST00107" + l2.slice(9);
    expect(verifyTd3(l1, bad)!.documentNumberOk).toBe(false);
  });
});

describe("カタカナ読み（D-12）", () => {
  it("カタカナ・長音・中黒だけを許す", () => {
    expect(isKatakanaName("ウィンストン・チャーチル")).toBe(true);
    expect(isKatakanaName("ヨープ・デン・アイル")).toBe(true);
    expect(isKatakanaName("Winston")).toBe(false);
    expect(isKatakanaName("うぃんすとん")).toBe(false);
    expect(isKatakanaName("")).toBe(false);
  });
  it("紙の見出しは名の部分だけ", () => {
    expect(firstKana("ウィンストン・チャーチル")).toBe("ウィンストン");
  });
});

describe("年180日の上限", () => {
  it("4月始まりの年度で、宿泊者がいた夜を数える", () => {
    expect(minpakuYearOf("2026-03-31")).toBe("2025");
    expect(minpakuYearOf("2026-04-01")).toBe("2026");
    const dates = ["2026-04-01", "2026-04-01", "2026-04-02", "2026-03-30"];
    const s = cap180Status(dates, "2026");
    expect(s.used).toBe(2);
    expect(s.remaining).toBe(178);
  });
  it("上限に達したら新しい夜は足せないが、既に宿泊がある夜は足せる", () => {
    const dates = datesOfMonth("2026-04").concat(datesOfMonth("2026-05")).concat(datesOfMonth("2026-06")).concat(datesOfMonth("2026-07")).concat(datesOfMonth("2026-08")).concat(datesOfMonth("2026-09")).slice(0, 180);
    expect(canAddNight(dates, "2026-10-01")).toBe(false);
    expect(canAddNight(dates, dates[0])).toBe(true);
  });
});

describe("定期報告（2か月ごと）", () => {
  it("期間は偶数月始まり", () => {
    expect(reportPeriodFor("2026-11-06")).toEqual({ from: "2026-10-01", to: "2026-11-30" });
    expect(reportPeriodFor("2027-01-15")).toEqual({ from: "2026-12-01", to: "2027-01-31" });
  });
  it("宿泊日数・宿泊者数・延べ宿泊者数・国籍別", () => {
    const stays = [
      { guest_id: "g1", date: "2026-10-01", nationality: "GBR" },
      { guest_id: "g1", date: "2026-10-02", nationality: "GBR" },
      { guest_id: "g2", date: "2026-10-02", nationality: "FRA" },
      { guest_id: "g3", date: "2026-12-01", nationality: "FRA" },
    ];
    const r = periodicReport(stays, "2026-10-01", "2026-11-30");
    expect(r.nightsOperated).toBe(2);
    expect(r.guests).toBe(2);
    expect(r.personNights).toBe(3);
    expect(r.byNationality).toEqual([
      { nationality: "GBR", personNights: 2, guests: 1 },
      { nationality: "FRA", personNights: 1, guests: 1 },
    ]);
  });
});

describe("日付", () => {
  it("加算と日本語表記", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(formatJa("2026-12-09")).toBe("2026年12月9日（水）");
  });
});
