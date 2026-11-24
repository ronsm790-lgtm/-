import { useState, type FormEvent } from 'react';
import {
  ArrowRight,
  Eye,
  EyeOff,
  Lock,
  ShieldCheck,
  User,
} from 'lucide-react';
import { apiFetch, setAdminSessionToken } from '../lib/api.ts';
import type { AdminUser, SchoolSettings } from '../types/school.ts';

interface AdminLoginProps {
  settings: SchoolSettings;
  onSuccess: (admin: AdminUser) => void;
  onBack: () => void;
}

export function AdminLogin({ settings, onSuccess, onBack }: AdminLoginProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const data = await apiFetch<{ admin: AdminUser; sessionToken?: string }>(
        '/api/admin/login',
        {
          method: 'POST',
          body: JSON.stringify({
            username: username.trim(),
            password,
          }),
        }
      );
      if (data.sessionToken) {
        setAdminSessionToken(data.sessionToken);
      }
      onSuccess(data.admin);
    } catch (err: any) {
      setError(err?.message || 'تعذر تسجيل الدخول.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-[#0B1F3A] flex items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-md bg-white rounded-2xl border border-slate-200 shadow-xl p-6 sm:p-8 space-y-6">
        <div className="flex flex-col items-center text-center space-y-3 pb-4 border-b border-slate-100">
          <div className="w-16 h-16 rounded-full overflow-hidden shrink-0 border-2 border-[#C59B27]/40 shadow-xs">
            <img
              src={settings.emblemUrl}
              alt={`شعار ${settings.schoolName}`}
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover scale-[1.06]"
            />
          </div>
          <div className="space-y-1">
            <h1 className="font-display text-xl font-extrabold text-[#0B1F3A]">
              تسجيل دخول الإدارة والمدرسين
            </h1>
            <p className="text-xs text-slate-500">
              {settings.schoolName} — لوحة الإدارة والتحكم المدرسي
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="admin-username" className="block text-sm font-bold text-[#0B1F3A]">
              اسم المستخدم
            </label>
            <div className="relative">
              <input
                id="admin-username"
                type="text"
                autoComplete="username"
                dir="ltr"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="أدخل اسم المستخدم"
                className="w-full min-h-[44px] px-4 py-2.5 pr-10 text-sm rounded-lg border border-slate-300 focus:border-[#1E4E8C] focus:outline-2 focus:outline-[#1E4E8C]/20 bg-white"
                required
              />
              <span className="absolute inset-y-0 right-0 px-3 flex items-center pointer-events-none text-slate-400">
                <User className="w-4 h-4" />
              </span>
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="admin-password" className="block text-sm font-bold text-[#0B1F3A]">
              كلمة المرور
            </label>
            <div className="relative">
              <input
                id="admin-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                dir="ltr"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full min-h-[44px] px-4 py-2.5 pl-11 pr-10 text-sm rounded-lg border border-slate-300 focus:border-[#1E4E8C] focus:outline-2 focus:outline-[#1E4E8C]/20 bg-white"
                required
              />
              <span className="absolute inset-y-0 right-0 px-3 flex items-center pointer-events-none text-slate-400">
                <Lock className="w-4 h-4" />
              </span>
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                className="absolute inset-y-0 left-0 px-3 flex items-center text-slate-500 hover:text-[#0B1F3A] cursor-pointer"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {error && (
            <div
              role="alert"
              className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-xs sm:text-sm font-medium"
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full min-h-[44px] flex items-center justify-center gap-2 py-3 bg-[#0B1F3A] hover:bg-[#1E4E8C] text-white font-bold text-sm rounded-lg transition-colors cursor-pointer disabled:opacity-50 shadow-xs"
          >
            <Lock className="w-4 h-4 text-[#C59B27]" />
            <span>{loading ? 'جاري التحقق...' : 'دخول إلى لوحة التحكم'}</span>
          </button>
        </form>

        <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 min-h-[44px] font-semibold text-[#1E4E8C] hover:text-[#0B1F3A] cursor-pointer"
          >
            <ArrowRight className="w-3.5 h-3.5" />
            <span>العودة لبوابة النتائج</span>
          </button>
          <span className="inline-flex items-center gap-1 text-slate-400">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
            نظام محمي
          </span>
        </div>
      </div>
    </main>
  );
}
