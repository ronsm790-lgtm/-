import { useCallback, useEffect, useState } from 'react';
import {
  BookOpen,
  Calendar,
  ChevronDown,
  ClipboardCheck,
  FileText,
  GraduationCap,
  LayoutDashboard,
  LogOut,
  Megaphone,
  QrCode,
  RefreshCw,
  Settings,
  Sheet,
  Users,
  WifiOff,
} from 'lucide-react';
import { apiFetch } from '../lib/api.ts';
import {
  flushOfflineQueue,
  registerOfflineAutoSync,
  subscribeOfflineQueue,
} from '../lib/offlineSync.ts';
import { FloatingUndoButton, UndoProvider } from '../lib/undoManager.tsx';
import type {
  AcademicYear,
  AdminUser,
  Announcement,
  AuditLog,
  Exam,
  SchoolClass,
  SchoolSettings,
  Section,
  Student,
  Subject,
} from '../types/school.ts';
import { AnnouncementsTab } from './admin/AnnouncementsTab.tsx';
import { ControlTab } from './admin/ControlTab.tsx';
import { GoogleIntegrationsTab } from './admin/GoogleIntegrationsTab.tsx';
import { GradesTab } from './admin/GradesTab.tsx';
import { GroupResultsTab } from './admin/GroupResultsTab.tsx';
import { OverviewTab } from './admin/OverviewTab.tsx';
import { SettingsAndUsersTab } from './admin/SettingsAndUsersTab.tsx';
import { StructureTab } from './admin/StructureTab.tsx';
import { StudentsTab } from './admin/StudentsTab.tsx';
import { TeachersAndUsersTab } from './admin/TeachersAndUsersTab.tsx';
import { ActionMenu } from './ui/ActionMenu.tsx';

type TabKey =
  | 'overview'
  | 'students'
  | 'structure'
  | 'grades'
  | 'control'
  | 'group_results'
  | 'teachers'
  | 'google'
  | 'announcements'
  | 'settings';

interface AdminDashboardProps {
  admin: AdminUser;
  settings: SchoolSettings;
  onAdminUpdated?: (next: AdminUser) => void;
  onSettingsUpdated: (next: SchoolSettings) => void;
  onPublicDataChanged: () => void;
  onLogout: () => void;
  onViewPublic: () => void;
}

function AdminDashboardInner({
  admin,
  settings,
  onAdminUpdated,
  onSettingsUpdated,
  onPublicDataChanged,
  onLogout,
  onViewPublic,
}: AdminDashboardProps) {
  const isOwner = admin.role === 'owner';
  const isTeacher = admin.role === 'teacher';

  const [activeTab, setActiveTab] = useState<TabKey>(() => (isTeacher ? 'grades' : 'overview'));

  const [academicYears, setAcademicYears] = useState<AcademicYear[]>([]);
  const [selectedYearId, setSelectedYearId] = useState<number | null>(null);
  const [stats, setStats] = useState<any>(null);
  const [alerts, setAlerts] = useState<Array<{ level: 'warning' | 'info'; message: string }>>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [exams, setExams] = useState<Exam[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);

  // Offline queue banner state
  const [offlineQueueCount, setOfflineQueueCount] = useState(0);
  const [syncingQueue, setSyncingQueue] = useState(false);

  const loadAll = useCallback(
    async (overrideYearId?: number | null) => {
      try {
        const yrsRes = await apiFetch<{
          academicYears: AcademicYear[];
          currentYear: AcademicYear;
        }>('/api/admin/academic-years');
        setAcademicYears(yrsRes.academicYears);
        const effectiveYearId =
          overrideYearId !== undefined
            ? overrideYearId
            : selectedYearId ?? yrsRes.currentYear?.id ?? yrsRes.academicYears[0]?.id ?? null;
        if (effectiveYearId && effectiveYearId !== selectedYearId) {
          setSelectedYearId(effectiveYearId);
        }

        const yearQs = effectiveYearId ? `?yearId=${effectiveYearId}` : '';
        const [ov, st, str, ann] = await Promise.all([
          apiFetch<{ stats: any; alerts: any[]; auditLogs: AuditLog[] }>(
            `/api/admin/overview${yearQs}`
          ),
          apiFetch<{ students: Student[] }>(`/api/admin/students${yearQs}`),
          apiFetch<{
            classes: SchoolClass[];
            sections: Section[];
            subjects: Subject[];
            exams: Exam[];
          }>(`/api/admin/structure${yearQs}`),
          apiFetch<{ announcements: Announcement[] }>('/api/admin/announcements'),
        ]);
        setStats(ov.stats);
        setAlerts(ov.alerts);
        setAuditLogs(ov.auditLogs);
        setStudents(st.students);
        setClasses(str.classes);
        setSections(str.sections);
        setSubjects(str.subjects);
        setExams(str.exams);
        setAnnouncements(ann.announcements);
      } catch {
        // handled per route
      }
    },
    [selectedYearId]
  );

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    const unsubQueue = subscribeOfflineQueue((count) => {
      setOfflineQueueCount(count);
    });
    registerOfflineAutoSync((synced) => {
      if (synced > 0) {
        loadAll();
        onPublicDataChanged();
      }
    });
    return () => {
      unsubQueue();
    };
  }, [loadAll, onPublicDataChanged]);

  const handleManualQueueSync = async () => {
    setSyncingQueue(true);
    try {
      const res = await flushOfflineQueue();
      if (res.synced > 0) {
        await loadAll();
        onPublicDataChanged();
      }
    } finally {
      setSyncingQueue(false);
    }
  };

  const handleDataChanged = async () => {
    await loadAll();
    onPublicDataChanged();
  };

  const selectedYearObj =
    academicYears.find((y) => y.id === selectedYearId) ??
    academicYears.find((y) => y.isCurrent) ??
    academicYears[0] ??
    null;

  const navItems: Array<{ key: TabKey; label: string; icon: typeof LayoutDashboard }> = isTeacher
    ? [
        { key: 'grades', label: 'رفع الدرجات (يدوي وجماعي)', icon: ClipboardCheck },
        { key: 'overview', label: 'نظرة عامة لموادي', icon: LayoutDashboard },
        { key: 'settings', label: 'تغيير كلمة المرور', icon: Settings },
      ]
    : [
        { key: 'overview', label: 'نظرة عامة', icon: LayoutDashboard },
        { key: 'students', label: 'إدارة الطلاب (واستيراد/تصدير)', icon: Users },
        { key: 'grades', label: 'الدرجات والإعفاء والاستيراد', icon: ClipboardCheck },
        { key: 'control', label: 'قسم الكونترول (QR)', icon: QrCode },
        { key: 'group_results', label: 'قوائم النتائج (Word / PDF)', icon: FileText },
        { key: 'structure', label: 'الصفوف والمواد والامتحانات', icon: BookOpen },
        ...(isOwner
          ? [{ key: 'teachers' as const, label: 'المدرسون والمشرفون', icon: GraduationCap }]
          : []),
        { key: 'announcements', label: 'الإعلانات والروابط والاعتراضات', icon: Megaphone },
        { key: 'google', label: 'Google Sheets والنسخ السحابي', icon: Sheet },
        { key: 'settings', label: 'الإعدادات والنسخ الاحتياطي', icon: Settings },
      ];

  const activeLabel = navItems.find((n) => n.key === activeTab)?.label ?? 'لوحة التحكم';
  const roleLabel = isOwner ? 'المالك الأساسي (مدير المدرسة)' : isTeacher ? 'مدرس مادة' : 'مشرف إداري';

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-[#F8FAFC] flex flex-col lg:flex-row print:block print:bg-white print:min-h-0">
      {/* Desktop Sidebar */}
      <aside className="no-print w-full lg:w-[275px] bg-[#0B1F3A] text-slate-200 shrink-0 flex flex-col justify-between border-b lg:border-b-0 lg:border-l border-slate-800">
        <div className="p-4 space-y-5">
          <div className="pb-4 border-b border-white/10 space-y-1">
            <p className="text-xs font-bold text-[#C59B27]">{roleLabel}</p>
            <p className="font-display text-sm font-bold text-white truncate">{admin.fullName}</p>
            <p dir="ltr" className="font-mono text-xs text-slate-400 truncate text-right">
              {admin.username}
            </p>
          </div>

          <nav
            aria-label="أقسام لوحة التحكم"
            className="flex lg:flex-col gap-1 overflow-x-auto lg:overflow-visible pb-2 lg:pb-0"
          >
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setActiveTab(item.key)}
                  className={`min-h-[44px] flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg text-xs sm:text-sm font-semibold whitespace-nowrap shrink-0 transition-colors cursor-pointer text-right ${
                    isActive
                      ? 'bg-[#1E4E8C] text-white'
                      : 'text-slate-300 hover:bg-white/5 hover:text-white'
                  }`}
                >
                  <Icon
                    className={`w-4 h-4 shrink-0 ${isActive ? 'text-[#C59B27]' : 'text-slate-400'}`}
                  />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        <div className="hidden lg:block p-4 border-t border-white/10 space-y-2">
          <button
            type="button"
            onClick={onViewPublic}
            className="min-h-[44px] w-full px-3.5 py-2 text-xs font-bold text-slate-200 bg-white/5 hover:bg-white/10 rounded-lg text-center cursor-pointer"
          >
            معاينة البوابة العامة
          </button>
          <button
            type="button"
            onClick={onLogout}
            className="min-h-[44px] w-full flex items-center justify-center gap-2 px-3.5 py-2 text-xs font-bold text-red-200 bg-red-950/40 hover:bg-red-900/50 rounded-lg cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            <span>تسجيل الخروج الآمن</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Contextual Header */}
        <div className="no-print bg-white border-b border-slate-200 px-5 sm:px-8 py-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs text-slate-500">
              {settings.schoolName} / {isTeacher ? 'بوابة المدرس' : 'لوحة الإدارة'}
              {selectedYearObj ? ` · العام الدراسي ${selectedYearObj.name}` : ''}
            </p>
            <h1 className="font-display text-xl font-extrabold text-[#0B1F3A]">{activeLabel}</h1>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {academicYears.length > 0 && (
              <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5">
                <Calendar className="w-4 h-4 text-[#C59B27] shrink-0" />
                <label
                  htmlFor="admin-year-switch"
                  className="text-xs font-bold text-slate-600 whitespace-nowrap"
                >
                  العام الدراسي النشط:
                </label>
                <div className="relative">
                  <select
                    id="admin-year-switch"
                    aria-label="العام الدراسي النشط"
                    value={selectedYearId ? String(selectedYearId) : ''}
                    onChange={(e) => {
                      const nextId = Number(e.target.value);
                      if (nextId) {
                        setSelectedYearId(nextId);
                      }
                    }}
                    className="appearance-none pr-2 pl-6 py-1 text-xs font-extrabold text-[#0B1F3A] bg-white border border-slate-300 rounded-md cursor-pointer"
                  >
                    {academicYears.map((y) => (
                      <option key={y.id} value={y.id}>
                        {y.name} {y.isCurrent ? '(الحالي)' : ''}
                      </option>
                    ))}
                  </select>
                  <ChevronDown
                    aria-hidden="true"
                    className="w-3.5 h-3.5 text-slate-500 pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2"
                  />
                </div>
              </div>
            )}

            <div className="flex items-center gap-2 lg:hidden">
              <ActionMenu
                label="القائمة"
                icon={LayoutDashboard}
                variant="navy"
                size="sm"
                items={[
                  ...navItems.map((item) => ({
                    id: `nav-${item.key}`,
                    label: item.label,
                    icon: item.icon,
                    tone: activeTab === item.key ? ('primary' as const) : ('default' as const),
                    onClick: () => setActiveTab(item.key),
                  })),
                  {
                    id: 'view-public',
                    label: 'معاينة البوابة العامة',
                    dividerBefore: true,
                    onClick: onViewPublic,
                  },
                  {
                    id: 'logout',
                    label: 'تسجيل الخروج الآمن',
                    icon: LogOut,
                    tone: 'danger',
                    onClick: onLogout,
                  },
                ]}
              />
            </div>
          </div>
        </div>

        {/* Offline Sync Queue Banner */}
        {offlineQueueCount > 0 && (
          <div className="no-print mx-4 sm:mx-6 lg:mx-8 mt-4 p-3.5 rounded-xl bg-amber-50 border border-amber-300 flex flex-wrap items-center justify-between gap-3 text-xs sm:text-sm text-amber-950">
            <div className="flex items-center gap-2">
              <WifiOff className="w-4 h-4 text-amber-800 shrink-0" />
              <span>
                يوجد <strong className="tabular-nums">{offlineQueueCount}</strong> عملية محفوظة محلياً
                دون إنترنت وبانتظار المزامنة مع الخادم.
              </span>
            </div>
            <button
              type="button"
              disabled={syncingQueue}
              onClick={handleManualQueueSync}
              className="min-h-[40px] inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-[#0B1F3A] hover:bg-[#1E4E8C] text-white text-xs font-bold rounded-lg cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncingQueue ? 'animate-spin' : ''}`} />
              <span>{syncingQueue ? 'جاري المزامنة...' : 'مزامنة الآن'}</span>
            </button>
          </div>
        )}

        <div className="p-4 sm:p-6 lg:p-8 flex-1 print:p-0">
          {activeTab === 'overview' && (
            <OverviewTab
              admin={admin}
              stats={stats}
              alerts={alerts}
              auditLogs={auditLogs}
              onRefresh={loadAll}
              onNavigate={(tab) => setActiveTab(tab as TabKey)}
            />
          )}
          {activeTab === 'students' && !isTeacher && (
            <StudentsTab
              students={students}
              classes={classes}
              sections={sections}
              exams={exams}
              selectedYearId={selectedYearId}
              canManage={isOwner || admin.permissions.manageStudents}
              onChanged={handleDataChanged}
            />
          )}
          {activeTab === 'structure' && !isTeacher && (
            <StructureTab
              classes={classes}
              sections={sections}
              subjects={subjects}
              exams={exams}
              academicYears={academicYears}
              selectedYearId={selectedYearId}
              onSelectYear={(nextId) => {
                setSelectedYearId(nextId);
              }}
              canManage={isOwner || admin.permissions.manageStructure}
              onChanged={handleDataChanged}
            />
          )}
          {activeTab === 'grades' && (
            <GradesTab
              admin={admin}
              classes={classes}
              sections={sections}
              subjects={subjects}
              exams={exams}
              selectedYearId={selectedYearId}
              selectedYear={selectedYearObj}
              canEdit={isOwner || isTeacher || admin.permissions.manageGrades}
              canPublish={isOwner || admin.permissions.publishGrades}
              onChanged={handleDataChanged}
            />
          )}
          {activeTab === 'control' && !isTeacher && (
            <ControlTab
              classes={classes}
              sections={sections}
              subjects={subjects}
              exams={exams}
              selectedYearId={selectedYearId}
              onChanged={handleDataChanged}
            />
          )}
          {activeTab === 'group_results' && !isTeacher && (
            <GroupResultsTab
              classes={classes}
              sections={sections}
              subjects={subjects}
              exams={exams}
              selectedYearId={selectedYearId}
            />
          )}
          {activeTab === 'teachers' && isOwner && (
            <TeachersAndUsersTab
              currentAdmin={admin}
              classes={classes}
              sections={sections}
              subjects={subjects}
              selectedYearId={selectedYearId}
            />
          )}
          {activeTab === 'google' && !isTeacher && (
            <GoogleIntegrationsTab students={students} classes={classes} exams={exams} />
          )}
          {activeTab === 'announcements' && !isTeacher && (
            <AnnouncementsTab
              announcements={announcements}
              classes={classes}
              sections={sections}
              subjects={subjects}
              exams={exams}
              selectedYearId={selectedYearId}
              canManage={isOwner || admin.permissions.manageAnnouncements}
              canPublish={isOwner || admin.permissions.publishGrades}
              onChanged={handleDataChanged}
            />
          )}
          {activeTab === 'settings' && (
            <SettingsAndUsersTab
              currentAdmin={admin}
              settings={settings}
              onAdminUpdated={onAdminUpdated}
              onSettingsUpdated={(next) => {
                onSettingsUpdated(next);
                onPublicDataChanged();
              }}
            />
          )}
        </div>
      </div>

      <FloatingUndoButton />
    </div>
  );
}

export function AdminDashboard(props: AdminDashboardProps) {
  return (
    <UndoProvider>
      <AdminDashboardInner {...props} />
    </UndoProvider>
  );
}
