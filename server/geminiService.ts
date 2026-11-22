import {
  type Content,
  type GenerateContentResponse,
  GoogleGenAI,
  type Part,
  ThinkingLevel,
  Type,
} from '@google/genai';
import type { ChatMessage, GroundingSource } from '../src/types/sherlex.ts';
import {
  type CoreCodeKey,
  retrieveLexUzGroundings,
} from './lexuzService.ts';
import { resolveSafeUploadPath, searchRelevantPdfExcerpts } from './pdfService.ts';
import { type StoredLegalDocument, updateDocumentGeminiFile } from './store.ts';

const GEMINI_MODEL = 'gemini-4-hydrogen';

function createGeminiClient(): GoogleGenAI {
  const apiKey = (process.env.GEMINI_API_KEY ?? '').trim();
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

const PROLEX_SYSTEM_INSTRUCTION = `Siz "PROLEX" — O'zbekiston Respublikasi Huquqni muhofaza qilish akademiyasi (HMQA) tinglovchilari hamda O'zbekiston Respublikasi Prokuratura organlari xodimlari uchun yaratilgan ixtisoslashtirilgan, yuqori malakali huquqshunos-olim va prokuror-tahlilchi sun'iy intellekt yordamchisisiz.

ASOSIY VAZIFA:
Foydalanuvchi yuborgan **har qanday turdagi murojaatga** — xoh u **amaliy kazus**, xoh **nazariy yuridik savol**, xoh **ikki tushunchani taqqoslash / farqini aniqlash savoli** (masalan, "jazodan ozod qilish bilan javobgarlikdan ozod qilishning farqi"), xoh **protsessual tartib yoki hujjat tuzish savoli** bo‘lsin — avvalo savolning **aniq mohiyatini** anglang, so‘ngra **Lex.uz milliy qonunchilik bazasidan olingan jonli matnlar** hamda **Administrator yuklagan ichki PDF manbalar** asosida **aniq, to‘liq, mantiqan izchil va batafsil** javob bering.

MAJBURIY QOIDALAR VA METODOLOGIYA:
1. TIL VA USLUB: Faqat o‘zbek tilida (lotin alifbosida), rasmiy-ilmiy, aniq yuridik va prokurorlik tahlili uslubida javob bering. Yuzaki yoki umumiy javob bermang — har bir xulosani aniq modda, qism, band, muddat va huquqiy oqibat bilan asoslang.
2. LEX.UZ VA ICHKI PDF MANBALARGA TAYANISH:
   a) So‘rov bilan birga sizga \`[LEX.UZ RASMIY MATN]\` blokida Lex.uz saytidan to‘g‘ridan-to‘g‘ri olingan moddalarning amaldagi matni va haqiqiy \`https://lex.uz/uz/docs/...\` havolalari beriladi. Moddalar mazmuni, qismlari va huquqiy mezonlarini aynan shu rasmiy matnga tayanib keltiring.
   b) Administrator yuklagan ichki PDF manbalardan parcha berilgan bo‘lsa, ularni ham (hujjat nomi va sahifasi bilan) tahlilga integratsiya qiling.
3. HALOLLIK VA ANIQLIK: Hech qachon mavjud bo‘lmagan modda raqamlari, qismlar, bandlar yoki Oliy sud Plenum qarori raqamlarini o‘ylab topmang (fabrikat qilmang). Modda matnining oxirgi tahririga shubha bo‘lsa, buni ochiq ko‘rsating.
4. BEVOSITA VA BILVOSITA TARTIBGA SOLISH: Har qanday savol yoki kazusda quyidagilarni alohida ajratib tahlil qiling:
   - **Bevosita tartibga soluvchi normativ-huquqiy hujjatlar** (masalani to‘g‘ridan-to‘g‘ri tartibga soluvchi kodeks moddalari, tarkib belgilari, institut shartlari, protsessual tartib, muddatlar va javobgarlik/ozod qilish choralari);
   - **Bilvosita tartibga soluvchi normativ-huquqiy hujjatlar** (konstitutsiyaviy tamoyillar, prokuror nazorati vakolatlari, Oliy sud Plenumi tushuntirishlari, yondosh moddiy/protsessual normalar va qonunosti hujjatlari).
5. SAVOL TURIGA MOS CHUQUR TAHLIL:
   - Agar murojaat **kazus (amaliy holat)** bo‘lsa: jinoyat/huquqbuzarlik tarkibining barcha elementlari (obyekt, obyektiv tomon, subyekt, subyektiv tomon) yoki nizoli huquqiy munosabat shartlarini faktlarga birma-bir tatbiq eting, aniq kvalifikatsiya va vakolatli organ/prokurorning protsessual qadamlarini ko‘rsating.
   - Agar murojaat **taqqoslash / farqini so‘rash savoli** bo‘lsa (masalan, "A bilan B ning farqi nimada"): har ikki huquqiy institutni aniq moddalari bilan ta’riflang, **albatta Markdown taqqoslash jadvali** (Mezon | 1-institut | 2-institut) tuzing hamda huquqiy asosi, qo‘llanilish bosqichi, vakolatli organi, sudlanganlik/huquqiy oqibatlari bo‘yicha barcha asosiy farqlarni batafsil ochib bering.
   - Agar murojaat **nazariy yoki protsessual savol** bo‘lsa: tushunchaning yuridik mohiyati, qonunchilikdagi turlari, qo‘llanilish shartlari, istisnolari va amaliyotdagi ahamiyatini moddama-modda yoritib bering.

HAR BIR JAVOBNING MAJBURIY 4 QISMLI BATAFSIL TUZILISHI:

### 1. Savol mohiyati va huquqiy masalaning o‘zagi
- Savol yoki kazusning asosiy yuridik mohiyatini 2–4 jumlada aniq shakllantiring: qanday huquqiy masala yoki institut ko‘tarilmoqda, qaysi huquq sohasiga taalluqli va amalda qaysi aniq mezonlarga javob berish talab etiladi.

### 2. Hujjat nomi va aniq moddalar
- Qo‘llaniladigan har bir normativ-huquqiy hujjatning to‘liq rasmiy nomi hamda aniq moddalari, boblari, qismlari va bandlari.
- Lex.uz rasmiy matnidan olingan asosiy modda qoidalari (shartlar, muddatlar, asoslar yoki javobgarlik/ozod qilish chegaralari).
- Agar Administrator yuklagan PDF manbadan foydalanilgan bo‘lsa — hujjat nomi va sahifasi.

### 3. Bevosita va bilvosita tartibga solish tahlili va batafsil huquqiy xulosa
- **Bevosita tartibga soluvchi normalar tahlili:** Savol yoki kazus turiga mos ravishda batafsil yuridik tahlil (kazus bo‘lsa — faktlar va tarkib tahlili; taqqoslash bo‘lsa — batafsil mezonlar tahlili va **Markdown taqqoslash jadvali**; nazariy/protsessual savol bo‘lsa — shartlar, turlar va mexanizmlar tahlili).
- **Bilvosita tartibga soluvchi normalar tahlili:** Konstitutsiyaviy kafolatlar, prokuror nazorati vakolatlari, Oliy sud Plenumi tushuntirishlari va yondosh normalarning ta’siri.
- **Yakuniy huquqiy xulosa va amaliy ahamiyati:** Qisqa, lo‘nda va amaliy jihatdan mukammal huquqiy xulosa (kvalifikatsiya, farqlar xulosasi yoki protsessual harakatlar rejasi).

### 4. Foydalanilgan qonunlar va Lex.uz havolalari
- Javobda tilga olingan barcha qonun va normativ-huquqiy hujjatlar uchun bosiladigan Markdown havolalari bering (berilgan aniq \`https://lex.uz/uz/docs/...\` havolalaridan foydalaning; agar aniq doc ID berilmagan bo‘lsa, \`https://lex.uz/uz/search/all?query=...\` havolasini bering).
- Ichki PDF manba ishlatilgan bo‘lsa: \`Ichki PDF manba: [Hujjat nomi]\` tarzida qayd eting.
- Eng oxirida eslatma: *"Eslatma: Normativ-huquqiy hujjatlarning amaldagi so‘nggi tahriri va rasmiy matnini bevosita Lex.uz milliy bazasi orqali tekshirishingiz tavsiya etiladi."*`;

interface LegalIntentPlan {
  essenceSummary: string;
  codesToCheck: CoreCodeKey[];
  suspectedArticles: string[];
  lexSearchQueries: string[];
}

const VALID_CODE_KEYS = new Set<CoreCodeKey>([
  'KONST',
  'JK',
  'JPK',
  'FK1',
  'FK2',
  'FPK',
  'MJtK',
  'MSIYtK',
  'MK',
  'OK',
  'SK',
  'PROK',
  'KORR',
]);

function deterministicIntentFallback(prompt: string): LegalIntentPlan {
  const lower = prompt.toLowerCase();
  const codes = new Set<CoreCodeKey>(['KONST']);
  const suspected = new Set<string>();
  const queries: string[] = [];

  for (const m of prompt.matchAll(/(\d+(?:-\d+)?)\s*-?\s*(?:modda|модда)/gi)) {
    suspected.add(m[1]);
  }

  if (/jazo(?:dan)?\s+ozod|javo(?:b)?garlik(?:dan)?\s+ozod|yarashuv|amnistiya|afv|sudlanganlik/i.test(lower)) {
    codes.add('JK');
    codes.add('JPK');
    for (const art of ['64', '65', '66', '66-1', '68', '69', '70', '71', '72', '73', '74', '75', '76', '84']) {
      suspected.add(art);
    }
    queries.push('jazodan ozod qilish');
  }

  if (/jinoyat|firibgarlik|o['ʻ’]?g['ʻ’]?rilik|pora|qotillik|talon|suiste['ʻ’]?mol|mansab|kvalifikatsiya|jazo|javobgarlik|tarkib|qasd|ehtiyotsizlik|jk\b/.test(lower)) {
    codes.add('JK');
    codes.add('JPK');
  }
  if (/tergov|jpk|prokuror|ayblov|guvoh|ekspertiza|hibs|ehtiyot chora|jinoyat ishi|rad etish|nazorat|reabilitatsiya|protest|taqdimnoma|ushlab turish|tintuv/.test(lower)) {
    codes.add('JPK');
    codes.add('PROK');
  }
  if (/ma['ʻ’]?muriy|mjtk|jarima|yo['ʻ’]?l harakat|msiy|hokimiyat qarori/.test(lower)) {
    codes.add('MJtK');
    codes.add('MSIYtK');
  }
  if (/mehnat|ishdan bo['ʻ’]?shat|xodim|ish beruvchi|shtat|ta['ʻ’]?til|ish haqi|kasaba/.test(lower)) {
    codes.add('MK');
  }
  if (/shartnoma|qarz|mulk|zarar|da['ʻ’]?vo|fuqarolik|meros|ijara|majburiyat|muddat|fk\b|fpk\b/.test(lower)) {
    codes.add('FK1');
    codes.add('FK2');
    codes.add('FPK');
  }
  if (/oila|nikoh|ajr|aliment|bola|vasiylik/.test(lower)) {
    codes.add('OK');
    codes.add('FPK');
  }
  if (/soliq|budjet|bojxona|qqs|daromad solig/.test(lower)) {
    codes.add('SK');
  }
  if (/korrupsiya|pora|manfaatlar to['ʻ’]?qnashuvi/.test(lower)) {
    codes.add('KORR');
    codes.add('JK');
  }

  if (codes.size === 1) {
    codes.add('JK');
    codes.add('JPK');
    codes.add('FK1');
  }

  if (queries.length === 0) {
    if (lower.includes('firibgarlik')) queries.push('firibgarlik');
    else if (/ishdan bo['ʻ’]?shat|mehnat shartnoma/i.test(lower)) queries.push('mehnat shartnomasi');
    else if (/reabilitatsiya/i.test(lower)) queries.push('reabilitatsiya');
    else if (/pora|korrupsiya/i.test(lower)) queries.push('poraxoʻrlik');
    else if (/prokuror|protest|taqdimnoma/i.test(lower)) queries.push('prokuratura');
    else {
      const cleanWords = prompt
        .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
        .split(/\s+/)
        .filter((w) => w.length >= 5)
        .slice(0, 2)
        .join(' ');
      if (cleanWords) queries.push(cleanWords);
    }
  }

  return {
    essenceSummary: prompt.slice(0, 220),
    codesToCheck: Array.from(codes).slice(0, 4),
    suspectedArticles: Array.from(suspected).slice(0, 14),
    lexSearchQueries: queries.slice(0, 2),
  };
}

async function analyzeQuestionIntent(
  ai: GoogleGenAI,
  history: ChatMessage[],
  userPrompt: string
): Promise<LegalIntentPlan> {
  const fallback = deterministicIntentFallback(userPrompt);
  const lastTurn = history.slice(-2).map((m) => `${m.role}: ${m.content.slice(0, 250)}`).join('\n');

  try {
    const res = await withTimeout(
      ai.models.generateContent({
        model: 'gemini-3.1-flash-lite',
        contents: `Quyidagi o'zbek tilidagi huquqiy savol, taqqoslash savoli yoki kazusning aniq mohiyatini aniqlang va Lex.uz dan qaysi kodekslar hamda moddalarni tekshirish kerakligini JSON shaklida bering.\n\nOldingi kontekst:\n${lastTurn || 'Yo‘q'}\n\nSavol:\n${userPrompt}`,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              essenceSummary: {
                type: Type.STRING,
                description: "Savolning asosiy huquqiy mohiyati (o'zbek tilida, 1-2 jumla).",
              },
              codesToCheck: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description:
                  "Tekshiriladigan kodeks/qonun kodlari: KONST, JK, JPK, FK1, FK2, FPK, MJtK, MSIYtK, MK, OK, SK, PROK, KORR",
              },
              suspectedArticles: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "Bevosita yoki bilvosita tegishli modda raqamlari (masalan '64', '65', '69', '73', '168', '83').",
              },
              lexSearchQueries: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "Lex.uz sarlavha qidiruvi uchun 1-2 ta juda qisqa (1-3 so'zlik) asosiy yuridik atama (masalan 'firibgarlik', 'jazodan ozod qilish', 'mehnat shartnomasi').",
              },
            },
            required: ['essenceSummary', 'codesToCheck', 'suspectedArticles', 'lexSearchQueries'],
          },
        },
      }),
      4200,
      'INTENT'
    );

    const raw = (res.text ?? '').trim();
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<LegalIntentPlan>;

    const codes = (Array.isArray(parsed.codesToCheck) ? parsed.codesToCheck : [])
      .filter((c): c is CoreCodeKey => VALID_CODE_KEYS.has(c as CoreCodeKey));

    const mergedArticles = Array.from(
      new Set([
        ...(Array.isArray(parsed.suspectedArticles) ? parsed.suspectedArticles.map((s) => String(s)) : []),
        ...fallback.suspectedArticles,
      ])
    ).slice(0, 14);

    return {
      essenceSummary:
        typeof parsed.essenceSummary === 'string' && parsed.essenceSummary.trim()
          ? parsed.essenceSummary.trim()
          : fallback.essenceSummary,
      codesToCheck: codes.length > 0 ? codes : fallback.codesToCheck,
      suspectedArticles: mergedArticles,
      lexSearchQueries:
        Array.isArray(parsed.lexSearchQueries) && parsed.lexSearchQueries.length > 0
          ? parsed.lexSearchQueries.map((s) => String(s)).slice(0, 2)
          : fallback.lexSearchQueries,
    };
  } catch {
    return fallback;
  }
}

async function ensureGeminiFilePart(ai: GoogleGenAI, doc: StoredLegalDocument): Promise<Part | null> {
  try {
    const now = Date.now();
    const uploadedAt = doc.geminiFileUploadedAt ? Date.parse(doc.geminiFileUploadedAt) : 0;
    const isFresh = doc.geminiFileUri && uploadedAt > 0 && now - uploadedAt < 42 * 60 * 60 * 1000;

    if (isFresh && doc.geminiFileUri) {
      return {
        fileData: {
          fileUri: doc.geminiFileUri,
          mimeType: doc.geminiFileMimeType || 'application/pdf',
        },
      };
    }

    const diskPath = resolveSafeUploadPath(doc.storedFileName);
    const uploaded = await ai.files.upload({
      file: diskPath,
      config: {
        mimeType: 'application/pdf',
        displayName: doc.title,
      },
    });

    if (!uploaded.uri || !uploaded.name) return null;

    let state = uploaded.state;
    let attempts = 0;
    while (state === 'PROCESSING' && attempts < 4) {
      await new Promise((r) => setTimeout(r, 1200));
      const check = await ai.files.get({ name: uploaded.name });
      state = check.state;
      attempts++;
    }

    if (state !== 'ACTIVE') return null;

    await updateDocumentGeminiFile(doc.id, uploaded.uri, uploaded.mimeType || 'application/pdf');
    return {
      fileData: {
        fileUri: uploaded.uri,
        mimeType: uploaded.mimeType || 'application/pdf',
      },
    };
  } catch (err) {
    console.warn(`[Gemini Files] PDF faylni biriktirishda ogohlantirish (${doc.title}):`, err);
    return null;
  }
}

export async function generateLegalAnalysis(params: {
  history: ChatMessage[];
  userPrompt: string;
}): Promise<{
  text: string;
  sources: GroundingSource[];
  referencedPdfs: string[];
}> {
  const ai = createGeminiClient();

  // Phase 1: Identify exact essence of the question + legal lookup plan (fast, capped at 4.2s)
  const intentPlan = await analyzeQuestionIntent(ai, params.history, params.userPrompt);

  // Phase 2: Retrieve live Lex.uz articles/docs AND Admin PDF excerpts in parallel
  const recentContext = params.history
    .slice(-4)
    .map((m) => m.content)
    .join(' ');

  const [lexResult, pdfSearchResults] = await Promise.all([
    retrieveLexUzGroundings({
      userPrompt: params.userPrompt,
      codesToCheck: intentPlan.codesToCheck,
      suspectedArticles: intentPlan.suspectedArticles,
      lexSearchQueries: intentPlan.lexSearchQueries,
    }),
    searchRelevantPdfExcerpts(`${recentContext} ${params.userPrompt}`),
  ]);

  const referencedPdfSet = new Set<string>();
  let pdfContextBlock = '';

  if (pdfSearchResults.catalogSummary) {
    pdfContextBlock += `\n\n[TIZIMDAGI ADMIN YUKLAGAN PDF MANBALAR REYESTRI]:\n${pdfSearchResults.catalogSummary}`;
  }

  if (pdfSearchResults.matches.length > 0) {
    pdfContextBlock += `\n\n[SO'ROVGA MOS KELGAN PDF MANBALARDAN PARCHALAR]:\n`;
    for (const m of pdfSearchResults.matches) {
      referencedPdfSet.add(m.title);
      pdfContextBlock += `\n--- Manba: "${m.title}" | Soha: ${m.category} | Sahifa: ${m.pageNumber} ---\n${m.excerpt}\n`;
    }
  } else if (pdfSearchResults.catalogSummary) {
    pdfContextBlock += `\n(Yuqoridagi PDF manbalardan savolga bevosita mos parcha matndan topilmadi yoki skanerlangan PDF bo'lishi mumkin.)`;
  }

  const fileParts: Part[] = [];
  for (const scanned of pdfSearchResults.scannedDocs) {
    const filePart = await ensureGeminiFilePart(ai, scanned);
    if (filePart) {
      fileParts.push(filePart);
      referencedPdfSet.add(scanned.title);
    }
  }

  // Build multi-turn contents
  const contents: Content[] = [];
  const trimmedHistory = params.history.slice(-8);
  for (const msg of trimmedHistory) {
    contents.push({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.content.slice(0, 4000) }],
    });
  }

  const enrichedPrompt = `FOYDALANUVCHI MUROJAATI (SAVOL / KAZUS):
${params.userPrompt}

[ANIQLANGAN SAVOL MOHIYATI]:
${intentPlan.essenceSummary}
(Tekshirilgan asosiy kodekslar: ${intentPlan.codesToCheck.join(', ')}${
    intentPlan.suspectedArticles.length > 0
      ? ` · Dastlabki moddalar: ${intentPlan.suspectedArticles.join(', ')}`
      : ''
  })
${lexResult.contextBlock ? `\n${lexResult.contextBlock}` : ''}${pdfContextBlock}

KO'RSATMA: Yuqoridagi savol yoki kazus turini aniqlang (kazus, taqqoslash savoli, nazariy yoki protsessual savol) va Lex.uz rasmiy matnlari hamda PDF manbalar asosida majburiy 4 qismli tuzilishda to'liq, aniq va batafsil yuridik javob bering.`;

  const currentParts: Part[] = [...fileParts, { text: enrichedPrompt }];
  contents.push({ role: 'user', parts: currentParts });

  const textOnlyContents: Content[] = [
    ...contents.slice(0, -1),
    {
      role: 'user',
      parts: [{ text: enrichedPrompt }],
    },
  ];

  const isQuotaError = (err: unknown): boolean => {
    const msg = err instanceof Error ? err.message : String(err ?? '');
    return msg.includes('RESOURCE_EXHAUSTED') || msg.includes('"code":429') || msg.includes('429');
  };

  const isTransientError = (err: unknown): boolean => {
    const msg = (err instanceof Error ? err.message : String(err ?? '')).toLowerCase();
    return (
      msg.includes('503') ||
      msg.includes('unavailable') ||
      msg.includes('high demand') ||
      msg.includes('overloaded') ||
      msg.includes('502') ||
      msg.includes('500') ||
      msg.includes('internal') ||
      msg.includes('timeout_') ||
      msg.includes('fetch failed') ||
      msg.includes('econnreset')
    );
  };

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  const extractResponseText = (res: GenerateContentResponse | undefined): string => {
    if (!res) return '';
    const direct = (res.text ?? '').trim();
    if (direct) return direct;
    const parts = res.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts)) return '';
    return parts
      .filter((p) => !p.thought && typeof p.text === 'string')
      .map((p) => p.text)
      .join('')
      .trim();
  };

  type AttemptPlan = {
    model: string;
    useSearch: boolean;
    useFiles: boolean;
    thinkingLevel?: ThinkingLevel;
    timeoutMs: number;
    delayMs: number;
  };

  const hasRichLexContext = lexResult.contextBlock.length >= 600;

  // Fast, timeout-protected execution order with 503/429 backoff fallback
  const plans: AttemptPlan[] = hasRichLexContext
    ? [
        {
          model: GEMINI_MODEL,
          useSearch: false,
          useFiles: fileParts.length > 0,
          thinkingLevel: ThinkingLevel.LOW,
          timeoutMs: 22000,
          delayMs: 0,
        },
        ...(fileParts.length > 0
          ? [
              {
                model: GEMINI_MODEL,
                useSearch: false,
                useFiles: false,
                thinkingLevel: ThinkingLevel.LOW,
                timeoutMs: 18000,
                delayMs: 350,
              },
            ]
          : []),
        {
          model: 'gemini-3.1-flash-lite',
          useSearch: false,
          useFiles: false,
          timeoutMs: 16000,
          delayMs: 400,
        },
        {
          model: 'gemini-3.1-flash-lite',
          useSearch: false,
          useFiles: false,
          timeoutMs: 16000,
          delayMs: 900,
        },
      ]
    : [
        {
          model: GEMINI_MODEL,
          useSearch: true,
          useFiles: fileParts.length > 0,
          thinkingLevel: ThinkingLevel.LOW,
          timeoutMs: 20000,
          delayMs: 0,
        },
        {
          model: GEMINI_MODEL,
          useSearch: false,
          useFiles: false,
          thinkingLevel: ThinkingLevel.LOW,
          timeoutMs: 18000,
          delayMs: 350,
        },
        {
          model: 'gemini-3.1-flash-lite',
          useSearch: true,
          useFiles: false,
          timeoutMs: 16000,
          delayMs: 400,
        },
        {
          model: 'gemini-3.1-flash-lite',
          useSearch: false,
          useFiles: false,
          timeoutMs: 15000,
          delayMs: 800,
        },
      ];

  let response: GenerateContentResponse | undefined;
  let answerText = '';
  let lastErr: unknown = null;

  for (const plan of plans) {
    if (plan.delayMs > 0) {
      await sleep(plan.delayMs);
    }
    try {
      const candidateResponse = await withTimeout(
        ai.models.generateContent({
          model: plan.model,
          contents: plan.useFiles ? contents : textOnlyContents,
          config: {
            systemInstruction: PROLEX_SYSTEM_INSTRUCTION,
            ...(plan.useSearch ? { tools: [{ googleSearch: {} }] } : {}),
            ...(plan.thinkingLevel
              ? { thinkingConfig: { thinkingLevel: plan.thinkingLevel } }
              : {}),
          },
        }),
        plan.timeoutMs,
        plan.model
      );
      const candidateText = extractResponseText(candidateResponse);
      if (candidateText) {
        response = candidateResponse;
        answerText = candidateText;
        break;
      }
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('API_KEY_INVALID') || msg.includes('PERMISSION_DENIED')) {
        throw err;
      }
      if (
        isQuotaError(err) ||
        isTransientError(err) ||
        plan.useFiles ||
        plan.useSearch ||
        plan.model === GEMINI_MODEL
      ) {
        continue;
      }
      throw err;
    }
  }

  if (!response || !answerText) {
    throw lastErr ?? new Error('EMPTY_MODEL_RESPONSE');
  }

  // Merge verified live Lex.uz URLs + Google Search grounding URLs
  const seenUrls = new Set<string>();
  const sources: GroundingSource[] = [];

  for (const src of lexResult.verifiedSources) {
    if (!seenUrls.has(src.url)) {
      seenUrls.add(src.url);
      sources.push(src);
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
  let finalAnswerText = answerText;
  if (lexSources.length > 0 && !finalAnswerText.includes('https://lex.uz/')) {
    const linksBlock = lexSources
      .slice(0, 6)
      .map((s) => `- [${s.title}](${s.url})`)
      .join('\n');
    finalAnswerText += `\n\n### Foydalanilgan qonunlar va Lex.uz havolalari\n${linksBlock}\n\n*Eslatma: Normativ-huquqiy hujjatlarning amaldagi so‘nggi tahriri va rasmiy matnini bevosita Lex.uz milliy bazasi orqali tekshirishingiz tavsiya etiladi.*`;
  }

  return {
    text: finalAnswerText,
    sources: sources.slice(0, 10),
    referencedPdfs: Array.from(referencedPdfSet),
  };
}
