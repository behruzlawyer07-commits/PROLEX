import type {
  ChatApiRequest,
  ChatApiResponse,
  GroundingSource,
} from '../types/sherlex';

export class GeminiClientError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}

interface CoreCodeSpec {
  key: string;
  officialName: string;
  url: string;
  keywords: RegExp[];
}

const CORE_CODES: CoreCodeSpec[] = [
  {
    key: 'KONST',
    officialName: "O'zbekiston Respublikasi Konstitutsiyasi (Yangi tahrir, 30.04.2023)",
    url: 'https://lex.uz/uz/docs/6445145',
    keywords: [/konstitutsiy/i, /asosiy qonun/i, /konstitutsion/i],
  },
  {
    key: 'JK',
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
  {
    key: 'JPK',
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
  {
    key: 'FK1',
    officialName: "O'zbekiston Respublikasining Fuqarolik kodeksi (birinchi qism)",
    url: 'https://lex.uz/uz/docs/111189',
    keywords: [
      /fuqarolik\s+kodeks/i,
      /\bfk\b/i,
      /bitim|shartnoma|majburiyat|mulk|da’vo\s+muddati|davo\s+muddati/i,
      /yuridik\s+shaxs|ishonchnoma|haqiqiy\s+emas/i,
    ],
  },
  {
    key: 'FK2',
    officialName: "O'zbekiston Respublikasining Fuqarolik kodeksi (ikkinchi qism)",
    url: 'https://lex.uz/uz/docs/-180552',
    keywords: [
      /oldi[-\s]*sotdi|ijara|pudrat|qarz|kredit|kafillik|sug‘urta|sugurta/i,
      /zarar\s+yetkazish|ma’naviy\s+zarar|manaviy\s+zarar|meros|vasiyat/i,
    ],
  },
  {
    key: 'FPK',
    officialName: "O'zbekiston Respublikasining Fuqarolik protsessual kodeksi",
    url: 'https://lex.uz/uz/docs/3517337',
    keywords: [/fuqarolik\s+protsessual/i, /\bfpk\b/i, /da’vo\s+ariza|davo\s+ariza|apellyatsiya|kassatsiya/i],
  },
  {
    key: 'MJtK',
    officialName: "O'zbekiston Respublikasining Ma'muriy javobgarlik to'g'risidagi kodeksi",
    url: 'https://lex.uz/uz/docs/97664',
    keywords: [/ma’muriy\s+javobgarlik|mamuriy\s+javobgarlik/i, /\bmjtk\b/i, /ma’muriy\s+huquqbuzarlik|jarima/i],
  },
  {
    key: 'MSIYtK',
    officialName: "O'zbekiston Respublikasining Ma'muriy sud ishlarini yuritish to'g'risidagi kodeksi",
    url: 'https://lex.uz/uz/docs/3527353',
    keywords: [/ma’muriy\s+sud|mamuriy\s+sud/i, /\bmsiytk\b/i, /mansabdor\s+shaxs.*harakat.*ustidan/i],
  },
  {
    key: 'MK',
    officialName: "O'zbekiston Respublikasining Mehnat kodeksi (28.10.2022)",
    url: 'https://lex.uz/uz/docs/6257288',
    keywords: [/mehnat\s+kodeks/i, /\bmk\b/i, /ishdan\s+bo‘shatish|ishdan\s+boshatish|mehnat\s+shartnoma|intizomiy\s+jazo|ta’til|tatil/i],
  },
  {
    key: 'OK',
    officialName: "O'zbekiston Respublikasining Oila kodeksi",
    url: 'https://lex.uz/uz/docs/-104720',
    keywords: [/oila\s+kodeks/i, /\bok\b/i, /nikoh|ajralish|aliment|otalik|farzandlikka|vasiylik/i],
  },
  {
    key: 'SK',
    officialName: "O'zbekiston Respublikasining Soliq kodeksi",
    url: 'https://lex.uz/uz/docs/4674902',
    keywords: [/soliq\s+kodeks/i, /\bsk\b/i, /soliq\s+to‘lash|soliq\s+tolash|qqs|soliq\s+tekshiruv/i],
  },
  {
    key: 'PROK',
    officialName: '"Prokuratura to\'g\'risida"gi O\'zbekiston Respublikasi Qonuni (Yangi tahrir)',
    url: 'https://lex.uz/uz/docs/-106197',
    keywords: [/prokuror/i, /prokuratura/i, /protest/i, /taqdimnoma/i, /nazorat\s+vakolat/i],
  },
  {
    key: 'KORR',
    officialName: '"Korrupsiyaga qarshi kurashish to\'g\'risida"gi O\'zbekiston Respublikasi Qonuni (O\'RQ-419)',
    url: 'https://lex.uz/uz/docs/-3088008',
    keywords: [/korrupsiya/i, /manfaatlar\s+to‘qnashuvi|manfaatlar\s+toqnashuvi/i],
  },
];

const PROLEX_SYSTEM_INSTRUCTION = `Siz "PROLEX" — O'zbekiston Respublikasi Huquqni muhofaza qilish akademiyasi (HMQA) tinglovchilari hamda O'zbekiston Respublikasi Prokuratura organlari xodimlari uchun yaratilgan ixtisoslashtirilgan, yuqori malakali huquqshunos-olim va prokuror-tahlilchi sun'iy intellekt yordamchisisiz.

ASOSIY VAZIFA:
Har bir savol, kazus yoki ilova qilingan rasm bo‘yicha O‘zbekiston Respublikasining Lex.uz dagi AMALDAGI normativ-huquqiy hujjatlari (Kodekslar, Qonunlar, Prezident Farmon va Qarorlari — PF/PQ, Vazirlar Mahkamasi qarorlari, Oliy sud Plenumi qarorlari) hamda **Administrator yuklagan ichki PDF manbalar** asosida **prokuratura amaliyoti uchun chuqur, izchil, mantiqan to‘liq va asosli** huquqiy tahlil bering. Javobni qisqa yoki yuzaki yozmang.

QAT'IY MAJBURIY QOIDALAR VA ICHKI TEKSHIRUV TARTIBI:
1. KIRISH MATNI, SALOMLASHUV VA "SAVOL MOHIYATI" TAQIQLANADI:
   - Javobni HECH QACHON "Assalomu alaykum", "Salom", "Men PROLEX...", "Sizning savolingiz..." yoki boshqa kirish/tanishtiruv gaplari bilan boshlamang.
   - Javobda "Savol mohiyati" bo‘limi BO‘LMASIN.
   - Javobda 4-bo‘lim, "Eslatma:", "Tavsiya:", "Muhim izoh:" yoki yakuniy takror bloklari BO‘LMASIN. Javob DARHOL \`### 1. Hujjat nomi va aniq moddalar\` sarlavhasidan boshlanib, 3-bo‘lim bilan tugashi SHART.
2. MODDA RAQAMI VA MAZMUNIDA ADASHMASLIK UCHUN 4 BOSQICHLI ICHKI TEKSHIRUV:
   Javob yozishdan avval chuqur fikrlash jarayonida quyidagi bosqichlarni qat'iy bajaring:
   a) Avval savol yoki kazusning aniq huquqiy institutini hamda qaysi organ / prokuratura / sudning predmetli va funksional vakolatiga (yurisdiksiyasiga) kirishini aniqlang.
   b) Qaysi Kodeks yoki Qonun (JK, JPK, FK, FPK, MJtK, MSIYtK, MK, OK, SK, "Prokuratura to‘g‘risida"gi Qonun, Oliy sud Plenumi qarorlari, PF/PQ va VM qarorlari) aynan shu holatni tartibga solishini belgilang.
   c) Har bir modda, qism va bandni yozishdan oldin uning raqami va mazmuni o‘zaro **100% mos kelishini** tekshiring; agar aniq modda raqamiga yoki bandiga shubha qilsangiz, noto‘g‘ri yoki taxminiy raqam yozmang — faqat 100% aniq bilgan modda/qismni yozing va mazmunini aniq bayon eting.
   d) Kontekstda berilgan Lex.uz qidiruv natijalari hamda Lex.uz dagi **AMALDAGI** (kuchini yo‘qotmagan, oxirgi o‘zgartish va qo‘shimchalar kiritilgan) tahrirga tayaning.
3. NORMALAR USTUVORLIGI VA MAXSUS NORMA QOIDASI:
   - Agar bitta huquqiy holat ikkita yoki undan ortiq norma bilan tartibga solinsa: vakolatli organ yurisdiksiyasi hamda umumiy va maxsus norma to‘qnashuviga ko‘ra **maxsus normani** asos qilib oling va 2-bo‘limda nima uchun ikkinchi norma emas, aynan shu norma qo‘llanilishini huquqiy jihatdan chuqur asoslab bering.
4. RASM (HUJJAT, QAROR, BAYONNOMA, KAZUS, SKRINSHOT) TAHLILI:
   - Foydalanuvchi rasm yuborganda rasmdagi **har bir so‘z, sana, raqam, organ nomi, modda havolasi va faktik holatni** diqqat bilan o‘qib chiqing va tahlilni rasm mazmuniga to‘liq tayanib bering.
5. PROKURATURA AMALIYOTI DARAJASIDAGI CHUQUURLIK VA TIL:
   - Faqat o‘zbek tilida (lotin alifbosida), rasmiy-ilmiy yuridik uslubda yozing.
   - Barcha shartlar, vakolat chegaralari, muddatlar, istisnolar, protsessual tartib va huquqiy oqibatlarni birortasini tushirib qoldirmasdan batafsil yoriting.
   - Agar murojaat **kazus** bo‘lsa: tarkib elementlarini faktlarga birma-bir tatbiq eting, aniq kvalifikatsiya hamda prokuror/tergovchi/sudning harakatlarini ko‘rsating.
   - Agar murojaat **taqqoslash savoli** bo‘lsa: har ikki institutni aniq modda, qism va bandlari bilan ta’riflang, **Markdown taqqoslash jadvali** tuzing.

HAR BIR JAVOBNING QAT'IY 3 TA BO‘LIMLI TUZILISHI:

### 1. Hujjat nomi va aniq moddalar
- Savolga bevosita tegishli bo‘lgan har bir normativ-huquqiy hujjatning to‘liq nomi, qabul qilingan sanasi/raqami (PF/PQ, O‘RQ, VM qarori, Oliy sud Plenumi qarori), aniq **moddasi, qismi va bandi hamda ularning amaldagi aniq mazmuni** ro‘yxat shaklida keltirilsin.
- Ichki PDF manbadan foydalanilgan bo‘lsa — hujjat nomi va sahifasi ham ko‘rsatilsin.

### 2. Huquqiy tahlil hamda huquqiy xulosa
- Prokuratura amaliyoti darajasida chuqur, izchil, mantiqan to‘liq va batafsil yuridik tahlil bering: moddalarning amaldagi mazmuni, vakolatli organ yurisdiksiyasi chegaralari, normalar to‘qnashuvi (nega aynan shu norma qo‘llanilishi va boshqasi qo‘llanilmasligi), shartlar, muddatlar, istisnolar va faktik holatga tatbiqini yoritib, yakunda aniq **Huquqiy xulosa**ni bayon eting.

### 3. Foydalanilgan qonunlar va Lex.uz havolalari
- Javobda foydalanilgan barcha qonun hujjatlarining to‘liq nomi va bosiladigan Lex.uz Markdown havolalarini bering (aniq \`https://lex.uz/uz/docs/...\` yoki zarur bo‘lsa \`https://lex.uz/uz/search/all?query=...\`).
- Ichki PDF manba ishlatilgan bo‘lsa: \`Ichki PDF manba: [Hujjat nomi]\` tarzida qayd eting.
- Ushbu 3-bo‘limdan keyin HECH QANDAY qo‘shimcha matn, eslatma yoki 4-bo‘lim yozmang.`;

function isValidKey(val: unknown): val is string {
  return (
    typeof val === 'string' &&
    val.trim().length > 0 &&
    !val.trim().startsWith('MY_')
  );
}

function parseCommaSeparatedKeys(raw: unknown): string[] {
  if (typeof raw !== 'string') return [];
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => isValidKey(part));
}

function getGeminiApiKeys(): string[] {
  const keys = parseCommaSeparatedKeys(import.meta.env.VITE_GEMINI_API_KEY);
  return Array.from(new Set(keys));
}

export function hasClientGeminiKey(): boolean {
  return getGeminiApiKeys().length > 0;
}

function getSerperApiKey(): string {
  const viteKey = import.meta.env.VITE_SERPER_API_KEY;
  if (isValidKey(viteKey)) return viteKey.trim();
  return '';
}

function detectRelevantCoreCodes(text: string): GroundingSource[] {
  const matched: GroundingSource[] = [];
  for (const spec of CORE_CODES) {
    if (spec.keywords.some((re) => re.test(text))) {
      matched.push({ title: spec.officialName, url: spec.url });
    }
  }
  return matched.slice(0, 4);
}

interface SerperLexHit extends GroundingSource {
  snippet?: string;
}

async function safeSerperLexUzSearch(query: string): Promise<SerperLexHit[]> {
  try {
    const serperKey = getSerperApiKey();
    if (!serperKey) return [];

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);

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
          num: 6,
          hl: 'uz',
          gl: 'uz',
        }),
      });
      if (!res.ok) return [];
      const data = (await res.json()) as {
        organic?: Array<{ title?: string; link?: string; snippet?: string }>;
      };
      const results: SerperLexHit[] = [];
      for (const item of data.organic ?? []) {
        if (!item.link || !item.title) continue;
        try {
          const parsed = new URL(item.link);
          if (
            (parsed.protocol === 'https:' || parsed.protocol === 'http:') &&
            (parsed.hostname === 'lex.uz' || parsed.hostname.endsWith('.lex.uz'))
          ) {
            results.push({
              title: item.title.replace(/\s*\|\s*lex\.uz.*$/i, '').trim(),
              url: item.link,
              snippet: (item.snippet ?? '').replace(/\s+/g, ' ').trim().slice(0, 320),
            });
          }
        } catch {
          // ignore malformed URL
        }
      }
      return results.slice(0, 6);
    } finally {
      clearTimeout(timer);
    }
  } catch {
    // Gracefully skip if Serper fails, times out, or is blocked by CORS
    return [];
  }
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface GeminiAttemptSpec {
  model: string;
  useSearch: boolean;
  thinkingBudget?: number;
  thinkingLevel?: 'HIGH';
  timeoutMs: number;
  retryDelayMs: number;
  retrySingleKey: boolean;
}

interface GeminiRestResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string; thought?: boolean }>;
    };
    groundingMetadata?: {
      groundingChunks?: Array<{
        web?: { uri?: string; title?: string };
      }>;
    };
  }>;
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
}

function formatGeminiErrorInUzbek(status: number, rawMessage: string, apiStatus: string): string {
  const detail = rawMessage ? ` (${rawMessage})` : '';

  if (
    apiStatus === 'API_KEY_INVALID' ||
    rawMessage.toLowerCase().includes('api key not valid') ||
    rawMessage.toLowerCase().includes('api_key_invalid')
  ) {
    return `Gemini API kaliti noto‘g‘ri${detail}. Vercel Environment Variables bo‘limida GEMINI_API_KEY yoki VITE_GEMINI_API_KEY qiymatini tekshirib qayta deploy qiling.`;
  }

  if (status === 403 || apiStatus === 'PERMISSION_DENIED') {
    return `Gemini API kalitiga ruxsat berilmagan (403)${detail}. API kalit faolligini va loyiha ruxsatlarini tekshiring.`;
  }

  if (status === 429 || apiStatus === 'RESOURCE_EXHAUSTED') {
    return `Gemini API so‘rovlar kvotasi tugadi (429)${detail}. Birozdan so‘ng qayta urinib ko‘ring yoki billing yoqilgan API kalitidan foydalaning.`;
  }

  if (status === 404 || apiStatus === 'NOT_FOUND') {
    return `Tanlangan Gemini modeli topilmadi (404)${detail}.`;
  }

  if (status === 503 || apiStatus === 'UNAVAILABLE') {
    return `Barcha AI modellari vaqtincha yuqori yuklama ostida (503)${detail}. Iltimos, «Qayta urinish» tugmasini bosing.`;
  }

  if (status === 400 || apiStatus === 'INVALID_ARGUMENT') {
    return `Gemini so‘rov parametrlarida xatolik (400)${detail}.`;
  }

  return `Gemini API xatoligi (HTTP ${status || 'tarmoq'})${detail}.`;
}

export async function generateLegalAnalysisClient(
  req: ChatApiRequest,
  callbacks?: {
    onDelta?: (deltaText: string) => void;
    onReset?: () => void;
  }
): Promise<ChatApiResponse> {
  const apiKeys = getGeminiApiKeys();
  if (apiKeys.length === 0) {
    throw new GeminiClientError(
      'Gemini API kaliti topilmadi. Vercel loyihangizda Environment Variables bo‘limiga VITE_GEMINI_API_KEY (yoki GEMINI_API_KEY) qo‘shing va loyihani qayta deploy (Redeploy) qiling.',
      400
    );
  }

  const effectivePrompt =
    req.userPrompt.trim() ||
    'Ilova qilingan rasmdagi hujjat, bayonnoma, qaror yoki huquqiy holatni O‘zbekiston Respublikasining Lex.uz dagi amaldagi qonunchiligi asosida batafsil yuridik tahlil qiling.';

  const recentText = [
    ...req.history.slice(-3).map((m) => m.content),
    effectivePrompt,
  ].join(' ');

  const coreCodes = detectRelevantCoreCodes(recentText);
  const plenumQuery = `${effectivePrompt.slice(0, 75)} Oliy sud Plenumi qarori`;

  const referencedPdfSet = new Set<string>();
  let pdfBlock = '';
  if (req.pdfContext?.catalogSummary) {
    pdfBlock += `\n\n[ICHKI PDF BILIM BAZASI REYESTRI]:\n${req.pdfContext.catalogSummary}`;
  }
  if (req.pdfContext?.matches?.length) {
    pdfBlock += '\n\n[SAVOLGA MOS KELGAN ICHKI PDF PARCHALARI]:\n';
    for (const match of req.pdfContext.matches) {
      referencedPdfSet.add(match.title);
      pdfBlock += `\n--- Hujjat: "${match.title}" (${match.category}, ${match.pageNumber}-sahifa) ---\n${match.excerpt}\n`;
    }
  }

  const coreLinksBlock =
    coreCodes.length > 0
      ? `\n\n[ASOSIY KODEKS/QONUN HAVOLALARI (faqat savolga aloqadorini ishlating)]:\n${coreCodes
          .map((s) => `- ${s.title}: ${s.url}`)
          .join('\n')}`
      : '';

  async function runSerperWith5sTimeout(): Promise<SerperLexHit[]> {
    if (req.userPrompt.trim().length < 4) return [];
    return await Promise.race([
      Promise.all([
        safeSerperLexUzSearch(req.userPrompt),
        safeSerperLexUzSearch(plenumQuery),
      ]).then(([mainHits, plenumHits]) => [...mainHits, ...plenumHits]),
      new Promise<SerperLexHit[]>((resolve) => setTimeout(() => resolve([]), 5000)),
    ]).catch(() => []);
  }

  // Run Serper API (max 5s timeout) before Gemini; safely skip if slow or unavailable
  const serperHits = await runSerperWith5sTimeout();
  const seenSerperUrls = new Set<string>();
  const serperContextLines: string[] = [];
  for (const hit of serperHits) {
    if (seenSerperUrls.has(hit.url)) continue;
    seenSerperUrls.add(hit.url);
    serperContextLines.push(
      `- ${hit.title} (${hit.url})${hit.snippet ? `\n  Mazmun parchasi: ${hit.snippet}` : ''}`
    );
  }
  const serperContextBlock =
    serperContextLines.length > 0
      ? `\n\n[LEX.UZ QIDIRUV NATIJALARI (AMALDAGI QONUNCHILIK KONTEKSTI)]:\n${serperContextLines
          .slice(0, 7)
          .join('\n')}`
      : '';

  const userParts: Array<
    | { text: string }
    | { inlineData: { mimeType: string; data: string } }
  > = [];
  if (req.image) {
    userParts.push({
      inlineData: {
        mimeType: req.image.mimeType,
        data: req.image.data,
      },
    });
  }
  userParts.push({
    text: `${effectivePrompt}${serperContextBlock}${coreLinksBlock}${pdfBlock}\n\nSalomlashuv, kirish gapi va "Savol mohiyati" yozmasdan, darhol "### 1. Hujjat nomi va aniq moddalar" dan boshlab faqat 3 ta bo‘limda ("### 1. Hujjat nomi va aniq moddalar", "### 2. Huquqiy tahlil hamda huquqiy xulosa", "### 3. Foydalanilgan qonunlar va Lex.uz havolalari") javob bering. Avval huquqiy institut, vakolatli organ va kodeks/qonunni aniqlang; har bir modda raqami va mazmuni 100% mosligini ichki tekshiring hamda yuqoridagi Lex.uz qidiruv natijalari va amaldagi tahrir asosida prokuratura amaliyoti darajasida chuqur, izchil va asosli tahlil yozing.`,
  });

  const contents = [
    ...req.history.slice(-8).map((m) => ({
      role: m.role === 'user' ? 'user' : 'model',
      parts: [{ text: (m.content.trim() || '[Rasm ilova qilingan]').slice(0, 4000) }],
    })),
    {
      role: 'user',
      parts: userParts,
    },
  ];

  const plans: GeminiAttemptSpec[] = [
    {
      model: 'gemini-2.5-pro',
      useSearch: true,
      thinkingBudget: 16384,
      timeoutMs: 80_000,
      retryDelayMs: 2000,
      retrySingleKey: true,
    },
    {
      model: 'gemini-2.5-flash',
      useSearch: false,
      thinkingBudget: 8192,
      timeoutMs: 75_000,
      retryDelayMs: 1200,
      retrySingleKey: true,
    },
    {
      model: 'gemini-2.5-flash-lite',
      useSearch: false,
      thinkingBudget: 8192,
      timeoutMs: 60_000,
      retryDelayMs: 800,
      retrySingleKey: false,
    },
    {
      model: 'gemini-4-hydrogen',
      useSearch: false,
      thinkingLevel: 'HIGH',
      timeoutMs: 60_000,
      retryDelayMs: 800,
      retrySingleKey: false,
    },
    {
      model: 'gemini-3.1-flash-lite',
      useSearch: false,
      thinkingLevel: 'HIGH',
      timeoutMs: 55_000,
      retryDelayMs: 600,
      retrySingleKey: false,
    },
  ];

  async function runStreamingGemini(): Promise<{
    answerText: string;
    groundingChunks: Array<{ web?: { uri?: string; title?: string } }>;
  }> {
    let lastErrorStatus = 502;
    let lastErrorMessage = '';
    let lastApiStatus = '';
    let emittedAnyDelta = false;
    const invalidKeys = new Set<string>();

    for (const plan of plans) {
      const candidateKeys = apiKeys.filter((k) => !invalidKeys.has(k));
      if (candidateKeys.length === 0) break;

      const attemptsForPlan: Array<{ apiKey: string; useSearch: boolean; waitBeforeMs: number }> =
        candidateKeys.length > 1
          ? candidateKeys.map((key, idx) => ({
              apiKey: key,
              useSearch: idx === 0 ? plan.useSearch : false,
              waitBeforeMs: idx === 0 ? 0 : plan.retryDelayMs,
            }))
          : plan.retrySingleKey
            ? [
                { apiKey: candidateKeys[0], useSearch: plan.useSearch, waitBeforeMs: 0 },
                { apiKey: candidateKeys[0], useSearch: false, waitBeforeMs: plan.retryDelayMs },
              ]
            : [{ apiKey: candidateKeys[0], useSearch: plan.useSearch, waitBeforeMs: 0 }];

      for (const attempt of attemptsForPlan) {
        if (invalidKeys.has(attempt.apiKey)) continue;
        if (attempt.waitBeforeMs > 0) {
          await sleepMs(attempt.waitBeforeMs);
        }

        if (emittedAnyDelta) {
          emittedAnyDelta = false;
          if (callbacks?.onReset) callbacks.onReset();
        }

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), plan.timeoutMs);
        let collected = '';
        let chunksMeta: Array<{ web?: { uri?: string; title?: string } }> = [];

        try {
          const payload: Record<string, unknown> = {
            systemInstruction: {
              parts: [{ text: PROLEX_SYSTEM_INSTRUCTION }],
            },
            contents,
          };
          if (plan.thinkingBudget !== undefined) {
            payload.generationConfig = {
              thinkingConfig: { thinkingBudget: plan.thinkingBudget },
            };
          } else if (plan.thinkingLevel !== undefined) {
            payload.generationConfig = {
              thinkingConfig: { thinkingLevel: plan.thinkingLevel },
            };
          }
          if (attempt.useSearch) {
            payload.tools = [{ googleSearch: {} }];
          }

          const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
              plan.model
            )}:streamGenerateContent?alt=sse&key=${encodeURIComponent(attempt.apiKey)}`,
            {
              method: 'POST',
              signal: controller.signal,
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(payload),
            }
          );

          if (!res.ok) {
            clearTimeout(timer);
            const json = (await res.json().catch(() => ({}))) as GeminiRestResponse;
            lastErrorStatus = res.status;
            lastErrorMessage = json.error?.message ?? `HTTP ${res.status}`;
            lastApiStatus = json.error?.status ?? '';

            if (
              lastApiStatus === 'API_KEY_INVALID' ||
              lastApiStatus === 'PERMISSION_DENIED' ||
              res.status === 403 ||
              lastErrorMessage.toLowerCase().includes('api key not valid')
            ) {
              invalidKeys.add(attempt.apiKey);
              if (invalidKeys.size >= apiKeys.length) {
                throw new GeminiClientError(
                  formatGeminiErrorInUzbek(res.status, lastErrorMessage, lastApiStatus),
                  res.status
                );
              }
              continue;
            }

            const isTransient =
              res.status === 503 ||
              res.status === 500 ||
              res.status === 502 ||
              res.status === 504 ||
              res.status === 429 ||
              lastApiStatus === 'UNAVAILABLE';
            if (isTransient) {
              continue;
            }
            break;
          }

          const reader = res.body?.getReader();
          if (reader) {
            const decoder = new TextDecoder();
            let buffer = '';
            while (true) {
              const { value, done } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split(/\r?\n/);
              buffer = lines.pop() ?? '';
              for (const line of lines) {
                const trimmedLine = line.trim();
                if (!trimmedLine.startsWith('data:')) continue;
                const jsonStr = trimmedLine.slice(5).trim();
                if (!jsonStr || jsonStr === '[DONE]') continue;
                try {
                  const evt = JSON.parse(jsonStr) as GeminiRestResponse;
                  const delta = (evt.candidates?.[0]?.content?.parts ?? [])
                    .filter((p) => !p.thought && typeof p.text === 'string')
                    .map((p) => p.text ?? '')
                    .join('');
                  if (delta) {
                    collected += delta;
                    emittedAnyDelta = true;
                    if (callbacks?.onDelta) callbacks.onDelta(delta);
                  }
                  const gm = evt.candidates?.[0]?.groundingMetadata?.groundingChunks;
                  if (Array.isArray(gm) && gm.length > 0) {
                    chunksMeta = gm;
                  }
                } catch {
                  // ignore partial SSE JSON lines
                }
              }
            }
          } else {
            const json = (await res.json().catch(() => ({}))) as GeminiRestResponse;
            collected = (json.candidates?.[0]?.content?.parts ?? [])
              .filter((p) => !p.thought && typeof p.text === 'string')
              .map((p) => p.text ?? '')
              .join('');
            chunksMeta = json.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
            if (collected) {
              emittedAnyDelta = true;
              if (callbacks?.onDelta) callbacks.onDelta(collected);
            }
          }

          clearTimeout(timer);

          if (collected.trim()) {
            return { answerText: collected.trim(), groundingChunks: chunksMeta };
          }

          lastErrorStatus = 502;
          lastErrorMessage = 'Model bo‘sh javob qaytardi.';
        } catch (err) {
          clearTimeout(timer);
          if (collected.trim().length > 80) {
            return { answerText: collected.trim(), groundingChunks: chunksMeta };
          }
          if (err instanceof GeminiClientError) {
            throw err;
          }
          if (err instanceof DOMException && err.name === 'AbortError') {
            lastErrorStatus = 504;
            lastErrorMessage = `So‘rov vaqti tugadi (${Math.round(
              plan.timeoutMs / 1000
            )} soniya).`;
            if (candidateKeys.length === 1) break;
            continue;
          }
          lastErrorStatus = 0;
          lastErrorMessage =
            err instanceof Error ? err.message : 'Tarmoq ulanishida xatolik yuz berdi.';
        }
      }
    }

    if (lastErrorStatus === 0 && lastErrorMessage) {
      throw new GeminiClientError(
        `Barcha AI modellarida tarmoq aloqasi xatoligi (${lastErrorMessage}). Iltimos, «Qayta urinish» tugmasini bosing.`,
        502
      );
    }
    throw new GeminiClientError(
      formatGeminiErrorInUzbek(lastErrorStatus, lastErrorMessage, lastApiStatus),
      lastErrorStatus || 502
    );
  }

  const streamOutput = await runStreamingGemini();

  const seenUrls = new Set<string>();
  const verifiedLexSources: GroundingSource[] = [];
  for (const s of [...serperHits, ...coreCodes]) {
    if (!seenUrls.has(s.url)) {
      seenUrls.add(s.url);
      verifiedLexSources.push({ title: s.title, url: s.url });
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
      verifiedLexSources.push({
        title: web.title || parsed.hostname,
        url: web.uri,
      });
    } catch {
      // ignore invalid URL
    }
  }

  verifiedLexSources.sort((a, b) => {
    const aLex = a.url.includes('lex.uz') ? 0 : 1;
    const bLex = b.url.includes('lex.uz') ? 0 : 1;
    return aLex - bLex;
  });

  const lexSources = verifiedLexSources.filter((s) => s.url.includes('lex.uz'));
  const pdfTitles = Array.from(referencedPdfSet);

  let finalAnswerText = streamOutput.answerText.trim();
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

  const hasSection3 = /foydalanilgan qonunlar va lex\.uz havolalari/i.test(
    finalAnswerText
  );

  if (!hasSection3) {
    const linkLines = lexSources
      .slice(0, 8)
      .map((s) => `- [${s.title}](${s.url})`);
    if (linkLines.length === 0) {
      linkLines.push(
        `- [O'zbekiston Respublikasi qonunchilik ma'lumotlari milliy bazasi — Lex.uz](https://lex.uz/uz/search/all?query=${encodeURIComponent(
          effectivePrompt.slice(0, 60)
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
    sources: verifiedLexSources.slice(0, 10),
    referencedPdfs: pdfTitles,
  };
}
