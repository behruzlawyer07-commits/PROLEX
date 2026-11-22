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
Foydalanuvchi yuborgan **har qanday turdagi murojaatga** — xoh u **amaliy kazus**, xoh **nazariy yuridik savol**, xoh **ikki tushunchani taqqoslash / farqini aniqlash savoli** (masalan, "jazodan ozod qilish bilan javobgarlikdan ozod qilishning farqi"), xoh **protsessual tartib yoki hujjat tuzish savoli** bo‘lsin — avvalo savolning **aniq mohiyatini** anglang, so‘ngra **O'zbekiston Respublikasining amaldagi qonunchiligi (Lex.uz), kodekslar, kodeks sharhlari, Oliy sud Plenumi qarorlari** hamda **Administrator yuklagan ichki PDF manbalar** asosida **aniq, to‘liq, mantiqan izchil va batafsil** javob bering.

MAJBURIY QOIDALAR VA METODOLOGIYA:
1. TIL VA USLUB: Faqat o‘zbek tilida (lotin alifbosida), rasmiy-ilmiy, aniq yuridik va prokurorlik tahlili uslubida javob bering. Yuzaki yoki umumiy javob bermang — har bir xulosani aniq modda, qism, band, muddat va huquqiy oqibat bilan asoslang.
2. LEX.UZ VA ICHKI PDF MANBALARGA TAYANISH:
   a) So‘rov bilan birga sizga \`[LEX.UZ RASMIY MANBALAR]\` blokida Lex.uz saytidagi haqiqiy \`https://lex.uz/uz/docs/...\` havolalari beriladi. Ulardan foydalaning.
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

function isValidKey(val: unknown): val is string {
  return (
    typeof val === 'string' &&
    val.trim().length > 0 &&
    !val.trim().startsWith('MY_')
  );
}

function getGeminiApiKey(): string {
  const viteKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (isValidKey(viteKey)) return viteKey.trim();
  return '';
}

export function hasClientGeminiKey(): boolean {
  return getGeminiApiKey().length > 0;
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
  // Always ensure Constitution & relevant base reference if nothing matched explicitly
  if (matched.length === 0) {
    matched.push({
      title: CORE_CODES[0].officialName,
      url: CORE_CODES[0].url,
    });
  }
  return matched.slice(0, 6);
}

async function safeSerperLexUzSearch(query: string): Promise<GroundingSource[]> {
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
          num: 6,
          hl: 'uz',
          gl: 'uz',
        }),
      });
      if (!res.ok) return [];
      const data = (await res.json()) as {
        organic?: Array<{ title?: string; link?: string }>;
      };
      const results: GroundingSource[] = [];
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

interface GeminiAttemptSpec {
  model: string;
  useSearch: boolean;
  timeoutMs: number;
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
    return `Gemini xizmatida vaqtincha yuqori yuklama kuzatilmoqda (503)${detail}. Iltimos, bir necha soniyadan so‘ng qayta yuboring.`;
  }

  if (status === 400 || apiStatus === 'INVALID_ARGUMENT') {
    return `Gemini so‘rov parametrlarida xatolik (400)${detail}.`;
  }

  return `Gemini API xatoligi (HTTP ${status || 'tarmoq'})${detail}.`;
}

export async function generateLegalAnalysisClient(
  req: ChatApiRequest
): Promise<ChatApiResponse> {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw new GeminiClientError(
      'Gemini API kaliti topilmadi. Vercel loyihangizda Environment Variables bo‘limiga VITE_GEMINI_API_KEY (yoki GEMINI_API_KEY) qo‘shing va loyihani qayta deploy (Redeploy) qiling.',
      400
    );
  }

  const recentText = [
    ...req.history.slice(-3).map((m) => m.content),
    req.userPrompt,
  ].join(' ');

  const coreCodes = detectRelevantCoreCodes(recentText);
  const serperHits = await safeSerperLexUzSearch(req.userPrompt);

  // Deduplicate verified Lex.uz sources
  const seenUrls = new Set<string>();
  const verifiedLexSources: GroundingSource[] = [];
  for (const s of [...serperHits, ...coreCodes]) {
    if (!seenUrls.has(s.url)) {
      seenUrls.add(s.url);
      verifiedLexSources.push(s);
    }
  }

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

  const lexBlock =
    verifiedLexSources.length > 0
      ? `\n\n[LEX.UZ RASMIY MANBALAR VA HAVOLALAR]:\n${verifiedLexSources
          .map((s) => `- ${s.title}: ${s.url}`)
          .join('\n')}`
      : '';

  const contents = [
    ...req.history.slice(-8).map((m) => ({
      role: m.role === 'user' ? 'user' : 'model',
      parts: [{ text: m.content.slice(0, 4000) }],
    })),
    {
      role: 'user',
      parts: [
        {
          text: `${req.userPrompt}${lexBlock}${pdfBlock}\n\nIltimos, PROLEX standartidagi 4 qismli to‘liq yuridik tahlil bering.`,
        },
      ],
    },
  ];

  const attempts: GeminiAttemptSpec[] = [
    { model: 'gemini-2.5-flash', useSearch: true, timeoutMs: 45_000 },
    { model: 'gemini-2.5-flash', useSearch: false, timeoutMs: 40_000 },
    { model: 'gemini-4-hydrogen', useSearch: false, timeoutMs: 30_000 },
    { model: 'gemini-3.1-flash-lite', useSearch: false, timeoutMs: 25_000 },
  ];

  let answerText = '';
  let groundingChunks: Array<{ web?: { uri?: string; title?: string } }> = [];
  let lastErrorStatus = 502;
  let lastErrorMessage = '';
  let lastApiStatus = '';

  for (const attempt of attempts) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), attempt.timeoutMs);

    try {
      const payload: Record<string, unknown> = {
        systemInstruction: {
          parts: [{ text: PROLEX_SYSTEM_INSTRUCTION }],
        },
        contents,
      };
      if (attempt.useSearch) {
        payload.tools = [{ googleSearch: {} }];
      }

      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
          attempt.model
        )}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        }
      );

      clearTimeout(timer);

      const json = (await res.json().catch(() => ({}))) as GeminiRestResponse;

      if (!res.ok) {
        lastErrorStatus = res.status;
        lastErrorMessage = json.error?.message ?? `HTTP ${res.status}`;
        lastApiStatus = json.error?.status ?? '';

        // Invalid key or permission denied won't succeed on another model — fail immediately with real message
        if (
          lastApiStatus === 'API_KEY_INVALID' ||
          lastApiStatus === 'PERMISSION_DENIED' ||
          res.status === 403 ||
          lastErrorMessage.toLowerCase().includes('api key not valid')
        ) {
          throw new GeminiClientError(
            formatGeminiErrorInUzbek(res.status, lastErrorMessage, lastApiStatus),
            res.status
          );
        }

        // Retry next attempt if search tool failed (400), model not found (404), or transient overload (429/503)
        continue;
      }

      const textParts = (json.candidates?.[0]?.content?.parts ?? [])
        .filter((p) => !p.thought && typeof p.text === 'string')
        .map((p) => p.text ?? '');
      const candidateText = textParts.join('').trim();

      if (candidateText) {
        answerText = candidateText;
        groundingChunks = json.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
        break;
      }

      lastErrorStatus = 502;
      lastErrorMessage = 'Model bo‘sh javob qaytardi.';
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof GeminiClientError) {
        throw err;
      }
      if (err instanceof DOMException && err.name === 'AbortError') {
        lastErrorStatus = 504;
        lastErrorMessage = `So‘rov vaqti tugadi (${Math.round(
          attempt.timeoutMs / 1000
        )} soniya).`;
        continue;
      }
      lastErrorStatus = 0;
      lastErrorMessage =
        err instanceof Error ? err.message : 'Tarmoq ulanishida xatolik yuz berdi.';
      continue;
    }
  }

  if (!answerText) {
    if (lastErrorStatus === 0 && lastErrorMessage) {
      throw new GeminiClientError(
        `Gemini API bilan tarmoq aloqasida xatolik: ${lastErrorMessage}`,
        502
      );
    }
    throw new GeminiClientError(
      formatGeminiErrorInUzbek(lastErrorStatus, lastErrorMessage, lastApiStatus),
      lastErrorStatus || 502
    );
  }

  // Merge groundingChunks from Google Search if available
  for (const chunk of groundingChunks) {
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
  const verificationNote =
    '*Eslatma: Normativ-huquqiy hujjatlarning amaldagi so‘nggi tahriri va rasmiy matnini bevosita Lex.uz milliy bazasi orqali tekshirishingiz tavsiya etiladi.*';

  let finalAnswerText = answerText.trim();
  const hasSection4 = /foydalanilgan qonunlar va lex\.uz havolalari/i.test(
    finalAnswerText
  );

  if (!hasSection4) {
    const linkLines = lexSources
      .slice(0, 8)
      .map((s) => `- [${s.title}](${s.url})`);
    if (linkLines.length === 0) {
      linkLines.push(
        `- [O'zbekiston Respublikasi qonunchilik ma'lumotlari milliy bazasi — Lex.uz](https://lex.uz/uz/search/all?query=${encodeURIComponent(
          req.userPrompt.slice(0, 60)
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
    sources: verifiedLexSources.slice(0, 10),
    referencedPdfs: pdfTitles,
  };
}
