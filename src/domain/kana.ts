// カタカナ読み（D-12）：Claude が作った読みを、文字種で検証する。

const KATAKANA = /^[゠-ヿー・　 ]+$/;

export function isKatakanaName(s: string): boolean {
  const t = s.trim();
  return t.length > 0 && t.length <= 40 && KATAKANA.test(t);
}

// 紙の見出しに使う呼び名：「ウィンストン・チャーチル」→「ウィンストン」
export function firstKana(kana: string): string {
  return kana.split(/[・\s　]/)[0] ?? kana;
}

// 読みが使えないときの予備：ローマ字をそのまま大きく出す
export function displayName(name: string, kana: string | null | undefined): { kana: string | null; latin: string } {
  return { kana: kana && isKatakanaName(kana) ? kana : null, latin: name };
}
