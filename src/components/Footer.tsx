import { ShieldCheck } from 'lucide-react';
import type { AdminUser, SchoolSettings } from '../types/school.ts';

interface FooterProps {
  settings: SchoolSettings;
  admin: AdminUser | null;
  onNavigate: (view: 'public' | 'login' | 'admin', sectionId?: string) => void;
}

export function Footer({ settings, admin, onNavigate }: FooterProps) {
  return (
    <footer className="no-print bg-[#0B1F3A] text-slate-200 border-t-4 border-[#C59B27]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-10 pb-8 border-b border-white/10">
          {/* Institutional Identity */}
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full overflow-hidden shrink-0">
                <img
                  src={settings.emblemUrl}
                  alt={`شعار ${settings.schoolName}`}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover scale-[1.06]"
                />
              </div>
              <div>
                <p className="text-xs text-[#C59B27] font-semibold">
                  {settings.republicHeader} · {settings.ministryHeader}
                </p>
                <h3 className="font-display text-lg font-bold text-white">
                  {settings.schoolName}
                </h3>
              </div>
            </div>
            <p className="text-sm text-slate-300 leading-relaxed">
              {settings.directorate}
            </p>
            {settings.contactInfo && (
              <p className="text-xs text-slate-400">{settings.contactInfo}</p>
            )}
          </div>

          {/* Portal Links */}
          <div className="space-y-3 md:justify-self-end">
            <h4 className="font-display text-sm font-bold text-[#C59B27]">
              روابط البوابة المدرسية
            </h4>
            <ul className="space-y-2.5 text-sm">
              <li>
                <a
                  href="#results-portal"
                  onClick={(e) => {
                    e.preventDefault();
                    onNavigate('public', 'results-portal');
                  }}
                  className="text-slate-300 hover:text-white transition-colors"
                >
                  بوابة النتائج المدرسية (واجهة الطالب)
                </a>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onNavigate(admin ? 'admin' : 'login')}
                  className="inline-flex items-center gap-1.5 text-slate-300 hover:text-white transition-colors cursor-pointer"
                >
                  <ShieldCheck className="w-4 h-4 text-[#C59B27]" />
                  <span>{admin ? 'الانتقال إلى لوحة التحكم' : 'تسجيل دخول الإدارة والمشرفين'}</span>
                </button>
              </li>
            </ul>
          </div>
        </div>

        <div className="pt-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-400">
          <p>
            © {new Date().getFullYear()} {settings.schoolName} — العام الدراسي{' '}
            <span dir="ltr" className="inline-block whitespace-nowrap tabular-nums">
              {settings.academicYear}
            </span>
          </p>
          <p>{settings.printNote}</p>
        </div>
      </div>
    </footer>
  );
}
