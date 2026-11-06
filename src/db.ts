// D1 へのアクセス。SQL はここに集める。計算はしない（domain/ で行う）。
import { nowJstIso } from "./lib/dates";

export type Operator = { id: string; name: string; kind: string; freee_config?: string | null };
export type House = {
  id: string; operator_id: string; municipality_code: string; community: string; seq: number; label: string;
  lat: number | null; lng: number | null; section_id: number | null; capacity: number; price: number; donation: number; status: string;
  guide_ja: string | null; rules_ja: string | null;
};
export type Staff = { id: string; operator_id: string; name: string; daily_wage: number; active: number };
export type Guest = {
  id: string; name: string; name_kana: string | null; nationality: string | null; language: string | null; occupation: string | null;
  address: string | null; passport_no: string | null; passport_country: string | null; photo_key: string | null; passport_image_key: string | null;
  consent_photo_on_paper: number; note: string | null; note_ja: string | null;
};
export type Booking = {
  id: string; house_id: string; guest_id: string; date: string; room_type: string; party_id: string | null; direction: string;
  price: number; donation: number; status: string; created_at: string;
};
export type Duty = { house_id: string; date: string; staff_id: string };
export type PrintJob = { id: string; house_id: string; kind: string; ref_id: string | null; status: string; created_at: string; printed_at: string | null; print_no: string | null };

export class Db {
  constructor(private d1: D1Database) {}

  // --- 事業主・宿 ---
  async operators(): Promise<Operator[]> {
    return (await this.d1.prepare("SELECT * FROM operators ORDER BY name").all<Operator>()).results;
  }
  async operator(id: string): Promise<Operator | null> {
    return (await this.d1.prepare("SELECT * FROM operators WHERE id=?").bind(id).first<Operator>()) ?? null;
  }
  async houses(): Promise<House[]> {
    return (await this.d1.prepare("SELECT * FROM houses ORDER BY label").all<House>()).results;
  }
  async housesOf(operatorId: string): Promise<House[]> {
    return (await this.d1.prepare("SELECT * FROM houses WHERE operator_id=? ORDER BY label").bind(operatorId).all<House>()).results;
  }
  async house(id: string): Promise<House | null> {
    return (await this.d1.prepare("SELECT * FROM houses WHERE id=?").bind(id).first<House>()) ?? null;
  }
  async updateOperatorFreee(id: string, json: string) {
    await this.d1.prepare("UPDATE operators SET freee_config=? WHERE id=?").bind(json, id).run();
  }
  async updateHouseGuide(id: string, guideJa: string, rulesJa: string) {
    await this.d1.prepare("UPDATE houses SET guide_ja=?, rules_ja=? WHERE id=?").bind(guideJa, rulesJa, id).run();
    await this.d1.prepare("DELETE FROM house_guides WHERE house_id=?").bind(id).run();
  }

  // --- 要員・予定 ---
  async staffOf(operatorId: string): Promise<Staff[]> {
    return (await this.d1.prepare("SELECT * FROM staff WHERE operator_id=? AND active=1 ORDER BY created_at, id").bind(operatorId).all<Staff>()).results;
  }
  async addStaff(s: { id: string; operator_id: string; name: string; daily_wage: number }) {
    await this.d1.prepare("INSERT INTO staff (id, operator_id, name, daily_wage) VALUES (?,?,?,?)").bind(s.id, s.operator_id, s.name, s.daily_wage).run();
  }
  async setStaffWage(id: string, wage: number) {
    await this.d1.prepare("UPDATE staff SET daily_wage=? WHERE id=?").bind(wage, id).run();
  }
  async scheduleOf(operatorId: string, month: string): Promise<{ staff_id: string; date: string; available: number }[]> {
    return (
      await this.d1
        .prepare("SELECT ss.staff_id, ss.date, ss.available FROM staff_schedule ss JOIN staff s ON s.id=ss.staff_id WHERE s.operator_id=? AND ss.date LIKE ?")
        .bind(operatorId, `${month}-%`)
        .all<{ staff_id: string; date: string; available: number }>()
    ).results;
  }
  async setAvailable(staffId: string, date: string, available: boolean) {
    await this.d1
      .prepare("INSERT INTO staff_schedule (staff_id, date, available) VALUES (?,?,?) ON CONFLICT(staff_id, date) DO UPDATE SET available=excluded.available")
      .bind(staffId, date, available ? 1 : 0)
      .run();
  }
  // その夜に予定○の要員（宿の事業主に属する人）
  async availableStaff(houseId: string, date: string): Promise<Staff[]> {
    return (
      await this.d1
        .prepare(
          "SELECT s.* FROM staff s JOIN houses h ON h.operator_id=s.operator_id JOIN staff_schedule ss ON ss.staff_id=s.id AND ss.date=? AND ss.available=1 WHERE h.id=? AND s.active=1 ORDER BY s.created_at, s.id",
        )
        .bind(date, houseId)
        .all<Staff>()
    ).results;
  }
  async availableCounts(houseId: string, from: string, to: string): Promise<Record<string, number>> {
    const rows = (
      await this.d1
        .prepare(
          "SELECT ss.date, COUNT(*) AS n FROM staff s JOIN houses h ON h.operator_id=s.operator_id JOIN staff_schedule ss ON ss.staff_id=s.id AND ss.available=1 WHERE h.id=? AND s.active=1 AND ss.date BETWEEN ? AND ? GROUP BY ss.date",
        )
        .bind(houseId, from, to)
        .all<{ date: string; n: number }>()
    ).results;
    return Object.fromEntries(rows.map((r) => [r.date, r.n]));
  }

  // --- 当番 ---
  async dutiesOf(houseId: string, month: string): Promise<Duty[]> {
    return (await this.d1.prepare("SELECT * FROM duties WHERE house_id=? AND date LIKE ?").bind(houseId, `${month}-%`).all<Duty>()).results;
  }
  async dutiesOfOperator(operatorId: string, month: string): Promise<(Duty & { house_label: string })[]> {
    return (
      await this.d1
        .prepare("SELECT d.*, h.label AS house_label FROM duties d JOIN houses h ON h.id=d.house_id WHERE h.operator_id=? AND d.date LIKE ?")
        .bind(operatorId, `${month}-%`)
        .all<Duty & { house_label: string }>()
    ).results;
  }
  async duty(houseId: string, date: string): Promise<(Duty & { name: string; daily_wage: number }) | null> {
    return (
      (await this.d1
        .prepare("SELECT d.*, s.name, s.daily_wage FROM duties d JOIN staff s ON s.id=d.staff_id WHERE d.house_id=? AND d.date=?")
        .bind(houseId, date)
        .first<Duty & { name: string; daily_wage: number }>()) ?? null
    );
  }
  async setDuty(houseId: string, date: string, staffId: string) {
    await this.d1
      .prepare("INSERT INTO duties (house_id, date, staff_id) VALUES (?,?,?) ON CONFLICT(house_id, date) DO UPDATE SET staff_id=excluded.staff_id")
      .bind(houseId, date, staffId)
      .run();
  }
  async clearDuty(houseId: string, date: string) {
    await this.d1.prepare("DELETE FROM duties WHERE house_id=? AND date=?").bind(houseId, date).run();
  }
  async dutyCountsForMonth(operatorId: string, month: string): Promise<Record<string, number>> {
    const rows = (
      await this.d1
        .prepare("SELECT d.staff_id, COUNT(*) AS n FROM duties d JOIN houses h ON h.id=d.house_id WHERE h.operator_id=? AND d.date LIKE ? GROUP BY d.staff_id")
        .bind(operatorId, `${month}-%`)
        .all<{ staff_id: string; n: number }>()
    ).results;
    return Object.fromEntries(rows.map((r) => [r.staff_id, r.n]));
  }

  // --- 宿泊者・予約 ---
  async guest(id: string): Promise<Guest | null> {
    return (await this.d1.prepare("SELECT * FROM guests WHERE id=?").bind(id).first<Guest>()) ?? null;
  }
  async insertGuest(g: { id: string; name: string; language: string | null; nationality?: string | null }) {
    await this.d1.prepare("INSERT INTO guests (id, name, language, nationality) VALUES (?,?,?,?)").bind(g.id, g.name, g.language, g.nationality ?? null).run();
  }
  async updateGuest(id: string, f: Partial<Omit<Guest, "id">>) {
    const keys = Object.keys(f) as (keyof typeof f)[];
    if (keys.length === 0) return;
    const sets = keys.map((k) => `${k}=?`).join(", ");
    await this.d1.prepare(`UPDATE guests SET ${sets} WHERE id=?`).bind(...keys.map((k) => f[k] ?? null), id).run();
  }
  async booking(id: string): Promise<Booking | null> {
    return (await this.d1.prepare("SELECT * FROM bookings WHERE id=?").bind(id).first<Booking>()) ?? null;
  }
  async bookingsOfParty(partyId: string): Promise<(Booking & { guest_name: string })[]> {
    return (
      await this.d1
        .prepare("SELECT b.*, g.name AS guest_name FROM bookings b JOIN guests g ON g.id=b.guest_id WHERE b.party_id=? ORDER BY b.created_at, b.id")
        .bind(partyId)
        .all<Booking & { guest_name: string }>()
    ).results;
  }
  async insertBooking(b: Omit<Booking, "created_at">) {
    await this.d1
      .prepare("INSERT INTO bookings (id, house_id, guest_id, date, room_type, party_id, direction, price, donation, status) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .bind(b.id, b.house_id, b.guest_id, b.date, b.room_type, b.party_id, b.direction, b.price, b.donation, b.status)
      .run();
  }
  async setBookingStatus(id: string, status: string) {
    await this.d1.prepare("UPDATE bookings SET status=? WHERE id=?").bind(status, id).run();
  }
  async bookedCounts(houseId: string, from: string, to: string): Promise<Record<string, { n: number; private: number }>> {
    const rows = (
      await this.d1
        .prepare("SELECT date, COUNT(*) AS n, SUM(CASE WHEN room_type='private' THEN 1 ELSE 0 END) AS p FROM bookings WHERE house_id=? AND status!='cancelled' AND date BETWEEN ? AND ? GROUP BY date")
        .bind(houseId, from, to)
        .all<{ date: string; n: number; p: number }>()
    ).results;
    return Object.fromEntries(rows.map((r) => [r.date, { n: r.n, private: r.p }]));
  }
  async bookingsOfHouseNight(houseId: string, date: string): Promise<(Booking & { guest_name: string; name_kana: string | null; nationality: string | null })[]> {
    return (
      await this.d1
        .prepare("SELECT b.*, g.name AS guest_name, g.name_kana, g.nationality FROM bookings b JOIN guests g ON g.id=b.guest_id WHERE b.house_id=? AND b.date=? AND b.status!='cancelled' ORDER BY b.created_at")
        .bind(houseId, date)
        .all<Booking & { guest_name: string; name_kana: string | null; nationality: string | null }>()
    ).results;
  }
  async bookingDatesOfHouse(houseId: string): Promise<string[]> {
    return (await this.d1.prepare("SELECT DISTINCT date FROM bookings WHERE house_id=? AND status!='cancelled'").bind(houseId).all<{ date: string }>()).results.map((r) => r.date);
  }
  async upcomingBookingsOfOperator(operatorId: string, from: string, to: string) {
    return (
      await this.d1
        .prepare(
          "SELECT b.*, g.name AS guest_name, g.name_kana, g.nationality, h.label AS house_label FROM bookings b JOIN guests g ON g.id=b.guest_id JOIN houses h ON h.id=b.house_id WHERE h.operator_id=? AND b.status!='cancelled' AND b.date BETWEEN ? AND ? ORDER BY b.date, h.label, b.created_at",
        )
        .bind(operatorId, from, to)
        .all<Booking & { guest_name: string; name_kana: string | null; nationality: string | null; house_label: string }>()
    ).results;
  }

  // --- 名簿・受領 ---
  async insertRegister(r: {
    id: string; booking_id: string; house_id: string; date: string; name: string; address: string | null; occupation: string | null;
    nationality: string | null; passport_no: string | null; passport_country: string | null; checked_in_at: string;
  }) {
    await this.d1
      .prepare(
        "INSERT INTO register_entries (id, booking_id, house_id, date, name, address, occupation, nationality, passport_no, passport_country, checked_in_at) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(booking_id) DO UPDATE SET name=excluded.name, address=excluded.address, occupation=excluded.occupation, nationality=excluded.nationality, passport_no=excluded.passport_no, passport_country=excluded.passport_country",
      )
      .bind(r.id, r.booking_id, r.house_id, r.date, r.name, r.address, r.occupation, r.nationality, r.passport_no, r.passport_country, r.checked_in_at)
      .run();
  }
  async setRulesConsent(bookingId: string, at: string) {
    await this.d1.prepare("UPDATE register_entries SET consent_rules_at=? WHERE booking_id=?").bind(at, bookingId).run();
  }
  async registerOfOperator(operatorId: string, from: string, to: string) {
    return (
      await this.d1
        .prepare(
          "SELECT r.*, h.label AS house_label, b.guest_id FROM register_entries r JOIN houses h ON h.id=r.house_id JOIN bookings b ON b.id=r.booking_id WHERE h.operator_id=? AND r.date BETWEEN ? AND ? ORDER BY r.date, h.label, r.checked_in_at",
        )
        .bind(operatorId, from, to)
        .all<{
          id: string; booking_id: string; house_id: string; date: string; name: string; address: string | null; occupation: string | null;
          nationality: string | null; passport_no: string | null; passport_country: string | null; checked_in_at: string; consent_rules_at: string | null; house_label: string; guest_id: string;
        }>()
    ).results;
  }
  async staysOfOperator(operatorId: string, from: string, to: string): Promise<{ guest_id: string; date: string; nationality: string | null; house_id: string }[]> {
    return (
      await this.d1
        .prepare("SELECT b.guest_id, b.date, r.nationality, b.house_id FROM register_entries r JOIN bookings b ON b.id=r.booking_id JOIN houses h ON h.id=b.house_id WHERE h.operator_id=? AND b.date BETWEEN ? AND ?")
        .bind(operatorId, from, to)
        .all<{ guest_id: string; date: string; nationality: string | null; house_id: string }>()
    ).results;
  }
  async insertPayment(bookingId: string, amount: number, paidAt: string) {
    await this.d1.prepare("INSERT OR IGNORE INTO payments (booking_id, amount, method, paid_at) VALUES (?,?,'cash',?)").bind(bookingId, amount, paidAt).run();
  }
  async payment(bookingId: string): Promise<{ amount: number; paid_at: string } | null> {
    return (await this.d1.prepare("SELECT amount, paid_at FROM payments WHERE booking_id=?").bind(bookingId).first<{ amount: number; paid_at: string }>()) ?? null;
  }
  async paidOfOperator(operatorId: string, month: string) {
    return (
      await this.d1
        .prepare(
          "SELECT b.id AS booking_id, b.date, b.price, b.donation, p.paid_at, g.name AS guest_name, h.label AS house_label FROM payments p JOIN bookings b ON b.id=p.booking_id JOIN guests g ON g.id=b.guest_id JOIN houses h ON h.id=b.house_id WHERE h.operator_id=? AND b.date LIKE ? ORDER BY b.date, b.created_at",
        )
        .bind(operatorId, `${month}-%`)
        .all<{ booking_id: string; date: string; price: number; donation: number; paid_at: string; guest_name: string; house_label: string }>()
    ).results;
  }

  // --- 印刷待ち ---
  async enqueuePrint(j: { id: string; house_id: string; kind: string; ref_id: string; print_no: string | null }): Promise<boolean> {
    const r = await this.d1
      .prepare("INSERT OR IGNORE INTO print_jobs (id, house_id, kind, ref_id, print_no, created_at) VALUES (?,?,?,?,?,?)")
      .bind(j.id, j.house_id, j.kind, j.ref_id, j.print_no, nowJstIso())
      .run();
    return (r.meta.changes ?? 0) > 0;
  }
  async printJob(id: string): Promise<PrintJob | null> {
    return (await this.d1.prepare("SELECT * FROM print_jobs WHERE id=?").bind(id).first<PrintJob>()) ?? null;
  }
  async printJobByRef(kind: string, refId: string): Promise<PrintJob | null> {
    return (await this.d1.prepare("SELECT * FROM print_jobs WHERE kind=? AND ref_id=?").bind(kind, refId).first<PrintJob>()) ?? null;
  }
  async queuedJobs(houseId: string | null): Promise<PrintJob[]> {
    const q = houseId
      ? this.d1.prepare("SELECT * FROM print_jobs WHERE status='queued' AND house_id=? ORDER BY created_at").bind(houseId)
      : this.d1.prepare("SELECT * FROM print_jobs WHERE status='queued' ORDER BY created_at");
    return (await q.all<PrintJob>()).results;
  }
  async recentJobsOfOperator(operatorId: string, limit = 30): Promise<(PrintJob & { house_label: string })[]> {
    return (
      await this.d1
        .prepare("SELECT p.*, h.label AS house_label FROM print_jobs p JOIN houses h ON h.id=p.house_id WHERE h.operator_id=? ORDER BY p.created_at DESC LIMIT ?")
        .bind(operatorId, limit)
        .all<PrintJob & { house_label: string }>()
    ).results;
  }
  async setPrintStatus(id: string, status: string, printedAt: string | null) {
    await this.d1.prepare("UPDATE print_jobs SET status=?, printed_at=COALESCE(?, printed_at) WHERE id=?").bind(status, printedAt, id).run();
  }
  async nextPrintSeq(date: string): Promise<number> {
    const r = await this.d1.prepare("SELECT COUNT(*) AS n FROM print_jobs WHERE print_no LIKE ?").bind(`P-${date.replaceAll("-", "")}-%`).first<{ n: number }>();
    return (r?.n ?? 0) + 1;
  }

  // --- 宿の案内（Claude の翻訳をキャッシュ） ---
  async houseGuide(houseId: string, lang: string): Promise<string | null> {
    const r = await this.d1.prepare("SELECT text FROM house_guides WHERE house_id=? AND lang=?").bind(houseId, lang).first<{ text: string }>();
    return r?.text ?? null;
  }
  async setHouseGuide(houseId: string, lang: string, text: string) {
    await this.d1
      .prepare("INSERT INTO house_guides (house_id, lang, text) VALUES (?,?,?) ON CONFLICT(house_id, lang) DO UPDATE SET text=excluded.text, updated_at=datetime('now')")
      .bind(houseId, lang, text)
      .run();
  }
}
