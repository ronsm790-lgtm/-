import { useCallback, useEffect, useState } from 'react';
import { AdminDashboard } from './components/AdminDashboard.tsx';
import { AdminLogin } from './components/AdminLogin.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { Footer } from './components/Footer.tsx';
import { Navbar } from './components/Navbar.tsx';
import { PublicPortal } from './components/PublicPortal.tsx';
import { apiFetch, setAdminSessionToken } from './lib/api.ts';
import { testFirestoreConnection } from './lib/firebase.ts';
import type {
  AcademicYear,
  AdminUser,
  Announcement,
  Exam,
  SchoolSettings,
} from './types/school.ts';

const DEFAULT_SETTINGS: SchoolSettings = {
  schoolName: 'إعدادية المنتظر للبنين',
  republicHeader: 'جمهورية العراق',
  ministryHeader: 'وزارة التربية',
  directorate: 'المديرية العامة لتربية واسط',
  academicYear: '2025 - 2026',
  contactInfo: '',
  footerText: '',
  printNote: 'معتمد للطباعة الرسمية على ورق A4',
  emblemUrl: '/assets/aistudio/school_logo_original_f35f0f97.jpg',
  ministrySealUrl: '/src/assets/images/ministry_seal_emblem_1795173275872.jpg',
  primaryColor: '#0B1F3A',
  accentColor: '#C59B27',
};

export default function App() {
  const [view, setView] = useState<'public' | 'login' | 'admin'>(() =>
    window.location.pathname.startsWith('/admin') ? 'login' : 'public'
  );
  const [settings, setSettings] = useState<SchoolSettings>(DEFAULT_SETTINGS);
  const [academicYears, setAcademicYears] = useState<AcademicYear[]>([]);
  const [selectedYearId, setSelectedYearId] = useState<number | null>(null);
  const [exams, setExams] = useState<Exam[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [admin, setAdmin] = useState<AdminUser | null>(null);
  const [bootLoading, setBootLoading] = useState(true);

  const loadPublicBootstrap = useCallback(async (yearId?: number | null) => {
    try {
      const qs = yearId ? `?yearId=${yearId}` : '';
      const data = await apiFetch<{
        settings: SchoolSettings;
        academicYears?: AcademicYear[];
        currentYear?: AcademicYear;
        selectedYear?: AcademicYear;
        exams: Exam[];
        announcements: Announcement[];
      }>(`/api/public/bootstrap${qs}`);
      setSettings(data.settings);
      setExams(data.exams);
      setAnnouncements(data.announcements);
      if (data.academicYears) setAcademicYears(data.academicYears);
      if (data.selectedYear) setSelectedYearId(data.selectedYear.id);
    } catch {
      // keep fallback settings while retrying
    }
  }, []);

  useEffect(() => {
    testFirestoreConnection();

    (async () => {
      await loadPublicBootstrap();
      try {
        const me = await apiFetch<{ authenticated: boolean; admin: AdminUser }>(
          '/api/admin/me'
        );
        if (me.authenticated && me.admin) {
          setAdmin(me.admin);
          if (window.location.pathname.startsWith('/admin')) {
            setView('admin');
          }
        }
      } catch {
        setAdmin(null);
      } finally {
        setBootLoading(false);
      }
    })();
  }, [loadPublicBootstrap]);

  const handleSelectPublicYear = useCallback(
    async (yearId: number) => {
      setSelectedYearId(yearId);
      await loadPublicBootstrap(yearId);
    },
    [loadPublicBootstrap]
  );

  const handleNavigate = (nextView: 'public' | 'login' | 'admin', sectionId?: string) => {
    if (nextView === 'admin' && !admin) {
      setView('login');
    } else {
      setView(nextView);
    }
    if (nextView === 'public') {
      window.history.replaceState(null, '', '/');
      if (sectionId) {
        setTimeout(() => {
          document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth' });
        }, 60);
      }
    } else if (nextView === 'login' || nextView === 'admin') {
      window.history.replaceState(null, '', '/admin');
    }
  };

  const handleLogout = async () => {
    try {
      await apiFetch('/api/admin/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    setAdminSessionToken(null);
    setAdmin(null);
    setView('public');
    window.history.replaceState(null, '', '/');
  };

  return (
    <ErrorBoundary>
      <div
        dir="rtl"
        className="min-h-screen flex flex-col bg-[#F8FAFC] text-[#0F172A]"
      >
        <Navbar
          settings={settings}
          admin={admin}
          currentView={view}
          onNavigate={handleNavigate}
        />

        {bootLoading ? (
          <div className="flex-1 flex items-center justify-center p-12 text-sm text-slate-600">
            جاري تهيئة البوابة المدرسية...
          </div>
        ) : view === 'login' && !admin ? (
          <AdminLogin
            settings={settings}
            onSuccess={(loggedAdmin) => {
              setAdmin(loggedAdmin);
              setView('admin');
            }}
            onBack={() => handleNavigate('public')}
          />
        ) : view === 'admin' && admin ? (
          <AdminDashboard
            admin={admin}
            settings={settings}
            onAdminUpdated={setAdmin}
            onSettingsUpdated={setSettings}
            onPublicDataChanged={() => loadPublicBootstrap(selectedYearId)}
            onLogout={handleLogout}
            onViewPublic={() => handleNavigate('public')}
          />
        ) : (
          <PublicPortal
            settings={settings}
            exams={exams}
            academicYears={academicYears}
            selectedYearId={selectedYearId}
            onSelectYear={handleSelectPublicYear}
            announcements={announcements}
            onGoLogin={() => handleNavigate(admin ? 'admin' : 'login')}
          />
        )}

        {view !== 'admin' && (
          <Footer
            settings={settings}
            admin={admin}
            onNavigate={handleNavigate}
          />
        )}
      </div>
    </ErrorBoundary>
  );
}
