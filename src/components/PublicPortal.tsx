import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  Link2,
  MessageSquareWarning,
  Search,
  Send,
  ShieldCheck,
  X,
} from 'lucide-react';
import { apiFetch } from '../lib/api.ts';
import type {
  AcademicYear,
  AllPublishedReportCard,
  Announcement,
  Exam,
  PublicObjectionNoticeItem,
  PublicReportCard,
  PublishLink,
  SchoolSettings,
} from '../types/school.ts';
import { AllResultsReportCard, ReportCard } from './ReportCard.tsx';

interface PublicPortalProps {
  settings: SchoolSettings;
  exams: Exam[];
  academicYears?: AcademicYear[];
  selectedYearId?: number | null;
  onSelectYear?: (yearId: number) => void;
  announcements?: Announcement[];
  onGoLogin: () => void;
}

export function PublicPortal({
  settings,
  exams,
  academicYears = [],
  selectedYearId = null,
  onSelectYear,
}: PublicPortalProps) {
  const [inquiryCode, setInquiryCode] = useState('');
  const [examId, setExamId] = useState<string>('all');
  const [activeLink, setActiveLink] = useState<PublishLink | null>(null);
  const [linkNotice, setLinkNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<PublicReportCard | null>(null);
  const [reportExamId, setReportExamId] = useState<number | null>(null);
  const [allReport, setAllReport] = useState<AllPublishedReportCard | null>(null);
  const [objectionNotices, setObjectionNotices] = useState<PublicObjectionNoticeItem[]>([]);
  const [resultYearId, setResultYearId] = useState<number | null>(null);

  // Student Grade Objection Form State
  const [showObjectionForm, setShowObjectionForm] = useState(false);
  const [objExamId, setObjExamId] = useState<string>('');
  const [objSubjectId, setObjSubjectId] = useState<string>('');
  const [objReason, setObjReason] = useState('');
  const [objSubmitting, setObjSubmitting] = useState(false);
  const [objSuccess, setObjSuccess] = useState<string | null>(null);
  const [objError, setObjError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const slug = (params.get('pub') || params.get('n') || '').trim();
    if (!slug) return;

    (async () => {
      try {
        const res = await apiFetch<{ link: PublishLink }>(
          `/api/public/publish-link/${encodeURIComponent(slug)}`
        );
        if (res.link) {
          setActiveLink(res.link);
          setExamId(String(res.link.examId));
          if (res.link.academicYearId && onSelectYear) {
            onSelectYear(res.link.academicYearId);
          }
          setLinkNotice(null);
        }
      } catch (err: any) {
        setLinkNotice(
          err?.message || 'رابط النشرة المحددة غير متاح، يمكنك الاستعلام بشكل اعتيادي أدناه.'
        );
      }
    })();
  }, []);

  const selectedValue = examId || 'all';

  const runInquiry = async (codeRaw: string, targetExamValue: string) => {
    setError(null);
    setReport(null);
    setReportExamId(null);
    setAllReport(null);
    setObjectionNotices([]);
    setShowObjectionForm(false);
    setObjSuccess(null);
    setObjError(null);

    const code = codeRaw.trim();
    if (!code) {
      setError('يرجى إدخال رقم الهوية الوطنية الخاص بالطالب.');
      return;
    }
    if (!targetExamValue) {
      setError('يرجى اختيار نوع الامتحان المطلوب.');
      return;
    }

    const isAll = targetExamValue === 'all';
    const usePublishSlug =
      !isAll && activeLink && String(activeLink.examId) === targetExamValue
        ? activeLink.slug
        : undefined;

    setLoading(true);
    try {
      const data = await apiFetch<{
        mode?: 'single' | 'all';
        report?: PublicReportCard;
        examId?: number;
        allReport?: AllPublishedReportCard;
        objectionNotices?: PublicObjectionNoticeItem[];
        yearId?: number;
      }>('/api/public/results', {
        method: 'POST',
        body: JSON.stringify({
          inquiryCode: code,
          examId: isAll ? 'all' : Number(targetExamValue),
          ...(selectedYearId ? { yearId: selectedYearId } : {}),
          ...(usePublishSlug ? { publishSlug: usePublishSlug } : {}),
        }),
      });
      setObjectionNotices(data.objectionNotices || []);
      setResultYearId(data.yearId ?? selectedYearId ?? null);

      if (data.mode === 'all' && data.allReport) {
        setAllReport(data.allReport);
      } else if (data.report) {
        setReport(data.report);
        setReportExamId(data.examId ?? (isAll ? null : Number(targetExamValue)));
      } else {
        setError('لا توجد نتائج منشورة مطابقة للبيانات المدخلة.');
      }
    } catch (err: any) {
      setError(err?.message || 'تعذر الاستعلام عن النتيجة.');
    } finally {
      setLoading(false);
    }
  };

  const handleInquiry = async (e: FormEvent) => {
    e.preventDefault();
    await runInquiry(inquiryCode, selectedValue);
  };

  const handleClearPublishLink = () => {
    setActiveLink(null);
    setLinkNotice(null);
    setExamId('all');
    if (window.location.search) {
      window.history.replaceState(null, '', '/');
    }
  };

  const publishedExamChoices = useMemo(() => {
    if (allReport) {
      return allReport.exams.map((ex) => ({
        examId: ex.examId,
        examName: ex.examName,
        subjects: ex.rows.map((r) => ({
          subjectId: r.subjectId,
          subjectName: r.subjectName,
          score: r.score,
        })),
      }));
    }
    if (report && reportExamId) {
      return [
        {
          examId: reportExamId,
          examName: report.examName,
          subjects: report.rows.map((r) => ({
            subjectId: r.subjectId,
            subjectName: r.subjectName,
            score: r.score,
          })),
        },
      ];
    }
    return [];
  }, [allReport, report, reportExamId]);

  const activeObjExam = useMemo(
    () =>
      publishedExamChoices.find((e) => String(e.examId) === objExamId) ??
      publishedExamChoices[0] ??
      null,
    [publishedExamChoices, objExamId]
  );

  const handleOpenObjectionForm = () => {
    const firstExam = publishedExamChoices[0];
    setObjExamId(firstExam ? String(firstExam.examId) : '');
    setObjSubjectId(firstExam?.subjects[0] ? String(firstExam.subjects[0].subjectId) : '');
    setObjReason('');
    setObjError(null);
    setObjSuccess(null);
    setShowObjectionForm(true);
  };

  const handleSubmitObjection = async (e: FormEvent) => {
    e.preventDefault();
    setObjError(null);
    setObjSuccess(null);

    const targetExam = activeObjExam?.examId;
    const targetSubject = Number(objSubjectId || activeObjExam?.subjects[0]?.subjectId);
    const trimmedReason = objReason.trim();
    if (!targetExam || !targetSubject) {
      setObjError('يرجى تحديد الامتحان والمادة الدراسية.');
      return;
    }
    if (trimmedReason.length < 4) {
      setObjError('يرجى كتابة سبب واضح للاعتراض (4 أحرف على الأقل).');
      return;
    }

    setObjSubmitting(true);
    try {
      await apiFetch('/api/public/objections', {
        method: 'POST',
        body: JSON.stringify({
          yearId: resultYearId ?? selectedYearId,
          inquiryCode: inquiryCode.trim(),
          examId: targetExam,
          subjectId: targetSubject,
          reason: trimmedReason,
        }),
      });
      setObjSuccess('تم استلام اعتراضك بنجاح وسيتم تدقيقه من قبل الإدارة واللجنة الامتحانية.');
      setObjReason('');
      setShowObjectionForm(false);
    } catch (err: any) {
      setObjError(err?.message || 'تعذر إرسال الاعتراض.');
    } finally {
      setObjSubmitting(false);
    }
  };

  return (
    <main id="top" className="flex-1 bg-[#F8FAFC]">
      {/* Dignified Institutional Hero + Student Results Inquiry */}
      <section className="no-print relative bg-[#0B1F3A] text-white overflow-hidden border-b-4 border-[#C59B27]">
        <div className="absolute inset-0">
          <img
            src="/src/assets/images/hero_campus_arch_1795173276646.jpg"
            alt={`مبنى ${settings.schoolName}`}
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover opacity-25"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-[#0B1F3A]/90 via-[#0B1F3A]/85 to-[#0B1F3A]/95" />
        </div>

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 lg:py-20">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-stretch">
            {/* Institutional Identity & Summary */}
            <div className="lg:col-span-6 flex flex-col justify-center space-y-6">
              <div className="flex items-center gap-4">
                <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-full overflow-hidden shrink-0 drop-shadow-md">
                  <img
                    src={settings.emblemUrl}
                    alt={`شعار ${settings.schoolName}`}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover scale-[1.06]"
                  />
                </div>
                <div className="space-y-1">
                  <p className="text-xs sm:text-sm font-semibold text-[#C59B27]">
                    {settings.republicHeader} · {settings.ministryHeader}
                  </p>
                  <p className="text-xs sm:text-sm text-slate-200 font-medium">
                    {settings.directorate}
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                <h1 className="font-display text-3xl sm:text-4xl lg:text-5xl font-extrabold leading-tight text-white [text-wrap:balance]">
                  {settings.schoolName}
                </h1>
                <p className="text-base sm:text-lg text-slate-200 leading-relaxed max-w-xl">
                  المنصة الإلكترونية الرسمية لإعلان النتائج المدرسية وكشوف الدرجات الفردية المعتمدة للعام الدراسي{' '}
                  <span
                    className="font-bold text-[#C59B27] tabular-nums whitespace-nowrap inline-block"
                    dir="ltr"
                  >
                    {settings.academicYear}
                  </span>
                  .
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-6 pt-2 text-xs sm:text-sm text-slate-300">
                <span className="inline-flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-[#C59B27]" />
                  كشف فردي سري ومعتمد
                </span>
                <span aria-hidden="true" className="text-slate-500">
                  ·
                </span>
                <span className="inline-flex items-center gap-2">
                  <BookOpen className="w-4 h-4 text-[#C59B27]" />
                  طباعة وتصدير PDF بدقة A4
                </span>
              </div>
            </div>

            {/* Primary Focal Anchor: Student Results Inquiry Card */}
            <div id="results-portal" className="lg:col-span-6 flex items-center">
              <div className="w-full bg-white text-[#0F172A] rounded-2xl border border-slate-200 shadow-lg p-6 sm:p-8 space-y-5">
                <div className="border-b border-slate-100 pb-4 space-y-1">
                  <h2 className="font-display text-xl sm:text-2xl font-extrabold text-[#0B1F3A]">
                    بوابة النتائج المدرسية
                  </h2>
                  <p className="text-sm text-slate-600">
                    اختر العام الدراسي أولاً ثم أدخل رقم الهوية الوطنية واختر نوع الامتحان للاطلاع على نتيجتك.
                  </p>
                </div>

                {activeLink && (
                  <div className="flex items-start justify-between gap-2 bg-[#0B1F3A] text-white rounded-xl p-3.5 text-xs sm:text-sm border border-[#C59B27]/50">
                    <div className="flex items-start gap-2.5">
                      <Link2 className="w-4 h-4 text-[#C59B27] shrink-0 mt-0.5" />
                      <div className="space-y-0.5">
                        <p className="font-bold text-[#C59B27]">رابط نشر مخصص</p>
                        <p className="text-slate-100 font-semibold leading-snug">
                          {activeLink.title}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleClearPublishLink}
                      title="العودة للاستعلام العام"
                      aria-label="العودة للاستعلام العام"
                      className="p-1.5 text-slate-300 hover:text-white rounded cursor-pointer shrink-0"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                )}

                {linkNotice && (
                  <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-xs">
                    {linkNotice}
                  </div>
                )}

                <form onSubmit={handleInquiry} className="space-y-4">
                  {/* Academic Year ALWAYS First above National ID */}
                  <div className="space-y-1.5">
                    <label
                      htmlFor="academic-year-select"
                      className="block text-sm font-bold text-[#0B1F3A]"
                    >
                      العام الدراسي
                    </label>
                    <div className="relative">
                      <select
                        id="academic-year-select"
                        value={selectedYearId ? String(selectedYearId) : ''}
                        onChange={(e) => {
                          const val = Number(e.target.value);
                          if (val && onSelectYear) {
                            setReport(null);
                            setAllReport(null);
                            setObjectionNotices([]);
                            setError(null);
                            onSelectYear(val);
                          }
                        }}
                        className="w-full min-h-[44px] appearance-none pr-4 pl-10 py-2.5 text-sm sm:text-base font-semibold rounded-lg border border-slate-300 bg-white focus:border-[#1E4E8C] focus:outline-2 focus:outline-[#1E4E8C]/20 cursor-pointer"
                      >
                        {academicYears.length > 0 ? (
                          academicYears.map((yr) => (
                            <option key={yr.id} value={yr.id}>
                              {yr.name} {yr.isCurrent ? '(العام الحالي)' : ''}
                            </option>
                          ))
                        ) : (
                          <option value="">{settings.academicYear}</option>
                        )}
                      </select>
                      <ChevronDown
                        aria-hidden="true"
                        className="w-4 h-4 text-slate-500 pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label
                      htmlFor="inquiry-code"
                      className="block text-sm font-bold text-[#0B1F3A]"
                    >
                      رقم الهوية الوطنية
                    </label>
                    <input
                      id="inquiry-code"
                      type="text"
                      inputMode="numeric"
                      value={inquiryCode}
                      onChange={(e) => setInquiryCode(e.target.value)}
                      placeholder="أدخل رقم الهوية الوطنية (مثال: 2026101)"
                      className="w-full min-h-[44px] px-4 py-3 text-base rounded-lg border border-slate-300 focus:border-[#1E4E8C] focus:outline-2 focus:outline-[#1E4E8C]/20 tabular-nums"
                      required
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label
                      htmlFor="exam-select"
                      className="block text-sm font-bold text-[#0B1F3A]"
                    >
                      نوع الامتحان
                    </label>
                    <div className="relative">
                      <select
                        id="exam-select"
                        value={selectedValue}
                        onChange={(e) => setExamId(e.target.value)}
                        className="w-full min-h-[44px] appearance-none pr-4 pl-10 py-3 text-base rounded-lg border border-slate-300 bg-white focus:border-[#1E4E8C] focus:outline-2 focus:outline-[#1E4E8C]/20 cursor-pointer"
                        required
                      >
                        <option value="all">عرض كل النتائج</option>
                        {exams.map((ex) => (
                          <option key={ex.id} value={ex.id}>
                            {ex.name}
                          </option>
                        ))}
                      </select>
                      <ChevronDown
                        aria-hidden="true"
                        className="w-4 h-4 text-slate-500 pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full min-h-[48px] flex items-center justify-center gap-2 px-6 py-3.5 bg-[#0B1F3A] hover:bg-[#1E4E8C] text-white font-bold text-base rounded-lg transition-colors cursor-pointer disabled:opacity-60"
                  >
                    <Search className="w-5 h-5 text-[#C59B27]" />
                    <span>{loading ? 'جاري البحث عن النتيجة...' : 'عرض النتيجة'}</span>
                  </button>
                </form>

                {error && (
                  <div
                    role="alert"
                    className="flex items-start gap-3 p-4 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-sm"
                  >
                    <AlertCircle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
                    <p className="leading-relaxed">{error}</p>
                  </div>
                )}

                <p className="text-xs text-slate-500 pt-1">
                  ملاحظة: لا تظهر في البوابة العامة إلا الدرجات المعتمدة والمنشورة رسمياً، ولا تُعرض أي مسودات أو امتحانات قيد المراجعة.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Published Objection Results Notice (Rendered OUTSIDE the report card) */}
      {(report || allReport) && objectionNotices.length > 0 && (
        <section
          aria-label="نتائج الاعتراضات"
          className="no-print max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 pt-6"
        >
          <div className="bg-white border border-amber-300 rounded-xl p-4 sm:p-5 shadow-xs space-y-3">
            <div className="flex items-center gap-2 text-[#0B1F3A]">
              <MessageSquareWarning className="w-5 h-5 text-amber-600 shrink-0" />
              <h3 className="font-display text-base sm:text-lg font-extrabold">
                نتائج الاعتراضات المعلنة
              </h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {objectionNotices.map((notice) => {
                const isChanged = notice.status === 'mismatching';
                return (
                  <div
                    key={notice.id}
                    className={`rounded-lg border p-3.5 text-sm space-y-1.5 ${
                      isChanged
                        ? 'bg-amber-50/70 border-amber-300 text-amber-950'
                        : 'bg-slate-50 border-slate-200 text-slate-800'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 font-bold">
                      <span>
                        {notice.subjectName} — {notice.examName}
                      </span>
                      <span
                        className={isChanged ? 'text-amber-800' : 'text-emerald-800'}
                      >
                        {isChanged ? 'غير مطابقة (تم التعديل)' : 'مطابقة'}
                      </span>
                    </div>
                    <div className="text-xs text-slate-700 flex flex-wrap items-center gap-3 tabular-nums">
                      <span>الدرجة السابقة: {notice.recordedScore ?? '—'}</span>
                      {isChanged && notice.correctedScore !== null && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-bold text-amber-900">
                            الدرجة المعدلة: {notice.correctedScore}
                          </span>
                        </>
                      )}
                    </div>
                    {notice.adminNote && (
                      <p className="text-xs text-slate-600">ملاحظة اللجنة: {notice.adminNote}</p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* Rendered Individual Report Card */}
      {report && (
        <section className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-6 sm:py-8 print:p-0 print:m-0 print:max-w-none">
          <ReportCard
            report={report}
            pdfParams={{
              inquiryCode: inquiryCode.trim(),
              examId: reportExamId ?? selectedValue,
              yearId: resultYearId ?? selectedYearId,
              publishSlug: activeLink?.slug,
            }}
            onShowAllResults={() => {
              setExamId('all');
              void runInquiry(inquiryCode, 'all');
            }}
            onReset={() => {
              setReport(null);
              setReportExamId(null);
              setAllReport(null);
              setObjectionNotices([]);
              setError(null);
            }}
          />
        </section>
      )}

      {allReport && (
        <section className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-6 sm:py-8 print:p-0 print:m-0 print:max-w-none">
          <AllResultsReportCard
            allReport={allReport}
            pdfParams={{
              inquiryCode: inquiryCode.trim(),
              examId: 'all',
              yearId: resultYearId ?? selectedYearId,
            }}
            onReset={() => {
              setReport(null);
              setReportExamId(null);
              setAllReport(null);
              setObjectionNotices([]);
              setError(null);
            }}
          />
        </section>
      )}

      {/* Grade Objection Submission Card (Outside Report Card) */}
      {(report || allReport) && publishedExamChoices.length > 0 && (
        <section
          aria-label="تقديم اعتراض على درجة"
          className="no-print max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 pb-10"
        >
          <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 shadow-xs space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-0.5">
                <h3 className="font-display text-base font-extrabold text-[#0B1F3A]">
                  تقديم اعتراض على درجة
                </h3>
                <p className="text-xs text-slate-600">
                  في حال وجود ملاحظة على درجة مادة منشورة يمكنك إرسال طلب اعتراض للمراجعة الرسمية.
                </p>
              </div>
              {!showObjectionForm && (
                <button
                  type="button"
                  onClick={handleOpenObjectionForm}
                  className="inline-flex items-center gap-2 min-h-[44px] px-4 py-2 text-xs sm:text-sm font-bold text-[#0B1F3A] bg-amber-50 hover:bg-amber-100 border border-amber-300 rounded-lg transition-colors cursor-pointer"
                >
                  <MessageSquareWarning className="w-4 h-4 text-amber-700" />
                  <span>تقديم اعتراض على درجة</span>
                </button>
              )}
            </div>

            {objSuccess && (
              <div
                role="status"
                className="flex items-start gap-2.5 p-3.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-900 text-sm"
              >
                <CheckCircle2 className="w-5 h-5 text-emerald-700 shrink-0 mt-0.5" />
                <span>{objSuccess}</span>
              </div>
            )}

            {showObjectionForm && (
              <form
                onSubmit={handleSubmitObjection}
                className="space-y-4 pt-3 border-t border-slate-100"
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label
                      htmlFor="objection-exam-select"
                      className="block text-xs font-bold text-slate-700"
                    >
                      الامتحان المنشور
                    </label>
                    <select
                      id="objection-exam-select"
                      value={String(activeObjExam?.examId ?? '')}
                      onChange={(e) => {
                        const nextId = e.target.value;
                        setObjExamId(nextId);
                        const found = publishedExamChoices.find(
                          (ex) => String(ex.examId) === nextId
                        );
                        setObjSubjectId(
                          found?.subjects[0] ? String(found.subjects[0].subjectId) : ''
                        );
                      }}
                      className="w-full min-h-[44px] px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white"
                    >
                      {publishedExamChoices.map((ex) => (
                        <option key={ex.examId} value={ex.examId}>
                          {ex.examName}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label
                      htmlFor="objection-subject-select"
                      className="block text-xs font-bold text-slate-700"
                    >
                      المادة الدراسية
                    </label>
                    <select
                      id="objection-subject-select"
                      value={objSubjectId}
                      onChange={(e) => setObjSubjectId(e.target.value)}
                      className="w-full min-h-[44px] px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white"
                    >
                      {(activeObjExam?.subjects || []).map((subj) => (
                        <option key={subj.subjectId} value={subj.subjectId}>
                          {subj.subjectName} (الدرجة المرصودة: {subj.score})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="space-y-1">
                  <label
                    htmlFor="objection-reason"
                    className="block text-xs font-bold text-slate-700"
                  >
                    سبب الاعتراض (إلزامي)
                  </label>
                  <textarea
                    id="objection-reason"
                    rows={3}
                    value={objReason}
                    onChange={(e) => setObjReason(e.target.value)}
                    placeholder="اذكر سبب الاعتراض بوضوح (مثال: عدم تطابق جمع الدفتر أو غياب غير مبرر)..."
                    className="w-full px-3 py-2.5 text-sm rounded-lg border border-slate-300 focus:border-[#1E4E8C] focus:outline-none"
                    required
                  />
                </div>

                {objError && (
                  <div
                    role="alert"
                    className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-xs sm:text-sm"
                  >
                    {objError}
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="submit"
                    disabled={objSubmitting}
                    className="inline-flex items-center gap-2 min-h-[44px] px-5 py-2 text-sm font-bold text-white bg-[#0B1F3A] hover:bg-[#1E4E8C] rounded-lg cursor-pointer disabled:opacity-60"
                  >
                    <Send className="w-4 h-4 text-[#C59B27]" />
                    <span>{objSubmitting ? 'جاري الإرسال...' : 'إرسال الاعتراض'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowObjectionForm(false)}
                    className="min-h-[44px] px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer"
                  >
                    إلغاء
                  </button>
                </div>
              </form>
            )}
          </div>
        </section>
      )}
    </main>
  );
}
