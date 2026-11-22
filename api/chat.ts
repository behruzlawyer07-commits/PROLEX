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
Foydalanuvchi yuborgan **har qanday turdagi murojaatga** — xoh u **amaliy kazus**, xoh **nazariy yuridik savol**, xoh **ikki tushunchani taqqoslash / farqini aniqlash savoli** (masalan, "jazodan ozod qilish bilan javobgarlikdan ozod qilishning farqi"), xoh **protsessual tartib yoki hujjat tuzish savoli** bo‘lsin — avvalo savolning **aniq mohiyatini** anglang, so‘ngra **Lex.uz milliy qonunchilik bazasidan olingan rasmiy normalar, kodeks sharhlari, Oliy sud Plenumi qarorlari** hamda **Administrator yuklagan ichki PDF manbalar** asosida **aniq, to‘liq, mantiqan izchil va batafsil** javob bering.

MAJBURIY QOIDALAR VA METODOLOGIYA:
1. TIL VA USLUB: Faqat o‘zbek tilida (lotin alifbosida), rasmiy-ilmiy, aniq yuridik va prokurorlik tahlili uslubida javob bering. Yuzaki yoki umumiy javob bermang — har bir xulosani aniq modda, qism, band, muddat va huquqiy oqibat bilan asoslang.
2. LEX.UZ VA ICHKI PDF MANBALARGA TAYANISH:
   a) So‘rov bilan birga sizga \`[LEX.UZ RASMIY MATN]\` blokida Lex.uz saytidagi haqiqiy \`https://lex.uz/uz/docs/...\` havolalari va topilgan hujjat parchalari beriladi. Ulardan foydalaning.
   b) Administrator yuklagan ichki PDF manbalardan parcha berilgan bo‘lsa, ularni ham (hujjat nomi va sahifasi bilan) tahlilga integratsiya qiling.
3. HALOLLIK VA ANIQLIK: Hech qachon mavjud bo‘lmagan modda raqamlari, qismlar, bandlar yoki Oliy sud Plenum qarori raqamlarini o‘ylab topmang (fabrikat qilmang). Modda matnining oxirgi tahririga shubha bo‘lsa, buni ochiq ko‘rsating.
4. BEVOSITA VA BILVOSITA TARTIBGA SOLISH: Har qanday savol yoki kazusda quyidagilarni alohida ajratib tahlil qiling:
   - **Bevosita tartibga soluvchi normativ-huquqiy hujjatlar** (masalani to‘g‘ridan-to‘g‘ri tartibga soluvchi kodeks moddalari, tarkib belgilari, institut shartlari, protsessual tartib, muddatlar va javobgarlik/ozod qilish choralari);
   - **Bilvosita tartibga soluvchi normativ-huquqiy hujjatlar** (konstitutsiyaviy tamoyillar, prokuror nazorati vakolatlari, Oliy sud Plenumi tushuntirishlari, yondosh moddiy/protsessual normalar va qonunosti hujjatlari).
5. SAVOL TURIGA MOS CHUQUR TAHLIL:
   - Agar murojaat **kazus (amaliy holat)** bo‘lsa: jinoyat/huquqbuzarlik tarkibining barcha elementlari (obyekt, obyektiv tomon, subyekt, subyektiv tomon) yoki nizoli huquqiy munosabat shartlarini faktlarga birma-bir tatbiq eting, aniq kvalifikatsiya va vakolatli organ/prokurorning protsessual qadamlarini ko‘rsating.
   - Agar murojaat **taqqoslash / farqini so‘rash savoli** bo‘lsa: har ikki huquqiy institutni aniq moddalari bilan ta’riflang, **albatta Markdown taqqoslash jadvali** (Mezon | 1-institut | 2-institut) tuzing hamda huquqiy asosi, qo‘llanilish bosqichi, vakolatli organi, sudlanganlik/huquqiy oqibatlari bo‘yicha barcha asosiy farqlarni batafsil ochib bering.
   - Agar murojaat **nazariy yoki protsessual savol** bo‘lsa: tushunchaning yuridik mohiyati, qonunchilikdagi turlari, qo‘llanilish shartlari, istisnolari va amaliyotdagi ahamiyatini moddama-modda yoritib bering.

HAR BIR JAVOBNING MAJBURIY 4 QISMLI BATAFSIL TUZILISHI (USHBU 4 TA SARLAVHANI AYNAN SAQLANG):

### 1. Savol mohiyati
- Savol yoki kazusning asosiy yuridik mohiyatini 2–4 jumlada aniq shakllantiring: qanday huquqiy masala yoki institut ko‘tarilmoqda, qaysi huquq sohasiga taalluqli va amalda qaysi aniq mezonlarga javob berish talab etiladi.

### 2. Hujjat nomi va aniq moddalar
- Qo‘llaniladigan har bir normativ-huquqiy hujjatning to‘liq rasmiy nomi (Kodekslar, Qonunlar, kodeks sharhlari va Oliy sud Plenumi qarorlari) hamda aniq moddalari, boblari, qismlari va bandlari — bevosita va bilvosita normalarga ajratgan holda.
- Agar Administrator yuklagan PDF manbadan parcha berilgan bo‘lsa — hujjat nomi va sahifasini ham albatta ko‘rsating.

### 3. Bevosita va bilvosita tartibga solish tahlili hamda huquqiy xulosa
- **Bevosita tartibga soluvchi normativ-huquqiy hujjatlar tahlili:** Savol yoki kazus turiga mos ravishda batafsil yuridik tahlil (kazus bo‘lsa — faktlar va tarkib elementlari tahlili; taqqoslash bo‘lsa — batafsil mezonlar tahlili va **Markdown taqqoslash jadvali**; nazariy/protsessual savol bo‘lsa — shartlar, turlar va mexanizmlar tahlili).
- **Bilvosita tartibga soluvchi normativ-huquqiy hujjatlar tahlili:** Konstitutsiyaviy kafolatlar, prokuror nazorati vakolatlari, Oliy sud Plenumi tushuntirishlari, yondosh moddiy/protsessual normalar hamda Administrator yuklagan PDF sharh/qo‘llanmalar ta’siri.
- **Yakuniy huquqiy xulosa va amaliy ahamiyati:** Aniq kvalifikatsiya, farqlar xulosasi yoki vakolatli organ/prokurorning protsessual harakatlari bo‘yicha mukammal huquqiy xulosa.

### 4. Foydalanilgan qonunlar va Lex.uz havolalari
- Javobda tilga olingan barcha qonun, kodeks va Oliy sud Plenumi qarorlari uchun bosiladigan Markdown havolalari bering (berilgan aniq \`https://lex.uz/uz/docs/...\` havolalaridan foydalaning; agar aniq doc ID berilmagan bo‘lsa, \`https://lex.uz/uz/search/all?query=...\` havolasini bering).
- Ichki PDF manba ishlatilgan bo‘lsa: \`Ichki PDF manba: [Hujjat nomi]\` tarzida qayd eting.
- Eng oxirida albatta ushbu eslatmani yozing: *"Eslatma: Normativ-huquqiy hujjatlarning amaldagi so‘nggi tahriri va rasmiy matnini bevosita Lex.uz milliy bazasi orqali tekshirishingiz tavsiya etiladi."*`;

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
    .replace(/<\/(p|div|li|tr|h[1-6]|br)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&laquo;|&raquo;/gi, '"')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
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

async function fetchLexDocSnippet(url: string, keywords: string[]): Promise<string> {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== 'lex.uz' && !parsed.hostname.endsWith('.lex.uz')) {
      return '';
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3200);
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
      const plain = cyrillicToLatinUz(stripHtmlToText(html));
      if (!plain || plain.length < 120) return '';

      const lines = plain.split('\n').filter((l) => l.trim().length > 20);
      const lowerKw = keywords.map((k) => k.toLowerCase()).filter((k) => k.length > 2);
      const scored = lines
        .map((line, idx) => {
          const low = line.toLowerCase();
          let score = 0;
          for (const kw of lowerKw) {
            if (low.includes(kw)) score += 3;
          }
          if (/^\d+(-\d+)?-modda\b/i.test(line)) score += 2;
          return { line, idx, score };
        })
        .sort((a, b) => b.score - a.score || a.idx - b.idx);

      const picked = scored.slice(0, 8).map((s) => s.line.slice(0, 380));
      return picked.join('\n').slice(0, 2200);
    } finally {
      clearTimeout(timer);
    }
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

    for (const item of combinedHits) {
      if (!item.link || !item.title) continue;
      try {
        const u = new URL(item.link);
        if (u.hostname !== 'lex.uz' && !u.hostname.endsWith('.lex.uz')) continue;
        if (seenUrls.has(item.link)) continue;
        seenUrls.add(item.link);
        const cleanTitle = item.title.replace(/\s*\|\s*lex\.uz.*$/i, '').trim();
        verifiedSources.push({ title: cleanTitle, url: item.link });
        fetchTargets.push({
          title: cleanTitle,
          url: item.link,
          snippet: item.snippet || '',
        });
      } catch {
        // ignore invalid URL
      }
    }

    const keywords = [
      ...intent.suspectedArticles,
      ...userPrompt
        .split(/\s+/)
        .map((w) => w.replace(/[^a-zA-Z0-9‘’']/g, ''))
        .filter((w) => w.length > 3),
    ].slice(0, 14);

    const snippets = await Promise.all(
      fetchTargets.slice(0, 2).map(async (t) => {
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
    7500,
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
          text: `${params.userPrompt}\n${lexResult.contextBlock}${pdfBlock}\n\nIltimos, PROLEX standartidagi 4 qismli to‘liq yuridik tahlil bering.`,
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
  const verificationNote =
    '*Eslatma: Normativ-huquqiy hujjatlarning amaldagi so‘nggi tahriri va rasmiy matnini bevosita Lex.uz milliy bazasi orqali tekshirishingiz tavsiya etiladi.*';

  let finalAnswerText = answerText.trim();
  const hasSection4 = /foydalanilgan qonunlar va lex\.uz havolalari/i.test(
    finalAnswerText
  );

  if (!hasSection4) {
    const linkLines = lexSources.slice(0, 8).map((s) => `- [${s.title}](${s.url})`);
    if (linkLines.length === 0) {
      linkLines.push(
        `- [O'zbekiston Respublikasi qonunchilik ma'lumotlari milliy bazasi — Lex.uz](https://lex.uz/uz/search/all?query=${encodeURIComponent(
          params.userPrompt.slice(0, 60)
        )})`
      );
    }
    const pdfLines = pdfTitles.map((t) => `- Ichki PDF manba: **${t}**`);
    finalAnswerText += `\n\n### 4. Foydalanilgan qonunlar va Lex.uz havolalari\n${[
      ...linkLines,
      ...pdfLines,
    ].join('\n')}\n\n${verificationNote}`;
  } else {
    const noteRegex =
      /\n*\*?Eslatma:\s*Normativ-huquqiy hujjatlarning amaldagi[\s\S]*?tavsiya etiladi\.?\*?\s*$/i;
    const hadBottomNote = noteRegex.test(finalAnswerText);
    const extractedNote = hadBottomNote
      ? finalAnswerText.match(noteRegex)?.[0].trim() ?? verificationNote
      : verificationNote;

    if (hadBottomNote) {
      finalAnswerText = finalAnswerText.replace(noteRegex, '').trimEnd();
    }

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

    finalAnswerText += `\n\n${extractedNote}`;
  }

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
