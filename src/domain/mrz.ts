// 旅券の機械読取欄（MRZ, ICAO Doc 9303）のチェックディジット。Claude の読み取り結果をコードで検算する（D-06, D-16）。

const WEIGHTS = [7, 3, 1];

export function mrzCheckDigit(s: string): number {
  let total = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    let v = 0;
    if (c >= "0" && c <= "9") v = c.charCodeAt(0) - 48;
    else if (c >= "A" && c <= "Z") v = c.charCodeAt(0) - 55;
    else v = 0; // '<'
    total += v * WEIGHTS[i % 3];
  }
  return total % 10;
}

export type MrzCheck = {
  documentNumber: string;
  documentNumberOk: boolean;
  issuingCountry: string;
  nationality: string;
  surname: string;
  givenNames: string;
  birthDateOk: boolean | null;
  expiryDateOk: boolean | null;
};

// TD3（旅券）の2行（各44文字）を検算する。読み取りミスがあれば ok が false になる。
export function verifyTd3(line1: string, line2: string): MrzCheck | null {
  const l1 = line1.trim().toUpperCase().replaceAll(" ", "<");
  const l2 = line2.trim().toUpperCase().replaceAll(" ", "<");
  if (l1.length !== 44 || l2.length !== 44) return null;
  const issuingCountry = l1.slice(2, 5).replaceAll("<", "");
  const names = l1.slice(5).split("<<");
  const surname = (names[0] ?? "").replaceAll("<", " ").trim();
  const givenNames = (names[1] ?? "").replaceAll("<", " ").trim();
  const docNo = l2.slice(0, 9);
  const docCd = Number(l2[9]);
  const nationality = l2.slice(10, 13).replaceAll("<", "");
  const birth = l2.slice(13, 19);
  const birthCd = l2[19];
  const expiry = l2.slice(21, 27);
  const expiryCd = l2[27];
  return {
    documentNumber: docNo.replaceAll("<", ""),
    documentNumberOk: mrzCheckDigit(docNo) === docCd,
    issuingCountry,
    nationality,
    surname,
    givenNames,
    birthDateOk: birth.includes("<") ? null : mrzCheckDigit(birth) === Number(birthCd),
    expiryDateOk: expiry.includes("<") ? null : mrzCheckDigit(expiry) === Number(expiryCd),
  };
}

// 見本の旅券（SPECIMEN）を作るときに使う。
export function buildTd3(args: { issuing: string; surname: string; given: string; number: string; nationality: string; birth: string; sex: string; expiry: string }): [string, string] {
  const pad = (s: string, n: number) => (s + "<".repeat(n)).slice(0, n);
  const name = `${args.surname.toUpperCase().replaceAll(" ", "<")}<<${args.given.toUpperCase().replaceAll(" ", "<")}`;
  const l1 = pad(`P<${args.issuing}${name}`, 44);
  const num = pad(args.number.toUpperCase(), 9);
  const personal = pad("", 14);
  const body = `${num}${mrzCheckDigit(num)}${args.nationality}${args.birth}${mrzCheckDigit(args.birth)}${args.sex}${args.expiry}${mrzCheckDigit(args.expiry)}${personal}${mrzCheckDigit(personal)}`;
  const composite = `${num}${mrzCheckDigit(num)}${args.birth}${mrzCheckDigit(args.birth)}${args.expiry}${mrzCheckDigit(args.expiry)}${personal}${mrzCheckDigit(personal)}`;
  const l2 = `${body}${mrzCheckDigit(composite)}`;
  return [l1, l2];
}
