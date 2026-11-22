import {
  ArrowLeft,
  Ban,
  Check,
  CheckCircle2,
  Copy,
  FileText,
  KeyRound,
  LogOut,
  Plus,
  Search,
  Trash2,
  Upload,
  UserPlus,
  Users,
} from 'lucide-react';
import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../lib/api';
import type { LegalDocumentMeta, UserPublic } from '../types/sherlex';
import { EmblemImage } from './EmblemImage';
import { LEGAL_CATEGORIES, PdfUploadModal } from './PdfUploadModal';

interface AdminPanelProps {
  token: string;
  currentUser: UserPublic;
  onBackToChat: () => void;
  onLogout: () => void;
  onDocumentsChanged: () => void;
}

function generateStrongPassword(length = 12): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const symbols = '!@#$%*?';
  const all = upper + lower + digits + symbols;

  const randomValues = new Uint32Array(length);
  window.crypto.getRandomValues(randomValues);

  const chars: string[] = [
    upper[randomValues[0] % upper.length],
    lower[randomValues[1] % lower.length],
    digits[randomValues[2] % digits.length],
    symbols[randomValues[3] % symbols.length],
  ];

  for (let i = 4; i < length; i++) {
    chars.push(all[randomValues[i] % all.length]);
  }

  // Shuffle deterministically with additional crypto random
  const shuffleVals = new Uint32Array(chars.length);
  window.crypto.getRandomValues(shuffleVals);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = shuffleVals[i] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDateUz(iso: string): string {
  try {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(
      d.getHours()
    )}:${pad(d.getMinutes())}`;
  } catch {
    return iso;
  }
}

export function AdminPanel({
  token,
  currentUser,
  onBackToChat,
  onLogout,
  onDocumentsChanged,
}: AdminPanelProps) {
  const [activeTab, setActiveTab] = useState<'users' | 'documents'>('users');

  // Users state
  const [users, setUsers] = useState<UserPublic[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [userSearch, setUserSearch] = useState('');
  const [newName, setNewName] = useState('');
  const [newLogin, setNewLogin] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [creatingUser, setCreatingUser] = useState(false);
  const [userError, setUserError] = useState('');
  const [createdCredentials, setCreatedCredentials] = useState<{
    name: string;
    login: string;
    password: string;
  } | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Documents state
  const [documents, setDocuments] = useState<LegalDocumentMeta[]>([]);
  const [docsLoading, setDocsLoading] = useState(true);
  const [docSearch, setDocSearch] = useState('');
  const [docCategoryFilter, setDocCategoryFilter] = useState('Barchasi');
  const [docError, setDocError] = useState('');
  const [uploadModalOpen, setUploadModalOpen] = useState(false);

  const loadData = useCallback(async () => {
    setUsersLoading(true);
    setDocsLoading(true);
    try {
      const [usersRes, docsRes] = await Promise.all([
        api.listUsers(token),
        api.listDocuments(token),
      ]);
      setUsers(usersRes.users);
      setDocuments(docsRes.documents);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Ma’lumotlarni yuklashda xatolik.';
      setUserError(msg);
      setDocError(msg);
    } finally {
      setUsersLoading(false);
      setDocsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  async function copyToClipboard(text: string, markerId: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(markerId);
      setTimeout(() => {
        setCopiedId((prev) => (prev === markerId ? null : prev));
      }, 2200);
    } catch {
      // Fallback ignored if clipboard blocked
    }
  }

  async function handleCreateUser(e: FormEvent) {
    e.preventDefault();
    setUserError('');
    setCreatedCredentials(null);

    if (!newName.trim() || !newLogin.trim() || !newPassword) {
      setUserError('Ism/lavozim, login va parolni kiriting.');
      return;
    }

    setCreatingUser(true);
    try {
      const res = await api.createUser(token, {
        name: newName.trim(),
        login: newLogin.trim(),
        password: newPassword,
      });
      setUsers((prev) => [res.user, ...prev]);
      setCreatedCredentials({
        name: res.user.name,
        login: res.user.login,
        password: newPassword,
      });
      setNewName('');
      setNewLogin('');
      setNewPassword('');
    } catch (err) {
      setUserError(
        err instanceof ApiError ? err.message : 'Foydalanuvchi qo‘shishda xatolik.'
      );
    } finally {
      setCreatingUser(false);
    }
  }

  async function handleToggleUserStatus(user: UserPublic) {
    setUserError('');
    const nextStatus = user.status === 'active' ? 'blocked' : 'active';
    try {
      const res = await api.updateUserStatus(token, user.id, nextStatus);
      setUsers((prev) => prev.map((u) => (u.id === user.id ? res.user : u)));
    } catch (err) {
      setUserError(
        err instanceof ApiError ? err.message : 'Holatni o‘zgartirishda xatolik.'
      );
    }
  }

  async function handleDeleteUser(user: UserPublic) {
    setUserError('');
    try {
      await api.deleteUser(token, user.id);
      setUsers((prev) => prev.filter((u) => u.id !== user.id));
    } catch (err) {
      setUserError(
        err instanceof ApiError ? err.message : 'Foydalanuvchini o‘chirishda xatolik.'
      );
    }
  }

  async function handleDeleteDocument(doc: LegalDocumentMeta) {
    setDocError('');
    try {
      await api.deleteDocument(token, doc.id);
      setDocuments((prev) => prev.filter((d) => d.id !== doc.id));
      onDocumentsChanged();
    } catch (err) {
      setDocError(
        err instanceof ApiError ? err.message : 'PDF hujjatni o‘chirishda xatolik.'
      );
    }
  }

  const filteredUsers = useMemo(() => {
    const q = userSearch.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) =>
        u.name.toLowerCase().includes(q) ||
        u.login.toLowerCase().includes(q)
    );
  }, [users, userSearch]);

  const filteredDocuments = useMemo(() => {
    const q = docSearch.trim().toLowerCase();
    return documents.filter((d) => {
      const catOk =
        docCategoryFilter === 'Barchasi' || d.category === docCategoryFilter;
      const textOk =
        !q ||
        d.title.toLowerCase().includes(q) ||
        d.category.toLowerCase().includes(q) ||
        d.note.toLowerCase().includes(q);
      return catOk && textOk;
    });
  }, [documents, docSearch, docCategoryFilter]);

  return (
    <div className="min-h-screen w-full bg-[#081120] text-[#F4F1EA] flex flex-col">
      {/* Top Bar */}
      <header className="sticky top-0 z-20 bg-[#0A1527]/95 backdrop-blur-md border-b border-[#D4AF37]/20 px-4 sm:px-8 py-3.5">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3.5 min-w-0">
            <EmblemImage size="sm" />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-serif text-lg sm:text-xl font-bold tracking-tight text-[#F4F1EA] whitespace-nowrap">
                  PROLEX
                </span>
                <span className="text-slate-600" aria-hidden="true">
                  /
                </span>
                <span className="text-xs sm:text-sm font-medium text-[#E5C35B] truncate">
                  Administrator paneli
                </span>
              </div>
              <p className="text-xs text-[#889BB5] truncate">
                {currentUser.name} · {currentUser.login}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={onBackToChat}
              className="flex items-center gap-2 px-3.5 py-2 rounded-lg border border-[#D4AF37]/35 bg-[#12223C] hover:bg-[#192F52] text-xs sm:text-sm font-medium text-[#F5DC86] whitespace-nowrap transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4 shrink-0" />
              <span>Huquqiy tahlil (Chat)</span>
            </button>
            <button
              type="button"
              onClick={onLogout}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-700/70 hover:bg-slate-800/70 text-xs sm:text-sm text-[#CBD5E1] whitespace-nowrap transition-colors cursor-pointer"
            >
              <LogOut className="w-4 h-4 shrink-0" />
              <span className="hidden sm:inline">Chiqish</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-8 py-7 space-y-6">
        {/* Section Switcher Tabs */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-800 pb-4">
          <div
            role="tablist"
            aria-label="Administrator bo‘limlari"
            className="inline-flex p-1 rounded-xl bg-[#0E1C33] border border-slate-700/60 self-start"
          >
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'users'}
              onClick={() => setActiveTab('users')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs sm:text-sm font-medium whitespace-nowrap transition-colors cursor-pointer ${
                activeTab === 'users'
                  ? 'bg-[#172A4A] text-[#F5DC86] border border-[#D4AF37]/30'
                  : 'text-[#9FB0C7] hover:text-[#F4F1EA]'
              }`}
            >
              <Users className="w-4 h-4 shrink-0" />
              <span>Foydalanuvchilar</span>
              <span className="text-xs opacity-75 tabular-nums">({users.length})</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'documents'}
              onClick={() => setActiveTab('documents')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs sm:text-sm font-medium whitespace-nowrap transition-colors cursor-pointer ${
                activeTab === 'documents'
                  ? 'bg-[#172A4A] text-[#F5DC86] border border-[#D4AF37]/30'
                  : 'text-[#9FB0C7] hover:text-[#F4F1EA]'
              }`}
            >
              <FileText className="w-4 h-4 shrink-0" />
              <span>Huquqiy manbalar (PDF)</span>
              <span className="text-xs opacity-75 tabular-nums">({documents.length})</span>
            </button>
          </div>

          {activeTab === 'documents' && (
            <button
              type="button"
              onClick={() => setUploadModalOpen(true)}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[#D4AF37] hover:bg-[#E2C15A] text-[#081120] text-xs sm:text-sm font-semibold whitespace-nowrap transition-colors cursor-pointer"
            >
              <Upload className="w-4 h-4 shrink-0" />
              <span>PDF ma’lumot yuklash</span>
            </button>
          )}
        </div>

        {/* SECTION A: USERS MANAGEMENT */}
        {activeTab === 'users' && (
          <div className="space-y-6">
            {/* Add User Card */}
            <section className="rounded-2xl border border-slate-700/60 bg-[#0E1C33] p-5 sm:p-6">
              <div className="mb-4">
                <h2 className="font-serif text-xl sm:text-2xl font-semibold text-[#F4F1EA]">
                  Yangi foydalanuvchi hisobi yaratish
                </h2>
                <p className="text-xs sm:text-sm text-[#9FB0C7] mt-0.5">
                  HMQA tinglovchilari va Prokuratura xodimlari uchun login va parol yarating.
                </p>
              </div>

              {userError && (
                <div
                  role="alert"
                  className="mb-4 rounded-lg border border-red-500/40 bg-red-950/40 px-4 py-3 text-xs sm:text-sm text-red-200"
                >
                  {userError}
                </div>
              )}

              {createdCredentials && (
                <div className="mb-5 rounded-xl border border-emerald-500/35 bg-emerald-950/25 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-xs sm:text-sm font-semibold text-emerald-300">
                      <CheckCircle2 className="w-4 h-4 shrink-0" />
                      <span>Hisob muvaffaqiyatli yaratildi — kirish ma’lumotlarini nusxalab oling</span>
                    </div>
                    <p className="text-xs sm:text-sm text-[#E8E4DA] font-mono">
                      Foydalanuvchi: {createdCredentials.name} · Login: {createdCredentials.login} · Parol: {createdCredentials.password}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      copyToClipboard(
                        `PROLEX kirish ma'lumotlari\nFoydalanuvchi: ${createdCredentials.name}\nLogin: ${createdCredentials.login}\nParol: ${createdCredentials.password}`,
                        'new-cred'
                      )
                    }
                    className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer shrink-0"
                  >
                    {copiedId === 'new-cred' ? (
                      <>
                        <Check className="w-4 h-4" />
                        <span>Nusxa olindi</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4" />
                        <span>Nusxa olish</span>
                      </>
                    )}
                  </button>
                </div>
              )}

              <form
                onSubmit={handleCreateUser}
                className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end"
              >
                <div className="md:col-span-4">
                  <label
                    htmlFor="new-user-name"
                    className="block text-xs font-medium text-[#CBD5E1] mb-1.5"
                  >
                    Ism va lavozim / rol *
                  </label>
                  <input
                    id="new-user-name"
                    type="text"
                    required
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="Masalan: Sardor Alimov — HMQA tinglovchisi"
                    className="w-full rounded-lg bg-[#081120] border border-slate-700/70 px-3.5 py-2.5 text-sm text-[#F4F1EA] placeholder:text-slate-500 focus:outline-none focus:border-[#D4AF37]"
                  />
                </div>

                <div className="md:col-span-3">
                  <label
                    htmlFor="new-user-login"
                    className="block text-xs font-medium text-[#CBD5E1] mb-1.5"
                  >
                    Login yoki Email *
                  </label>
                  <input
                    id="new-user-login"
                    type="text"
                    required
                    value={newLogin}
                    onChange={(e) => setNewLogin(e.target.value)}
                    placeholder="s.alimov@hmqa.uz"
                    className="w-full rounded-lg bg-[#081120] border border-slate-700/70 px-3.5 py-2.5 text-sm text-[#F4F1EA] placeholder:text-slate-500 focus:outline-none focus:border-[#D4AF37]"
                  />
                </div>

                <div className="md:col-span-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <label
                      htmlFor="new-user-pass"
                      className="block text-xs font-medium text-[#CBD5E1]"
                    >
                      Parol *
                    </label>
                    <button
                      type="button"
                      onClick={() => setNewPassword(generateStrongPassword(12))}
                      className="inline-flex items-center gap-1 text-xs font-medium text-[#E5C35B] hover:text-[#F5DC86] cursor-pointer"
                    >
                      <KeyRound className="w-3 h-3" />
                      <span>Parol generatsiya qilish</span>
                    </button>
                  </div>
                  <div className="flex gap-1.5">
                    <input
                      id="new-user-pass"
                      type="text"
                      required
                      minLength={6}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Kamida 6 ta belgi"
                      className="w-full rounded-lg bg-[#081120] border border-slate-700/70 px-3.5 py-2.5 text-sm font-mono text-[#F4F1EA] placeholder:text-slate-500 focus:outline-none focus:border-[#D4AF37]"
                    />
                    {newPassword && newLogin && (
                      <button
                        type="button"
                        onClick={() =>
                          copyToClipboard(
                            `Login: ${newLogin.trim()} | Parol: ${newPassword}`,
                            'draft-cred'
                          )
                        }
                        title="Login va parolni nusxalash"
                        className="px-2.5 rounded-lg border border-slate-700 bg-[#081120] hover:border-[#D4AF37]/50 text-[#CBD5E1] cursor-pointer shrink-0"
                      >
                        {copiedId === 'draft-cred' ? (
                          <Check className="w-4 h-4 text-emerald-400" />
                        ) : (
                          <Copy className="w-4 h-4" />
                        )}
                      </button>
                    )}
                  </div>
                </div>

                <div className="md:col-span-2">
                  <button
                    type="submit"
                    disabled={creatingUser}
                    className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-[#D4AF37] hover:bg-[#E2C15A] disabled:opacity-60 text-[#081120] text-sm font-semibold py-2.5 px-4 whitespace-nowrap transition-colors cursor-pointer"
                  >
                    <UserPlus className="w-4 h-4 shrink-0" />
                    <span>{creatingUser ? 'Qo‘shilmoqda...' : 'Qo‘shish'}</span>
                  </button>
                </div>
              </form>
            </section>

            {/* Users Table */}
            <section className="rounded-2xl border border-slate-700/60 bg-[#0E1C33] overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-700/50 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <h3 className="text-sm sm:text-base font-semibold text-[#F4F1EA]">
                  Ro‘yxatdagi foydalanuvchilar ({filteredUsers.length})
                </h3>
                <div className="relative w-full sm:w-72">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                    placeholder="Ism yoki login bo‘yicha qidirish..."
                    className="w-full rounded-lg bg-[#081120] border border-slate-700/70 pl-9 pr-3 py-2 text-xs sm:text-sm text-[#F4F1EA] placeholder:text-slate-500 focus:outline-none focus:border-[#D4AF37]"
                  />
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-700/50 bg-[#0A1527] text-xs font-medium text-[#889BB5]">
                      <th className="py-3 px-5">Ism va lavozim</th>
                      <th className="py-3 px-4">Login / Email</th>
                      <th className="py-3 px-4">Holat</th>
                      <th className="py-3 px-4">Yaratilgan sana</th>
                      <th className="py-3 px-5 text-right">Amallar</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/80 text-xs sm:text-sm">
                    {usersLoading ? (
                      <tr>
                        <td colSpan={5} className="py-8 px-5 text-center text-[#889BB5]">
                          Foydalanuvchilar ro‘yxati yuklanmoqda...
                        </td>
                      </tr>
                    ) : filteredUsers.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-10 px-5 text-center text-[#889BB5]">
                          Hozircha mos keluvchi foydalanuvchi hisobi topilmadi. Yuqoridagi shakl orqali yangi hisob yarating.
                        </td>
                      </tr>
                    ) : (
                      filteredUsers.map((u) => {
                        const isSelfOrAdmin = u.role === 'admin' || u.id === currentUser.id;
                        return (
                          <tr
                            key={u.id}
                            className="hover:bg-[#132542]/60 transition-colors"
                          >
                            <td className="py-3.5 px-5 font-medium text-[#F4F1EA]">
                              <div className="flex items-center gap-2">
                                <span>{u.name}</span>
                                {u.role === 'admin' && (
                                  <span className="text-xs text-[#E5C35B]">
                                    · Administrator
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="py-3.5 px-4 font-mono text-xs text-[#CBD5E1]">
                              {u.login}
                            </td>
                            <td className="py-3.5 px-4">
                              {u.status === 'active' ? (
                                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400">
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                  <span>Faol</span>
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-400">
                                  <Ban className="w-3.5 h-3.5" />
                                  <span>Bloklangan</span>
                                </span>
                              )}
                            </td>
                            <td className="py-3.5 px-4 text-xs text-[#9FB0C7] tabular-nums">
                              {formatDateUz(u.createdAt)}
                            </td>
                            <td className="py-3.5 px-5">
                              <div className="flex items-center justify-end gap-2">
                                <button
                                  type="button"
                                  onClick={() => copyToClipboard(u.login, `login-${u.id}`)}
                                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-slate-700 hover:border-[#D4AF37]/50 text-xs text-[#CBD5E1] hover:text-white whitespace-nowrap transition-colors cursor-pointer"
                                >
                                  {copiedId === `login-${u.id}` ? (
                                    <>
                                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                                      <span>Nusxalandi</span>
                                    </>
                                  ) : (
                                    <>
                                      <Copy className="w-3.5 h-3.5" />
                                      <span>Nusxa olish</span>
                                    </>
                                  )}
                                </button>

                                {!isSelfOrAdmin && (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => handleToggleUserStatus(u)}
                                      className={`px-2.5 py-1.5 rounded-md border text-xs font-medium whitespace-nowrap transition-colors cursor-pointer ${
                                        u.status === 'active'
                                          ? 'border-amber-500/40 text-amber-300 hover:bg-amber-950/40'
                                          : 'border-emerald-500/40 text-emerald-300 hover:bg-emerald-950/40'
                                      }`}
                                    >
                                      {u.status === 'active' ? 'Bloklash' : 'Faollashtirish'}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteUser(u)}
                                      aria-label={`${u.name} hisobini o‘chirish`}
                                      className="p-1.5 rounded-md border border-red-500/30 text-red-400 hover:bg-red-950/50 transition-colors cursor-pointer"
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </button>
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )}

        {/* SECTION B: LEGAL PDF KNOWLEDGE BASE */}
        {activeTab === 'documents' && (
          <div className="space-y-5">
            {docError && (
              <div
                role="alert"
                className="rounded-lg border border-red-500/40 bg-red-950/40 px-4 py-3 text-xs sm:text-sm text-red-200"
              >
                {docError}
              </div>
            )}

            <section className="rounded-2xl border border-slate-700/60 bg-[#0E1C33] overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-700/50 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
                <div>
                  <h2 className="font-serif text-xl font-semibold text-[#F4F1EA]">
                    Indekslangan huquqiy PDF manbalar ({filteredDocuments.length})
                  </h2>
                  <p className="text-xs text-[#9FB0C7] mt-0.5">
                    Yuklangan kodeks sharhlari, Oliy sud Plenum qarorlari va qo‘llanmalar barcha foydalanuvchilar savollarida avtomatik qo‘llaniladi.
                  </p>
                </div>

                <div className="flex flex-col sm:flex-row gap-2.5">
                  <div className="relative sm:w-60">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={docSearch}
                      onChange={(e) => setDocSearch(e.target.value)}
                      placeholder="Hujjat nomi bo‘yicha qidirish..."
                      className="w-full rounded-lg bg-[#081120] border border-slate-700/70 pl-9 pr-3 py-2 text-xs sm:text-sm text-[#F4F1EA] placeholder:text-slate-500 focus:outline-none focus:border-[#D4AF37]"
                    />
                  </div>
                  <select
                    value={docCategoryFilter}
                    onChange={(e) => setDocCategoryFilter(e.target.value)}
                    aria-label="Soha bo‘yicha filtrlash"
                    className="rounded-lg bg-[#081120] border border-slate-700/70 px-3 py-2 text-xs sm:text-sm text-[#F4F1EA] focus:outline-none focus:border-[#D4AF37]"
                  >
                    <option value="Barchasi">Barcha sohalar</option>
                    {LEGAL_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-700/50 bg-[#0A1527] text-xs font-medium text-[#889BB5]">
                      <th className="py-3 px-5">Hujjat nomi</th>
                      <th className="py-3 px-4">Soha / turi</th>
                      <th className="py-3 px-4 text-right">Hajmi</th>
                      <th className="py-3 px-4 text-right">Sahifalar</th>
                      <th className="py-3 px-4">Yuklangan sana</th>
                      <th className="py-3 px-5 text-right">O‘chirish</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/80 text-xs sm:text-sm">
                    {docsLoading ? (
                      <tr>
                        <td colSpan={6} className="py-8 px-5 text-center text-[#889BB5]">
                          Huquqiy manbalar yuklanmoqda...
                        </td>
                      </tr>
                    ) : filteredDocuments.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-12 px-5 text-center">
                          <div className="max-w-md mx-auto space-y-3">
                            <p className="text-sm text-[#CBD5E1]">
                              Hozircha biriktirilgan PDF huquqiy manbalar yo‘q.
                            </p>
                            <p className="text-xs text-[#889BB5]">
                              50 MB gacha bo‘lgan kodeks sharhlari, Plenum qarorlari yoki o‘quv qo‘llanmalarini yuklab, AI bilim bazasini boyiting.
                            </p>
                            <button
                              type="button"
                              onClick={() => setUploadModalOpen(true)}
                              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#D4AF37] hover:bg-[#E2C15A] text-[#081120] text-xs font-semibold transition-colors cursor-pointer"
                            >
                              <Plus className="w-4 h-4" />
                              <span>Birinchi PDF hujjatni yuklash</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      filteredDocuments.map((doc) => (
                        <tr
                          key={doc.id}
                          className="hover:bg-[#132542]/60 transition-colors"
                        >
                          <td className="py-3.5 px-5 max-w-md">
                            <div className="font-medium text-[#F4F1EA]">
                              {doc.title}
                            </div>
                            <div className="text-xs text-[#889BB5] mt-0.5 truncate">
                              {doc.originalFileName}
                              {doc.note ? ` · ${doc.note}` : ''}
                            </div>
                          </td>
                          <td className="py-3.5 px-4 text-xs text-[#E5C35B]">
                            {doc.category}
                          </td>
                          <td className="py-3.5 px-4 text-right font-mono text-xs text-[#CBD5E1] tabular-nums whitespace-nowrap">
                            {formatBytes(doc.sizeBytes)}
                          </td>
                          <td className="py-3.5 px-4 text-right font-mono text-xs text-[#CBD5E1] tabular-nums whitespace-nowrap">
                            {doc.pageCount > 0 ? `${doc.pageCount} bet` : 'Skaner/PDF'}
                          </td>
                          <td className="py-3.5 px-4 text-xs text-[#9FB0C7] tabular-nums whitespace-nowrap">
                            {formatDateUz(doc.createdAt)}
                          </td>
                          <td className="py-3.5 px-5 text-right">
                            <button
                              type="button"
                              onClick={() => handleDeleteDocument(doc)}
                              aria-label={`${doc.title} hujjatini o‘chirish`}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-red-500/30 text-xs text-red-400 hover:bg-red-950/50 transition-colors cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              <span>O‘chirish</span>
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )}
      </main>

      <PdfUploadModal
        token={token}
        isOpen={uploadModalOpen}
        onClose={() => setUploadModalOpen(false)}
        onUploaded={(doc) => {
          setDocuments((prev) => [doc, ...prev]);
          onDocumentsChanged();
        }}
      />
    </div>
  );
}
