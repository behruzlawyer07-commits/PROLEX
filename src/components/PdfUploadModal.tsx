import { AlertTriangle, FileText, Upload, X } from 'lucide-react';
import { type ChangeEvent, type DragEvent, type FormEvent, useRef, useState } from 'react';
import { api, ApiError } from '../lib/api';
import type { LegalDocumentMeta } from '../types/sherlex';

const MAX_BYTES = 50 * 1024 * 1024; // 50 MB

export const LEGAL_CATEGORIES = [
  'Kodekslarga sharhlar',
  'Oliy sud Plenum qarorlari',
  'Jinoyat huquqi va JPK',
  'Prokuror nazorati va HMQO',
  'Fuqarolik huquqi va FPK',
  "Ma'muriy huquq va MJtK",
  'Mehnat va ijtimoiy huquq',
  'Konstitutsiyaviy va davlat huquqi',
  'Boshqa huquqiy manba',
];

interface PdfUploadModalProps {
  token: string;
  isOpen: boolean;
  onClose: () => void;
  onUploaded: (doc: LegalDocumentMeta) => void;
}

export function PdfUploadModal({
  token,
  isOpen,
  onClose,
  onUploaded,
}: PdfUploadModalProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState(LEGAL_CATEGORIES[0]);
  const [note, setNote] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);

  if (!isOpen) return null;

  function validateAndSelectFile(file: File | null) {
    setErrorMsg('');
    if (!file) return;

    const isPdfExt = file.name.toLowerCase().endsWith('.pdf');
    const isPdfMime =
      file.type === 'application/pdf' ||
      file.type === 'application/x-pdf' ||
      file.type === '';

    if (!isPdfExt || !isPdfMime) {
      setSelectedFile(null);
      setErrorMsg('Faqat PDF (.pdf) formatidagi hujjatlar qabul qilinadi.');
      return;
    }

    if (file.size > MAX_BYTES) {
      const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
      setSelectedFile(null);
      setErrorMsg(
        `Tanlangan fayl hajmi ${sizeMb} MB. Maksimal ruxsat etilgan hajm: 50 MB.`
      );
      return;
    }

    setSelectedFile(file);
    if (!title.trim()) {
      setTitle(file.name.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').trim());
    }
  }

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    validateAndSelectFile(file);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0] ?? null;
    validateAndSelectFile(file);
  }

  function handleClose() {
    if (uploading) return;
    setSelectedFile(null);
    setTitle('');
    setNote('');
    setErrorMsg('');
    setProgress(0);
    onClose();
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setErrorMsg('');

    if (!selectedFile) {
      setErrorMsg('Iltimos, avval PDF faylni tanlang.');
      return;
    }
    if (!title.trim() || title.trim().length < 2) {
      setErrorMsg('Hujjat nomini kiriting.');
      return;
    }

    setUploading(true);
    setProgress(0);
    try {
      const res = await api.uploadDocument(
        token,
        {
          file: selectedFile,
          title: title.trim(),
          category,
          note: note.trim(),
        },
        (pct) => setProgress(pct)
      );
      onUploaded(res.document);
      setSelectedFile(null);
      setTitle('');
      setNote('');
      setProgress(0);
      onClose();
    } catch (err) {
      setErrorMsg(
        err instanceof ApiError
          ? err.message
          : 'PDF hujjatni yuklashda xatolik yuz berdi.'
      );
    } finally {
      setUploading(false);
    }
  }

  const fileSizeMb = selectedFile
    ? (selectedFile.size / (1024 * 1024)).toFixed(2)
    : null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="pdf-upload-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4"
    >
      <div className="w-full max-w-xl rounded-2xl border border-[#D4AF37]/30 bg-[#0E1C33] text-[#F4F1EA] shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700/50">
          <div>
            <h3
              id="pdf-upload-modal-title"
              className="font-serif text-xl font-semibold text-[#F4F1EA]"
            >
              PDF huquqiy manba yuklash
            </h3>
            <p className="text-xs text-[#9FB0C7] mt-0.5">
              Maksimal fayl hajmi: 50 MB · Faqat .pdf format
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={uploading}
            aria-label="Oynani yopish"
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/60 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {errorMsg && (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-lg border border-red-500/40 bg-red-950/40 px-4 py-3 text-xs sm:text-sm text-red-200"
            >
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-red-400" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Drag and Drop / Device File Picker */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={() => !uploading && fileInputRef.current?.click()}
            className={`rounded-xl border-2 border-dashed p-6 text-center transition-colors cursor-pointer ${
              isDragging
                ? 'border-[#D4AF37] bg-[#D4AF37]/10'
                : selectedFile
                  ? 'border-[#D4AF37]/50 bg-[#132544]'
                  : 'border-slate-600/70 bg-[#081120] hover:border-[#D4AF37]/50'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,application/pdf"
              onChange={handleFileChange}
              className="hidden"
            />
            {selectedFile ? (
              <div className="flex flex-col items-center gap-2">
                <div className="w-11 h-11 rounded-xl bg-[#D4AF37]/15 border border-[#D4AF37]/40 flex items-center justify-center text-[#E5C35B]">
                  <FileText className="w-5 h-5" />
                </div>
                <p className="text-sm font-medium text-[#F4F1EA] break-all max-w-md">
                  {selectedFile.name}
                </p>
                <p className="text-xs text-[#9FB0C7] tabular-nums">
                  Hajmi: {fileSizeMb} MB · Boshqa fayl tanlash uchun bosing
                </p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2.5">
                <div className="w-11 h-11 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center text-[#D4AF37]">
                  <Upload className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-sm font-medium text-[#F4F1EA]">
                    PDF faylni shu yerga tashlang yoki qurilmadan tanlang
                  </p>
                  <p className="text-xs text-[#9FB0C7] mt-1">
                    Kodeks sharhlari, Oliy sud Plenum qarorlari, o‘quv qo‘llanmalar (50 MB gacha)
                  </p>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    fileInputRef.current?.click();
                  }}
                  className="mt-1 px-4 py-2 rounded-lg border border-[#D4AF37]/40 bg-[#132544] hover:bg-[#1A3158] text-xs font-medium text-[#F5DC86] transition-colors cursor-pointer"
                >
                  Qurilmadan PDF tanlash
                </button>
              </div>
            )}
          </div>

          <div>
            <label
              htmlFor="pdf-title"
              className="block text-xs font-medium text-[#CBD5E1] mb-1.5"
            >
              Hujjat nomi *
            </label>
            <input
              id="pdf-title"
              type="text"
              required
              disabled={uploading}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Masalan: O‘zbekiston Respublikasi Jinoyat kodeksiga sharh (2025)"
              className="w-full rounded-lg bg-[#081120] border border-slate-700/70 px-3.5 py-2.5 text-sm text-[#F4F1EA] placeholder:text-slate-500 focus:outline-none focus:border-[#D4AF37]"
            />
          </div>

          <div>
            <label
              htmlFor="pdf-category"
              className="block text-xs font-medium text-[#CBD5E1] mb-1.5"
            >
              Soha / turi *
            </label>
            <select
              id="pdf-category"
              disabled={uploading}
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full rounded-lg bg-[#081120] border border-slate-700/70 px-3.5 py-2.5 text-sm text-[#F4F1EA] focus:outline-none focus:border-[#D4AF37]"
            >
              {LEGAL_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="pdf-note"
              className="block text-xs font-medium text-[#CBD5E1] mb-1.5"
            >
              Izoh (ixtiyoriy)
            </label>
            <textarea
              id="pdf-note"
              rows={2}
              disabled={uploading}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Nashr yili, mualliflar yoki qo‘llanish sohasi bo‘yicha qisqacha izoh..."
              className="w-full rounded-lg bg-[#081120] border border-slate-700/70 px-3.5 py-2 text-sm text-[#F4F1EA] placeholder:text-slate-500 focus:outline-none focus:border-[#D4AF37] resize-none"
            />
          </div>

          {uploading && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs text-[#CBD5E1] tabular-nums">
                <span>
                  {progress < 100
                    ? 'Fayl yuklanmoqda...'
                    : 'Matn ajratilmoqda va indekslanmoqda...'}
                </span>
                <span>{progress}%</span>
              </div>
              <div className="w-full h-2 rounded-full bg-[#081120] overflow-hidden border border-slate-700/50">
                <div
                  className="h-full bg-[#D4AF37] transition-all duration-200"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={handleClose}
              disabled={uploading}
              className="px-4 py-2.5 rounded-lg border border-slate-700 text-xs sm:text-sm font-medium text-[#CBD5E1] hover:bg-slate-800/60 transition-colors cursor-pointer"
            >
              Bekor qilish
            </button>
            <button
              type="submit"
              disabled={uploading || !selectedFile}
              className="px-5 py-2.5 rounded-lg bg-[#D4AF37] hover:bg-[#E2C15A] disabled:opacity-50 text-[#081120] text-xs sm:text-sm font-semibold transition-colors cursor-pointer"
            >
              {uploading ? 'Yuklanmoqda...' : 'Bazaga yuklash va indekslash'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
