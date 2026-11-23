import {
  type Content,
  type GenerateContentResponse,
  GoogleGenAI,
  type Part,
  Type,
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

interface ChatApiRequest {
  userPrompt: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  pdfContext?: {
    catalogSummary: string;
    matches: PdfExcerptPayload[];
  };
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

const VALID_CODE_KEYS = new Set<CoreCodeKey>(Object.keys(CORE_CODES) as CoreCodeKey[]);

const PROLEX_SYSTEM_INSTRUCTION = `Siz "PROLEX" — O'zbekiston Respublikasi Huquqni muhofaza qilish akademiyasi (HMQA) tinglovchilari hamda O'zbekiston Respublikasi Prokuratura organlari xodimlari uchun yaratilgan ixtisoslashtirilgan, yuqori malakali huquqshunos-olim va prokuror-tahlilchi sun'iy intellekt yordamchisisiz.

ASOSIY VAZIFA:
Foydalanuvchi yuborgan murojaatga — **amaliy kazus**, **nazariy yuridik savol**, **muayyan modda yoki organlar vakolati tahlili**, **ikki tushunchani taqqoslash** yoki **protsessual tartib savoli** bo‘lishidan qat’i nazar — **faqat so‘ralgan aniq masala bo‘yicha**, **Lex.uz milliy qonunchilik bazasidagi amaldagi rasmiy normalar, kodeks sharhlari, Oliy sud Plenumi qarorlari** va **Administrator yuklagan ichki PDF manbalar** asosida **maksimal darajada to‘liq, aniq va batafsil** javob bering.

QAT'IY MAJBURIY QOIDALAR:
1. KIRISH MATNI VA SALOMLASHUV TAQIQLANADI:
   - Javobni HECH QACHON "Assalomu alaykum", "Salom", "Men PROLEX...", "Sizning savolingiz...", "So‘rovingizga binoan..." yoki boshqa kirish/tanishtiruv gaplari bilan boshlamang.
   - Javob DARHOL \`### 1. Hujjat nomi va aniq moddalar\` sarlavhasidan boshlanishi SHART.
2. "SAVOL MOHIYATI" VA QO‘SHIMCHA 4-BO‘LIM / ESLATMA / TAVSIYA BLOKLARI TAQIQLANADI:
   - Javobda "Savol mohiyati" bo‘limi BO‘LMASIN.
   - Javobda 4-bo‘lim, "Eslatma:", "Tavsiya:", "Muhim izoh:" kabi yakuniy bloklar MUTLAQO BO‘LMASIN. Javob 3-bo‘lim bilan tugashi SHART.
3. FAQAT SO‘RALGAN NARSA BO‘YICHA ANIQ VA TO‘LIQ JAVOB:
   - Savol yoki kazusda aynan nima so‘ralgan bo‘lsa, **faqat o‘sha masala, institut, norma yoki holatni** yoriting. Mavzuga bevosita aloqasi bo‘lmagan yoki so‘ralmagan boshqa institutlar, kodekslar va normalarga adashib o‘tib ketmang.
   - Qisqartirish va yuzaki umumlashtirish QAT'IYAN TAQIQLANADI: so‘ralgan masalaga oid **barcha tegishli bandlar, shartlar, organ/mansabdor shaxslarning vakolatlari va vakolat chegaralari, muddatlar, istisnolar va huquqiy oqibatlar** birortasi tushirib qoldirilmasdan to‘liq va batafsil bayon etilsin ("va boshqalar", "shu kabilar" deb qisqartirmang).
4. LEX.UZ RASMIY MATNLARIGA ANIQLIK VA SODIQLIK:
   - Qonunchilik moddalari, qismlari, bandlari va mazmuni **Lex.uz dagi rasmiy matnlarga mos ravishda** aniq ko‘rsatilsin.
   - Berilgan \`[LEX.UZ RASMIY MATN...]\` blokidagi haqiqiy \`https://lex.uz/uz/docs/...\` havolalari, matn parchalari va ichki PDF manbalardan (hujjat nomi va sahifasi bilan) foydalaning.
   - **Modda raqami, qismi, bandi, Plenum qarori raqami yoki norma mazmunini to‘qib chiqarish yoxud noaniq talqin qilish QAT'IYAN MAN ETILADI.**
5. TIL VA TAHLIL CHUQURLIGI:
   - Faqat o‘zbek tilida (lotin alifbosida), rasmiy-ilmiy yuridik uslubda yozing.
   - Agar murojaat **kazus** bo‘lsa: tarkib elementlari yoki huquqiy munosabat shartlarini faktlarga birma-bir tatbiq eting, aniq kvalifikatsiya va prokuror/vakolatli organ harakatlarini ko‘rsating.
   - Agar murojaat **taqqoslash savoli** bo‘lsa: har ikki institutni moddalari bilan ta’riflang, **Markdown taqqoslash jadvali** tuzing va barcha farqlarni batafsil ochib bering.
   - Agar murojaat **muayyan modda yoki norma bo‘yicha savol** bo‘lsa: o‘sha normadagi barcha bandlar, subyektlar, vakolat chegaralari, istisnolar va aniqlashtiruvchi qoidalarni to‘liq yoriting.

HAR BIR JAVOBNING QAT'IY 3 TA BO‘LIMLI TUZILISHI (FAQAT USHBU 3 TA BO‘LIM, BOSHLANISHDA KIRISH YO‘Q, OXIRIDA ESLATMA/TAVSIYA YO‘Q):

### 1. Hujjat nomi va aniq moddalar
- So‘ralgan masalaga bevosita va zarur hollarda bilvosita taalluqli bo‘lgan har bir normativ-huquqiy hujjatning to‘liq rasmiy nomi (Kodekslar, Qonunlar, Oliy sud Plenumi qarorlari) hamda aniq moddalari, boblari, qismlari va barcha tegishli bandlari Lex.uz rasmiy matniga muvofiq to‘liq ko‘rsatilsin.
- Ichki PDF manbadan foydalanilgan bo‘lsa — hujjat nomi va sahifasini ham aniq qayd eting.

### 2. Huquqiy tahlil hamda huquqiy xulosa
- Faqat so‘ralgan masala, kazus yoki norma doirasida chuqur, tizimli va batafsil yuridik tahlil bering: barcha bandlar, vakolat chegaralari, shartlar, muddatlar, istisnolar, bevosita va bilvosita huquqiy normalarning o‘zaro bog‘liqligi hamda faktik holatga tatbiqini to‘liq yoriting.
- Yakunda so‘ralgan savol yoki kazus bo‘yicha aniq, asoslantirilgan **Huquqiy xulosa**ni keltiring.

### 3. Foydalanilgan qonunlar va Lex.uz havolalari
- Javobda tilga olingan barcha qonun, kodeks va Oliy sud Plenumi qarorlarining to‘liq nomi hamda bosiladigan Markdown havolalarini bering (berilgan aniq \`https://lex.uz/uz/docs/...\` havolalaridan foydalaning; agar aniq doc ID berilmagan bo‘lsa, \`https://lex.uz/uz/search/all?query=...\` havolasini bering).
- Ichki PDF manba ishlatilgan bo‘lsa: \`Ichki PDF manba: [Hujjat nomi]\` tarzida qayd eting.
- Ushbu 3-bo‘limdan keyin HECH QANDAY eslatma, tavsiya yoki 4-bo‘lim yozmang.`;

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

function extractResponseText(response: GenerateContentResponse | undefined): string {
  if (!response) return '';
  const direct = response.text?.trim();
  if (direct) return direct;

  const parts = response.candidates?.[0]?.content?.parts ?? [];
  return parts
    .filter((p) => !p.thought && typeof p.text === 'string')
    .map((p) => p.text ?? '')
    .join('')
    .trim();
}

function cyrillicToLatinUz(input: string): string {
  const map: Record<string, string> = {
    А: 'A', а: 'a', Б: 'B', б: 'b', В: 'V', в: 'v', Г: 'G', г: 'g',
    Д: 'D', д: 'd', Е: 'E', е: 'e', Ё: 'Yo', ё: 'yo', Ж: 'J', ж: 'j',
    З: 'Z', з: 'z', И: 'I', и: 'i', Й: 'Y', й: 'y', К: 'K', к: 'k',
    Л: 'L', л: 'l', М: 'M', м: 'm', Н: 'N', н: 'n', О: 'O', о: 'o',
    П: 'P', п: 'p', Р: 'R', р: 'r', С: 'S', с: 's', Т: 'T', т: 't',
    У: 'U', у: 'u', Ф: 'F', ф: 'f', Х: 'X', х: 'x', Ц: 'Ts', ц: 'ts',
    Ч: 'Ch', ч: 'ch', Ш: 'Sh', ш: 'sh', Ъ: "'", ъ: "'", Ь: '', ь: '',
    Э: 'E', э: 'e', Ю: 'Yu', ю: 'yu', Я: 'Ya', я: 'ya', Ў: "O'", ў: "o'",
    Қ: 'Q', қ: 'q', Ғ: "G'", ғ: "g'", Ҳ: 'H', ҳ: 'h',
  };
  let out = '';
  for (const ch of input) {
    out += map[ch] ?? ch;
  }
  return out;
}

function stripHtmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<sup>\s*([^<\s]+)\s*<\/sup>/gi, '-$1')
    .replace(/<\/(p|div|li|tr|h[1-6]|br)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|\u00a0/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&laquo;|&raquo;/gi, '"')
    .replace(
      /Hujjatga taklif yuborish|Audioni tinglash|Hujjat elementidan havola olish|Oldingi\s+tahrirga\s+qarang\.?/gi,
      ' '
    )
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\b(\d+)\s+(\d+)\s*-\s*modda\b/gi, '$1-$2-modda')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

function normalizeSearchStr(val: string): string {
  return val.toLowerCase().replace(/[‘’ʻʼ`]/g, "'");
}

function detectCodesFromText(text: string): CoreCodeKey[] {
  const matched: CoreCodeKey[] = [];
  for (const spec of Object.values(CORE_CODES)) {
    if (spec.keywords.some((re) => re.test(text))) {
      matched.push(spec.key);
    }
  }
  if (matched.length === 0) {
    matched.push('KONST');
  }
  return matched.slice(0, 5);
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
    const timer = setTimeout(() => controller.abort(), 3500);
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

const lexDocCache = new Map<string, { plain: string; expiresAt: number }>();

async function fetchLexDocSnippet(url: string, keywords: string[]): Promise<string> {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== 'lex.uz' && !parsed.hostname.endsWith('.lex.uz')) {
      return '';
    }

    let plain = '';
    const cached = lexDocCache.get(url);
    if (cached && cached.expiresAt > Date.now()) {
      plain = cached.plain;
    } else {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 13_000);
      try {
        const res = await fetch(url, {
          signal: controller.signal,
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; PROLEX/1.0)',
            Accept: 'text/html',
          },
        });
        if (!res.ok) return '';
        const html = await res.text();
        plain = cyrillicToLatinUz(stripHtmlToText(html));
        if (plain && plain.length >= 120) {
          lexDocCache.set(url, { plain, expiresAt: Date.now() + 30 * 60 * 1000 });
        }
      } finally {
        clearTimeout(timer);
      }
    }
    if (!plain || plain.length < 120) return '';

      const lowerKw = Array.from(
        new Set(
          keywords
            .map((k) => normalizeSearchStr(k).replace(/^[‘’'"ʻʼ.,()]+|[‘’'"ʻʼ.,()]+$/g, ''))
            .filter((k) => k.length > 2)
        )
      );

      // Extract full contiguous article blocks (skipping Table of Contents lines)
      const articleRegex = /(?:^|\n)\s*(\d+(?:-\d+)?-modda\.[^\n]*)/gi;
      const headers: Array<{ index: number; title: string }> = [];
      let m: RegExpExecArray | null;
      while ((m = articleRegex.exec(plain)) !== null) {
        const startIdx = m.index + (m[0].startsWith('\n') ? 1 : 0);
        headers.push({ index: startIdx, title: m[1].trim() });
      }

      if (headers.length >= 3) {
        const articles: Array<{ title: string; body: string; score: number; idx: number }> = [];
        for (let i = 0; i < headers.length; i++) {
          const start = headers[i].index;
          const end = i + 1 < headers.length ? headers[i + 1].index : Math.min(plain.length, start + 10000);
          const block = plain.slice(start, end).trim();
          const bodyOnly = block.slice(headers[i].title.length).trim();
          // Skip Table of Contents items (which have little/no body before the next heading)
          if (bodyOnly.length < 90) continue;

          const lowTitle = normalizeSearchStr(headers[i].title);
          const lowBlock = normalizeSearchStr(block);
          let score = 0;
          for (const kw of lowerKw) {
            if (lowTitle.includes(kw)) score += 6;
            else if (lowBlock.includes(kw)) score += 2;
          }
          if (score > 0) {
            articles.push({
              title: headers[i].title,
              body: block.slice(0, 9500),
              score,
              idx: i,
            });
          }
        }

        if (articles.length > 0) {
          articles.sort((a, b) => b.score - a.score || a.idx - b.idx);
          const picked: string[] = [];
          let totalLen = 0;
          for (const art of articles.slice(0, 4)) {
            if (totalLen + art.body.length > 14000 && picked.length > 0) break;
            picked.push(art.body);
            totalLen += art.body.length;
          }
          return picked.join('\n\n').slice(0, 14000);
        }
      }

      // Fallback for non-code documents (e.g., Plenum resolutions, laws without standard headings)
      const lines = plain.split('\n').filter((l) => l.trim().length > 20);
      const scored = lines
        .map((line, idx) => {
          const low = line.toLowerCase();
          let score = 0;
          for (const kw of lowerKw) {
            if (low.includes(kw)) score += 3;
          }
          if (/^\d+(-\d+)?-modda\b/i.test(line)) score += 2;
          return { idx, score };
        })
        .filter((s) => s.score > 0)
        .sort((a, b) => b.score - a.score || a.idx - b.idx);

      const usedIdx = new Set<number>();
      const blocks: string[] = [];
      for (const hit of scored.slice(0, 3)) {
        if (usedIdx.has(hit.idx)) continue;
        const start = Math.max(0, hit.idx - 1);
        const end = Math.min(lines.length, hit.idx + 7);
        for (let k = start; k < end; k++) usedIdx.add(k);
        blocks.push(lines.slice(start, end).join('\n'));
      }
      return blocks.join('\n...\n').slice(0, 5000);
  } catch {
    return '';
  }
}

interface LegalIntentPlan {
  codesToCheck: CoreCodeKey[];
  suspectedArticles: string[];
  lexSearchQueries: string[];
}

async function analyzeLegalIntent(
  ai: GoogleGenAI,
  userPrompt: string,
  historySnippet: string
): Promise<LegalIntentPlan> {
  const fallbackCodes = detectCodesFromText(`${historySnippet} ${userPrompt}`);
  const fallbackPlan: LegalIntentPlan = {
    codesToCheck: fallbackCodes,
    suspectedArticles: [],
    lexSearchQueries: [userPrompt.slice(0, 110)],
  };

  try {
    const res = await withTimeout(
      ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: `O'zbekiston huquqi bo'yicha quyidagi murojaatni tahlil qiling va JSON qaytaring.
Murojaat: "${userPrompt.slice(0, 2500)}"
Kontekst: "${historySnippet.slice(0, 800)}"

Mavjud kodeks/qonun kalitlari: KONST, JK, JPK, FK1, FK2, FPK, MJtK, MSIYtK, MK, OK, SK, PROK, KORR.`,
              },
            ],
          },
        ],
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              codesToCheck: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              suspectedArticles: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              lexSearchQueries: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
            },
          },
        },
      }),
      7000,
      'INTENT'
    );

    const parsed = JSON.parse((res.text ?? '{}').trim()) as Partial<LegalIntentPlan>;
    const validCodes = Array.isArray(parsed.codesToCheck)
      ? parsed.codesToCheck.filter((c): c is CoreCodeKey => VALID_CODE_KEYS.has(c as CoreCodeKey))
      : [];
    const mergedCodes = Array.from(new Set<CoreCodeKey>([...validCodes, ...fallbackCodes])).slice(
      0,
      5
    );
    const articles = Array.isArray(parsed.suspectedArticles)
      ? parsed.suspectedArticles.map(String).slice(0, 10)
      : [];
    const queries = Array.isArray(parsed.lexSearchQueries)
      ? parsed.lexSearchQueries.map(String).filter(Boolean).slice(0, 2)
      : fallbackPlan.lexSearchQueries;

    return {
      codesToCheck: mergedCodes.length > 0 ? mergedCodes : fallbackCodes,
      suspectedArticles: articles,
      lexSearchQueries: queries.length > 0 ? queries : fallbackPlan.lexSearchQueries,
    };
  } catch {
    return fallbackPlan;
  }
}

async function gatherLexUzContext(
  userPrompt: string,
  intent: LegalIntentPlan
): Promise<{ contextBlock: string; verifiedSources: GroundingSource[] }> {
  const verifiedSources: GroundingSource[] = [];
  const seenUrls = new Set<string>();

  for (const key of intent.codesToCheck) {
    const spec = CORE_CODES[key];
    if (spec && !seenUrls.has(spec.url)) {
      seenUrls.add(spec.url);
      verifiedSources.push({ title: spec.officialName, url: spec.url });
    }
  }

  let contextBlock = '';

  try {
    const primaryQuery = intent.lexSearchQueries[0] || userPrompt.slice(0, 120);
    const plenumQuery = `${primaryQuery.slice(0, 70)} Oliy sud Plenumi qarori`;
    const [mainHits, plenumHits] = await Promise.all([
      searchSerperLexUz(primaryQuery, 6),
      searchSerperLexUz(plenumQuery, 3),
    ]);

    const combinedHits = [...mainHits, ...plenumHits];
    const fetchTargets: Array<{ title: string; url: string; snippet: string }> = [];
    const targetUrls = new Set<string>();

    for (const item of combinedHits) {
      if (!item.link || !item.title) continue;
      try {
        const u = new URL(item.link);
        if (u.hostname !== 'lex.uz' && !u.hostname.endsWith('.lex.uz')) continue;
        if (!seenUrls.has(item.link)) {
          seenUrls.add(item.link);
          const cleanTitle = item.title.replace(/\s*\|\s*lex\.uz.*$/i, '').trim();
          verifiedSources.push({ title: cleanTitle, url: item.link });
        }
        if (!targetUrls.has(item.link)) {
          targetUrls.add(item.link);
          fetchTargets.push({
            title: item.title.replace(/\s*\|\s*lex\.uz.*$/i, '').trim(),
            url: item.link,
            snippet: item.snippet || '',
          });
        }
      } catch {
        // ignore invalid URL
      }
    }

    // Ensure primary detected Core Codes are also fetched directly from Lex.uz
    for (const key of intent.codesToCheck.slice(0, 2)) {
      const spec = CORE_CODES[key];
      if (spec && !targetUrls.has(spec.url)) {
        targetUrls.add(spec.url);
        fetchTargets.push({
          title: spec.officialName,
          url: spec.url,
          snippet: '',
        });
      }
    }

    const keywords = [
      ...intent.suspectedArticles,
      ...userPrompt
        .split(/\s+/)
        .map((w) => w.replace(/[^a-zA-Z0-9‘’'ʻʼ-]/g, ''))
        .filter((w) => w.length > 3),
    ].slice(0, 16);

    const snippets = await Promise.all(
      fetchTargets.slice(0, 3).map(async (t) => {
        const pageExcerpt = await fetchLexDocSnippet(t.url, keywords);
        return { ...t, pageExcerpt };
      })
    );

    if (snippets.length > 0 || verifiedSources.length > 0) {
      const sourceList = verifiedSources
        .map((s) => `- ${s.title}: ${s.url}`)
        .join('\n');
      const excerptBlocks = snippets
        .filter((s) => s.pageExcerpt || s.snippet)
        .map(
          (s) =>
            `\n--- Lex.uz manba: ${s.title} (${s.url}) ---\n${s.pageExcerpt || s.snippet}`
        )
        .join('\n');
      contextBlock = `\n[LEX.UZ RASMIY MATN VA HAVOLALAR]:\n${sourceList}\n${excerptBlocks}`;
    }
  } catch {
    if (verifiedSources.length > 0) {
      contextBlock = `\n[LEX.UZ RASMIY HAVOLALAR]:\n${verifiedSources
        .map((s) => `- ${s.title}: ${s.url}`)
        .join('\n')}`;
    }
  }

  return { contextBlock, verifiedSources };
}

async function generateLegalAnalysis(params: {
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  userPrompt: string;
  pdfContext?: {
    catalogSummary: string;
    matches: PdfExcerptPayload[];
  };
}): Promise<ChatApiResponse> {
  const ai = createGeminiClient();
  const historySnippet = params.history
    .slice(-3)
    .map((m) => m.content)
    .join(' ');

  const intent = await withTimeout(
    analyzeLegalIntent(ai, params.userPrompt, historySnippet),
    7500,
    'INTENT'
  ).catch(() => ({
    codesToCheck: detectCodesFromText(`${historySnippet} ${params.userPrompt}`),
    suspectedArticles: [],
    lexSearchQueries: [params.userPrompt.slice(0, 110)],
  }));

  const lexResult = await withTimeout(
    gatherLexUzContext(params.userPrompt, intent),
    15500,
    'LEXUZ'
  ).catch(() => ({
    contextBlock: '',
    verifiedSources: intent.codesToCheck
      .map((k) => CORE_CODES[k])
      .filter(Boolean)
      .map((s) => ({ title: s.officialName, url: s.url })),
  }));

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

  const contents: Content[] = [
    ...params.history.slice(-8).map(
      (m): Content => ({
        role: m.role === 'user' ? 'user' : 'model',
        parts: [{ text: m.content.slice(0, 4000) } as Part],
      })
    ),
    {
      role: 'user',
      parts: [
        {
          text: `${params.userPrompt}\n${lexResult.contextBlock}${pdfBlock}\n\nIltimos, salomlashuv va kirish so‘zlarisiz, "Savol mohiyati" bo‘limisiz va oxirida qo‘shimcha eslatma/tavsiya/4-bo‘lim yozmasdan, darhol "### 1. Hujjat nomi va aniq moddalar" dan boshlab faqat 3 ta bo‘limda ("### 1. Hujjat nomi va aniq moddalar", "### 2. Huquqiy tahlil hamda huquqiy xulosa", "### 3. Foydalanilgan qonunlar va Lex.uz havolalari") so‘ralgan masala bo‘yicha Lex.uz rasmiy matniga muvofiq to‘liq va batafsil javob bering.`,
        },
      ],
    },
  ];

  const plans = [
    { model: 'gemini-2.5-flash', useSearch: true, timeoutMs: 28000 },
    { model: 'gemini-2.5-flash', useSearch: false, timeoutMs: 24000 },
    { model: 'gemini-4-hydrogen', useSearch: false, timeoutMs: 22000 },
    { model: 'gemini-3.1-flash-lite', useSearch: false, timeoutMs: 18000 },
  ];

  let response: GenerateContentResponse | undefined;
  let answerText = '';
  let lastErr: unknown = null;

  for (const plan of plans) {
    try {
      const candidate = await withTimeout(
        ai.models.generateContent({
          model: plan.model,
          contents,
          config: {
            systemInstruction: PROLEX_SYSTEM_INSTRUCTION,
            ...(plan.useSearch ? { tools: [{ googleSearch: {} }] } : {}),
          },
        }),
        plan.timeoutMs,
        plan.model
      );
      const text = extractResponseText(candidate);
      if (text) {
        response = candidate;
        answerText = text;
        break;
      }
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : '';
      if (
        msg.includes('API_KEY_INVALID') ||
        msg.includes('PERMISSION_DENIED') ||
        msg.toLowerCase().includes('api key not valid')
      ) {
        throw err;
      }
      continue;
    }
  }

  if (!response || !answerText) {
    throw lastErr ?? new Error('EMPTY_MODEL_RESPONSE');
  }

  const seenUrls = new Set<string>();
  const sources: GroundingSource[] = [];

  for (const s of lexResult.verifiedSources) {
    if (!seenUrls.has(s.url)) {
      seenUrls.add(s.url);
      sources.push(s);
    }
  }

  const rawChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
  for (const chunk of rawChunks) {
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

  let finalAnswerText = answerText.trim();
  const section1Match = finalAnswerText.match(
    /(?:^|\n)(?:#{1,4}\s*|\*{0,2})1\.\s*Hujjat nomi va aniq moddalar/i
  );
  if (section1Match && typeof section1Match.index === 'number') {
    finalAnswerText = finalAnswerText.slice(section1Match.index).trimStart();
  }

  // Strip any accidental "Savol mohiyati" block or trailing 4th section / Eslatma / Tavsiya block
  finalAnswerText = finalAnswerText
    .replace(
      /(?:^|\n)#{1,4}\s*(?:\d+\.\s*)?Savol mohiyati[\s\S]*?(?=\n#{1,4}\s*(?:1\.|2\.|3\.))/gi,
      '\n'
    )
    .replace(/\n#{1,4}\s*4\.[\s\S]*$/i, '')
    .replace(
      /\n+(?:#{1,4}\s*)?\*{0,2}(?:Eslatma|Tavsiya|Muhim eslatma)\s*:[\s\S]*$/i,
      ''
    )
    .trim();

  const hasSection3 = /foydalanilgan qonunlar va lex\.uz havolalari/i.test(
    finalAnswerText
  );

  if (!hasSection3) {
    const linkLines = lexSources.slice(0, 8).map((s) => `- [${s.title}](${s.url})`);
    if (linkLines.length === 0) {
      linkLines.push(
        `- [O'zbekiston Respublikasi qonunchilik ma'lumotlari milliy bazasi — Lex.uz](https://lex.uz/uz/search/all?query=${encodeURIComponent(
          params.userPrompt.slice(0, 60)
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

  return {
    text: finalAnswerText.trim(),
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
    const MAX_BODY = 512 * 1024;

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

export async function executeChatRequest(
  rawBody: Record<string, unknown> | null
): Promise<{ status: number; payload: unknown }> {
  if (!rawBody) {
    return { status: 400, payload: { error: 'So‘rov tanasi noto‘g‘ri formatda.' } };
  }

  const body = rawBody as Partial<ChatApiRequest>;
  const userPrompt = typeof body.userPrompt === 'string' ? body.userPrompt.trim() : '';

  if (!userPrompt) {
    return { status: 400, payload: { error: 'Savol yoki kazus matnini kiriting.' } };
  }
  if (userPrompt.length > 15000) {
    return {
      status: 400,
      payload: { error: 'Matn hajmi 15 000 belgidan oshmasligi kerak.' },
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

  try {
    const analysis = await generateLegalAnalysis({
      history: safeHistory,
      userPrompt,
      pdfContext: {
        catalogSummary: safeCatalogSummary,
        matches: safePdfMatches,
      },
    });
    return { status: 200, payload: analysis };
  } catch (err) {
    console.error('[PROLEX Chat API Error]:', err);
    const errMsg = err instanceof Error ? err.message : String(err ?? '');

    if (errMsg === 'MISSING_GEMINI_API_KEY') {
      return {
        status: 503,
        payload: {
          error:
            'Gemini API kaliti topilmadi. Vercel Environment Variables bo‘limiga GEMINI_API_KEY (yoki VITE_GEMINI_API_KEY) qo‘shib, loyihani Redeploy qiling.',
        },
      };
    }
    if (
      errMsg.includes('API_KEY_INVALID') ||
      errMsg.includes('PERMISSION_DENIED') ||
      errMsg.toLowerCase().includes('api key not valid')
    ) {
      return {
        status: 502,
        payload: {
          error: `Gemini API kaliti yaroqsiz yoki ruxsat etilmagan (${errMsg.slice(0, 220)}).`,
        },
      };
    }
    if (errMsg.includes('RESOURCE_EXHAUSTED') || errMsg.includes('429')) {
      return {
        status: 429,
        payload: {
          error: `Gemini API kvotasi tugadi (429): ${errMsg.slice(0, 220)}. Birozdan so‘ng qayta urinib ko‘ring.`,
        },
      };
    }
    if (
      errMsg.includes('503') ||
      errMsg.includes('UNAVAILABLE') ||
      errMsg.toLowerCase().includes('high demand')
    ) {
      return {
        status: 503,
        payload: {
          error: `Gemini xizmatida vaqtincha yuqori yuklama kuzatilmoqda (503): ${errMsg.slice(0, 220)}.`,
        },
      };
    }
    if (errMsg === 'EMPTY_MODEL_RESPONSE') {
      return {
        status: 502,
        payload: {
          error:
            'AI modelidan bo‘sh javob qaytdi. Iltimos, kazus yoki savolni aniqroq yozib qayta urinib ko‘ring.',
        },
      };
    }
    if (errMsg.startsWith('TIMEOUT_')) {
      return {
        status: 504,
        payload: {
          error:
            'So‘rovni qayta ishlash vaqti tugadi. Iltimos, savolni qayta yuborib ko‘ring.',
        },
      };
    }
    return {
      status: 502,
      payload: {
        error: errMsg
          ? `AI tahlil xatoligi: ${errMsg.slice(0, 260)}`
          : 'Huquqiy tahlilni shakllantirishda noma’lum xatolik yuz berdi.',
      },
    };
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
  const result = await executeChatRequest(body);
  sendJson(res, result.status, result.payload);
}
