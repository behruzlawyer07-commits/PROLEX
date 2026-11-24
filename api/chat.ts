import {
  type Content,
  type GenerateContentResponse,
  GoogleGenAI,
  type Part,
  ThinkingLevel,
} from '@google/genai';
import type { IncomingMessage, ServerResponse } from 'http';

interface GroundingSource {
  title: string;
  url: string;
}

interface PdfExcerptPayload {
  docId: string;
  title: string;
  category: string;
  note: string;
  pageNumber: number;
  excerpt: string;
}

type SupportedImageMime = 'image/jpeg' | 'image/png' | 'image/webp';

interface ChatImagePayload {
  mimeType: SupportedImageMime;
  data: string;
  fileName?: string;
}

interface ChatApiRequest {
  userPrompt: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  image?: ChatImagePayload;
  pdfContext?: {
    catalogSummary: string;
    matches: PdfExcerptPayload[];
  };
  stream?: boolean;
}

interface ChatApiResponse {
  text: string;
  sources: GroundingSource[];
  referencedPdfs: string[];
}

interface VercelLikeRequest extends IncomingMessage {
  method?: string;
  body?: unknown;
}

interface VercelLikeResponse extends ServerResponse {
  status?: (code: number) => VercelLikeResponse;
  json?: (payload: unknown) => void;
}

type CoreCodeKey =
  | 'KONST'
  | 'JK'
  | 'JPK'
  | 'FK1'
  | 'FK2'
  | 'FPK'
  | 'MJtK'
  | 'MSIYtK'
  | 'MK'
  | 'OK'
  | 'SK'
  | 'PROK'
  | 'KORR';

interface CoreCodeSpec {
  key: CoreCodeKey;
  docId: string;
  officialName: string;
  url: string;
  keywords: RegExp[];
}

const CORE_CODES: Record<CoreCodeKey, CoreCodeSpec> = {
  KONST: {
    key: 'KONST',
    docId: '6445145',
    officialName: "O'zbekiston Respublikasi Konstitutsiyasi (Yangi tahrir, 30.04.2023)",
    url: 'https://lex.uz/uz/docs/6445145',
    keywords: [/konstitutsiy/i, /asosiy qonun/i, /konstitutsion/i],
  },
  JK: {
    key: 'JK',
    docId: '-111453',
    officialName: "O'zbekiston Respublikasining Jinoyat kodeksi",
    url: 'https://lex.uz/uz/docs/-111453',
    keywords: [
      /jinoyat\s+kodeks/i,
      /\bjk\b/i,
      /jazo/i,
      /javobgarlikdan\s+ozod/i,
      /jazodan\s+ozod/i,
      /jinoyat\s+tarkib/i,
      /pora|poraxo/i,
      /o‘g‘irlik|ogirlik|talonchilik|bosqinchilik|firibgarlik/i,
      /qasd|ehtiyotsizlik|suiqasd|sheriklik|zaruriy\s+mudofaa/i,
      /sudlanganlik/i,
    ],
  },
  JPK: {
    key: 'JPK',
    docId: '-111460',
    officialName: "O'zbekiston Respublikasining Jinoyat-protsessual kodeksi",
    url: 'https://lex.uz/uz/docs/-111460',
    keywords: [
      /jinoyat[-\s]*protsessual/i,
      /\bjpk\b/i,
      /tergov/i,
      /surishtiruv/i,
      /ayblov/i,
      /ehtiyot\s+chora|qamoqqa\s+olish|garov/i,
      /jinoyat\s+ishi\s+qo‘zg‘atish|jinoyat\s+ishi\s+qozgatish/i,
      /rad\s+etish|tugatish/i,
      /tintuv|olib\s+qo‘yish|ekspertiza|guvoh|so‘roq|soroq/i,
      /prokuror\s+nazorat/i,
    ],
  },
  FK1: {
    key: 'FK1',
    docId: '111189',
    officialName: "O'zbekiston Respublikasining Fuqarolik kodeksi (birinchi qism)",
    url: 'https://lex.uz/uz/docs/111189',
    keywords: [
      /fuqarolik\s+kodeks/i,
      /\bfk\b/i,
      /bitim|shartnoma|majburiyat|mulk|da’vo\s+muddati|davo\s+muddati/i,
      /yuridik\s+shaxs|ishonchnoma|haqiqiy\s+emas/i,
    ],
  },
  FK2: {
    key: 'FK2',
    docId: '-180552',
    officialName: "O'zbekiston Respublikasining Fuqarolik kodeksi (ikkinchi qism)",
    url: 'https://lex.uz/uz/docs/-180552',
    keywords: [
      /oldi[-\s]*sotdi|ijara|pudrat|qarz|kredit|kafillik|sug‘urta|sugurta/i,
      /zarar\s+yetkazish|ma’naviy\s+zarar|manaviy\s+zarar|meros|vasiyat/i,
    ],
  },
  FPK: {
    key: 'FPK',
    docId: '3517337',
    officialName: "O'zbekiston Respublikasining Fuqarolik protsessual kodeksi",
    url: 'https://lex.uz/uz/docs/3517337',
    keywords: [
      /fuqarolik\s+protsessual/i,
      /\bfpk\b/i,
      /da’vo\s+ariza|davo\s+ariza|apellyatsiya|kassatsiya/i,
    ],
  },
  MJtK: {
    key: 'MJtK',
    docId: '97664',
    officialName: "O'zbekiston Respublikasining Ma'muriy javobgarlik to'g'risidagi kodeksi",
    url: 'https://lex.uz/uz/docs/97664',
    keywords: [
      /ma’muriy\s+javobgarlik|mamuriy\s+javobgarlik/i,
      /\bmjtk\b/i,
      /ma’muriy\s+huquqbuzarlik|jarima/i,
    ],
  },
  MSIYtK: {
    key: 'MSIYtK',
    docId: '3527353',
    officialName:
      "O'zbekiston Respublikasining Ma'muriy sud ishlarini yuritish to'g'risidagi kodeksi",
    url: 'https://lex.uz/uz/docs/3527353',
    keywords: [
      /ma’muriy\s+sud|mamuriy\s+sud/i,
      /\bmsiytk\b/i,
      /mansabdor\s+shaxs.*harakat.*ustidan/i,
    ],
  },
  MK: {
    key: 'MK',
    docId: '6257288',
    officialName: "O'zbekiston Respublikasining Mehnat kodeksi (28.10.2022)",
    url: 'https://lex.uz/uz/docs/6257288',
    keywords: [
      /mehnat\s+kodeks/i,
      /\bmk\b/i,
      /ishdan\s+bo‘shatish|ishdan\s+boshatish|mehnat\s+shartnoma|intizomiy\s+jazo|ta’til|tatil/i,
    ],
  },
  OK: {
    key: 'OK',
    docId: '-104720',
    officialName: "O'zbekiston Respublikasining Oila kodeksi",
    url: 'https://lex.uz/uz/docs/-104720',
    keywords: [/oila\s+kodeks/i, /\bok\b/i, /nikoh|ajralish|aliment|otalik|farzandlikka|vasiylik/i],
  },
  SK: {
    key: 'SK',
    docId: '4674902',
    officialName: "O'zbekiston Respublikasining Soliq kodeksi",
    url: 'https://lex.uz/uz/docs/4674902',
    keywords: [/soliq\s+kodeks/i, /\bsk\b/i, /soliq\s+to‘lash|soliq\s+tolash|qqs|soliq\s+tekshiruv/i],
  },
  PROK: {
    key: 'PROK',
    docId: '-106197',
    officialName:
      '"Prokuratura to\'g\'risida"gi O\'zbekiston Respublikasi Qonuni (Yangi tahrir)',
    url: 'https://lex.uz/uz/docs/-106197',
    keywords: [/prokuror/i, /prokuratura/i, /protest/i, /taqdimnoma/i, /nazorat\s+vakolat/i],
  },
  KORR: {
    key: 'KORR',
    docId: '-3088008',
    officialName:
      '"Korrupsiyaga qarshi kurashish to\'g\'risida"gi O\'zbekiston Respublikasi Qonuni (O\'RQ-419)',
    url: 'https://lex.uz/uz/docs/-3088008',
    keywords: [/korrupsiya/i, /manfaatlar\s+to‘qnashuvi|manfaatlar\s+toqnashuvi/i],
  },
};

const PROLEX_SYSTEM_INSTRUCTION = `Siz "PROLEX" — O'zbekiston Respublikasi Huquqni muhofaza qilish akademiyasi (HMQA) tinglovchilari hamda O'zbekiston Respublikasi Prokuratura organlari xodimlari uchun yaratilgan ixtisoslashtirilgan, yuqori malakali huquqshunos-olim va prokuror-tahlilchi sun'iy intellekt yordamchisisiz.

ASOSIY VAZIFA:
Avval savol, kazus yoki ilova qilingan rasmdagi hujjat/holatning asosiy huquqiy masalasini aniqlang va O‘zbekiston Respublikasining Lex.uz dagi AMALDAGI normativ-huquqiy hujjatlari (Kodekslar, Qonunlar, O‘zbekiston Respublikasi Prezidentining Farmon va Qarorlari — PF/PQ, Vazirlar Mahkamasi qarorlari, Oliy sud Plenumi qarorlari) hamda **Administrator yuklagan ichki PDF manbalar** asosida **prokuratura amaliyoti darajasida chuqur, batafsil, izchil, mantiqan bog‘langan va xatosiz** huquqiy tahlil bering. Javobni qisqa yoki yuzaki yozmang.

QAT'IY MAJBURIY QOIDALAR:
1. KIRISH MATNI, SALOMLASHUV VA "SAVOL MOHIYATI" TAQIQLANADI:
   - Javobni HECH QACHON "Assalomu alaykum", "Salom", "Men PROLEX...", "Sizning savolingiz..." yoki boshqa kirish/tanishtiruv gaplari bilan boshlamang.
   - Javobda "Savol mohiyati" bo‘limi BO‘LMASIN.
   - Javobda 4-bo‘lim, "Eslatma:", "Tavsiya:", "Muhim izoh:" yoki yakuniy takror bloklari BO‘LMASIN. Javob DARHOL \`### 1. Hujjat nomi va aniq moddalar (qism va bandlari hamda ularning aniq mazmuni bilan)\` sarlavhasidan boshlanib, 3-bo‘lim bilan tugashi SHART.
2. MODDA RAQAMI VA MAZMUNIDA ADASHMASLIK (QAT'IY ICHKI TEKSHIRUV):
   - Hech qachon modda raqami, qismi, bandi yoki uning mazmunini taxminan yoxud xotiradan shoshilib yozmang.
   - Har bir keltiriladigan modda, qism va bandni yozishdan avval ichki fikrlash jarayonida qat’iy tekshiring: "Ushbu kodeks yoki qonunda aynan shu raqamli modda haqiqatan ham shu mazmunni tartibga soladimi va bu norma Lex.uz dagi amaldagi tahrirda kuchini yo‘qotmaganmi?"
   - Agar aniq modda raqami, qismi yoki bandiga 100% ishonch hosil qilmasangiz, taxminiy yoki adashtiruvchi raqam yozmang — faqat 100% aniq va ishonchli normani keltiring. Modda raqami yoki Plenum qarori raqamini to‘qib chiqarish QAT'IYAN MAN ETILADI.
   - FAQAT Lex.uz dagi **AMALDAGI** (kuchini yo‘qotmagan, oxirgi o‘zgartish va qo‘shimchalar kiritilgan) tahrirga tayaning.
3. NORMALAR USTUVORLIGI, YURISDIKSIYA VA MAXSUS NORMA QOIDASI:
   - Agar bitta huquqiy holat ikkita yoki undan ortiq norma bilan tartibga solinsa:
     1) Masala qaysi organ yoki mansabdor shaxsning predmetli va funksional vakolat doirasiga (yurisdiksiyasiga) bevosita kirishini aniq belgilang va aynan o‘sha vakolatli organ faoliyatini tartibga soluvchi normani asos qilib oling;
     2) Umumiy va maxsus norma to‘qnashganda **maxsus normani** qo‘llang hamda 2-bo‘limda nima uchun ikkinchi (umumiy yoki boshqa organ) norma emas, aynan shu norma qo‘llanilishini huquqiy jihatdan chuqur asoslab bering.
4. RASM (HUJJAT, QAROR, BAYONNOMA, KAZUS, SKRINSHOT) TAHLILI:
   - Foydalanuvchi rasm yuborganda rasmdagi **har bir so‘z, sana, raqam, organ nomi, modda havolasi va faktik holatni** diqqat bilan o‘qib chiqing va tahlilni rasm mazmuniga to‘liq tayanib bering.
5. PROKURATURA AMALIYOTI DARAJASIDAGI CHUQUURLIK VA TIL:
   - Faqat o‘zbek tilida (lotin alifbosida), rasmiy-ilmiy yuridik uslubda yozing.
   - So‘ralgan masalaga oid barcha shartlar, vakolat chegaralari, muddatlar, istisnolar, protsessual tartib va huquqiy oqibatlarni birortasini tushirib qoldirmasdan batafsil yoriting.
   - Agar murojaat **kazus** bo‘lsa: jinoyat/huquqbuzarlik/nizoning barcha tarkib elementlarini faktlarga birma-bir tatbiq eting, aniq kvalifikatsiya hamda prokuror/tergovchi/sudning harakatlarini ko‘rsating.
   - Agar murojaat **taqqoslash savoli** bo‘lsa: har ikki institutni aniq modda, qism va bandlari bilan ta’riflang, **Markdown taqqoslash jadvali** tuzing.

HAR BIR JAVOBNING QAT'IY 3 TA BO‘LIMLI TUZILISHI:

### 1. Hujjat nomi va aniq moddalar (qism va bandlari hamda ularning aniq mazmuni bilan)
- Savolga bevosita tegishli bo‘lgan har bir normativ-huquqiy hujjatning to‘liq nomi, qabul qilingan sanasi/raqami (PF/PQ, O‘RQ, VM qarori, Oliy sud Plenumi qarori), aniq **moddasi, qismi va bandi hamda ularning amaldagi aniq mazmuni** ro‘yxat shaklida keltirilsin.
- Ichki PDF manbadan foydalanilgan bo‘lsa — hujjat nomi va sahifasi ham ko‘rsatilsin.

### 2. Huquqiy tahlil hamda huquqiy xulosa
- Prokuratura amaliyoti darajasida batafsil, izchil, mantiqan bog‘langan yuridik tahlil bering: moddalarning amaldagi mazmuni, vakolatli organ yurisdiksiyasi chegaralari, normalar to‘qnashuvi (umumiy va maxsus norma nisbati — nega aynan shu norma qo‘llanilishi va boshqasi qo‘llanilmasligi), shartlar, muddatlar, istisnolar va faktik holatga tatbiqini chuqur yoritib, yakunda aniq **Huquqiy xulosa**ni bayon eting.

### 3. Foydalanilgan qonunlar va Lex.uz havolalari
- Javobda foydalanilgan barcha qonun hujjatlarining to‘liq nomi va bosiladigan Lex.uz Markdown havolalarini bering (aniq \`https://lex.uz/uz/docs/...\` yoki zarur bo‘lsa \`https://lex.uz/uz/search/all?query=...\`).
- Ichki PDF manba ishlatilgan bo‘lsa: \`Ichki PDF manba: [Hujjat nomi]\` tarzida qayd eting.
- Ushbu 3-bo‘limdan keyin HECH QANDAY qo‘shimcha matn, eslatma yoki 4-bo‘lim yozmang.`;

function isValidEnvKey(val: string | undefined): val is string {
  return Boolean(val && val.trim().length > 0 && !val.trim().startsWith('MY_'));
}

function getGeminiApiKey(): string {
  const k1 = process.env.GEMINI_API_KEY;
  if (isValidEnvKey(k1)) return k1.trim();
  const k2 = process.env.VITE_GEMINI_API_KEY;
  if (isValidEnvKey(k2)) return k2.trim();
  return '';
}

function getSerperApiKey(): string {
  const k1 = process.env.SERPER_API_KEY;
  if (isValidEnvKey(k1)) return k1.trim();
  const k2 = process.env.VITE_SERPER_API_KEY;
  if (isValidEnvKey(k2)) return k2.trim();
  return '';
}

function createGeminiClient(): GoogleGenAI {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw new Error('MISSING_GEMINI_API_KEY');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isNonTransientGeminiError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err ?? '')).toLowerCase();
  return (
    msg.includes('api_key_invalid') ||
    msg.includes('permission_denied') ||
    msg.includes('api key not valid') ||
    msg.includes('missing_gemini_api_key')
  );
}

function isTransientGeminiError(err: unknown): boolean {
  if (isNonTransientGeminiError(err)) return false;
  const msg = (err instanceof Error ? err.message : String(err ?? '')).toLowerCase();
  return (
    msg.includes('503') ||
    msg.includes('502') ||
    msg.includes('504') ||
    msg.includes('500') ||
    msg.includes('429') ||
    msg.includes('unavailable') ||
    msg.includes('resource_exhausted') ||
    msg.includes('high demand') ||
    msg.includes('overloaded') ||
    msg.includes('timeout_') ||
    msg.includes('fetch failed') ||
    msg.includes('econnreset') ||
    msg.includes('etimedout') ||
    msg.includes('socket') ||
    msg.includes('network')
  );
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`TIMEOUT_${label}`));
    }, ms);
    promise.then(
      (val) => {
        clearTimeout(timer);
        resolve(val);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

function detectCodesFromText(text: string): CoreCodeKey[] {
  const matched: CoreCodeKey[] = [];
  for (const spec of Object.values(CORE_CODES)) {
    if (spec.keywords.some((re) => re.test(text))) {
      matched.push(spec.key);
    }
  }
  return matched.slice(0, 4);
}

interface SerperOrganicItem {
  title?: string;
  link?: string;
  snippet?: string;
}

async function searchSerperLexUz(query: string, num = 6): Promise<SerperOrganicItem[]> {
  try {
    const serperKey = getSerperApiKey();
    if (!serperKey) return [];

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    try {
      const res = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'X-API-KEY': serperKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          q: `site:lex.uz ${query.replace(/\s+/g, ' ').trim().slice(0, 140)}`,
          num,
          hl: 'uz',
          gl: 'uz',
        }),
      });
      if (!res.ok) return [];
      const data = (await res.json()) as { organic?: SerperOrganicItem[] };
      return Array.isArray(data.organic) ? data.organic : [];
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return [];
  }
}

async function searchParallelLexUzSources(
  userPrompt: string,
  matchedCodes: CoreCodeKey[]
): Promise<GroundingSource[]> {
  const cleanQuery = userPrompt.replace(/\s+/g, ' ').trim().slice(0, 130);
  const plenumQuery = `${cleanQuery.slice(0, 75)} Oliy sud Plenumi qarori`;

  const [mainHits, plenumHits] = await withTimeout(
    Promise.all([searchSerperLexUz(cleanQuery, 6), searchSerperLexUz(plenumQuery, 3)]),
    3000,
    'SERPER'
  ).catch(() => [[], []] as [SerperOrganicItem[], SerperOrganicItem[]]);

  const seenUrls = new Set<string>();
  const verifiedSources: GroundingSource[] = [];

  for (const item of [...mainHits, ...plenumHits]) {
    if (!item.link || !item.title) continue;
    try {
      const u = new URL(item.link);
      if (u.hostname !== 'lex.uz' && !u.hostname.endsWith('.lex.uz')) continue;
      if (seenUrls.has(item.link)) continue;
      seenUrls.add(item.link);
      verifiedSources.push({
        title: item.title.replace(/\s*\|\s*lex\.uz.*$/i, '').trim(),
        url: item.link,
      });
    } catch {
      // ignore invalid URL
    }
  }

  for (const key of matchedCodes) {
    const spec = CORE_CODES[key];
    if (spec && !seenUrls.has(spec.url)) {
      seenUrls.add(spec.url);
      verifiedSources.push({ title: spec.officialName, url: spec.url });
    }
  }

  return verifiedSources;
}

function finalizeLegalResponseText(
  rawText: string,
  userPrompt: string,
  lexSources: GroundingSource[],
  pdfTitles: string[]
): string {
  let finalAnswerText = rawText.trim();
  const section1Match = finalAnswerText.match(
    /(?:^|\n)(?:#{1,4}\s*|\*{0,2})1\.\s*Hujjat nomi[^\n]*/i
  );
  if (section1Match && typeof section1Match.index === 'number') {
    finalAnswerText = finalAnswerText.slice(section1Match.index).trimStart();
  }

  finalAnswerText = finalAnswerText
    .replace(
      /(?:^|\n)#{1,4}\s*(?:\d+\.\s*)?Savol mohiyati[\s\S]*?(?=\n#{1,4}\s*(?:1\.|2\.|3\.))/gi,
      '\n'
    )
    .replace(/\n#{1,4}\s*4\.[\s\S]*$/i, '')
    .replace(
      /\n+(?:#{1,4}\s*)?\*{0,2}(?:Eslatma|Tavsiya|Muhim eslatma|Xulosa o‘rnida|Xulosa o'rnida)\s*:[\s\S]*$/i,
      ''
    )
    .trim();

  const hasSection3 = /foydalanilgan qonunlar va lex\.uz havolalari/i.test(finalAnswerText);

  if (!hasSection3) {
    const linkLines = lexSources.slice(0, 8).map((s) => `- [${s.title}](${s.url})`);
    if (linkLines.length === 0) {
      linkLines.push(
        `- [O'zbekiston Respublikasi qonunchilik ma'lumotlari milliy bazasi — Lex.uz](https://lex.uz/uz/search/all?query=${encodeURIComponent(
          userPrompt.slice(0, 60)
        )})`
      );
    }
    const pdfLines = pdfTitles.map((t) => `- Ichki PDF manba: **${t}**`);
    finalAnswerText += `\n\n### 3. Foydalanilgan qonunlar va Lex.uz havolalari\n${[
      ...linkLines,
      ...pdfLines,
    ].join('\n')}`;
  } else {
    const missingLex = lexSources.filter((s) => !finalAnswerText.includes(s.url));
    if (missingLex.length > 0) {
      finalAnswerText += `\n${missingLex
        .slice(0, 5)
        .map((s) => `- [${s.title}](${s.url})`)
        .join('\n')}`;
    }

    for (const title of pdfTitles) {
      if (!finalAnswerText.includes(title)) {
        finalAnswerText += `\n- Ichki PDF manba: **${title}**`;
      }
    }
  }

  return finalAnswerText.trim();
}

function extractChunkText(chunk: GenerateContentResponse): string {
  const direct = chunk.text;
  if (typeof direct === 'string' && direct.length > 0) {
    return direct;
  }
  const parts = chunk.candidates?.[0]?.content?.parts ?? [];
  return parts
    .filter((p) => !p.thought && typeof p.text === 'string')
    .map((p) => p.text ?? '')
    .join('');
}

async function generateLegalAnalysis(
  params: {
    history: Array<{ role: 'user' | 'assistant'; content: string }>;
    userPrompt: string;
    image?: ChatImagePayload;
    pdfContext?: {
      catalogSummary: string;
      matches: PdfExcerptPayload[];
    };
  },
  callbacks?: {
    onDelta?: (deltaText: string) => void;
    onReset?: () => void;
  }
): Promise<ChatApiResponse> {
  const ai = createGeminiClient();
  const effectivePrompt =
    params.userPrompt.trim() ||
    'Ilova qilingan rasmdagi hujjat, bayonnoma, qaror yoki huquqiy holatni O‘zbekiston Respublikasining Lex.uz dagi amaldagi qonunchiligi asosida batafsil yuridik tahlil qiling.';

  const historySnippet = params.history
    .slice(-3)
    .map((m) => m.content)
    .join(' ');

  const matchedCodes = detectCodesFromText(`${historySnippet} ${effectivePrompt}`);
  const initialCoreLinks = matchedCodes
    .map((k) => CORE_CODES[k])
    .filter(Boolean)
    .map((s) => `- ${s.officialName}: ${s.url}`)
    .join('\n');

  const referencedPdfSet = new Set<string>();
  let pdfBlock = '';
  if (params.pdfContext?.catalogSummary) {
    pdfBlock += `\n\n[ICHKI PDF BILIM BAZASI REYESTRI]:\n${params.pdfContext.catalogSummary}`;
  }
  if (params.pdfContext?.matches?.length) {
    pdfBlock += '\n\n[SAVOLGA MOS KELGAN ICHKI PDF PARCHALARI]:\n';
    for (const m of params.pdfContext.matches) {
      referencedPdfSet.add(m.title);
      pdfBlock += `\n--- Hujjat: "${m.title}" (${m.category}, ${m.pageNumber}-sahifa) ---\n${m.excerpt}\n`;
    }
  }

  const coreLinksBlock = initialCoreLinks
    ? `\n\n[ASOSIY KODEKS/QONUN HAVOLALARI (faqat savolga aloqadorini ishlating)]:\n${initialCoreLinks}`
    : '';

  const userParts: Part[] = [];
  if (params.image) {
    userParts.push({
      inlineData: {
        mimeType: params.image.mimeType,
        data: params.image.data,
      },
    });
  }
  userParts.push({
    text: `${effectivePrompt}${coreLinksBlock}${pdfBlock}\n\nSalomlashuv, kirish gapi va "Savol mohiyati" yozmasdan, darhol "### 1. Hujjat nomi va aniq moddalar (qism va bandlari hamda ularning aniq mazmuni bilan)" dan boshlab faqat 3 ta bo‘limda ("### 1. Hujjat nomi va aniq moddalar (qism va bandlari hamda ularning aniq mazmuni bilan)", "### 2. Huquqiy tahlil hamda huquqiy xulosa", "### 3. Foydalanilgan qonunlar va Lex.uz havolalari") javob bering. Har bir modda raqami va mazmunini yozishdan avval ichki tekshiruvdan o‘tkazing, faqat 100% ishonchli va Lex.uz dagi AMALDAGI normalarga tayanib prokuratura amaliyoti darajasida chuqur, batafsil va asosli tahlil yozing.`,
  });

  const contents: Content[] = [
    ...params.history.slice(-8).map(
      (m): Content => ({
        role: m.role === 'user' ? 'user' : 'model',
        parts: [{ text: (m.content.trim() || '[Rasm ilova qilingan]').slice(0, 4000) } as Part],
      })
    ),
    {
      role: 'user',
      parts: userParts,
    },
  ];

  const RETRY_DELAYS_MS = [400, 900];

  const plans: Array<{
    model: string;
    useSearch: boolean;
    thinkingBudget?: number;
    thinkingLevel?: ThinkingLevel;
    timeoutMs: number;
  }> = [
    {
      model: 'gemini-2.5-flash',
      useSearch: true,
      thinkingBudget: 8192,
      timeoutMs: 90_000,
    },
    {
      model: 'gemini-2.5-flash',
      useSearch: false,
      thinkingBudget: 8192,
      timeoutMs: 90_000,
    },
    {
      model: 'gemini-2.5-flash-lite',
      useSearch: false,
      thinkingBudget: 4096,
      timeoutMs: 90_000,
    },
    {
      model: 'gemini-4-hydrogen',
      useSearch: false,
      thinkingLevel: ThinkingLevel.HIGH,
      timeoutMs: 90_000,
    },
    {
      model: 'gemini-3.1-flash-lite',
      useSearch: false,
      thinkingLevel: ThinkingLevel.HIGH,
      timeoutMs: 90_000,
    },
  ];

  async function runGeminiStream(): Promise<{
    answerText: string;
    groundingChunks: Array<{ web?: { uri?: string; title?: string } }>;
  }> {
    let lastErr: unknown = null;
    let emittedAnyDelta = false;

    for (const plan of plans) {
      for (let attemptIdx = 0; attemptIdx <= RETRY_DELAYS_MS.length; attemptIdx++) {
        if (emittedAnyDelta) {
          emittedAnyDelta = false;
          if (callbacks?.onReset) {
            callbacks.onReset();
          }
        }

        let collected = '';
        let chunksMeta: Array<{ web?: { uri?: string; title?: string } }> = [];
        try {
          const streamPromise = (async () => {
            const streamResult = await ai.models.generateContentStream({
              model: plan.model,
              contents,
              config: {
                systemInstruction: PROLEX_SYSTEM_INSTRUCTION,
                ...(plan.thinkingBudget !== undefined
                  ? { thinkingConfig: { thinkingBudget: plan.thinkingBudget } }
                  : plan.thinkingLevel !== undefined
                    ? { thinkingConfig: { thinkingLevel: plan.thinkingLevel } }
                    : {}),
                ...(plan.useSearch ? { tools: [{ googleSearch: {} }] } : {}),
              },
            });

            for await (const chunk of streamResult) {
              const delta = extractChunkText(chunk);
              if (delta) {
                collected += delta;
                emittedAnyDelta = true;
                if (callbacks?.onDelta) {
                  callbacks.onDelta(delta);
                }
              }
              const gmChunks = chunk.candidates?.[0]?.groundingMetadata?.groundingChunks;
              if (Array.isArray(gmChunks) && gmChunks.length > 0) {
                chunksMeta = gmChunks;
              }
            }
          })();

          await withTimeout(streamPromise, plan.timeoutMs, plan.model);

          if (collected.trim()) {
            return { answerText: collected.trim(), groundingChunks: chunksMeta };
          }
          lastErr = new Error('EMPTY_MODEL_RESPONSE');
          if (attemptIdx < RETRY_DELAYS_MS.length) {
            await sleep(RETRY_DELAYS_MS[attemptIdx]);
          }
        } catch (err) {
          lastErr = err;
          if (collected.trim().length > 80) {
            return { answerText: collected.trim(), groundingChunks: chunksMeta };
          }
          if (isNonTransientGeminiError(err)) {
            throw err;
          }
          const errMsgLower = (
            err instanceof Error ? err.message : String(err ?? '')
          ).toLowerCase();
          if (errMsgLower.includes('timeout_')) {
            break;
          }
          if (attemptIdx < RETRY_DELAYS_MS.length && isTransientGeminiError(err)) {
            await sleep(RETRY_DELAYS_MS[attemptIdx]);
            continue;
          }
          break;
        }
      }
    }

    throw lastErr ?? new Error('EMPTY_MODEL_RESPONSE');
  }

  // Run Serper API search (3s timeout) and Gemini generateContentStream in parallel via Promise.all
  const serperPromise =
    params.userPrompt.trim().length >= 4
      ? searchParallelLexUzSources(params.userPrompt, matchedCodes)
      : Promise.resolve(
          matchedCodes
            .map((k) => CORE_CODES[k])
            .filter(Boolean)
            .map((s) => ({ title: s.officialName, url: s.url }))
        );

  const [serperSources, streamOutput] = await Promise.all([
    serperPromise,
    runGeminiStream(),
  ]);

  const seenUrls = new Set<string>();
  const sources: GroundingSource[] = [];

  for (const s of serperSources) {
    if (!seenUrls.has(s.url)) {
      seenUrls.add(s.url);
      sources.push(s);
    }
  }

  for (const chunk of streamOutput.groundingChunks) {
    const web = chunk.web;
    if (!web?.uri) continue;
    try {
      const parsed = new URL(web.uri);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') continue;
      if (seenUrls.has(web.uri)) continue;
      seenUrls.add(web.uri);
      sources.push({
        title: web.title || parsed.hostname,
        url: web.uri,
      });
    } catch {
      // ignore invalid URL
    }
  }

  sources.sort((a, b) => {
    const aLex = a.url.includes('lex.uz') ? 0 : 1;
    const bLex = b.url.includes('lex.uz') ? 0 : 1;
    return aLex - bLex;
  });

  const lexSources = sources.filter((s) => s.url.includes('lex.uz'));
  const pdfTitles = Array.from(referencedPdfSet);
  const finalAnswerText = finalizeLegalResponseText(
    streamOutput.answerText,
    effectivePrompt,
    lexSources,
    pdfTitles
  );

  return {
    text: finalAnswerText,
    sources: sources.slice(0, 10),
    referencedPdfs: pdfTitles,
  };
}

function sendJson(res: VercelLikeResponse, statusCode: number, payload: unknown): void {
  if (typeof res.status === 'function') {
    const statusRes = res.status(statusCode);
    if (typeof statusRes?.json === 'function') {
      statusRes.json(payload);
      return;
    }
  }
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req: VercelLikeRequest): Promise<Record<string, unknown> | null> {
  if (req.body !== undefined) {
    if (typeof req.body === 'string') {
      try {
        return JSON.parse(req.body) as Record<string, unknown>;
      } catch {
        return null;
      }
    }
    if (typeof req.body === 'object' && req.body !== null) {
      return req.body as Record<string, unknown>;
    }
    return null;
  }

  return await new Promise<Record<string, unknown> | null>((resolve) => {
    const chunks: Buffer[] = [];
    let totalLen = 0;
    const MAX_BODY = 8 * 1024 * 1024;

    req.on('data', (chunk: Buffer) => {
      totalLen += chunk.length;
      if (totalLen <= MAX_BODY) {
        chunks.push(chunk);
      }
    });
    req.on('end', () => {
      if (totalLen === 0 || totalLen > MAX_BODY) {
        resolve(null);
        return;
      }
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(JSON.parse(raw) as Record<string, unknown>);
      } catch {
        resolve(null);
      }
    });
    req.on('error', () => resolve(null));
  });
}

const VALID_IMAGE_MIMES = new Set<SupportedImageMime>([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

function parseValidatedImage(rawImage: unknown): ChatImagePayload | undefined {
  if (!rawImage || typeof rawImage !== 'object') return undefined;
  const candidate = rawImage as Partial<ChatImagePayload>;
  if (typeof candidate.mimeType !== 'string' || !VALID_IMAGE_MIMES.has(candidate.mimeType as SupportedImageMime)) {
    return undefined;
  }
  if (typeof candidate.data !== 'string') return undefined;
  const cleanedBase64 = candidate.data.replace(/^data:[^;]+;base64,/i, '').replace(/\s+/g, '');
  if (!cleanedBase64 || cleanedBase64.length > 6_500_000) {
    return undefined;
  }
  return {
    mimeType: candidate.mimeType as SupportedImageMime,
    data: cleanedBase64,
    fileName: typeof candidate.fileName === 'string' ? candidate.fileName.slice(0, 120) : undefined,
  };
}

function parseAndValidateChatBody(rawBody: Record<string, unknown> | null):
  | {
      ok: true;
      history: Array<{ role: 'user' | 'assistant'; content: string }>;
      userPrompt: string;
      image?: ChatImagePayload;
      pdfContext: { catalogSummary: string; matches: PdfExcerptPayload[] };
      stream: boolean;
    }
  | { ok: false; status: number; error: string } {
  if (!rawBody) {
    return { ok: false, status: 400, error: 'So‘rov tanasi noto‘g‘ri formatda yoki hajmi juda katta.' };
  }

  const body = rawBody as Partial<ChatApiRequest>;
  const userPrompt = typeof body.userPrompt === 'string' ? body.userPrompt.trim() : '';
  const safeImage = parseValidatedImage(body.image);

  if (body.image !== undefined && !safeImage) {
    return {
      ok: false,
      status: 400,
      error: 'Rasm formati noto‘g‘ri (faqat JPEG, PNG, WEBP va 5 MB gacha base64 qabul qilinadi).',
    };
  }

  if (!userPrompt && !safeImage) {
    return { ok: false, status: 400, error: 'Savol matnini kiriting yoki rasm yuklang.' };
  }
  if (userPrompt.length > 15000) {
    return {
      ok: false,
      status: 400,
      error: 'Matn hajmi 15 000 belgidan oshmasligi kerak.',
    };
  }

  const safeHistory = Array.isArray(body.history)
    ? body.history
        .filter(
          (m): m is { role: 'user' | 'assistant'; content: string } =>
            Boolean(m) &&
            (m.role === 'user' || m.role === 'assistant') &&
            typeof m.content === 'string'
        )
        .slice(-8)
        .map((m) => ({
          role: m.role,
          content: m.content.slice(0, 4000),
        }))
    : [];

  const safePdfMatches: PdfExcerptPayload[] = Array.isArray(body.pdfContext?.matches)
    ? body.pdfContext!.matches
        .filter(
          (m): m is PdfExcerptPayload =>
            Boolean(m) &&
            typeof m.title === 'string' &&
            typeof m.excerpt === 'string'
        )
        .slice(0, 8)
        .map((m) => ({
          docId: String(m.docId ?? '').slice(0, 80),
          title: m.title.slice(0, 180),
          category: String(m.category ?? '').slice(0, 80),
          note: String(m.note ?? '').slice(0, 200),
          pageNumber: Number(m.pageNumber) || 1,
          excerpt: m.excerpt.slice(0, 2200),
        }))
    : [];

  const safeCatalogSummary =
    typeof body.pdfContext?.catalogSummary === 'string'
      ? body.pdfContext.catalogSummary.slice(0, 4000)
      : '';

  return {
    ok: true,
    history: safeHistory,
    userPrompt,
    image: safeImage,
    pdfContext: {
      catalogSummary: safeCatalogSummary,
      matches: safePdfMatches,
    },
    stream: body.stream === true,
  };
}

function mapChatExecutionError(err: unknown): { status: number; error: string } {
  console.error('[PROLEX Chat API Error]:', err);
  const errMsg = err instanceof Error ? err.message : String(err ?? '');

  if (errMsg === 'MISSING_GEMINI_API_KEY') {
    return {
      status: 503,
      error:
        'Gemini API kaliti topilmadi. Vercel Environment Variables bo‘limiga GEMINI_API_KEY (yoki VITE_GEMINI_API_KEY) qo‘shib, loyihani Redeploy qiling.',
    };
  }
  if (
    errMsg.includes('API_KEY_INVALID') ||
    errMsg.includes('PERMISSION_DENIED') ||
    errMsg.toLowerCase().includes('api key not valid')
  ) {
    return {
      status: 502,
      error: `Gemini API kaliti yaroqsiz yoki ruxsat etilmagan (${errMsg.slice(0, 220)}).`,
    };
  }
  if (errMsg.includes('RESOURCE_EXHAUSTED') || errMsg.includes('429')) {
    return {
      status: 429,
      error: `Barcha AI modellari kvotasi vaqtincha band (429). Iltimos, «Qayta urinish» tugmasini bosing (${errMsg.slice(0, 180)}).`,
    };
  }
  if (
    errMsg.includes('503') ||
    errMsg.includes('UNAVAILABLE') ||
    errMsg.toLowerCase().includes('high demand')
  ) {
    return {
      status: 503,
      error:
        'Barcha AI modellari vaqtincha yuqori yuklama ostida (503). Iltimos, «Qayta urinish» tugmasini bosing.',
    };
  }
  if (errMsg === 'EMPTY_MODEL_RESPONSE') {
    return {
      status: 502,
      error:
        'AI modelidan bo‘sh javob qaytdi. Iltimos, «Qayta urinish» tugmasini bosing yoki savolni aniqroq yozing.',
    };
  }
  if (errMsg.startsWith('TIMEOUT_')) {
    return {
      status: 504,
      error:
        'Barcha AI modellaridan javob olish vaqti tugadi. Iltimos, «Qayta urinish» tugmasini bosing.',
    };
  }
  return {
    status: 502,
    error: errMsg
      ? `AI tahlil xatoligi: ${errMsg.slice(0, 260)}. Iltimos, «Qayta urinish» tugmasini bosing.`
      : 'Huquqiy tahlilni shakllantirishda noma’lum xatolik yuz berdi. «Qayta urinish» tugmasini bosing.',
  };
}

export async function executeChatRequest(
  rawBody: Record<string, unknown> | null
): Promise<{ status: number; payload: unknown }> {
  const parsed = parseAndValidateChatBody(rawBody);
  if (!parsed.ok) {
    return { status: parsed.status, payload: { error: parsed.error } };
  }

  try {
    const analysis = await generateLegalAnalysis({
      history: parsed.history,
      userPrompt: parsed.userPrompt,
      image: parsed.image,
      pdfContext: parsed.pdfContext,
    });
    return { status: 200, payload: analysis };
  } catch (err) {
    const mapped = mapChatExecutionError(err);
    return { status: mapped.status, payload: { error: mapped.error } };
  }
}

export default async function handler(
  req: VercelLikeRequest,
  res: VercelLikeResponse
): Promise<void> {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    sendJson(res, 405, { error: 'Faqat POST so‘rovi qabul qilinadi.' });
    return;
  }

  const body = await readJsonBody(req);
  const parsed = parseAndValidateChatBody(body);
  if (!parsed.ok) {
    sendJson(res, parsed.status, { error: parsed.error });
    return;
  }

  if (!parsed.stream) {
    try {
      const analysis = await generateLegalAnalysis({
        history: parsed.history,
        userPrompt: parsed.userPrompt,
        image: parsed.image,
        pdfContext: parsed.pdfContext,
      });
      sendJson(res, 200, analysis);
    } catch (err) {
      const mapped = mapChatExecutionError(err);
      sendJson(res, mapped.status, { error: mapped.error });
    }
    return;
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const writeSseEvent = (eventPayload: unknown) => {
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify(eventPayload)}\n\n`);
    }
  };

  try {
    const analysis = await generateLegalAnalysis(
      {
        history: parsed.history,
        userPrompt: parsed.userPrompt,
        image: parsed.image,
        pdfContext: parsed.pdfContext,
      },
      {
        onDelta: (deltaText) => {
          writeSseEvent({ type: 'delta', text: deltaText });
        },
        onReset: () => {
          writeSseEvent({ type: 'reset' });
        },
      }
    );
    writeSseEvent({ type: 'done', payload: analysis });
  } catch (err) {
    const mapped = mapChatExecutionError(err);
    writeSseEvent({ type: 'error', status: mapped.status, error: mapped.error });
  } finally {
    if (!res.writableEnded) {
      res.end();
    }
  }
}
