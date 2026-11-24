import {
  AlertTriangle,
  ClipboardCheck,
  FileText,
  GraduationCap,
  Info,
  QrCode,
  RefreshCw,
  Users,
} from 'lucide-react';
import type { AdminUser, AuditLog } from '../../types/school.ts';

interface OverviewStats {
  totalStudents: number;
  totalClasses: number;
  totalSections: number;
  totalSubjects: number;
  totalExams: number;
  publishedGrades: number;
  unpublishedGrades: number;
}

interface OverviewTabProps {
  admin: AdminUser;
  stats: OverviewStats | null;
  alerts: Array<{ level: 'warning' | 'info'; message: string }>;
  auditLogs: AuditLog[];
  onRefresh: () => void;
  onNavigate?: (tab: string) => void;
}

export function OverviewTab({
  admin,
  stats,
  alerts,
  auditLogs,
  onRefresh,
  onNavigate,
}: OverviewTabProps) {
  if (!stats) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-500">
        جاري تحميل إحصائيات النظام...
      </div>
    );
  }

  const isTeacher = admin.role === 'teacher';
  const isOwner = admin.role === 'owner';

  if (isTeacher) {
    const assignments = admin.assignments ?? [];
    return (
      <div className="space-y-6">
        <div className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-[#0B1F3A] text-[#C59B27] flex items-center justify-center shrink-0">
                <GraduationCap className="w-6 h-6" />
              </div>
              <div>
                <h2 className="font-display text-lg font-extrabold text-[#0B1F3A]">
                  أهلاً بك، {admin.fullName}
                </h2>
                <p className="text-xs text-slate-500">
                  بوابة المدرس المخصصة لرفع درجات الطلبة في المواد والصفوف الموكلة إليك
                </p>
              </div>
            </div>
            {onNavigate && (
              <button
                type="button"
                onClick={() => onNavigate('grades')}
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#0B1F3A] hover:bg-[#1E4E8C] text-white text-xs font-bold rounded-lg cursor-pointer"
              >
                <ClipboardCheck className="w-4 h-4 text-[#C59B27]" />
                <span>الانتقال لرفع الدرجات</span>
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
              <span className="text-xs font-semibold text-slate-500 block">الطلبة ضمن صفوفك</span>
              <span className="font-display text-2xl font-extrabold text-[#0B1F3A] tabular-nums mt-1 block">
                {stats.totalStudents}
              </span>
            </div>
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
              <span className="text-xs font-semibold text-slate-500 block">المواد الموكلة</span>
              <span className="font-display text-2xl font-extrabold text-[#0B1F3A] tabular-nums mt-1 block">
                {stats.totalSubjects}
              </span>
            </div>
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
              <span className="text-xs font-semibold text-slate-500 block">الصفوف الموكلة</span>
              <span className="font-display text-2xl font-extrabold text-[#0B1F3A] tabular-nums mt-1 block">
                {stats.totalClasses}
              </span>
            </div>
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
              <span className="text-xs font-semibold text-slate-500 block">الامتحانات الفعالة</span>
              <span className="font-display text-2xl font-extrabold text-[#0B1F3A] tabular-nums mt-1 block">
                {stats.totalExams}
              </span>
            </div>
          </div>

          <div className="space-y-2 pt-2">
            <h3 className="text-xs font-bold text-slate-600">التكليفات الدراسية النشطة لحسابك:</h3>
            {assignments.length === 0 ? (
              <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">
                لا توجد مواد أو صفوف مسندة لحسابك حالياً.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {assignments.map((a, idx) => (
                  <div
                    key={idx}
                    className="px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-xs font-bold text-[#0B1F3A]"
                  >
                    {a.subjectName} · {a.className} (
                    {a.sectionId === null ? 'كل الشعب' : `شعبة ${a.sectionName}`})
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  const statItems = [
    { label: 'إجمالي الطلاب', value: stats.totalStudents },
    { label: 'الصفوف الدراسية', value: stats.totalClasses },
    { label: 'الشعب الفعالة', value: stats.totalSections },
    { label: 'المواد الدراسية', value: stats.totalSubjects },
    { label: 'الامتحانات المعتمدة', value: stats.totalExams },
    { label: 'الدرجات المنشورة', value: stats.publishedGrades },
    { label: 'الدرجات غير المنشورة', value: stats.unpublishedGrades },
  ];

  const quickActions = [
    {
      key: 'grades',
      title: 'رفع واعتماد الدرجات',
      desc: 'إدخال يدوي مرن أو رفع Excel مع النشر',
      icon: ClipboardCheck,
    },
    {
      key: 'group_results',
      title: 'قوائم النتائج الجماعية',
      desc: 'تصدير كشوف الصفوف بصيغة Word و PDF',
      icon: FileText,
    },
    {
      key: 'control',
      title: 'قسم الكونترول والباركود',
      desc: 'بطاقات QR (4×6) والماسح الضوئي للدرجات',
      icon: QrCode,
    },
    {
      key: 'students',
      title: 'إدارة شؤون الطلبة',
      desc: 'إضافة وتعديل وحذف ومعاينة السجلات',
      icon: Users,
    },
    ...(isOwner
      ? [
          {
            key: 'teachers',
            title: 'المدرسون والمشرفون',
            desc: 'تعيين المدرسين، توزيع المواد، التفعيل والتعطيل',
            icon: GraduationCap,
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-6">
      {/* KPI Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-4">
        {statItems.map((item) => (
          <div
            key={item.label}
            className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col justify-between gap-2"
          >
            <span className="text-xs font-semibold text-slate-500">{item.label}</span>
            <span className="font-display text-2xl font-extrabold text-[#0B1F3A] tabular-nums">
              {item.value}
            </span>
          </div>
        ))}
      </div>

      {/* Quick Actions */}
      {onNavigate && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {quickActions.map((act) => {
            const Icon = act.icon;
            return (
              <button
                key={act.key}
                type="button"
                onClick={() => onNavigate(act.key)}
                className="bg-white hover:bg-slate-50 border border-slate-200 hover:border-[#1E4E8C] rounded-xl p-4 text-right transition-colors cursor-pointer flex flex-col gap-2"
              >
                <div className="w-8 h-8 rounded-lg bg-[#0B1F3A] text-[#C59B27] flex items-center justify-center">
                  <Icon className="w-4 h-4" />
                </div>
                <div className="font-display text-sm font-bold text-[#0B1F3A]">{act.title}</div>
                <div className="text-xs text-slate-500 leading-relaxed">{act.desc}</div>
              </button>
            );
          })}
        </div>
      )}

      {/* System Alerts */}
      {alerts.length > 0 && (
        <div className="space-y-2.5">
          {alerts.map((al, idx) => (
            <div
              key={idx}
              className={`flex items-start gap-3 p-4 rounded-xl border text-sm ${
                al.level === 'warning'
                  ? 'bg-amber-50 border-amber-200 text-amber-900'
                  : 'bg-blue-50 border-blue-200 text-[#0B1F3A]'
              }`}
            >
              {al.level === 'warning' ? (
                <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
              ) : (
                <Info className="w-5 h-5 text-[#1E4E8C] shrink-0 mt-0.5" />
              )}
              <span>{al.message}</span>
            </div>
          ))}
        </div>
      )}

      {/* Recent Audit Logs */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h3 className="font-display text-base font-bold text-[#0B1F3A]">
              سجل العمليات الإدارية الأخيرة
            </h3>
            <span className="text-xs text-slate-500 tabular-nums">{auditLogs.length} عملية</span>
          </div>
          <button
            type="button"
            onClick={onRefresh}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>تحديث الإحصائيات</span>
          </button>
        </div>
        {auditLogs.length === 0 ? (
          <div className="p-6 text-center text-sm text-slate-500">لا توجد عمليات مسجلة بعد.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-600">
                  <th className="px-4 py-3 text-right">المنفذ</th>
                  <th className="px-4 py-3 text-right">العملية</th>
                  <th className="px-4 py-3 text-right">التفاصيل</th>
                  <th className="px-4 py-3 text-left">الوقت</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {auditLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50/70">
                    <td className="px-4 py-2.5 font-mono text-xs text-[#1E4E8C] font-semibold">
                      <span dir="ltr" className="inline-block">
                        {log.actorUsername}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-xs font-bold text-[#0B1F3A]">{log.action}</td>
                    <td className="px-4 py-2.5 text-xs text-slate-700">{log.summary}</td>
                    <td className="px-4 py-2.5 text-left font-mono text-xs text-slate-500 tabular-nums">
                      <span dir="ltr" className="inline-block">
                        {log.createdAt}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
