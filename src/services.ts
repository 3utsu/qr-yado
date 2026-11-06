// 予約・当番・チェックイン・印刷待ちをつなぐ処理。判断の規則は domain/ の関数を使う。
import { Db, type Booking, type Guest, type House } from "./db";
import { canAcceptNight, pickDuty, type StaffLite } from "./domain/duty";
import { canAddNight } from "./domain/cap180";
import { newId, printNumber } from "./lib/id";
import { addDays, monthOf, nowJstIso } from "./lib/dates";

export type NightStatus = { date: string; staff: number; booked: number; privateBooked: number; capacity: number; beds: number; state: "open" | "full" | "closed" | "cap" };

export async function nightsOfHouse(db: Db, house: House, from: string, days: number, bookingDates?: string[]): Promise<NightStatus[]> {
  const to = addDays(from, days - 1);
  const [staff, booked] = await Promise.all([db.availableCounts(house.id, from, to), db.bookedCounts(house.id, from, to)]);
  const dates = bookingDates ?? (await db.bookingDatesOfHouse(house.id));
  const out: NightStatus[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(from, i);
    const s = staff[date] ?? 0;
    const b = booked[date]?.n ?? 0;
    const p = booked[date]?.private ?? 0;
    let state: NightStatus["state"] = "open";
    if (house.status !== "open" || s === 0) state = "closed";
    else if (!canAddNight(dates, date)) state = "cap";
    else if (b >= house.capacity || p > 0) state = "full";
    out.push({ date, staff: s, booked: b, privateBooked: p, capacity: house.capacity, beds: Math.max(0, house.capacity - b), state });
  }
  return out;
}

export async function ensureDuty(db: Db, house: House, date: string): Promise<StaffLite | null> {
  const existing = await db.duty(house.id, date);
  const avail = await db.availableStaff(house.id, date);
  if (existing && avail.some((s) => s.id === existing.staff_id)) return avail.find((s) => s.id === existing.staff_id)!;
  const counts = await db.dutyCountsForMonth(house.operator_id, monthOf(date));
  const pick = pickDuty(avail, counts);
  if (!pick) {
    if (existing) await db.clearDuty(house.id, date);
    return null;
  }
  await db.setDuty(house.id, date, pick.id);
  return pick;
}

// 予定が変わったら、その月の当番を見直す（宿泊のある夜だけ）
export async function recomputeDuties(db: Db, operatorId: string, month: string) {
  const houses = await db.housesOf(operatorId);
  for (const h of houses) {
    const booked = await db.bookedCounts(h.id, `${month}-01`, `${month}-31`);
    const duties = await db.dutiesOf(h.id, month);
    for (const d of duties) if (!booked[d.date]) await db.clearDuty(h.id, d.date);
    for (const date of Object.keys(booked)) await ensureDuty(db, h, date);
  }
}

export type BookingRequest = { date: string; names: string[]; room_type: "shared" | "private"; direction: "forward" | "reverse"; language: string };

export async function createBooking(db: Db, house: House, req: BookingRequest): Promise<{ ok: true; partyId: string; bookings: Booking[] } | { ok: false; reason: string }> {
  const [night] = await nightsOfHouse(db, house, req.date, 1);
  const party = req.names.length;
  if (night.state === "closed" || night.state === "cap") return { ok: false, reason: night.state };
  if (req.room_type === "private" && night.booked > 0) return { ok: false, reason: "full" };
  if (!canAcceptNight(night.staff, house.capacity, night.booked, party)) return { ok: false, reason: "full" };
  const partyId = newId("pt", 8);
  const bookings: Booking[] = [];
  for (const name of req.names) {
    const guestId = newId("g");
    await db.insertGuest({ id: guestId, name, language: req.language });
    const b: Omit<Booking, "created_at"> = {
      id: newId("bk"), house_id: house.id, guest_id: guestId, date: req.date, room_type: req.room_type, party_id: partyId,
      direction: req.direction, price: house.price, donation: house.donation, status: "booked",
    };
    await db.insertBooking(b);
    bookings.push({ ...b, created_at: nowJstIso() });
  }
  await ensureDuty(db, house, req.date);
  return { ok: true, partyId, bookings };
}

export type CheckinFields = {
  name: string; name_kana: string | null; nationality: string | null; passport_no: string | null; passport_country: string | null;
  address: string | null; occupation: string | null; note: string | null; note_ja: string | null; consent_photo_on_paper: boolean;
};

// チェックイン完了：名簿に載せ、印刷待ちに入れる（1人1泊1枚：一意制約で守る）
export async function completeCheckin(db: Db, booking: Booking, guest: Guest, f: CheckinFields): Promise<{ printJobId: string; printNo: string }> {
  const now = nowJstIso();
  await db.updateGuest(guest.id, {
    name: f.name, name_kana: f.name_kana, nationality: f.nationality, passport_no: f.passport_no, passport_country: f.passport_country,
    address: f.address, occupation: f.occupation, note: f.note, note_ja: f.note_ja, consent_photo_on_paper: f.consent_photo_on_paper ? 1 : 0,
  });
  await db.insertRegister({
    id: newId("rg"), booking_id: booking.id, house_id: booking.house_id, date: booking.date, name: f.name, address: f.address, occupation: f.occupation,
    nationality: f.nationality, passport_no: f.passport_no, passport_country: f.passport_country, checked_in_at: now,
  });
  await db.setBookingStatus(booking.id, "checked_in");
  const existing = await db.printJobByRef("checkin", booking.id);
  if (existing) return { printJobId: existing.id, printNo: existing.print_no ?? "" };
  const seq = await db.nextPrintSeq(booking.date);
  const printNo = printNumber(booking.date, seq);
  const id = newId("pj");
  await db.enqueuePrint({ id, house_id: booking.house_id, kind: "checkin", ref_id: booking.id, print_no: printNo });
  return { printJobId: id, printNo };
}

export async function markPaid(db: Db, booking: Booking) {
  await db.insertPayment(booking.id, booking.price, nowJstIso());
  await db.setBookingStatus(booking.id, "paid");
}

export async function enqueueSchedulePrint(db: Db, houseId: string, staffId: string, month: string): Promise<string> {
  const ref = `${staffId}:${month}`;
  const existing = await db.printJobByRef("schedule", ref);
  if (existing) {
    await db.setPrintStatus(existing.id, "queued", null);
    return existing.id;
  }
  const id = newId("pj");
  await db.enqueuePrint({ id, house_id: houseId, kind: "schedule", ref_id: ref, print_no: null });
  return id;
}

export async function enqueueLedgerPrint(db: Db, houseId: string, operatorId: string, month: string): Promise<string> {
  const ref = `${operatorId}:${month}`;
  const existing = await db.printJobByRef("ledger", ref);
  if (existing) {
    await db.setPrintStatus(existing.id, "queued", null);
    return existing.id;
  }
  const id = newId("pj");
  await db.enqueuePrint({ id, house_id: houseId, kind: "ledger", ref_id: ref, print_no: null });
  return id;
}
