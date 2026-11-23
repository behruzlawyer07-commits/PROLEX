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
Avval savol yoki kazusdagi asosiy huquqiy masalani aniqlang va **FAQAT shu masalaga bevosita aloqador** O‘zbekiston Respublikasi normativ-huquqiy hujjatlari (Kodekslar, Qonunlar, O‘zbekiston Respublikasi Prezidentining Farmon va Qarorlari — PF/PQ, Vazirlar Mahkamasi qarorlari, Oliy sud Plenumi qarorlari) hamda **Administrator yuklagan ichki PDF manbalar** asosida **maksimal darajada aniq, asosli va batafsil** javob bering.

QAT'IY MAJBURIY QOIDALAR:
1. KIRISH MATNI, SALOMLASHUV VA "SAVOL MOHIYATI" TAQIQLANADI:
   - Javobni HECH QACHON "Assalomu alaykum", "Salom", "Men PROLEX...", "Sizning savolingiz..." yoki boshqa kirish/tanishtiruv gaplari bilan boshlamang.
   - Javobda "Savol mohiyati" bo‘limi BO‘LMASIN.
   - Javobda 4-bo‘lim, "Eslatma:", "Tavsiya:", "Muhim izoh:" yoki yakuniy takror bloklari BO‘LMASIN. Javob DARHOL \`### 1. Hujjat nomi va aniq moddalar (qism va bandlari bilan)\` sarlavhasidan boshlanib, 3-bo‘lim bilan tugashi SHART.
2. SAVOLGA 100% MOSLIK (MAVZUGA ALOQASI YO‘Q MODDALARNI YOZMANG):
   - Faqat so‘ralgan huquqiy masala, kazus yoki protsessual institutga bevosita tegishli normativ-huquqiy hujjatlarni keltiring.
   - Mavzuga daxli bo‘lmagan umumiy moddalarni (masalan, so‘ralmagan Konstitutsiya yoki begona kodeks normalarini) qo‘shmang.
3. ANIQ HUJJAT NOMI, MODDA, QISM, BAND VA AMALDAGI TAHRIR:
   - Har bir hujjatning to‘liq rasmiy nomi, qabul qilingan sanasi va raqami (PF/PQ, O‘RQ, VM qarori, Oliy sud Plenumi qarori sanasi/raqami), aniq **moddasi, qismi va bandi**ni aniq ko‘rsating (masalan: \`O'zbekiston Respublikasi Jinoyat-protsessual kodeksi 83-moddasi 1-qismi 2-bandi\`).
   - Agar modda yoki hujjat o‘z kuchini yo‘qotgan yoxud o‘zgartirilgan bo‘lsa, faqat **amaldagi tahriri**ga tayaning; bekor bo‘lgan eski tahrirni amaldagi sifatida bermang.
   - So‘ralgan masalaga oid barcha shartlar, vakolat chegaralari, muddatlar, istisnolar va huquqiy oqibatlarni to‘liq yoriting.
   - Modda raqami, qismi, bandi yoki Plenum qarori raqamini to‘qib chiqarish QAT'IYAN MAN ETILADI.
4. TIL VA TAHLIL CHUQURLIGI:
   - Faqat o‘zbek tilida (lotin alifbosida), rasmiy-ilmiy yuridik uslubda yozing.
   - Agar murojaat **kazus** bo‘lsa: tarkib elementlari yoki huquqiy shartlarni faktlarga birma-bir tatbiq eting, aniq kvalifikatsiya va vakolatli organ/prokuror harakatlarini ko‘rsating.
   - Agar murojaat **taqqoslash savoli** bo‘lsa: har ikki institutni modda, qism va bandlari bilan ta’riflang, **Markdown taqqoslash jadvali** tuzing.

HAR BIR JAVOBNING QAT'IY 3 TA BO‘LIMLI TUZILISHI:

### 1. Hujjat nomi va aniq moddalar (qism va bandlari bilan)
- Savolga bevosita tegishli bo‘lgan har bir normativ-huquqiy hujjatning to‘liq nomi, qabul qilingan sanasi/raqami (agar bo‘lsa), aniq moddasi, qismi va bandi aniq ro‘yxat shaklida keltirilsin.
- Ichki PDF manbadan foydalanilgan bo‘lsa — hujjat nomi va sahifasi ham ko‘rsatilsin.

### 2. Huquqiy tahlil hamda huquqiy xulosa
- Faqat so‘ralgan savol yoki kazus bo‘yicha aniq, mantiqiy va batafsil yuridik tahlil bering: modda, qism va bandlarning amaldagi tahriri mazmuni, shartlar, muddatlar, istisnolar va faktik holatga tatbiqini yoritib, yakunda aniq **Huquqiy xulosa**ni (savolga to‘g‘ridan-to‘g‘ri javobni) bayon eting.

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
  return matched.slice(0, 4);
}

async function safeSerperLexUzSearch(query: string): Promise<GroundingSource[]> {
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

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface GeminiAttemptSpec {
  model: string;
  useSearch: boolean;
  useThinkingZero: boolean;
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
  const plenumQuery = `${req.userPrompt.slice(0, 75)} Oliy sud Plenumi qarori`;

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

  const contents = [
    ...req.history.slice(-8).map((m) => ({
      role: m.role === 'user' ? 'user' : 'model',
      parts: [{ text: m.content.slice(0, 4000) }],
    })),
    {
      role: 'user',
      parts: [
        {
          text: `${req.userPrompt}${coreLinksBlock}${pdfBlock}\n\nSalomlashuv, kirish gapi va "Savol mohiyati" yozmasdan, darhol "### 1. Hujjat nomi va aniq moddalar (qism va bandlari bilan)" dan boshlab faqat 3 ta bo‘limda ("### 1. Hujjat nomi va aniq moddalar (qism va bandlari bilan)", "### 2. Huquqiy tahlil hamda huquqiy xulosa", "### 3. Foydalanilgan qonunlar va Lex.uz havolalari") faqat savolga bevosita tegishli amaldagi normativ-huquqiy hujjatlar (modda, qism, band) asosida javob bering.`,
        },
      ],
    },
  ];

  const RETRY_DELAYS_MS = [400, 900];

  const attempts: GeminiAttemptSpec[] = [
    {
      model: 'gemini-2.5-flash',
      useSearch: true,
      useThinkingZero: true,
      timeoutMs: 50_000,
    },
    {
      model: 'gemini-2.5-flash',
      useSearch: false,
      useThinkingZero: true,
      timeoutMs: 48_000,
    },
    {
      model: 'gemini-2.5-flash-lite',
      useSearch: false,
      useThinkingZero: true,
      timeoutMs: 45_000,
    },
    {
      model: 'gemini-4-hydrogen',
      useSearch: false,
      useThinkingZero: false,
      timeoutMs: 45_000,
    },
    {
      model: 'gemini-3.1-flash-lite',
      useSearch: false,
      useThinkingZero: false,
      timeoutMs: 45_000,
    },
  ];

  async function runSerperWith3sTimeout(): Promise<GroundingSource[]> {
    return await Promise.race([
      Promise.all([
        safeSerperLexUzSearch(req.userPrompt),
        safeSerperLexUzSearch(plenumQuery),
      ]).then(([mainHits, plenumHits]) => [...mainHits, ...plenumHits]),
      new Promise<GroundingSource[]>((resolve) => setTimeout(() => resolve([]), 3000)),
    ]).catch(() => []);
  }

  async function runStreamingGemini(): Promise<{
    answerText: string;
    groundingChunks: Array<{ web?: { uri?: string; title?: string } }>;
  }> {
    let lastErrorStatus = 502;
    let lastErrorMessage = '';
    let lastApiStatus = '';
    let emittedAnyDelta = false;

    for (const attempt of attempts) {
      for (let retryIdx = 0; retryIdx <= RETRY_DELAYS_MS.length; retryIdx++) {
        if (emittedAnyDelta) {
          emittedAnyDelta = false;
          if (callbacks?.onReset) callbacks.onReset();
        }

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), attempt.timeoutMs);
        let collected = '';
        let chunksMeta: Array<{ web?: { uri?: string; title?: string } }> = [];

        try {
          const payload: Record<string, unknown> = {
            systemInstruction: {
              parts: [{ text: PROLEX_SYSTEM_INSTRUCTION }],
            },
            contents,
          };
          if (attempt.useThinkingZero) {
            payload.generationConfig = {
              thinkingConfig: { thinkingBudget: 0 },
            };
          }
          if (attempt.useSearch) {
            payload.tools = [{ googleSearch: {} }];
          }

          const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
              attempt.model
            )}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`,
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
              throw new GeminiClientError(
                formatGeminiErrorInUzbek(res.status, lastErrorMessage, lastApiStatus),
                res.status
              );
            }

            const isTransient =
              res.status === 503 ||
              res.status === 500 ||
              res.status === 502 ||
              res.status === 504 ||
              res.status === 429 ||
              lastApiStatus === 'UNAVAILABLE';
            if (isTransient && retryIdx < RETRY_DELAYS_MS.length) {
              await sleepMs(RETRY_DELAYS_MS[retryIdx]);
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
          if (retryIdx < RETRY_DELAYS_MS.length) {
            await sleepMs(RETRY_DELAYS_MS[retryIdx]);
          }
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
              attempt.timeoutMs / 1000
            )} soniya).`;
            break;
          }
          lastErrorStatus = 0;
          lastErrorMessage =
            err instanceof Error ? err.message : 'Tarmoq ulanishida xatolik yuz berdi.';
          if (retryIdx < RETRY_DELAYS_MS.length) {
            await sleepMs(RETRY_DELAYS_MS[retryIdx]);
            continue;
          }
          break;
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

  // Run Serper API search (3s timeout) and Gemini streaming in parallel via Promise.all
  const [serperHits, streamOutput] = await Promise.all([
    runSerperWith3sTimeout(),
    runStreamingGemini(),
  ]);

  const seenUrls = new Set<string>();
  const verifiedLexSources: GroundingSource[] = [];
  for (const s of [...serperHits, ...coreCodes]) {
    if (!seenUrls.has(s.url)) {
      seenUrls.add(s.url);
      verifiedLexSources.push(s);
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
          req.userPrompt.slice(0, 60)
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
