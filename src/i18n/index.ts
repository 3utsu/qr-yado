// 宿泊者向け画面の辞書（言語ファイル方式）。足りないキーは英語に戻る。
import { en } from "./en";
import { ja } from "./ja";
import { fr } from "./fr";
import { de } from "./de";
import { es } from "./es";
import { nl } from "./nl";
import { it } from "./it";
import { pl } from "./pl";

export type Dict = Record<string, string>;
export type Lang = "en" | "ja" | "fr" | "de" | "es" | "nl" | "it" | "pl";

const DICTS: Record<Lang, Partial<Dict>> = { en, ja, fr, de, es, nl, it, pl };

export const LANGS: { code: Lang; label: string }[] = [
  { code: "en", label: "English" },
  { code: "ja", label: "日本語" },
  { code: "fr", label: "Français" },
  { code: "de", label: "Deutsch" },
  { code: "es", label: "Español" },
  { code: "nl", label: "Nederlands" },
  { code: "it", label: "Italiano" },
  { code: "pl", label: "Polski" },
];

export function isLang(s: string | undefined | null): s is Lang {
  return !!s && s in DICTS;
}

export function pickLang(query: string | undefined, cookie: string | undefined, acceptLanguage: string | undefined): Lang {
  if (isLang(query)) return query;
  if (isLang(cookie)) return cookie;
  const first = (acceptLanguage ?? "").split(",")[0]?.trim().slice(0, 2).toLowerCase();
  return isLang(first) ? first : "en";
}

export function t(lang: Lang, key: string, vars: Record<string, string | number> = {}): string {
  const s = DICTS[lang]?.[key] ?? en[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
}

export function dict(lang: Lang): (key: string, vars?: Record<string, string | number>) => string {
  return (key, vars) => t(lang, key, vars);
}
