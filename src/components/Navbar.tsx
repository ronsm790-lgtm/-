import { useState } from 'react';
import { Menu, ShieldCheck, X } from 'lucide-react';
import type { AdminUser, SchoolSettings } from '../types/school.ts';

interface NavbarProps {
  settings: SchoolSettings;
  admin: AdminUser | null;
  currentView: 'public' | 'login' | 'admin';
  onNavigate: (view: 'public' | 'login' | 'admin', sectionId?: string) => void;
}

export function Navbar({ settings, admin, currentView, onNavigate }: NavbarProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleLink = (view: 'public' | 'login' | 'admin', sectionId?: string) => {
    setMobileOpen(false);
    onNavigate(view, sectionId);
  };

  return (
    <header className="no-print sticky top-0 z-40 bg-white/95 backdrop-blur-sm border-b border-slate-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-8">
        {/* Zone 1: Brand Title + Official School Crest */}
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            handleLink('public', 'top');
          }}
          className="flex items-center gap-3 shrink-0 group focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1E4E8C] rounded-md"
        >
          <div className="w-10 h-10 rounded-full overflow-hidden shrink-0 flex items-center justify-center">
            <img
              src={settings.emblemUrl}
              alt={`شعار ${settings.schoolName}`}
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover scale-[1.06]"
            />
          </div>
          <span className="font-display font-bold text-base sm:text-lg text-[#0B1F3A] whitespace-nowrap shrink-0 group-hover:text-[#1E4E8C] transition-colors">
            {settings.schoolName}
          </span>
        </a>

        {/* Zone 2: Concise single-line navigation links */}
        <nav
          aria-label="التنقل الرئيسي"
          className="hidden md:flex items-center gap-7 text-sm font-semibold text-slate-700"
        >
          <a
            href="#top"
            onClick={(e) => {
              e.preventDefault();
              handleLink('public', 'top');
            }}
            className={`whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors ${
              currentView === 'public'
                ? 'border-[#C59B27] text-[#0B1F3A]'
                : 'border-transparent hover:text-[#0B1F3A] hover:border-slate-300'
            }`}
          >
            واجهة الطالب
          </a>
          <a
            href="#results-portal"
            onClick={(e) => {
              e.preventDefault();
              handleLink('public', 'results-portal');
            }}
            className="whitespace-nowrap shrink-0 py-1 border-b-2 border-transparent hover:text-[#0B1F3A] hover:border-[#C59B27] transition-colors"
          >
            بوابة النتائج
          </a>
        </nav>

        {/* Zone 3: Primary CTA + Mobile menu toggle */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => handleLink(admin ? 'admin' : 'login')}
            className="hidden sm:inline-flex items-center gap-2 px-4 py-2 text-xs sm:text-sm font-bold text-white bg-[#0B1F3A] hover:bg-[#1E4E8C] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C59B27]"
          >
            <ShieldCheck className="w-4 h-4 text-[#C59B27]" />
            <span>{admin ? 'لوحة الإدارة' : 'دخول الإدارة'}</span>
          </button>

          <button
            type="button"
            onClick={() => setMobileOpen((prev) => !prev)}
            aria-label={mobileOpen ? 'إغلاق القائمة' : 'فتح القائمة'}
            aria-expanded={mobileOpen}
            className="md:hidden inline-flex items-center justify-center w-10 h-10 rounded-lg border border-slate-200 text-[#0B1F3A] hover:bg-slate-50 cursor-pointer"
          >
            {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Responsive Mobile Navigation Drawer */}
      {mobileOpen && (
        <div className="md:hidden border-t border-slate-200 bg-white px-4 py-4 space-y-2">
          <a
            href="#top"
            onClick={(e) => {
              e.preventDefault();
              handleLink('public', 'top');
            }}
            className="block px-3 py-2.5 rounded-lg text-sm font-semibold text-[#0B1F3A] hover:bg-slate-50"
          >
            واجهة الطالب
          </a>
          <a
            href="#results-portal"
            onClick={(e) => {
              e.preventDefault();
              handleLink('public', 'results-portal');
            }}
            className="block px-3 py-2.5 rounded-lg text-sm font-semibold text-[#0B1F3A] hover:bg-slate-50"
          >
            بوابة النتائج
          </a>
          <button
            type="button"
            onClick={() => handleLink(admin ? 'admin' : 'login')}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-[#0B1F3A] text-white text-sm font-bold rounded-lg hover:bg-[#1E4E8C] cursor-pointer"
          >
            <ShieldCheck className="w-4 h-4 text-[#C59B27]" />
            <span>{admin ? 'لوحة الإدارة' : 'دخول الإدارة'}</span>
          </button>
        </div>
      )}
    </header>
  );
}
