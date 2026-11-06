// Claude API の呼び出し。役割は「読み取り・分類・翻訳・要約」まで（D-06）。出力は JSON schema（zod）で検証し、人の確認画面を挟む。
import { z } from "zod";
import type { Bindings } from "./env";

const API = "https://api.anthropic.com/v1/messages";

type Content = { type: "text"; text: string } | { type: "image"; source: { type: "base64"; media_type: string; data: string } };

async function callClaude(env: Bindings, system: string, content: Content[], maxTokens = 800): Promise<string> {
  if (!env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY が設定されていません");
  const res = await fetch(API, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: env.CLAUDE_MODEL, max_tokens: maxTokens, system, messages: [{ role: "user", content }] }),
  });
  if (!res.ok) throw new Error(`Claude API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as { content: { type: string; text?: string }[] };
  return data.content.filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
}

function extractJson(s: string): unknown {
  const m = s.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("JSON が見つかりません");
  return JSON.parse(m[0]);
}

// --- 旅券の読み取り ---
export const PassportRead = z.object({
  surname: z.string().min(1).max(60),
  given_names: z.string().min(1).max(80),
  nationality: z.string().regex(/^[A-Z]{3}$/),
  issuing_country: z.string().regex(/^[A-Z]{3}$/),
  passport_no: z.string().min(5).max(9).transform((s) => s.toUpperCase().replace(/[^A-Z0-9]/g, "")),
  mrz_line1: z.string().optional().nullable(),
  mrz_line2: z.string().optional().nullable(),
  confidence: z.enum(["high", "medium", "low"]),
});
export type PassportRead = z.infer<typeof PassportRead>;

export async function readPassport(env: Bindings, imageBase64: string, mediaType: string): Promise<PassportRead> {
  const system =
    "You read the identity page of a passport for a lodging register required by Japanese law. Return ONLY a JSON object with keys: surname, given_names, nationality (ISO 3166-1 alpha-3 as printed in the MRZ), issuing_country (alpha-3), passport_no, mrz_line1, mrz_line2 (the two 44-character machine-readable lines, exactly as printed, '<' included; null if not visible), confidence ('high'|'medium'|'low'). Do not include date of birth or any other field. If the document is not a passport, set confidence to 'low' and do your best.";
  const text = await callClaude(env, system, [
    { type: "image", source: { type: "base64", media_type: mediaType, data: imageBase64 } },
    { type: "text", text: "Read this passport page and return the JSON." },
  ]);
  return PassportRead.parse(extractJson(text));
}

// --- カタカナ読み（D-12） ---
export const KanaRead = z.object({
  kana: z.string().min(1).max(40),
  romaji: z.string().min(1).max(80),
  note: z.string().max(120).optional().nullable(),
});

export async function kanaForName(env: Bindings, name: string, nationality: string | null, language: string | null): Promise<z.infer<typeof KanaRead>> {
  const system =
    "You write how a foreign name is pronounced, in Japanese katakana, for an elderly Japanese host who will greet the guest. Use the guest's nationality and language to decide the pronunciation (e.g. Dutch 'Jan' → ヤン, French 'Jean' → ジャン, Catalan 'Joan' → ジョアン, Polish 'Łukasz' → ウカシュ). Order: given name first, then surname, separated by '・'. Return ONLY JSON: {\"kana\": string (katakana only, with ・ and ー allowed), \"romaji\": string (the name in Latin letters as pronounced), \"note\": short optional note}.";
  const text = await callClaude(
    env,
    system,
    [{ type: "text", text: `Name: ${name}\nNationality: ${nationality ?? "unknown"}\nLanguage: ${language ?? "unknown"}` }],
    300,
  );
  return KanaRead.parse(extractJson(text));
}

// --- 翻訳（宿の案内・地域ルール、宿泊者のひとこと） ---
export const GuideText = z.object({ guide: z.string().max(4000), rules: z.string().max(4000) });

export async function translateGuide(env: Bindings, guideJa: string, rulesJa: string, lang: string): Promise<z.infer<typeof GuideText>> {
  const system =
    `You translate a Japanese family guesthouse's guide and neighbourhood rules for foreign pilgrims. Target language: ${lang}. Keep it warm and plain, keep line breaks, do not add rules that are not there. Return ONLY JSON: {"guide": string, "rules": string}.`;
  const text = await callClaude(env, system, [{ type: "text", text: `[guide]\n${guideJa}\n\n[rules]\n${rulesJa}` }], 2000);
  return GuideText.parse(extractJson(text));
}

export const NoteJa = z.object({ ja: z.string().max(200) });

export async function noteToJapanese(env: Bindings, note: string, language: string | null): Promise<string> {
  const system =
    "A foreign pilgrim wrote a short note for an elderly Japanese host. Translate it into short, plain, polite Japanese (です・ます), at most 2 sentences, suitable for large print on paper. Return ONLY JSON: {\"ja\": string}.";
  const text = await callClaude(env, system, [{ type: "text", text: `Language: ${language ?? "unknown"}\nNote: ${note}` }], 300);
  return NoteJa.parse(extractJson(text)).ja;
}

// --- 需給ボード：依頼文・告知の下書き（Claude は文章の下書きまで。数字はコードが渡す） ---
export const Draft = z.object({ subject: z.string().max(120), body: z.string().max(3000) });

export async function draftRequestLetter(env: Bindings, args: { municipality: string; sectionName: string; dates: string; shortage: number; facilities: string[] }) {
  const system =
    "You draft a polite Japanese letter (敬体) from the operator of a pilgrim lodging network to a municipal office, asking to open a community hall for 1–2 weeks as temporary free lodging for walking pilgrims. Use only the numbers given. Return ONLY JSON: {\"subject\": string, \"body\": string}.";
  const text = await callClaude(
    env,
    system,
    [{ type: "text", text: `宛先: ${args.municipality}\n区間: ${args.sectionName}\n期間: ${args.dates}\n不足人数（1夜あたり）: ${args.shortage}人\n候補施設: ${args.facilities.join("、")}` }],
    1500,
  );
  return Draft.parse(extractJson(text));
}

export async function draftPilgrimNotice(env: Bindings, args: { sectionName: string; dates: string; langs: string[] }) {
  const system =
    "You write a short notice for walking pilgrims that a section of the Shikoku pilgrimage has no beds on certain nights, suggesting they adjust their pace or book earlier. Return ONLY JSON: {\"subject\": string, \"body\": string} where body contains one paragraph per language in this order, each prefixed by the language code in brackets.";
  const text = await callClaude(env, system, [{ type: "text", text: `Section: ${args.sectionName}\nNights without beds: ${args.dates}\nLanguages: ${args.langs.join(", ")}` }], 2000);
  return Draft.parse(extractJson(text));
}
