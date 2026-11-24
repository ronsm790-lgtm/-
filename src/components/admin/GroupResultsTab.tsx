import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  FileSpreadsheet,
  FileText,
  ImageDown,
  Layers,
  Printer,
  RefreshCw,
  Users,
} from 'lucide-react';
import { apiDownload, apiFetch } from '../../lib/api.ts';
import { getClassColorTheme } from '../../lib/classColors.ts';
import { captureSheetToPng } from '../../lib/exportImage.ts';
import { isSubjectExcludedForClass } from '../../lib/gradeRules.ts';
import type {
  AllPublishedReportCard,
  Exam,
  GroupExamRoster,
  PublicReportCard,
  SchoolClass,
  Section,
  Subject,
} from '../../types/school.ts';
import {
  AllResultsReportSheet,
  OfficialSheetHeader,
  PrincipalSignature,
  SingleReportSheet,
} from '../ReportCard.tsx';
import { ActionMenu } from '../ui/ActionMenu.tsx';

interface GroupResultsTabProps {
  selectedYearId?: number | null;
  classes: SchoolClass[];
  sections: Section[];
  subjects: Subject[];
  exams: Exam[];
}

const ROSTER_PAGE_SIZE = 50;

export function GroupResultsTab({ selectedYearId, classes, sections, subjects, exams }: GroupResultsTabProps) {
  const [tabMode, setTabMode] = useState<'roster' | 'individual'>('roster');

  // Shared / Roster mode state (NO "جميع الشعب" option in roster section selector)
  const [examId, setExamId] = useState<string>(exams[0] ? String(exams[0].id) : '');
  const [classId, setClassId] = useState<string>(classes[0] ? String(classes[0].id) : '');
  const [sectionId, setSectionId] = useState<string>('');
  const [subjectId, setSubjectId] = useState<string>('all');
  const [onlyPublished, setOnlyPublished] = useState<boolean>(false);

  const [roster, setRoster] = useState<GroupExamRoster | null>(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState<'word' | 'pdf' | 'xlsx' | 'png' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pageRefs = useRef<Array<HTMLDivElement | null>>([]);

  // Bulk individual cards mode state
  const [indExamId, setIndExamId] = useState<string>('all');
  const [indClassId, setIndClassId] = useState<string>(classes[0] ? String(classes[0].id) : '');
  const [indSectionId, setIndSectionId] = useState<string>('all');
  const [indOnlyPublished, setIndOnlyPublished] = useState<boolean>(false);
  const [indCardsMode, setIndCardsMode] = useState<'all' | 'single'>('all');
  const [indAllCards, setIndAllCards] = useState<AllPublishedReportCard[]>([]);
  const [indSingleCards, setIndSingleCards] = useState<PublicReportCard[]>([]);
  const [indLoading, setIndLoading] = useState(false);
  const [indError, setIndError] = useState<string | null>(null);
  const [indExportingPdf, setIndExportingPdf] = useState(false);
  const [indExportingPng, setIndExportingPng] = useState(false);

  const cardRefs = useRef<Array<HTMLDivElement | null>>([]);

  useEffect(() => {
    if (!examId && exams[0]) setExamId(String(exams[0].id));
  }, [exams, examId]);

  useEffect(() => {
    if (!classId && classes[0]) setClassId(String(classes[0].id));
    if (!indClassId && classes[0]) setIndClassId(String(classes[0].id));
  }, [classes, classId, indClassId]);

  const classSections = useMemo(
    () => sections.filter((s) => s.classId === Number(classId)),
    [sections, classId]
  );

  // Always pick a concrete section in roster mode (no 'all' option)
  const effectiveSectionId = useMemo(() => {
    if (classSections.some((s) => String(s.id) === sectionId)) return sectionId;
    return classSections[0] ? String(classSections[0].id) : '';
  }, [classSections, sectionId]);

  useEffect(() => {
    if (effectiveSectionId && effectiveSectionId !== sectionId) {
      setSectionId(effectiveSectionId);
    }
  }, [effectiveSectionId, sectionId]);

  const selectedRosterClass = useMemo(
    () => classes.find((c) => String(c.id) === classId) ?? null,
    [classes, classId]
  );

  const classSubjects = useMemo(
    () =>
      subjects.filter(
        (sub) =>
          sub.isActive &&
          (sub.classId === null || sub.classId === Number(classId)) &&
          !isSubjectExcludedForClass(
            sub.name,
            selectedRosterClass?.name,
            selectedRosterClass?.isMinisterial
          )
      ),
    [subjects, classId, selectedRosterClass]
  );

  useEffect(() => {
    if (subjectId !== 'all' && !classSubjects.some((s) => String(s.id) === subjectId)) {
      setSubjectId('all');
    }
  }, [classSubjects, subjectId]);

  const indClassSections = useMemo(
    () => sections.filter((s) => s.classId === Number(indClassId)),
    [sections, indClassId]
  );

  const queryString = useMemo(() => {
    const params = new URLSearchParams({
      examId,
      classId,
      sectionId: effectiveSectionId,
      subjectId: subjectId || 'all',
      onlyPublished: onlyPublished ? 'true' : 'false',
      ...(selectedYearId ? { yearId: String(selectedYearId) } : {}),
    });
    return params.toString();
  }, [examId, classId, effectiveSectionId, subjectId, onlyPublished, selectedYearId]);

  const loadRoster = async () => {
    if (!examId || !classId || !effectiveSectionId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<{ roster: GroupExamRoster }>(
        `/api/admin/group-results?${queryString}`
      );
      setRoster(data.roster);
    } catch (err: any) {
      setError(err?.message || 'تعذر تحميل قائمة النتائج الجماعية.');
      setRoster(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (tabMode === 'roster') {
      loadRoster();
    }
  }, [queryString, tabMode]);

  const rosterPages = useMemo(() => {
    if (!roster) return [];
    const totalPages = Math.max(1, Math.ceil(roster.rows.length / ROSTER_PAGE_SIZE));
    const chunks: Array<Array<(typeof roster.rows)[number] | null>> = [];
    for (let p = 0; p < totalPages; p++) {
      const slice = roster.rows.slice(p * ROSTER_PAGE_SIZE, (p + 1) * ROSTER_PAGE_SIZE);
      const padded: Array<(typeof roster.rows)[number] | null> = [];
      for (let i = 0; i < ROSTER_PAGE_SIZE; i++) {
        padded.push(slice[i] ?? null);
      }
      chunks.push(padded);
    }
    return chunks;
  }, [roster]);

  const handleOpenBulkCardsFromRoster = () => {
    if (classId) setIndClassId(classId);
    if (effectiveSectionId) setIndSectionId(effectiveSectionId);
    setIndOnlyPublished(onlyPublished);
    setTabMode('individual');
  };

  const loadIndividualCards = async () => {
    if (!indClassId) return;
    setIndLoading(true);
    setIndError(null);
    try {
      const params = new URLSearchParams({
        examId: indExamId || 'all',
        classId: indClassId,
        sectionId: indSectionId || 'all',
        onlyPublished: indOnlyPublished ? 'true' : 'false',
        ...(selectedYearId ? { yearId: String(selectedYearId) } : {}),
      });
      const res = await apiFetch<{
        mode: 'all' | 'single';
        cards: Array<AllPublishedReportCard | PublicReportCard>;
      }>(`/api/admin/group-individual-cards?${params.toString()}`);

      setIndCardsMode(res.mode);
      if (res.mode === 'all') {
        setIndAllCards(res.cards as AllPublishedReportCard[]);
        setIndSingleCards([]);
      } else {
        setIndSingleCards(res.cards as PublicReportCard[]);
        setIndAllCards([]);
      }
    } catch (err: any) {
      setIndError(err?.message || 'تعذر تحميل بطاقات الطلبة الفردية.');
      setIndAllCards([]);
      setIndSingleCards([]);
    } finally {
      setIndLoading(false);
    }
  };

  useEffect(() => {
    if (tabMode === 'individual') {
      loadIndividualCards();
    }
  }, [tabMode, indExamId, indClassId, indSectionId, indOnlyPublished, selectedYearId]);

  const handleDownloadWord = async () => {
    if (!roster) return;
    setDownloading('word');
    setError(null);
    try {
      await apiDownload(
        `/api/admin/group-results/word?${queryString}`,
        `قائمة-نتائج-${roster.examName}-${roster.className}.docx`
      );
    } catch (err: any) {
      setError(err?.message || 'تعذر تصدير ملف Word.');
    } finally {
      setDownloading(null);
    }
  };

  const handleDownloadXlsx = async () => {
    if (!roster) return;
    setDownloading('xlsx');
    setError(null);
    try {
      await apiDownload(
        `/api/admin/group-results/xlsx?${queryString}`,
        `قائمة-نتائج-${roster.examName}-${roster.className}.xlsx`
      );
    } catch (err: any) {
      setError(err?.message || 'تعذر تصدير ملف Excel.');
    } finally {
      setDownloading(null);
    }
  };

  const handleDownloadPdf = async () => {
    if (!roster) return;
    setDownloading('pdf');
    setError(null);
    try {
      await apiDownload(
        `/api/admin/group-results/pdf?${queryString}`,
        `قائمة-نتائج-${roster.examName}-${roster.className}-${roster.sectionLabel}.pdf`
      );
    } catch (err: any) {
      setError(
        err?.message || 'تعذر إنشاء ملف PDF الجماعي. يمكنك استخدام التصدير بصيغة Word أو الطباعة.'
      );
    } finally {
      setDownloading(null);
    }
  };

  const handleDownloadRosterPng = async () => {
    if (!roster || rosterPages.length === 0) return;
    setDownloading('png');
    setError(null);
    try {
      for (let idx = 0; idx < rosterPages.length; idx++) {
        const el = pageRefs.current[idx];
        if (!el) continue;
        const dataUrl = await captureSheetToPng(el, { pixelRatio: 2.2 });
        const link = document.createElement('a');
        link.href = dataUrl;
        const suffix = rosterPages.length > 1 ? `-صفحة-${idx + 1}` : '';
        link.download = `قائمة-نتائج-${roster.examName}-${roster.className}-${roster.sectionLabel}${suffix}.png`;
        document.body.appendChild(link);
        link.click();
        link.remove();
      }
    } catch (err: any) {
      setError(err?.message || 'تعذر تصدير القائمة كصورة PNG.');
    } finally {
      setDownloading(null);
    }
  };

  const activeIndividualCount =
    indCardsMode === 'all' ? indAllCards.length : indSingleCards.length;

  const handleDownloadIndividualCardsPdf = async () => {
    if (activeIndividualCount === 0 || !indClassId) return;
    setIndExportingPdf(true);
    setIndError(null);
    try {
      const qs = new URLSearchParams({
        examId: indExamId || 'all',
        classId: indClassId,
        sectionId: indSectionId || 'all',
        onlyPublished: indOnlyPublished ? 'true' : 'false',
        ...(selectedYearId ? { yearId: String(selectedYearId) } : {}),
      }).toString();
      const clsName = classes.find((c) => String(c.id) === indClassId)?.name || 'الصف';
      await apiDownload(
        `/api/admin/group-individual-cards/pdf?${qs}`,
        `بطاقات-الطلبة-${clsName}.pdf`
      );
    } catch (err: any) {
      setIndError(
        err?.message || 'تعذر إنشاء ملف PDF المجمع للبطاقات. يمكنك استخدام زر الطباعة المباشرة (A4).'
      );
    } finally {
      setIndExportingPdf(false);
    }
  };

  const handleDownloadSingleCardPng = async (index: number, studentName: string) => {
    const el = cardRefs.current[index];
    if (!el) return;
    setIndExportingPng(true);
    setIndError(null);
    try {
      const targetSheet = (el.querySelector('.print-sheet') as HTMLElement) || el;
      const dataUrl = await captureSheetToPng(targetSheet, { pixelRatio: 2.2 });
      const link = document.createElement('a');
      link.href = dataUrl;
      link.download = `بطاقة-${studentName}.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err: any) {
      setIndError(err?.message || 'تعذر حفظ بطاقة الطالب كصورة PNG.');
    } finally {
      setIndExportingPng(false);
    }
  };

  const handleDownloadAllCardsPng = async () => {
    if (activeIndividualCount === 0) return;
    setIndExportingPng(true);
    setIndError(null);
    try {
      const names =
        indCardsMode === 'all'
          ? indAllCards.map((c) => c.student.fullName)
          : indSingleCards.map((c) => c.student.fullName);
      for (let i = 0; i < names.length; i++) {
        const el = cardRefs.current[i];
        if (!el) continue;
        const targetSheet = (el.querySelector('.print-sheet') as HTMLElement) || el;
        const dataUrl = await captureSheetToPng(targetSheet, { pixelRatio: 2.1 });
        const link = document.createElement('a');
        link.href = dataUrl;
        link.download = `بطاقة-${names[i]}.png`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        await new Promise((r) => setTimeout(r, 120));
      }
    } catch (err: any) {
      setIndError(err?.message || 'تعذر حفظ البطاقات كصور PNG.');
    } finally {
      setIndExportingPng(false);
    }
  };

  const printPageCss =
    tabMode === 'individual' && indExamId !== 'all'
      ? '@page { size: A4 portrait; margin: 7mm; }'
      : '@page { size: A4 landscape; margin: 4mm; }';

  return (
    <div className="space-y-5">
      <style media="print">{printPageCss}</style>

      {/* Top Mode Switcher */}
      <div className="no-print bg-white border border-slate-200 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5 p-1 bg-slate-100 rounded-lg">
          <button
            type="button"
            onClick={() => setTabMode('roster')}
            className={`inline-flex items-center gap-2 px-4 py-2 text-xs sm:text-sm font-bold rounded-md cursor-pointer transition-colors ${
              tabMode === 'roster'
                ? 'bg-[#0B1F3A] text-white shadow-xs'
                : 'text-slate-600 hover:text-[#0B1F3A]'
            }`}
          >
            <Users className="w-4 h-4 text-[#C59B27]" />
            <span>القائمة الجماعية (50 طالب/صفحة)</span>
          </button>
          <button
            type="button"
            onClick={() => setTabMode('individual')}
            className={`inline-flex items-center gap-2 px-4 py-2 text-xs sm:text-sm font-bold rounded-md cursor-pointer transition-colors ${
              tabMode === 'individual'
                ? 'bg-[#0B1F3A] text-white shadow-xs'
                : 'text-slate-600 hover:text-[#0B1F3A]'
            }`}
          >
            <Layers className="w-4 h-4 text-[#C59B27]" />
            <span>بطاقات الطلبة الفردية (صفحة لكل طالب)</span>
          </button>
        </div>
        <span className="text-xs text-slate-500">
          {tabMode === 'roster'
            ? 'كشف جماعي منسق لشعبة محددة بسعة 50 اسم في كل ورقة A4'
            : 'طباعة وتصدير بطاقات الدرجات الفردية لجميع الطلبة دفعة واحدة (صفحة مستقلة لكل طالب)'}
        </span>
      </div>

      {/* ===================================================================== */}
      {/* MODE A: GROUP ROSTER (50 STUDENTS / PAGE)                             */}
      {/* ===================================================================== */}
      {tabMode === 'roster' && (
        <>
          <div className="no-print bg-white border border-slate-200 rounded-xl p-4 sm:p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
              <div>
                <h3 className="font-display text-base font-bold text-[#0B1F3A]">
                  إنشاء وتصدير قوائم النتائج الجماعية (خاص بالإدارة)
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  كشف رسمي مرتب للشعبة المختارة يحمل حتى 50 طالباً في الورقة الواحدة مع إمكانية اختيار مادة محددة أو كل المواد.
                </p>
              </div>
              <span
                className={`px-2.5 py-1 rounded border text-xs font-bold ${(() => {
                  const t = getClassColorTheme(classes.find((c) => String(c.id) === classId)?.name || '');
                  return `${t.badgeBg} ${t.badgeText} ${t.badgeBorder}`;
                })()}`}
              >
                {classes.find((c) => String(c.id) === classId)?.name || 'الصف'}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              <div>
                <label htmlFor="grp-exam" className="block text-xs font-bold text-slate-600 mb-1">
                  الامتحان
                </label>
                <div className="relative">
                  <select
                    id="grp-exam"
                    value={examId}
                    onChange={(e) => setExamId(e.target.value)}
                    className="w-full appearance-none pr-3 pl-8 py-2 text-sm rounded-lg border border-slate-300 bg-white cursor-pointer"
                  >
                    {exams.map((ex) => (
                      <option key={ex.id} value={ex.id}>
                        {ex.name}
                      </option>
                    ))}
                  </select>
                  <ChevronDown aria-hidden="true" className="w-4 h-4 text-slate-500 pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2" />
                </div>
              </div>

              <div>
                <label htmlFor="grp-class" className="block text-xs font-bold text-slate-600 mb-1">
                  الصف الدراسي
                </label>
                <div className="relative">
                  <select
                    id="grp-class"
                    value={classId}
                    onChange={(e) => {
                      setClassId(e.target.value);
                      setSectionId('');
                    }}
                    className="w-full appearance-none pr-3 pl-8 py-2 text-sm rounded-lg border border-slate-300 bg-white cursor-pointer"
                  >
                    {classes.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <ChevronDown aria-hidden="true" className="w-4 h-4 text-slate-500 pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2" />
                </div>
              </div>

              <div>
                <label htmlFor="grp-section" className="block text-xs font-bold text-slate-600 mb-1">
                  الشعبة
                </label>
                <div className="relative">
                  <select
                    id="grp-section"
                    value={effectiveSectionId}
                    onChange={(e) => setSectionId(e.target.value)}
                    className="w-full appearance-none pr-3 pl-8 py-2 text-sm rounded-lg border border-slate-300 bg-white cursor-pointer"
                  >
                    {classSections.map((sec) => (
                      <option key={sec.id} value={sec.id}>
                        شعبة {sec.name}
                      </option>
                    ))}
                  </select>
                  <ChevronDown aria-hidden="true" className="w-4 h-4 text-slate-500 pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2" />
                </div>
              </div>

              <div>
                <label htmlFor="grp-subject" className="block text-xs font-bold text-slate-600 mb-1">
                  المادة الدراسية
                </label>
                <div className="relative">
                  <select
                    id="grp-subject"
                    value={subjectId}
                    onChange={(e) => setSubjectId(e.target.value)}
                    className="w-full appearance-none pr-3 pl-8 py-2 text-sm rounded-lg border border-slate-300 bg-white cursor-pointer"
                  >
                    <option value="all">كل المواد</option>
                    {classSubjects.map((sub) => (
                      <option key={sub.id} value={sub.id}>
                        {sub.name}
                      </option>
                    ))}
                  </select>
                  <ChevronDown aria-hidden="true" className="w-4 h-4 text-slate-500 pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2" />
                </div>
              </div>

              <div>
                <label htmlFor="grp-scope" className="block text-xs font-bold text-slate-600 mb-1">
                  نطاق الدرجات
                </label>
                <div className="relative">
                  <select
                    id="grp-scope"
                    value={onlyPublished ? 'published' : 'all'}
                    onChange={(e) => setOnlyPublished(e.target.value === 'published')}
                    className="w-full appearance-none pr-3 pl-8 py-2 text-sm rounded-lg border border-slate-300 bg-white cursor-pointer"
                  >
                    <option value="all">جميع الدرجات المرصودة</option>
                    <option value="published">الدرجات المنشورة فقط</option>
                  </select>
                  <ChevronDown aria-hidden="true" className="w-4 h-4 text-slate-500 pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2" />
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100">
              <div className="text-xs text-slate-600 tabular-nums">
                {roster ? (
                  <>
                    الطلبة المسجلون: <strong className="text-[#0B1F3A]">{roster.rows.length}</strong> · السعة الجاهزة:{' '}
                    <strong className="text-[#0B1F3A]">{rosterPages.length * ROSTER_PAGE_SIZE}</strong> خانة (50 صف/صفحة A4 أفقي) · المواد:{' '}
                    <strong className="text-[#0B1F3A]">{roster.subjects.length}</strong>
                  </>
                ) : (
                  'اختر الصف والشعبة والامتحان لعرض القائمة'
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <ActionMenu
                  label={
                    downloading
                      ? downloading === 'word'
                        ? 'جاري تصدير Word...'
                        : downloading === 'pdf'
                          ? 'جاري إنشاء PDF...'
                          : downloading === 'xlsx'
                            ? 'جاري تصدير Excel...'
                            : 'جاري حفظ PNG...'
                      : 'تصدير القائمة (PDF / Word / Excel)'
                  }
                  icon={FileSpreadsheet}
                  variant="blue"
                  disabled={!roster || downloading !== null}
                  items={[
                    {
                      id: 'roster-xlsx',
                      label: 'تصدير Excel (.xlsx)',
                      description: 'جدول منسق RTL مع عرض الأعمدة التلقائي',
                      icon: FileSpreadsheet,
                      tone: 'emerald',
                      onClick: () => void handleDownloadXlsx(),
                    },
                    {
                      id: 'roster-pdf',
                      label: 'تصدير PDF أفقي (A4)',
                      description: 'نسخة رسمية جاهزة للطباعة أو الأرشفة',
                      icon: FileText,
                      tone: 'primary',
                      onClick: () => void handleDownloadPdf(),
                    },
                    {
                      id: 'roster-word',
                      label: 'تصدير Word (.docx)',
                      description: 'ملف قابل للتحرير والتعديل على Microsoft Word',
                      icon: FileText,
                      onClick: () => void handleDownloadWord(),
                    },
                    {
                      id: 'roster-png',
                      label: 'حفظ القائمة كصورة (PNG)',
                      description: 'للمشاركة السريعة بدقة عالية',
                      icon: ImageDown,
                      dividerBefore: true,
                      onClick: () => void handleDownloadRosterPng(),
                    },
                  ]}
                />

                <ActionMenu
                  label="أوامر الطباعة والبطاقات"
                  icon={Printer}
                  variant="navy"
                  items={[
                    {
                      id: 'roster-print',
                      label: 'طباعة القائمة الحالية (A4 أفقي)',
                      description: 'طباعة 50 طالباً في الورقة الواحدة مباشرة',
                      icon: Printer,
                      disabled: !roster,
                      tone: 'primary',
                      onClick: () => window.print(),
                    },
                    {
                      id: 'roster-bulk-cards',
                      label: 'طباعة بطاقات الطلاب جماعياً',
                      description: 'الانتقال لبطاقات الطلبة الفردية (صفحة لكل طالب)',
                      icon: Layers,
                      tone: 'amber',
                      onClick: handleOpenBulkCardsFromRoster,
                    },
                    {
                      id: 'roster-refresh',
                      label: 'تحديث بيانات القائمة',
                      icon: RefreshCw,
                      dividerBefore: true,
                      onClick: () => void loadRoster(),
                    },
                  ]}
                />
              </div>
            </div>
          </div>

          {error && (
            <div role="alert" className="no-print p-3.5 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm">
              {error}
            </div>
          )}

          {loading ? (
            <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-500">
              جاري إعداد قائمة النتائج الجماعية...
            </div>
          ) : !roster ? (
            <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-500">
              يرجى اختيار الصف والشعبة والامتحان لعرض القائمة الجماعية.
            </div>
          ) : (
            <div className="print-sheet-wrapper overflow-x-auto pb-2 space-y-6 print:space-y-0">
              {rosterPages.map((pageRows, pageIdx) => (
                <div
                  key={pageIdx}
                  ref={(el) => {
                    pageRefs.current[pageIdx] = el;
                  }}
                  dir="rtl"
                  className={`group-print-sheet a4-landscape-sheet mx-auto border-2 border-black bg-white text-black p-2 print:p-[1.5mm] space-y-1 print:space-y-0.5 shadow-md ${
                    pageIdx < rosterPages.length - 1 ? 'print-page-break print:break-after-page' : ''
                  }`}
                >
                  <OfficialSheetHeader
                    density="roster"
                    republicHeader={roster.republicHeader}
                    ministryHeader={roster.ministryHeader}
                    directorate={roster.directorate}
                    schoolName={roster.schoolName}
                    emblemUrl={roster.emblemUrl}
                    metaItems={[
                      <span key="year" className="font-semibold text-black">
                        العام الدراسي:{' '}
                        <span dir="ltr" className="font-bold tabular-nums whitespace-nowrap">
                          {roster.academicYear}
                        </span>
                      </span>,
                      <span key="exam" className="font-semibold text-black">
                        الامتحان: <span className="font-bold">{roster.examName}</span>
                      </span>,
                      <span key="cls" className="font-semibold text-black">
                        الصف:{' '}
                        <span className="font-bold">
                          {roster.className} ({roster.sectionLabel})
                        </span>
                      </span>,
                      <span key="sub" className="font-semibold text-black">
                        المادة: <span className="font-bold">{roster.subjectLabel}</span>
                      </span>,
                    ]}
                  />

                  <div className="text-center py-0.5 bg-[#F3F4F6] border border-black">
                    <h2 className="font-display text-[11px] print:text-[10px] font-extrabold text-black text-center m-0 leading-snug">
                      قائمة نتائج الطلبة الجماعية — {roster.examName} — {roster.className} (
                      {roster.sectionLabel}) — {roster.subjectLabel}
                      {rosterPages.length > 1
                        ? ` (صفحة ${pageIdx + 1} من ${rosterPages.length})`
                        : ''}
                    </h2>
                  </div>

                  <table className="w-full table-fixed border-collapse text-center text-[8px] print:text-[7.2px] leading-[1.2] print:leading-[1.08]">
                    <thead>
                      <tr className="bg-[#E5E7EB] text-black">
                        <th className="border border-black text-center font-bold w-[3.5%] px-0.5 py-0.5 print:py-0">
                          ت
                        </th>
                        <th className="border border-black text-center font-bold w-[21%] px-1 py-0.5 print:py-0">
                          اسم الطالب
                        </th>
                        <th className="border border-black text-center font-bold w-[10.5%] px-0.5 py-0.5 print:py-0">
                          رقم الهوية الوطنية
                        </th>
                        {roster.subjects.map((sub) => (
                          <th
                            key={sub.id}
                            className="border border-black text-center font-bold px-0.5 py-0.5 print:py-0 print:px-[1px] break-words"
                          >
                            {sub.name}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {pageRows.map((row, idx) => {
                        const slotNumber = pageIdx * ROSTER_PAGE_SIZE + idx + 1;
                        const rowBg = idx % 2 === 0 ? 'bg-white' : 'bg-[#F9FAFB]';

                        if (!row) {
                          return (
                            <tr key={`empty-${slotNumber}`} className={`${rowBg} h-[11.5px] print:h-[10.2px]`}>
                              <td className="border border-black text-center tabular-nums font-semibold px-0.5 py-0">
                                {slotNumber}
                              </td>
                              <td className="border border-black text-center px-1 py-0">&nbsp;</td>
                              <td className="border border-black text-center px-0.5 py-0">&nbsp;</td>
                              {roster.subjects.map((sub) => (
                                <td
                                  key={sub.id}
                                  className="border border-black text-center px-0.5 py-0"
                                >
                                  &nbsp;
                                </td>
                              ))}
                            </tr>
                          );
                        }

                        return (
                          <tr key={row.studentId} className={`${rowBg} h-[11.5px] print:h-[10.2px]`}>
                            <td className="border border-black text-center tabular-nums font-semibold px-0.5 py-0">
                              {slotNumber}
                            </td>
                            <td className="border border-black text-center font-bold text-black px-1 py-0 truncate">
                              {row.fullName}
                            </td>
                            <td className="border border-black text-center font-mono font-semibold tabular-nums px-0.5 py-0">
                              {row.inquiryCode}
                            </td>
                            {roster.subjects.map((sub) => {
                              const cell = row.scoresBySubject[sub.id];
                              const score = cell?.score ?? null;
                              return (
                                <td
                                  key={sub.id}
                                  className="border border-black text-center tabular-nums px-0.5 py-0"
                                >
                                  {score === null ? (
                                    <span className="text-neutral-400 font-normal">&nbsp;</span>
                                  ) : (
                                    <span
                                      className={
                                        score < 50
                                          ? 'font-extrabold text-[#DC2626]'
                                          : 'font-bold text-black'
                                      }
                                    >
                                      {score}
                                    </span>
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>

                  <footer className="pt-0.5 text-center">
                    <PrincipalSignature density="roster" />
                  </footer>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ===================================================================== */}
      {/* MODE B: BULK INDIVIDUAL STUDENT CARDS (1 PAGE PER STUDENT)            */}
      {/* ===================================================================== */}
      {tabMode === 'individual' && (
        <>
          <div className="no-print bg-white border border-slate-200 rounded-xl p-4 sm:p-5 space-y-4">
            <div className="border-b border-slate-100 pb-3">
              <h3 className="font-display text-base font-bold text-[#0B1F3A]">
                طباعة وتصدير بطاقات الدرجات الفردية بشكل جماعي (صفحة لكل طالب)
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                يُنشئ لكل طالب ورقة A4 مستقلة تماماً كما تظهر له عند الاستعلام برقم هويته الوطنية، جاهزة للطباعة المباشرة أو التصدير كملف PDF مجمع.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <label htmlFor="grp-ind-exam" className="block text-xs font-bold text-slate-600 mb-1">
                  نطاق الامتحان
                </label>
                <div className="relative">
                  <select
                    id="grp-ind-exam"
                    value={indExamId}
                    onChange={(e) => setIndExamId(e.target.value)}
                    className="w-full appearance-none pr-3 pl-8 py-2 text-sm rounded-lg border border-slate-300 bg-white cursor-pointer"
                  >
                    <option value="all">عرض كل النتائج (البطاقة الشاملة A4 بالعرض)</option>
                    {exams.map((ex) => (
                      <option key={ex.id} value={ex.id}>
                        {ex.name} (ورقة A4 بالطول)
                      </option>
                    ))}
                  </select>
                  <ChevronDown aria-hidden="true" className="w-4 h-4 text-slate-500 pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2" />
                </div>
              </div>

              <div>
                <label htmlFor="grp-ind-class" className="block text-xs font-bold text-slate-600 mb-1">
                  الصف الدراسي
                </label>
                <div className="relative">
                  <select
                    id="grp-ind-class"
                    value={indClassId}
                    onChange={(e) => {
                      setIndClassId(e.target.value);
                      setIndSectionId('all');
                    }}
                    className="w-full appearance-none pr-3 pl-8 py-2 text-sm rounded-lg border border-slate-300 bg-white cursor-pointer"
                  >
                    {classes.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <ChevronDown aria-hidden="true" className="w-4 h-4 text-slate-500 pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2" />
                </div>
              </div>

              <div>
                <label htmlFor="grp-ind-section" className="block text-xs font-bold text-slate-600 mb-1">
                  الشعبة
                </label>
                <div className="relative">
                  <select
                    id="grp-ind-section"
                    value={indSectionId}
                    onChange={(e) => setIndSectionId(e.target.value)}
                    className="w-full appearance-none pr-3 pl-8 py-2 text-sm rounded-lg border border-slate-300 bg-white cursor-pointer"
                  >
                    <option value="all">جميع الشعب</option>
                    {indClassSections.map((sec) => (
                      <option key={sec.id} value={sec.id}>
                        شعبة {sec.name}
                      </option>
                    ))}
                  </select>
                  <ChevronDown aria-hidden="true" className="w-4 h-4 text-slate-500 pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2" />
                </div>
              </div>

              <div>
                <label htmlFor="grp-ind-scope" className="block text-xs font-bold text-slate-600 mb-1">
                  نطاق الدرجات
                </label>
                <div className="relative">
                  <select
                    id="grp-ind-scope"
                    value={indOnlyPublished ? 'published' : 'all'}
                    onChange={(e) => setIndOnlyPublished(e.target.value === 'published')}
                    className="w-full appearance-none pr-3 pl-8 py-2 text-sm rounded-lg border border-slate-300 bg-white cursor-pointer"
                  >
                    <option value="all">جميع الدرجات المرصودة (مع المسودات)</option>
                    <option value="published">الدرجات المنشورة والمعتمدة فقط</option>
                  </select>
                  <ChevronDown aria-hidden="true" className="w-4 h-4 text-slate-500 pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2" />
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100">
              <div className="text-xs text-slate-600 tabular-nums">
                عدد البطاقات الجاهزة:{' '}
                <strong className="text-[#0B1F3A]">{activeIndividualCount}</strong> بطاقة طالب (صفحة مستقلة لكل طالب)
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <ActionMenu
                  label={
                    indExportingPdf
                      ? 'جاري تجميع PDF...'
                      : indExportingPng
                        ? 'جاري حفظ الصور...'
                        : 'أوامر الطباعة والتصدير الجماعي'
                  }
                  icon={Printer}
                  variant="navy"
                  disabled={indExportingPdf || indExportingPng}
                  items={[
                    {
                      id: 'bulk-print',
                      label: 'طباعة جميع البطاقات (صفحة لكل طالب A4)',
                      description: 'طباعة متتابعة عبر الطابعة أو حفظ كـ PDF من المتصفح',
                      icon: Printer,
                      disabled: activeIndividualCount === 0,
                      tone: 'primary',
                      onClick: () => window.print(),
                    },
                    {
                      id: 'bulk-pdf',
                      label: 'تصدير PDF مجمع لكل الطلبة',
                      description: 'ملف PDF واحد مرتب صفحة لكل طالب',
                      icon: FileText,
                      disabled: activeIndividualCount === 0,
                      onClick: () => void handleDownloadIndividualCardsPdf(),
                    },
                    {
                      id: 'bulk-png',
                      label: 'حفظ جميع البطاقات كصور (PNG)',
                      description: 'تنزيل كل بطاقة طالب بصورة مستقلة',
                      icon: ImageDown,
                      disabled: activeIndividualCount === 0,
                      tone: 'emerald',
                      onClick: () => void handleDownloadAllCardsPng(),
                    },
                    {
                      id: 'bulk-refresh',
                      label: 'تحديث البطاقات',
                      icon: RefreshCw,
                      dividerBefore: true,
                      onClick: () => void loadIndividualCards(),
                    },
                  ]}
                />
              </div>
            </div>
          </div>

          {indError && (
            <div role="alert" className="no-print p-3.5 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm">
              {indError}
            </div>
          )}

          {indLoading ? (
            <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-500">
              جاري تجهيز بطاقات الطلبة الفردية...
            </div>
          ) : activeIndividualCount === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-500">
              لا توجد درجات مسجلة ضمن هذا النطاق لعرض بطاقات فردية.
            </div>
          ) : (
            <div className="print-sheet-wrapper overflow-x-auto pb-4 space-y-8 print:space-y-0">
              {indCardsMode === 'all'
                ? indAllCards.map((card, idx) => (
                    <div
                      key={card.student.inquiryCode}
                      ref={(el) => {
                        cardRefs.current[idx] = el;
                      }}
                      className={
                        idx < indAllCards.length - 1
                          ? 'print-page-break print:break-after-page space-y-2 print:space-y-0'
                          : 'space-y-2 print:space-y-0'
                      }
                    >
                      <div className="no-print flex items-center justify-end">
                        <button
                          type="button"
                          disabled={indExportingPng}
                          onClick={() => void handleDownloadSingleCardPng(idx, card.student.fullName)}
                          className="inline-flex items-center gap-1.5 px-3 py-1 bg-white hover:bg-slate-100 text-[#0B1F3A] border border-slate-300 rounded-md text-xs font-bold cursor-pointer disabled:opacity-50"
                        >
                          <ImageDown className="w-3.5 h-3.5 text-[#1E4E8C]" />
                          <span>حفظ بطاقة {card.student.fullName} كصورة</span>
                        </button>
                      </div>
                      <AllResultsReportSheet allReport={card} />
                    </div>
                  ))
                : indSingleCards.map((card, idx) => (
                    <div
                      key={card.student.inquiryCode}
                      ref={(el) => {
                        cardRefs.current[idx] = el;
                      }}
                      className={
                        idx < indSingleCards.length - 1
                          ? 'print-page-break print:break-after-page space-y-2 print:space-y-0'
                          : 'space-y-2 print:space-y-0'
                      }
                    >
                      <div className="no-print flex items-center justify-end">
                        <button
                          type="button"
                          disabled={indExportingPng}
                          onClick={() => void handleDownloadSingleCardPng(idx, card.student.fullName)}
                          className="inline-flex items-center gap-1.5 px-3 py-1 bg-white hover:bg-slate-100 text-[#0B1F3A] border border-slate-300 rounded-md text-xs font-bold cursor-pointer disabled:opacity-50"
                        >
                          <ImageDown className="w-3.5 h-3.5 text-[#1E4E8C]" />
                          <span>حفظ بطاقة {card.student.fullName} كصورة</span>
                        </button>
                      </div>
                      <SingleReportSheet report={card} />
                    </div>
                  ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
