// ランダムな ID（旅券番号などの個人情報は主キーにしない：D-16）
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"; // 読み間違えやすい文字を除く

export function newId(prefix: string, len = 12): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let s = "";
  for (const b of bytes) s += ALPHABET[b % ALPHABET.length];
  return `${prefix}_${s}`;
}

// 印刷番号：P-YYYYMMDD-NNNN（紙に載せる。同じ番号は二度と印刷しない：D-11）
export function printNumber(date: string, seq: number): string {
  return `P-${date.replaceAll("-", "")}-${String(seq).padStart(4, "0")}`;
}
