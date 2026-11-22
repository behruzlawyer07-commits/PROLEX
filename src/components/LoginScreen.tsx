import { Eye, EyeOff, Lock, ShieldAlert, ShieldCheck, UserCheck } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { api, ApiError } from '../lib/api';
import type { AuthStatusResponse, UserPublic } from '../types/sherlex';
import { EmblemImage } from './EmblemImage';

const BACKDROP_SRC = '/src/assets/images/legal_library_backdrop_1795328234548.jpg';

interface LoginScreenProps {
  authStatus: AuthStatusResponse;
  onAuthenticated: (token: string, user: UserPublic) => void;
  onRefreshStatus: () => Promise<void>;
}

export function LoginScreen({
  authStatus,
  onAuthenticated,
  onRefreshStatus,
}: LoginScreenProps) {
  const [mode, setMode] = useState<'staff' | 'admin'>('staff');
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // First-run admin setup fields (only when !authStatus.adminConfigured)
  const [adminName, setAdminName] = useState('Bosh Administrator');
  const [adminLogin, setAdminLogin] = useState('admin@prolex.uz');
  const [adminPassword, setAdminPassword] = useState('');
  const [adminPasswordConfirm, setAdminPasswordConfirm] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [backdropFailed, setBackdropFailed] = useState(false);

  const showFirstRunAdminSetup = mode === 'admin' && !authStatus.adminConfigured;

  async function handleLoginSubmit(e: FormEvent) {
    e.preventDefault();
    setErrorMsg('');
    if (!login.trim() || !password) {
      setErrorMsg('Iltimos, login va parolingizni kiriting.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await api.login({ login: login.trim(), password });
      if (mode === 'admin' && res.user.role !== 'admin') {
        setErrorMsg('Ushbu hisob administrator huquqiga ega emas. "Xodim / Tinglovchi" bo‘limidan kiring.');
        setSubmitting(false);
        return;
      }
      onAuthenticated(res.token, res.user);
    } catch (err) {
      setErrorMsg(
        err instanceof ApiError ? err.message : 'Tizimga kirishda xatolik yuz berdi.'
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAdminBootstrap(e: FormEvent) {
    e.preventDefault();
    setErrorMsg('');
    if (!adminName.trim() || !adminLogin.trim() || !adminPassword) {
      setErrorMsg('Barcha maydonlarni to‘ldiring.');
      return;
    }
    if (adminPassword.length < 8) {
      setErrorMsg('Administrator paroli kamida 8 ta belgidan iborat bo‘lishi shart.');
      return;
    }
    if (adminPassword !== adminPasswordConfirm) {
      setErrorMsg('Parol va tasdiqlash paroli bir xil emas.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await api.bootstrapAdmin({
        name: adminName.trim(),
        login: adminLogin.trim(),
        password: adminPassword,
      });
      await onRefreshStatus();
      onAuthenticated(res.token, res.user);
    } catch (err) {
      setErrorMsg(
        err instanceof ApiError ? err.message : 'Administrator hisobini yaratishda xatolik yuz berdi.'
      );
      await onRefreshStatus();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="relative min-h-screen w-full bg-[#081120] text-[#F4F1EA] flex items-center justify-center px-4 py-10 overflow-hidden">
      {/* Subtle Architectural Backdrop */}
      {!backdropFailed && (
        <img
          src={BACKDROP_SRC}
          alt=""
          aria-hidden="true"
          referrerPolicy="no-referrer"
          onError={() => setBackdropFailed(true)}
          className="absolute inset-0 w-full h-full object-cover opacity-15 pointer-events-none select-none"
        />
      )}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-gradient-to-b from-[#081120]/90 via-[#081120]/85 to-[#081120]/95 pointer-events-none"
      />

      <div className="relative z-10 w-full max-w-md space-y-6">
        {/* Emblem + PROLEX only */}
        <div className="flex flex-col items-center text-center gap-4">
          <EmblemImage size="lg" />
          <h1 className="font-serif text-4xl sm:text-5xl font-bold tracking-[0.06em] text-[#F4F1EA] leading-none">
            PROLEX
          </h1>
        </div>

        {/* Strict Login Card */}
        <div className="rounded-2xl border border-[#D4AF37]/25 bg-[#0E1C33]/95 p-6 sm:p-7 shadow-2xl">
          {/* Segmented Mode Switch: Staff/Student vs Admin */}
          <div
            role="tablist"
            aria-label="Kirish turi"
            className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-[#081120] border border-slate-700/50 mb-5"
          >
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'staff'}
              onClick={() => {
                setMode('staff');
                setErrorMsg('');
              }}
              className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-md text-xs font-medium whitespace-nowrap transition-colors cursor-pointer ${
                mode === 'staff'
                  ? 'bg-[#172A4A] text-[#F5DC86] border border-[#D4AF37]/30'
                  : 'text-[#9FB0C7] hover:text-[#F4F1EA]'
              }`}
            >
              <UserCheck className="w-3.5 h-3.5 shrink-0" />
              <span>Xodim / Tinglovchi</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'admin'}
              onClick={() => {
                setMode('admin');
                setErrorMsg('');
              }}
              className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-md text-xs font-medium whitespace-nowrap transition-colors cursor-pointer ${
                mode === 'admin'
                  ? 'bg-[#172A4A] text-[#F5DC86] border border-[#D4AF37]/30'
                  : 'text-[#9FB0C7] hover:text-[#F4F1EA]'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
              <span>Administrator</span>
            </button>
          </div>

          {errorMsg && (
            <div
              role="alert"
              className="mb-4 rounded-lg border border-red-500/40 bg-red-950/40 px-4 py-3 text-xs sm:text-sm text-red-200"
            >
              {errorMsg}
            </div>
          )}

          {showFirstRunAdminSetup ? (
            <form onSubmit={handleAdminBootstrap} className="space-y-4">
              <div className="rounded-lg border border-[#D4AF37]/30 bg-[#D4AF37]/8 p-3 text-xs text-[#F5DC86] leading-relaxed">
                Birinchi marta kirish: Administrator hisobini o‘rnating.
              </div>

              <div>
                <label
                  htmlFor="bootstrap-name"
                  className="block text-xs font-medium text-[#CBD5E1] mb-1.5"
                >
                  Administrator ismi
                </label>
                <input
                  id="bootstrap-name"
                  type="text"
                  required
                  value={adminName}
                  onChange={(e) => setAdminName(e.target.value)}
                  className="w-full rounded-lg bg-[#081120] border border-slate-700/70 px-3.5 py-2.5 text-sm text-[#F4F1EA] placeholder:text-slate-500 focus:outline-none focus:border-[#D4AF37]"
                />
              </div>

              <div>
                <label
                  htmlFor="bootstrap-login"
                  className="block text-xs font-medium text-[#CBD5E1] mb-1.5"
                >
                  Administrator logini
                </label>
                <input
                  id="bootstrap-login"
                  type="text"
                  required
                  value={adminLogin}
                  onChange={(e) => setAdminLogin(e.target.value)}
                  className="w-full rounded-lg bg-[#081120] border border-slate-700/70 px-3.5 py-2.5 text-sm text-[#F4F1EA] placeholder:text-slate-500 focus:outline-none focus:border-[#D4AF37]"
                />
              </div>

              <div>
                <label
                  htmlFor="bootstrap-pass"
                  className="block text-xs font-medium text-[#CBD5E1] mb-1.5"
                >
                  Yangi parol (kamida 8 belgi)
                </label>
                <input
                  id="bootstrap-pass"
                  type="password"
                  required
                  minLength={8}
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                  placeholder="Kuchli parol kiriting"
                  className="w-full rounded-lg bg-[#081120] border border-slate-700/70 px-3.5 py-2.5 text-sm text-[#F4F1EA] placeholder:text-slate-500 focus:outline-none focus:border-[#D4AF37]"
                />
              </div>

              <div>
                <label
                  htmlFor="bootstrap-pass-confirm"
                  className="block text-xs font-medium text-[#CBD5E1] mb-1.5"
                >
                  Parolni tasdiqlang
                </label>
                <input
                  id="bootstrap-pass-confirm"
                  type="password"
                  required
                  minLength={8}
                  value={adminPasswordConfirm}
                  onChange={(e) => setAdminPasswordConfirm(e.target.value)}
                  placeholder="Parolni qayta kiriting"
                  className="w-full rounded-lg bg-[#081120] border border-slate-700/70 px-3.5 py-2.5 text-sm text-[#F4F1EA] placeholder:text-slate-500 focus:outline-none focus:border-[#D4AF37]"
                />
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full mt-2 rounded-lg bg-[#D4AF37] hover:bg-[#E2C15A] disabled:opacity-60 text-[#081120] font-semibold text-sm py-3 px-4 transition-colors cursor-pointer"
              >
                {submitting ? 'Saqlanmoqda...' : 'Saqlash va kirish'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleLoginSubmit} className="space-y-4">
              <div>
                <label
                  htmlFor="login-input"
                  className="block text-xs font-medium text-[#CBD5E1] mb-1.5"
                >
                  {mode === 'admin' ? 'Administrator logini' : 'Login'}
                </label>
                <input
                  id="login-input"
                  type="text"
                  autoComplete="username"
                  required
                  value={login}
                  onChange={(e) => setLogin(e.target.value)}
                  placeholder={mode === 'admin' ? 'admin@prolex.uz' : 'Loginni kiriting'}
                  className="w-full rounded-lg bg-[#081120] border border-slate-700/70 px-3.5 py-2.5 text-sm text-[#F4F1EA] placeholder:text-slate-500 focus:outline-none focus:border-[#D4AF37]"
                />
              </div>

              <div>
                <label
                  htmlFor="password-input"
                  className="block text-xs font-medium text-[#CBD5E1] mb-1.5"
                >
                  Parol
                </label>
                <div className="relative">
                  <input
                    id="password-input"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••••••"
                    className="w-full rounded-lg bg-[#081120] border border-slate-700/70 pl-3.5 pr-11 py-2.5 text-sm text-[#F4F1EA] placeholder:text-slate-500 focus:outline-none focus:border-[#D4AF37]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    aria-label={showPassword ? 'Parolni yashirish' : 'Parolni ko‘rsatish'}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 hover:text-[#F4F1EA] cursor-pointer"
                  >
                    {showPassword ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full mt-2 flex items-center justify-center gap-2 rounded-lg bg-[#D4AF37] hover:bg-[#E2C15A] disabled:opacity-60 text-[#081120] font-semibold text-sm py-3 px-4 transition-colors cursor-pointer"
              >
                <Lock className="w-4 h-4" />
                <span>{submitting ? 'Tekshirilmoqda...' : 'Kirish'}</span>
              </button>
            </form>
          )}

          <div className="mt-5 pt-4 border-t border-slate-700/40 flex items-center gap-2 text-xs text-[#E5C35B]/90">
            <ShieldAlert className="w-4 h-4 shrink-0" />
            <span>Maxfiy tizim — faqat HMQA va Prokuratura xodimlari uchun.</span>
          </div>
        </div>
      </div>
    </div>
  );
}
