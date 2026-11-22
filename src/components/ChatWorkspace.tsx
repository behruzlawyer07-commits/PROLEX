import {
  BookOpen,
  Check,
  Copy,
  ExternalLink,
  FileText,
  LogOut,
  Menu,
  MessageSquare,
  Plus,
  Scale,
  Send,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api, ApiError } from '../lib/api';
import type {
  ChatSession,
  ChatSessionSummary,
  LegalDocumentMeta,
  UserPublic,
} from '../types/sherlex';
import { EmblemImage } from './EmblemImage';

interface ChatWorkspaceProps {
  token: string;
  user: UserPublic;
  onOpenAdmin: () => void;
  onLogout: () => void;
  knowledgeRefreshKey: number;
}

const SAMPLE_CASES = [
  {
    title: 'Jinoyat huquqi · Firibgarlik kazusi',
    prompt:
      "Kazus: Fuqaro A. o'zini tuman hokimligi mas'ul xodimi sifatida tanishtirib, tadbirkor B.ga yer uchastkasi ajratib berishni va'da qilgan va buning evaziga 25 000 AQSH dollari olgan. Aslida A. bunday vakolatga ega bo'lmagan. Harakatni JK va Oliy sud Plenumi qarorlari asosida kvalifikatsiya qiling.",
  },
  {
    title: 'Prokuror nazorati · JPK 83-modda',
    prompt:
      "Kazus: Tuman IIB tergov bo'limi tomonidan JPK 83-moddasi asosida jinoyat ishi qo'zg'atishni rad etish haqida qaror qabul qilingan. Biroq ariza beruvchining asosiy guvohlari so'roq qilinmagan va moliyaviy ekspertiza tayinlanmagan. Prokurorning nazorat vakolatlari, bevosita va bilvosita normalarni tahlil qiling.",
  },
  {
    title: 'Nazariy va taqqoslash · JK XIII–XIV boblar',
    prompt:
      "Jazodan ozod qilish bilan javobgarlikdan ozod qilishning farqi nimada? Har ikki institutning huquqiy mohiyati, aniq kodeks moddalari, qo'llanilish bosqichlari, vakolatli organlar hamda sudlanganlik oqibatlarini taqqoslash jadvali bilan batafsil tushuntiring.",
  },
];

function isSafeExternalUrl(href?: string): boolean {
  if (!href) return false;
  try {
    const parsed = new URL(href);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

function formatShortDate(iso: string): string {
  try {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
  } catch {
    return '';
  }
}

export function ChatWorkspace({
  token,
  user,
  onOpenAdmin,
  onLogout,
  knowledgeRefreshKey,
}: ChatWorkspaceProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [chats, setChats] = useState<ChatSessionSummary[]>([]);
  const [activeChat, setActiveChat] = useState<ChatSession | null>(null);
  const [loadingChats, setLoadingChats] = useState(true);
  const [loadingThread, setLoadingThread] = useState(false);

  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [pendingUserText, setPendingUserText] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);

  const [knowledgeDocs, setKnowledgeDocs] = useState<LegalDocumentMeta[]>([]);
  const [knowledgeModalOpen, setKnowledgeModalOpen] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const loadChatsAndKnowledge = useCallback(async () => {
    setLoadingChats(true);
    try {
      const [chatsRes, kbRes] = await Promise.all([
        api.listChats(token),
        api.getKnowledgeSummary(token),
      ]);
      const safeChats = (chatsRes.chats ?? []).filter((c): c is ChatSessionSummary =>
        Boolean(c && c.id)
      );
      setChats(safeChats);
      setKnowledgeDocs(kbRes.documents ?? []);

      if (safeChats.length > 0) {
        const firstId = safeChats[0].id;
        const threadRes = await api.getChat(token, firstId);
        setActiveChat(threadRes?.chat ?? null);
      } else {
        setActiveChat(null);
      }
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        onLogout();
        return;
      }
      setErrorMsg(
        err instanceof ApiError ? err.message : 'Suhbatlarni yuklashda xatolik.'
      );
    } finally {
      setLoadingChats(false);
    }
  }, [token, onLogout]);

  useEffect(() => {
    void loadChatsAndKnowledge();
  }, [loadChatsAndKnowledge]);

  useEffect(() => {
    api
      .getKnowledgeSummary(token)
      .then((res) => setKnowledgeDocs(res.documents))
      .catch(() => {});
  }, [token, knowledgeRefreshKey]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeChat?.messages.length, pendingUserText, sending]);

  function autoResizeTextarea() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }

  async function handleNewChat() {
    setErrorMsg('');
    setSidebarOpen(false);
    try {
      const res = await api.createChat(token, 'Yangi huquqiy tahlil');
      const createdChat = res?.chat;
      if (!createdChat?.id) {
        throw new Error('Yangi suhbat ma’lumotlari olinmadi.');
      }
      const summary: ChatSessionSummary = {
        id: createdChat.id,
        title: createdChat.title,
        createdAt: createdChat.createdAt,
        updatedAt: createdChat.updatedAt,
        messageCount: 0,
      };
      setChats((prev) => [
        summary,
        ...prev.filter((c): c is ChatSessionSummary => Boolean(c && c.id && c.id !== summary.id)),
      ]);
      setActiveChat(createdChat);
      setTimeout(() => textareaRef.current?.focus(), 50);
    } catch (err) {
      setErrorMsg(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Yangi tahlil ochishda xatolik.'
      );
    }
  }

  async function handleSelectChat(chatId: string) {
    if (sending) return;
    setErrorMsg('');
    setSidebarOpen(false);
    setLoadingThread(true);
    try {
      const res = await api.getChat(token, chatId);
      setActiveChat(res?.chat ?? null);
    } catch (err) {
      setErrorMsg(
        err instanceof ApiError ? err.message : 'Suhbatni yuklab bo‘lmadi.'
      );
    } finally {
      setLoadingThread(false);
    }
  }

  async function handleDeleteChat(chatId: string) {
    setErrorMsg('');
    try {
      await api.deleteChat(token, chatId);
      setChats((prev) =>
        prev.filter((c): c is ChatSessionSummary => Boolean(c && c.id && c.id !== chatId))
      );
      if (activeChat?.id === chatId) {
        setActiveChat(null);
      }
    } catch (err) {
      setErrorMsg(
        err instanceof ApiError ? err.message : 'Suhbatni o‘chirishda xatolik.'
      );
    }
  }

  async function submitPrompt(promptOverride?: string) {
    const text = (promptOverride ?? inputText).trim();
    if (!text || sending) return;

    setErrorMsg('');
    setSending(true);
    setPendingUserText(text);
    if (!promptOverride) {
      setInputText('');
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    }

    try {
      let targetChatId = activeChat?.id;
      if (!targetChatId) {
        const created = await api.createChat(token, 'Yangi huquqiy tahlil');
        if (!created?.chat?.id) {
          throw new Error('Yangi tahlil sessiyasini yaratib bo‘lmadi.');
        }
        targetChatId = created.chat.id;
        setActiveChat(created.chat);
      }

      const res = await api.sendMessage(token, targetChatId, text);
      const updatedChat = res?.chat;
      if (!updatedChat?.id) {
        const refreshed = await api.listChats(token);
        setChats(
          (refreshed.chats ?? []).filter((c): c is ChatSessionSummary => Boolean(c && c.id))
        );
        return;
      }

      const summary: ChatSessionSummary = {
        id: updatedChat.id,
        title: updatedChat.title,
        createdAt: updatedChat.createdAt,
        updatedAt: updatedChat.updatedAt,
        messageCount: Array.isArray(updatedChat.messages) ? updatedChat.messages.length : 0,
      };
      setActiveChat(updatedChat);
      setChats((prev) => [
        summary,
        ...prev.filter((c): c is ChatSessionSummary => Boolean(c && c.id && c.id !== summary.id)),
      ]);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        onLogout();
        return;
      }
      setErrorMsg(
        err instanceof ApiError
          ? err.message
          : 'Javob olishda xatolik yuz berdi. Qayta urinib ko‘ring.'
      );
      if (!promptOverride) {
        setInputText(text);
      }
    } finally {
      setPendingUserText(null);
      setSending(false);
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void submitPrompt();
    }
  }

  async function handleCopyMessage(msgId: string, content: string) {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedMsgId(msgId);
      setTimeout(() => {
        setCopiedMsgId((prev) => (prev === msgId ? null : prev));
      }, 2000);
    } catch {
      // ignore
    }
  }

  const messages = activeChat?.messages ?? [];

  return (
    <div className="h-screen w-full bg-[#081120] text-[#F4F1EA] flex overflow-hidden">
      {/* Mobile Sidebar Backdrop */}
      {sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 z-30 bg-black/65 lg:hidden"
        />
      )}

      {/* Left Sidebar (User-Isolated Chat History) */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-[280px] bg-[#0B172A] border-r border-[#D4AF37]/18 flex flex-col transition-transform duration-200 lg:static lg:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Sidebar Header */}
        <div className="px-4 py-4 border-b border-slate-800/90 flex items-center justify-between gap-2">
          <div className="flex items-center gap-3 min-w-0">
            <EmblemImage size="sm" />
            <div className="min-w-0">
              <span className="font-serif text-lg font-bold tracking-tight text-[#F4F1EA] block leading-tight">
                PROLEX
              </span>
              <span className="text-[11px] text-[#D4AF37] block truncate">
                HMQA · Prokuratura AI
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setSidebarOpen(false)}
            aria-label="Menyuni yopish"
            className="lg:hidden p-1.5 rounded-lg text-slate-400 hover:text-white cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* New Analysis CTA */}
        <div className="p-3.5">
          <button
            type="button"
            onClick={handleNewChat}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-[#D4AF37] hover:bg-[#E2C15A] text-[#081120] font-semibold text-sm py-2.5 px-4 transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4 shrink-0" />
            <span>Yangi tahlil</span>
          </button>
        </div>

        {/* Private Chat History */}
        <div className="px-4 pb-2">
          <p className="text-xs font-medium text-[#889BB5]">
            Shaxsiy tahlillar tarixi
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-2.5 space-y-1">
          {loadingChats ? (
            <div className="px-3 py-4 text-xs text-[#889BB5]">
              Tarix yuklanmoqda...
            </div>
          ) : chats.length === 0 ? (
            <div className="px-3 py-6 text-xs text-[#889BB5] leading-relaxed">
              Hali tahlillar mavjud emas. Yangi kazus yoki huquqiy savol yuboring.
            </div>
          ) : (
            chats.map((chat) => {
              const isActive = activeChat?.id === chat.id;
              return (
                <div
                  key={chat.id}
                  className={`group flex items-center gap-2 rounded-lg px-3 py-2.5 text-xs transition-colors ${
                    isActive
                      ? 'bg-[#152846] text-[#F4F1EA] border border-[#D4AF37]/30'
                      : 'text-[#CBD5E1] hover:bg-[#102038] border border-transparent'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => handleSelectChat(chat.id)}
                    className="flex-1 min-w-0 text-left flex items-start gap-2.5 cursor-pointer"
                  >
                    <MessageSquare className="w-3.5 h-3.5 shrink-0 mt-0.5 text-[#D4AF37]/80" />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium truncate">{chat.title}</p>
                      <p className="text-[11px] text-[#889BB5] tabular-nums mt-0.5">
                        {formatShortDate(chat.updatedAt)}
                      </p>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteChat(chat.id)}
                    aria-label={`${chat.title} tahlilini o‘chirish`}
                    className="opacity-70 lg:opacity-0 group-hover:opacity-100 p-1 rounded text-slate-400 hover:text-red-400 transition-opacity cursor-pointer shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })
          )}
        </div>

        {/* Sidebar Bottom User & Admin Controls */}
        <div className="p-3.5 border-t border-slate-800/90 space-y-2 bg-[#091324]">
          <div className="px-1">
            <p className="text-xs font-semibold text-[#F4F1EA] truncate">
              {user.name}
            </p>
            <p className="text-[11px] text-[#889BB5] truncate">
              {user.login}
            </p>
          </div>

          {user.role === 'admin' && (
            <button
              type="button"
              onClick={onOpenAdmin}
              className="w-full flex items-center justify-center gap-2 rounded-lg border border-[#D4AF37]/40 bg-[#132544] hover:bg-[#193058] text-xs font-medium text-[#F5DC86] py-2 px-3 transition-colors cursor-pointer"
            >
              <ShieldCheck className="w-4 h-4 shrink-0" />
              <span>Admin panel</span>
            </button>
          )}

          <button
            type="button"
            onClick={onLogout}
            className="w-full flex items-center justify-center gap-2 rounded-lg border border-slate-700/70 hover:bg-slate-800/70 text-xs font-medium text-[#CBD5E1] py-2 px-3 transition-colors cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5 shrink-0" />
            <span>Tizimdan chiqish</span>
          </button>
        </div>
      </aside>

      {/* Main Chat Viewport */}
      <div className="flex-1 flex flex-col min-w-0 bg-[#081120]">
        {/* Top Bar */}
        <header className="shrink-0 h-14 px-4 sm:px-6 border-b border-slate-800/90 bg-[#0A1527]/90 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              aria-label="Suhbatlar menyusini ochish"
              className="lg:hidden p-2 -ml-2 rounded-lg text-[#CBD5E1] hover:text-white hover:bg-slate-800/60 cursor-pointer"
            >
              <Menu className="w-5 h-5" />
            </button>
            <h1 className="text-sm font-semibold text-[#F4F1EA] truncate">
              {activeChat ? activeChat.title : 'Yangi huquqiy tahlil'}
            </h1>
          </div>

          <button
            type="button"
            onClick={() => setKnowledgeModalOpen(true)}
            className="flex items-center gap-2 text-xs text-[#9FB0C7] hover:text-[#F5DC86] whitespace-nowrap shrink-0 transition-colors cursor-pointer"
          >
            <BookOpen className="w-3.5 h-3.5 text-[#D4AF37]" />
            <span className="tabular-nums">
              Manbalar: {knowledgeDocs.length} ta PDF · Lex.uz
            </span>
          </button>
        </header>

        {/* Scrollable Message Area */}
        <main className="flex-1 overflow-y-auto px-4 sm:px-6 py-6">
          <div className="max-w-3xl mx-auto space-y-6">
            {errorMsg && (
              <div
                role="alert"
                className="rounded-xl border border-red-500/40 bg-red-950/40 px-4 py-3 text-xs sm:text-sm text-red-200"
              >
                {errorMsg}
              </div>
            )}

            {loadingThread ? (
              <div className="py-12 text-center text-sm text-[#889BB5]">
                Tahlil matni yuklanmoqda...
              </div>
            ) : messages.length === 0 && !pendingUserText ? (
              <div className="py-8 sm:py-12 space-y-8">
                <div className="text-center space-y-3 max-w-xl mx-auto">
                  <div className="w-14 h-14 mx-auto rounded-2xl border border-[#D4AF37]/35 bg-[#0E1C33] flex items-center justify-center text-[#D4AF37]">
                    <Scale className="w-7 h-7" />
                  </div>
                  <h2 className="font-serif text-2xl sm:text-3xl font-semibold text-[#F4F1EA] [text-wrap:balance]">
                    PROLEX — Huquqiy tahlil va kazuslar yordamchisi
                  </h2>
                  <p className="text-xs sm:text-sm text-[#9FB0C7] leading-relaxed">
                    Amaliy kazus, nazariy savol yoki taqqoslash masalasini kiriting. Tizim Lex.uz rasmiy qonunchiligi va Administrator yuklagan PDF manbalar asosida bevosita hamda bilvosita normalarni aniq moddalar bilan batafsil tahlil qiladi.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
                  {SAMPLE_CASES.map((sample) => (
                    <button
                      key={sample.title}
                      type="button"
                      onClick={() => void submitPrompt(sample.prompt)}
                      className="text-left rounded-xl border border-slate-700/60 bg-[#0E1C33] hover:border-[#D4AF37]/45 hover:bg-[#122440] p-4 transition-colors cursor-pointer flex flex-col justify-between gap-3"
                    >
                      <div>
                        <p className="text-xs font-semibold text-[#E5C35B] mb-1.5">
                          {sample.title}
                        </p>
                        <p className="text-xs text-[#CBD5E1] leading-relaxed line-clamp-4">
                          {sample.prompt}
                        </p>
                      </div>
                      <span className="text-[11px] font-medium text-[#D4AF37]">
                        Tahlilni boshlash →
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <>
                {messages.map((msg) =>
                  msg.role === 'user' ? (
                    <div key={msg.id} className="flex justify-end">
                      <div className="max-w-[88%] sm:max-w-[80%] rounded-2xl border border-[#D4AF37]/25 bg-[#132440] px-4 py-3.5 text-sm text-[#F4F1EA] leading-relaxed whitespace-pre-wrap">
                        {msg.content}
                      </div>
                    </div>
                  ) : (
                    <article
                      key={msg.id}
                      className="rounded-2xl border border-slate-700/55 bg-[#0D1A2F] p-5 sm:p-6 space-y-4"
                    >
                      <div className="flex items-center justify-between gap-3 pb-3 border-b border-slate-800">
                        <div className="flex items-center gap-2.5 text-xs font-medium text-[#E5C35B]">
                          <Scale className="w-4 h-4 shrink-0" />
                          <span>PROLEX yuridik tahlili</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleCopyMessage(msg.id, msg.content)}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-slate-700/80 hover:border-[#D4AF37]/45 text-xs text-[#CBD5E1] hover:text-white transition-colors cursor-pointer"
                        >
                          {copiedMsgId === msg.id ? (
                            <>
                              <Check className="w-3.5 h-3.5 text-emerald-400" />
                              <span>Nusxa olindi</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5" />
                              <span>Nusxa olish</span>
                            </>
                          )}
                        </button>
                      </div>

                      <div className="legal-prose">
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={{
                            a: ({ href, children }) =>
                              isSafeExternalUrl(href) ? (
                                <a
                                  href={href}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-baseline gap-1"
                                >
                                  <span>{children}</span>
                                </a>
                              ) : (
                                <span>{children}</span>
                              ),
                            table: ({ children }) => (
                              <div className="overflow-x-auto my-3">
                                <table>{children}</table>
                              </div>
                            ),
                          }}
                        >
                          {msg.content}
                        </ReactMarkdown>
                      </div>

                      {((msg.sources && msg.sources.length > 0) ||
                        (msg.referencedPdfs && msg.referencedPdfs.length > 0)) && (
                        <div className="pt-4 border-t border-slate-800 space-y-2.5 text-xs">
                          {msg.referencedPdfs && msg.referencedPdfs.length > 0 && (
                            <div className="text-[#CBD5E1]">
                              <span className="font-semibold text-[#E5C35B]">
                                Tekshirilgan ichki PDF manbalar:{' '}
                              </span>
                              <span>{msg.referencedPdfs.join(' · ')}</span>
                            </div>
                          )}

                          {msg.sources && msg.sources.length > 0 && (
                            <div className="space-y-1.5">
                              <p className="font-semibold text-[#E5C35B]">
                                Qidiruv orqali tasdiqlangan rasmiy havolalar:
                              </p>
                              <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                                {msg.sources.map((src) => (
                                  <a
                                    key={src.url}
                                    href={src.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 text-[#9FB0C7] hover:text-[#F5DC86] underline underline-offset-2"
                                  >
                                    <span className="truncate max-w-[260px]">
                                      {src.title}
                                    </span>
                                    <ExternalLink className="w-3 h-3 shrink-0" />
                                  </a>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </article>
                  )
                )}

                {pendingUserText && (
                  <div className="flex justify-end">
                    <div className="max-w-[88%] sm:max-w-[80%] rounded-2xl border border-[#D4AF37]/25 bg-[#132440] px-4 py-3.5 text-sm text-[#F4F1EA] leading-relaxed whitespace-pre-wrap">
                      {pendingUserText}
                    </div>
                  </div>
                )}

                {sending && (
                  <div className="rounded-2xl border border-slate-700/55 bg-[#0D1A2F] p-5 space-y-2.5">
                    <div className="flex items-center gap-2.5 text-xs font-medium text-[#E5C35B]">
                      <Scale className="w-4 h-4 animate-pulse" />
                      <span>
                        Normativ-huquqiy hujjatlar (Lex.uz) va yuklangan PDF manbalar tahlil qilinmoqda...
                      </span>
                    </div>
                    <div className="space-y-2 pt-1">
                      <div className="h-3 w-3/4 rounded bg-slate-800 animate-pulse" />
                      <div className="h-3 w-full rounded bg-slate-800 animate-pulse" />
                      <div className="h-3 w-5/6 rounded bg-slate-800 animate-pulse" />
                    </div>
                  </div>
                )}
              </>
            )}
            <div ref={messagesEndRef} />
          </div>
        </main>

        {/* Composer Footer */}
        <footer className="shrink-0 px-4 sm:px-6 pb-4 pt-2 bg-[#081120]">
          <div className="max-w-3xl mx-auto">
            <div className="rounded-2xl border border-slate-700/70 focus-within:border-[#D4AF37]/60 bg-[#0E1C33] p-2.5 sm:p-3 transition-colors">
              <textarea
                ref={textareaRef}
                rows={1}
                disabled={sending}
                value={inputText}
                onChange={(e) => {
                  setInputText(e.target.value);
                  autoResizeTextarea();
                }}
                onKeyDown={handleKeyDown}
                placeholder="Kazus, amaliy holat yoki huquqiy savolingizni kiriting..."
                className="w-full bg-transparent px-2 py-1.5 text-sm text-[#F4F1EA] placeholder:text-[#6B7E99] focus:outline-none resize-none max-h-44"
              />
              <div className="flex items-center justify-between gap-3 pt-2 px-2 border-t border-slate-800/80 mt-1.5">
                <p className="text-[11px] text-[#6B7E99]">
                  Enter — yuborish · Shift+Enter — yangi qator
                </p>
                <button
                  type="button"
                  disabled={sending || !inputText.trim()}
                  onClick={() => void submitPrompt()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#D4AF37] hover:bg-[#E2C15A] disabled:opacity-45 text-[#081120] text-xs font-semibold px-4 py-2 whitespace-nowrap transition-colors cursor-pointer"
                >
                  <Send className="w-3.5 h-3.5 shrink-0" />
                  <span>{sending ? 'Tahlil...' : 'Yuborish'}</span>
                </button>
              </div>
            </div>
          </div>
        </footer>
      </div>

      {/* Read-Only Indexed PDF Knowledge Base Modal */}
      {knowledgeModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="kb-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
        >
          <div className="w-full max-w-lg rounded-2xl border border-[#D4AF37]/30 bg-[#0E1C33] text-[#F4F1EA] shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700/50">
              <div>
                <h3
                  id="kb-modal-title"
                  className="font-serif text-xl font-semibold text-[#F4F1EA]"
                >
                  Ulangan huquqiy PDF manbalar
                </h3>
                <p className="text-xs text-[#9FB0C7] mt-0.5">
                  AI tahlilda foydalaniladigan idoraviy manbalar reyestri
                </p>
              </div>
              <button
                type="button"
                onClick={() => setKnowledgeModalOpen(false)}
                aria-label="Yopish"
                className="p-2 rounded-lg text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="max-h-96 overflow-y-auto p-5 divide-y divide-slate-800">
              {knowledgeDocs.length === 0 ? (
                <p className="text-xs sm:text-sm text-[#9FB0C7] py-4 text-center">
                  Hozircha Administrator tomonidan PDF manba yuklanmagan. AI javoblar Lex.uz rasmiy qonunchiligi asosida shakllantiriladi.
                </p>
              ) : (
                knowledgeDocs.map((doc) => (
                  <div key={doc.id} className="py-3 first:pt-0 last:pb-0 flex items-start gap-3">
                    <FileText className="w-4 h-4 text-[#D4AF37] shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[#F4F1EA]">
                        {doc.title}
                      </p>
                      <p className="text-xs text-[#889BB5] mt-0.5">
                        {doc.category}
                        {doc.pageCount > 0 ? ` · ${doc.pageCount} bet` : ''}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
