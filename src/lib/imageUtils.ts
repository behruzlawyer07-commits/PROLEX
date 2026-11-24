import type { SupportedImageMime } from '../types/sherlex';

export interface PreparedChatImage {
  mimeType: SupportedImageMime;
  base64: string;
  previewDataUrl: string;
  fileName: string;
  sizeBytes: number;
}

const ALLOWED_MIME_TYPES = new Set<string>([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

const MAX_RAW_IMAGE_BYTES = 15 * 1024 * 1024; // 15 MB
const MAX_ANALYSIS_DIMENSION = 1600;
const MAX_PREVIEW_DIMENSION = 480;

function resolveMimeType(file: File): SupportedImageMime | null {
  const mime = (file.type || '').toLowerCase();
  if (ALLOWED_MIME_TYPES.has(mime)) {
    return mime as SupportedImageMime;
  }
  const lowerName = (file.name || '').toLowerCase();
  if (lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')) return 'image/jpeg';
  if (lowerName.endsWith('.png')) return 'image/png';
  if (lowerName.endsWith('.webp')) return 'image/webp';
  return null;
}

function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Rasmni o‘qib bo‘lmadi.'));
      }
    };
    reader.onerror = () => reject(new Error('Rasmni o‘qishda xatolik yuz berdi.'));
    reader.readAsDataURL(blob);
  });
}

function loadImageFromUrl(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Tanlangan rasm formati shikastlangan yoki o‘qib bo‘lmadi.'));
    img.src = src;
  });
}

function canvasToDataUrl(
  img: HTMLImageElement,
  maxDim: number,
  mimeType: SupportedImageMime,
  quality: number
): string {
  const srcW = img.naturalWidth || img.width || 1;
  const srcH = img.naturalHeight || img.height || 1;
  const scale = Math.min(1, maxDim / Math.max(srcW, srcH));
  const targetW = Math.max(1, Math.round(srcW * scale));
  const targetH = Math.max(1, Math.round(srcH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Brauzerda rasmni qayta ishlash imkoni bo‘lmadi.');
  }

  if (mimeType === 'image/jpeg') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, targetW, targetH);
  }
  ctx.drawImage(img, 0, 0, targetW, targetH);

  return mimeType === 'image/png'
    ? canvas.toDataURL('image/png')
    : canvas.toDataURL(mimeType, quality);
}

function extractPureBase64(dataUrl: string): string {
  const commaIdx = dataUrl.indexOf(',');
  return commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
}

export async function prepareChatImageFile(file: File): Promise<PreparedChatImage> {
  const mimeType = resolveMimeType(file);
  if (!mimeType) {
    throw new Error('Faqat JPEG, PNG yoki WEBP formatidagi rasmlar qabul qilinadi.');
  }

  if (file.size <= 0) {
    throw new Error('Tanlangan rasm bo‘sh.');
  }
  if (file.size > MAX_RAW_IMAGE_BYTES) {
    throw new Error('Rasm hajmi 15 MB dan oshmasligi kerak.');
  }

  const rawDataUrl = await readBlobAsDataUrl(file);
  const img = await loadImageFromUrl(rawDataUrl);

  const srcMaxDim = Math.max(img.naturalWidth || 0, img.naturalHeight || 0);
  let analysisDataUrl = rawDataUrl;
  let analysisMime: SupportedImageMime = mimeType;

  // Keep small crisp originals untouched, otherwise resize cleanly for fast Gemini inlineData transfer
  if (srcMaxDim > MAX_ANALYSIS_DIMENSION || file.size > 1_200_000) {
    analysisMime = mimeType === 'image/webp' ? 'image/webp' : 'image/jpeg';
    analysisDataUrl = canvasToDataUrl(img, MAX_ANALYSIS_DIMENSION, analysisMime, 0.86);
    if (analysisDataUrl.length > 3_200_000) {
      analysisDataUrl = canvasToDataUrl(img, 1280, 'image/jpeg', 0.78);
      analysisMime = 'image/jpeg';
    }
  }

  // Lightweight preview stored in Supabase chat_history JSONB
  let previewDataUrl = canvasToDataUrl(img, MAX_PREVIEW_DIMENSION, 'image/jpeg', 0.72);
  if (previewDataUrl.length > 75_000) {
    previewDataUrl = canvasToDataUrl(img, 360, 'image/jpeg', 0.62);
  }

  return {
    mimeType: analysisMime,
    base64: extractPureBase64(analysisDataUrl),
    previewDataUrl,
    fileName: (file.name || 'rasm.jpg').slice(0, 120),
    sizeBytes: file.size,
  };
}
