import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  CheckCircle2,
  Download,
  Eye,
  EyeOff,
  FileSpreadsheet,
  FileText,
  Pencil,
  Plus,
  Search,
  Trash2,
  Upload,
  UserCheck,
  UserX,
  X,
} from 'lucide-react';
import { apiDownload, apiFetch } from '../../lib/api.ts';
import { getClassColorTheme } from '../../lib/classColors.ts';
import { sortStudentsAlphabetically } from '../../lib/gradeRules.ts';
import { parseSpreadsheetBuffer } from '../../lib/spreadsheet.ts';
import { useUndo } from '../../lib/undoManager.tsx';
import {
  GRADE_STATUS_LABELS,
  type AllPublishedReportCard,
  type Exam,
  type GradeStatus,
  type ImportPreviewResponse,
  type PublicReportCard,
  type SchoolClass,
  type Section,
  type Student,
} from '../../types/school.ts';
import { AllResultsReportCard, ReportCard } from '../ReportCard.tsx';
import { ActionMenu } from '../ui/ActionMenu.tsx';

interface StudentsTabProps {
  students: Student[];
  classes: SchoolClass[];
  sections: Section[];
  exams: Exam[];
  selectedYearId?: number | null;
  canManage: boolean;
  onChanged: () => void;
}

export function StudentsTab({
  students,
  classes,
  sections,
  exams,
  selectedYearId = null,
  canManage,
  onChanged,
}: StudentsTabProps) {
  const { pushUndo } = useUndo();

  const [query, setQuery] = useState('');
  const [filterClassId, setFilterClassId] = useState<string>('');
  const [filterSectionId, setFilterSectionId] = useState<string>('');
  const [showStudentsList, setShowStudentsList] = useState<boolean>(true);
  const [showImportPanel, setShowImportPanel] = useState<boolean>(false);

  const [exporting, setExporting] = useState(false);
  const [downloadingTpl, setDownloadingTpl] = useState(false);
  const [editing, setEditing] = useState<Student | null>(null);
  const [creating, setCreating] = useState(false);

  const [fullName, setFullName] = useState('');
  const [inquiryCode, setInquiryCode] = useState('');
  const [classId, setClassId] = useState<string>(classes[0] ? String(classes[0].id) : '');
  const [sectionId, setSectionId] = useState<string>('');
  const [isActive, setIsActive] = useState(true);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Merged Student Excel Import state (students only)
  const [importDefaultClassId, setImportDefaultClassId] = useState<string>(
    classes[0] ? String(classes[0].id) : ''
  );
  const [importDefaultSectionId, setImportDefaultSectionId] = useState<string>('');
  const [allowUpdateExisting, setAllowUpdateExisting] = useState<boolean>(false);
  const [rawRows, setRawRows] = useState<Record<string, string>[]>([]);
  const [preview, setPreview] = useState<ImportPreviewResponse<any> | null>(null);
  const [importBusy, setImportBusy] = useState(false);

  // Academic view & report card preview
  const [academicStudent, setAcademicStudent] = useState<Student | null>(null);
  const [academicRows, setAcademicRows] = useState<
    Array<{
      id: number;
      examId: number;
      examName: string;
      subjectName: string;
      maxScore: number;
      score: number | null;
      status: GradeStatus;
      updatedAt: string;
    }>
  >([]);
  const [previewReport, setPreviewReport] = useState<PublicReportCard | null>(null);
  const [previewAllReport, setPreviewAllReport] = useState<AllPublishedReportCard | null>(null);

  useEffect(() => {
    if (!importDefaultClassId && classes[0]) setImportDefaultClassId(String(classes[0].id));
  }, [classes, importDefaultClassId]);

  const availableSectionsForForm = useMemo(
    () => sections.filter((s) => s.classId === Number(classId)),
    [sections, classId]
  );

  const importDefaultSections = useMemo(
    () => sections.filter((s) => s.classId === Number(importDefaultClassId)),
    [sections, importDefaultClassId]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = students.filter((st) => {
      if (filterClassId && st.classId !== Number(filterClassId)) return false;
      if (filterSectionId && st.sectionId !== Number(filterSectionId)) return false;
      if (q && !st.fullName.toLowerCase().includes(q) && !st.inquiryCode.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
    return sortStudentsAlphabetically(matched);
  }, [students, query, filterClassId, filterSectionId]);

  const openCreate = () => {
    const defaultCls = classes[0]?.id ?? '';
    const defaultSec = sections.find((s) => s.classId === Number(defaultCls))?.id ?? '';
    setEditing(null);
    setCreating(true);
    setFullName('');
    setInquiryCode('');
    setClassId(String(defaultCls));
    setSectionId(String(defaultSec));
    setIsActive(true);
    setNotes('');
    setError(null);
  };

  const openEdit = (st: Student) => {
    setCreating(false);
    setEditing(st);
    setFullName(st.fullName);
    setInquiryCode(st.inquiryCode);
    setClassId(String(st.classId));
    setSectionId(String(st.sectionId));
    setIsActive(st.isActive);
    setNotes(st.notes);
    setError(null);
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setSaving(true);
    try {
      const prevStudent = editing;
      const payload = {
        fullName: fullName.trim(),
        inquiryCode: inquiryCode.trim(),
        classId: Number(classId),
        sectionId: Number(sectionId || availableSectionsForForm[0]?.id),
        isActive,
        notes: notes.trim(),
        ...(selectedYearId ? { yearId: selectedYearId } : {}),
      };
      if (editing) {
        await apiFetch(`/api/admin/students/${editing.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        if (prevStudent) {
          pushUndo(
            `التراجع عن تعديل بيانات الطالب: ${prevStudent.fullName}`,
            async () => {
              await apiFetch(`/api/admin/students/${prevStudent.id}`, {
                method: 'PUT',
                body: JSON.stringify({
                  fullName: prevStudent.fullName,
                  inquiryCode: prevStudent.inquiryCode,
                  classId: prevStudent.classId,
                  sectionId: prevStudent.sectionId,
                  isActive: prevStudent.isActive,
                  notes: prevStudent.notes,
                }),
              });
              onChanged();
            }
          );
        }
        setNotice(`تم تحديث بيانات الطالب (${payload.fullName}) بنجاح.`);
      } else {
        await apiFetch('/api/admin/students', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setNotice(`تمت إضافة الطالب (${payload.fullName}) بنجاح.`);
      }
      setEditing(null);
      setCreating(false);
      onChanged();
    } catch (err: any) {
      setError(err?.message || 'تعذر حفظ بيانات الطالب.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (st: Student) => {
    setError(null);
    setNotice(null);
    try {
      await apiFetch(`/api/admin/students/${st.id}`, { method: 'DELETE' });
      setNotice(`تم حذف سجل الطالب (${st.fullName}).`);
      onChanged();
    } catch (err: any) {
      setError(err?.message || 'تعذر حذف الطالب.');
    }
  };

  const handleToggleActive = async (st: Student) => {
    setError(null);
    setNotice(null);
    const prevActive = st.isActive;
    try {
      await apiFetch(`/api/admin/students/${st.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          fullName: st.fullName,
          inquiryCode: st.inquiryCode,
          classId: st.classId,
          sectionId: st.sectionId,
          isActive: !prevActive,
          notes: st.notes,
        }),
      });
      pushUndo(
        `التراجع عن تغيير حالة الطالب: ${st.fullName}`,
        async () => {
          await apiFetch(`/api/admin/students/${st.id}`, {
            method: 'PUT',
            body: JSON.stringify({
              fullName: st.fullName,
              inquiryCode: st.inquiryCode,
              classId: st.classId,
              sectionId: st.sectionId,
              isActive: prevActive,
              notes: st.notes,
            }),
          });
          onChanged();
        }
      );
      onChanged();
    } catch (err: any) {
      setError(err?.message || 'تعذر تحديث حالة الطالب.');
    }
  };

  const handleExportExcel = async () => {
    setError(null);
    setExporting(true);
    try {
      const qs = new URLSearchParams({
        ...(selectedYearId ? { yearId: String(selectedYearId) } : {}),
        ...(filterClassId ? { classId: filterClassId } : {}),
        ...(filterSectionId ? { sectionId: filterSectionId } : {}),
      }).toString();
      await apiDownload(`/api/admin/export/students.xlsx?${qs}`, 'students_export.xlsx');
    } catch (err: any) {
      setError(err?.message || 'تعذر تصدير قائمة الطلاب.');
    } finally {
      setExporting(false);
    }
  };

  const handleDownloadStudentTemplate = async () => {
    setError(null);
    setDownloadingTpl(true);
    try {
      const qs = new URLSearchParams({
        ...(selectedYearId ? { yearId: String(selectedYearId) } : {}),
        ...(filterClassId ? { classId: filterClassId } : {}),
        ...(filterSectionId ? { sectionId: filterSectionId } : {}),
      }).toString();
      await apiDownload(
        `/api/admin/export/template/students${qs ? `?${qs}` : ''}`,
        'قالب_استيراد_الطلبة.xlsx'
      );
    } catch (err: any) {
      setError(err?.message || 'تعذر تنزيل قالب الطلبة.');
    } finally {
      setDownloadingTpl(false);
    }
  };

  const runImportPreview = async (rowsToPreview: Record<string, string>[]) => {
    const res = await apiFetch<ImportPreviewResponse<any>>('/api/admin/import/preview', {
      method: 'POST',
      body: JSON.stringify({
        type: 'students',
        rows: rowsToPreview,
        ...(selectedYearId ? { yearId: selectedYearId } : {}),
        options: {
          defaultClassId: importDefaultClassId ? Number(importDefaultClassId) : null,
          defaultSectionId: importDefaultSectionId ? Number(importDefaultSectionId) : null,
          allowUpdateExisting,
          ...(selectedYearId ? { yearId: selectedYearId } : {}),
        },
      }),
    });
    setPreview(res);
  };

  useEffect(() => {
    if (rawRows.length > 0) {
      runImportPreview(rawRows).catch(() => {});
    }
  }, [importDefaultClassId, importDefaultSectionId, allowUpdateExisting]);

  const handleStudentExcelUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setNotice(null);
    setPreview(null);
    setImportBusy(true);
    try {
      const buffer = await file.arrayBuffer();
      const normalized = parseSpreadsheetBuffer(buffer, file.name);
      setRawRows(normalized);
      await runImportPreview(normalized);
    } catch (err: any) {
      setError(err?.message || 'تعذر قراءة ملف Excel / CSV.');
    } finally {
      setImportBusy(false);
      e.target.value = '';
    }
  };

  const handleCommitStudentImport = async () => {
    if (rawRows.length === 0) return;
    setImportBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await apiFetch<{ importedCount: number; rejectedCount: number }>(
        '/api/admin/import/commit',
        {
          method: 'POST',
          body: JSON.stringify({
            type: 'students',
            rows: rawRows,
            ...(selectedYearId ? { yearId: selectedYearId } : {}),
            options: {
              defaultClassId: importDefaultClassId ? Number(importDefaultClassId) : null,
              defaultSectionId: importDefaultSectionId ? Number(importDefaultSectionId) : null,
              allowUpdateExisting,
              ...(selectedYearId ? { yearId: selectedYearId } : {}),
            },
          }),
        }
      );
      setNotice(
        `تم استيراد ${res.importedCount} طالب بنجاح${res.rejectedCount > 0 ? ` (مرفوض: ${res.rejectedCount})` : ''}.`
      );
      setRawRows([]);
      setPreview(null);
      onChanged();
    } catch (err: any) {
      setError(err?.message || 'تعذر تنفيذ استيراد الطلبة.');
    } finally {
      setImportBusy(false);
    }
  };

  const openAcademic = async (st: Student) => {
    setAcademicStudent(st);
    setPreviewReport(null);
    setPreviewAllReport(null);
    try {
      const data = await apiFetch<{ grades: any[] }>(`/api/admin/students/${st.id}/academic`);
      setAcademicRows(data.grades);
    } catch {
      setAcademicRows([]);
    }
  };

  const loadReportPreview = async (studentId: number, examId: number | 'all') => {
    setError(null);
    setPreviewReport(null);
    setPreviewAllReport(null);
    try {
      const yearQs = selectedYearId ? `&yearId=${selectedYearId}` : '';
      const data = await apiFetch<{
        mode: 'all' | 'single';
        report?: PublicReportCard;
        allReport?: AllPublishedReportCard;
      }>(`/api/admin/report-card?studentId=${studentId}&examId=${examId}&includeDrafts=true${yearQs}`);
      if (data.mode === 'all' && data.allReport) {
        setPreviewAllReport(data.allReport);
      } else if (data.report) {
        setPreviewReport(data.report);
      }
    } catch (err: any) {
      setError(err?.message || 'لا توجد درجات مسجلة لهذا الامتحان.');
    }
  };

  return (
    <div className="space-y-4 print:space-y-0">
      {/* Toolbar */}
      <div className="no-print bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5 flex-1 min-w-[260px]">
          <div className="relative flex-1 min-w-[200px] max-w-xs">
            <Search className="w-4 h-4 text-slate-400 absolute right-3 top-3.5" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="بحث بالاسم أو رقم الهوية الوطنية..."
              className="min-h-[44px] w-full pr-9 pl-3 py-2 text-sm rounded-lg border border-slate-300 focus:border-[#1E4E8C] focus:outline-none"
            />
          </div>

          <select
            aria-label="تصفية حسب الصف"
            value={filterClassId}
            onChange={(e) => {
              setFilterClassId(e.target.value);
              setFilterSectionId('');
            }}
            className="min-h-[44px] px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white"
          >
            <option value="">كل الصفوف</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          <select
            aria-label="تصفية حسب الشعبة"
            value={filterSectionId}
            onChange={(e) => setFilterSectionId(e.target.value)}
            className="min-h-[44px] px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white"
          >
            <option value="">كل الشعب</option>
            {sections
              .filter((s) => !filterClassId || s.classId === Number(filterClassId))
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.className} — {s.name}
                </option>
              ))}
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <ActionMenu
            label={
              exporting
                ? 'جاري تصدير Excel...'
                : downloadingTpl
                  ? 'جاري تنزيل القالب...'
                  : 'أوامر الطلبة والتصدير'
            }
            icon={FileSpreadsheet}
            variant="navy"
            disabled={exporting || downloadingTpl}
            items={[
              ...(canManage
                ? [
                    {
                      id: 'st-create',
                      label: 'إضافة طالب جديد',
                      description: 'تسجيل طالب منفرد وتحديد الصف والشعبة',
                      icon: Plus,
                      tone: 'primary' as const,
                      onClick: openCreate,
                    },
                    {
                      id: 'st-import-toggle',
                      label: showImportPanel
                        ? 'إغلاق لوحة استيراد Excel'
                        : 'استيراد الطلبة من Excel',
                      description: 'رفع ملف Excel / CSV لمعاينة واعتماد الطلبة دفعة واحدة',
                      icon: Upload,
                      onClick: () => setShowImportPanel((v) => !v),
                    },
                    {
                      id: 'st-template',
                      label: 'تنزيل قالب الطلبة (Excel)',
                      description: 'قالب منسق للصف والشعبة المختارة',
                      icon: Download,
                      onClick: () => void handleDownloadStudentTemplate(),
                    },
                  ]
                : []),
              {
                id: 'st-export',
                label: 'تصدير قائمة الطلبة (Excel)',
                description: 'تصدير بيانات الطلبة المطابقين للتصفية الحالية',
                icon: FileSpreadsheet,
                tone: 'emerald',
                dividerBefore: canManage,
                onClick: () => void handleExportExcel(),
              },
              {
                id: 'st-toggle-list',
                label: showStudentsList
                  ? `إخفاء جدول الطلبة (${filtered.length})`
                  : `عرض جدول الطلبة (${filtered.length})`,
                icon: showStudentsList ? EyeOff : Eye,
                dividerBefore: true,
                onClick: () => setShowStudentsList((v) => !v),
              },
            ]}
          />
        </div>
      </div>

      {/* Color legend for quick visual differentiation of classes */}
      {classes.length > 0 && (
        <div className="no-print flex flex-wrap items-center gap-2 text-[11px] font-bold">
          <span className="text-slate-500">تمييز الصفوف (أ → ي):</span>
          {classes.map((c) => {
            const theme = getClassColorTheme(c.name);
            const cnt = students.filter((s) => s.classId === c.id).length;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  setFilterClassId(filterClassId === String(c.id) ? '' : String(c.id));
                  setFilterSectionId('');
                }}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border cursor-pointer transition-colors ${theme.badgeBg} ${theme.badgeText} ${theme.badgeBorder} ${
                  filterClassId === String(c.id) ? 'ring-2 ring-[#0B1F3A]/40' : ''
                }`}
              >
                <span>{c.name}</span>
                <span className="tabular-nums opacity-80">({cnt})</span>
              </button>
            );
          })}
        </div>
      )}

      {notice && (
        <div role="status" className="no-print flex items-center gap-2 p-3.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-900 text-sm">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      {error && (
        <div role="alert" className="no-print p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm">
          {error}
        </div>
      )}

      {/* Merged Student-Only Excel Import & Template Section */}
      {canManage && showImportPanel && (
        <section className="no-print bg-white border border-[#1E4E8C]/30 rounded-xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
            <div>
              <h3 className="font-display text-base font-bold text-[#0B1F3A]">
                استيراد وتصدير قوائم الطلبة (Excel / CSV)
              </h3>
              <p className="text-xs text-slate-600 mt-0.5">
                نزّل قالب الطلبة الرسمي ثم ارفع ملف Excel ليتم فحصه قبل الاعتماد (مخصص لبيانات الطلبة فقط).
              </p>
            </div>
            <button
              type="button"
              disabled={downloadingTpl}
              onClick={handleDownloadStudentTemplate}
              className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-[#0B1F3A] border border-slate-300 text-xs font-bold rounded-lg cursor-pointer disabled:opacity-50"
            >
              <Download className="w-4 h-4 text-[#1E4E8C]" />
              <span>{downloadingTpl ? 'جاري التنزيل...' : 'تنزيل قالب الطلبة (Excel)'}</span>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1">
                الصف الافتراضي (إذا خلا في الملف)
              </label>
              <select
                value={importDefaultClassId}
                onChange={(e) => {
                  setImportDefaultClassId(e.target.value);
                  setImportDefaultSectionId('');
                }}
                className="min-h-[44px] w-full px-3 py-2 text-xs font-semibold rounded-lg border border-slate-300 bg-white"
              >
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1">
                الشعبة الافتراضية
              </label>
              <select
                value={importDefaultSectionId}
                onChange={(e) => setImportDefaultSectionId(e.target.value)}
                className="min-h-[44px] w-full px-3 py-2 text-xs font-semibold rounded-lg border border-slate-300 bg-white"
              >
                <option value="">تلقائي من الملف أو أول شعبة</option>
                {importDefaultSections.map((s) => (
                  <option key={s.id} value={s.id}>
                    شعبة {s.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={allowUpdateExisting}
                  onChange={(e) => setAllowUpdateExisting(e.target.checked)}
                />
                <span>تحديث الطلبة الموجودين</span>
              </label>
              <label className="min-h-[44px] inline-flex items-center gap-2 px-4 py-2 bg-[#0B1F3A] hover:bg-[#1E4E8C] text-white text-xs font-bold rounded-lg cursor-pointer">
                <Upload className="w-4 h-4 text-[#C59B27]" />
                <span>{importBusy ? 'جاري الفحص...' : 'رفع ملف الطلبة'}</span>
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleStudentExcelUpload}
                  className="sr-only"
                />
              </label>
            </div>
          </div>

          {preview && (
            <div className="space-y-3 pt-2 border-t border-slate-100">
              <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50 border border-slate-200 rounded-lg px-4 py-2.5 text-xs">
                <div className="flex items-center gap-4 tabular-nums">
                  <span>
                    الإجمالي: <strong>{preview.totalRows}</strong>
                  </span>
                  <span className="text-emerald-700">
                    صالح: <strong>{preview.validCount}</strong>
                  </span>
                  <span className="text-red-700">
                    مرفوض: <strong>{preview.invalidCount}</strong>
                  </span>
                </div>
                {preview.validCount > 0 && (
                  <button
                    type="button"
                    disabled={importBusy}
                    onClick={handleCommitStudentImport}
                    className="min-h-[40px] px-4 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold rounded-lg cursor-pointer disabled:opacity-50"
                  >
                    اعتماد واستيراد الطلبة الصالحين ({preview.validCount})
                  </button>
                )}
              </div>

              <div className="max-h-60 overflow-auto border border-slate-200 rounded-lg">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 font-bold text-slate-600">
                      <th className="px-2.5 py-2 text-right">الصف</th>
                      <th className="px-2.5 py-2 text-right">الحالة</th>
                      <th className="px-2.5 py-2 text-right">اسم الطالب</th>
                      <th className="px-2.5 py-2 text-right">رقم الهوية</th>
                      <th className="px-2.5 py-2 text-right">السبب</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {preview.rows.map((r) => (
                      <tr key={r.rowNumber} className={r.valid ? 'bg-white' : 'bg-red-50/50'}>
                        <td className="px-2.5 py-1.5 font-mono tabular-nums">{r.rowNumber}</td>
                        <td className="px-2.5 py-1.5 font-bold">
                          <span className={r.valid ? 'text-emerald-700' : 'text-red-700'}>
                            {r.valid ? 'صالح' : 'مرفوض'}
                          </span>
                        </td>
                        <td className="px-2.5 py-1.5 font-bold text-[#0B1F3A]">
                          {r.normalized?.fullName || r.raw['اسم الطالب'] || '—'}
                        </td>
                        <td className="px-2.5 py-1.5 font-mono text-[#1E4E8C] tabular-nums">
                          {r.normalized?.inquiryCode || r.raw['رقم الهوية الوطنية'] || '—'}
                        </td>
                        <td className="px-2.5 py-1.5 text-red-700">{r.errors.join(' | ') || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      )}

      {/* Add / Edit Student Form */}
      {(creating || editing) && (
        <form
          onSubmit={handleSave}
          className="no-print bg-white border border-[#1E4E8C]/40 rounded-xl p-5 space-y-4 shadow-xs"
        >
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h3 className="font-display text-base font-bold text-[#0B1F3A]">
              {editing ? `تعديل بيانات: ${editing.fullName}` : 'تسجيل طالب جديد'}
            </h3>
            <button
              type="button"
              aria-label="إغلاق النموذج"
              onClick={() => {
                setCreating(false);
                setEditing(null);
              }}
              className="text-slate-500 hover:text-slate-800 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">الاسم الكامل</label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                className="min-h-[44px] w-full px-3 py-2 text-sm rounded-lg border border-slate-300"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">رقم الهوية الوطنية</label>
              <input
                type="text"
                value={inquiryCode}
                onChange={(e) => setInquiryCode(e.target.value)}
                required
                className="min-h-[44px] w-full px-3 py-2 text-sm rounded-lg border border-slate-300 font-mono tabular-nums"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">الصف الدراسي</label>
              <select
                value={classId}
                onChange={(e) => {
                  const nextCid = e.target.value;
                  setClassId(nextCid);
                  const firstSec = sections.find((s) => s.classId === Number(nextCid));
                  setSectionId(firstSec ? String(firstSec.id) : '');
                }}
                className="min-h-[44px] w-full px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white"
              >
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">الشعبة</label>
              <select
                value={
                  sectionId || (availableSectionsForForm[0]?.id ? String(availableSectionsForForm[0].id) : '')
                }
                onChange={(e) => setSectionId(e.target.value)}
                className="min-h-[44px] w-full px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white"
              >
                {availableSectionsForForm.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
            <label className="inline-flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="rounded border-slate-300"
              />
              <span>حساب الطالب نشط ومسموح له بالاستعلام</span>
            </label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setCreating(false);
                  setEditing(null);
                }}
                className="min-h-[44px] px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="submit"
                disabled={saving}
                className="min-h-[44px] px-5 py-2 text-sm font-bold text-white bg-[#0B1F3A] hover:bg-[#1E4E8C] rounded-lg cursor-pointer disabled:opacity-60"
              >
                {saving ? 'جاري الحفظ...' : 'حفظ البيانات'}
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Students Table — Compact Full View Sorted أ → ي */}
      {!showStudentsList ? (
        <div className="no-print bg-white border border-slate-200 rounded-xl p-6 text-center space-y-3">
          <p className="text-sm font-bold text-[#0B1F3A]">
            تم إخفاء جدول الطلبة مؤقتاً (إجمالي المطابقين: {filtered.length} طالب — مرتبون أبجدياً من أ إلى ي)
          </p>
          <button
            type="button"
            onClick={() => setShowStudentsList(true)}
            className="min-h-[44px] inline-flex items-center gap-2 px-4 py-2 bg-[#0B1F3A] hover:bg-[#1E4E8C] text-white text-xs font-bold rounded-lg cursor-pointer"
          >
            <Eye className="w-4 h-4 text-[#C59B27]" />
            <span>عرض قائمة الطلاب كاملة</span>
          </button>
        </div>
      ) : (
        <div className="no-print bg-white border border-slate-200 rounded-xl overflow-hidden">
          {filtered.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">
              لا يوجد طلاب مطابقون لمعايير البحث الحالية.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold text-slate-600">
                    <th className="px-2.5 py-2 text-center w-10">ت</th>
                    <th className="px-3 py-2 text-right">اسم الطالب (ترتيب أ ← ي)</th>
                    <th className="px-2.5 py-2 text-center">رقم الهوية الوطنية</th>
                    <th className="px-2.5 py-2 text-right">الصف والشعبة</th>
                    <th className="px-2.5 py-2 text-center">الحالة</th>
                    <th className="px-2.5 py-2 text-left">الإجراءات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200/70">
                  {filtered.map((st, idx) => {
                    const theme = getClassColorTheme(st.className || '');
                    return (
                      <tr key={st.id} className={`${theme.rowBg} ${theme.rowHoverBg} transition-colors`}>
                        <td className="px-2.5 py-1.5 text-center tabular-nums text-[11px] text-slate-500 font-semibold">
                          {idx + 1}
                        </td>
                        <td className="px-3 py-1.5 font-bold text-[#0B1F3A] whitespace-nowrap">
                          {st.fullName}
                        </td>
                        <td className="px-2.5 py-1.5 text-center font-mono text-[11px] font-semibold text-[#1E4E8C] tabular-nums">
                          {st.inquiryCode}
                        </td>
                        <td className="px-2.5 py-1.5 whitespace-nowrap">
                          <span
                            className={`inline-block px-2 py-0.5 rounded border text-[11px] font-bold ${theme.badgeBg} ${theme.badgeText} ${theme.badgeBorder}`}
                          >
                            {st.className} · شعبة {st.sectionName}
                          </span>
                        </td>
                        <td className="px-2.5 py-1.5 text-center text-[11px] font-bold">
                          <span className={st.isActive ? 'text-emerald-700' : 'text-slate-400'}>
                            {st.isActive ? 'نشط' : 'معطل'}
                          </span>
                        </td>
                        <td className="px-2.5 py-1.5 text-left">
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => openAcademic(st)}
                              title={`عرض الملف الأكاديمي للطالب ${st.fullName}`}
                              aria-label={`عرض الملف الأكاديمي للطالب ${st.fullName}`}
                              className="p-1.5 text-slate-600 hover:text-[#1E4E8C] hover:bg-white/80 rounded-md cursor-pointer"
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </button>
                            {canManage && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleToggleActive(st)}
                                  title={st.isActive ? `تعطيل ${st.fullName}` : `تنشيط ${st.fullName}`}
                                  aria-label={st.isActive ? `تعطيل ${st.fullName}` : `تنشيط ${st.fullName}`}
                                  className="p-1.5 text-slate-600 hover:text-[#1E4E8C] hover:bg-white/80 rounded-md cursor-pointer"
                                >
                                  {st.isActive ? (
                                    <UserX className="w-3.5 h-3.5 text-amber-700" />
                                  ) : (
                                    <UserCheck className="w-3.5 h-3.5 text-emerald-700" />
                                  )}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => openEdit(st)}
                                  title={`تعديل ${st.fullName}`}
                                  aria-label={`تعديل ${st.fullName}`}
                                  className="p-1.5 text-slate-600 hover:text-[#0B1F3A] hover:bg-white/80 rounded-md cursor-pointer"
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDelete(st)}
                                  title={`حذف ${st.fullName}`}
                                  aria-label={`حذف ${st.fullName}`}
                                  className="p-1.5 text-red-600 hover:bg-red-50 rounded-md cursor-pointer"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Academic Record & Individual PDF Preview */}
      {academicStudent && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4 print:border-none print:rounded-none print:p-0 print:space-y-0">
          <div className="no-print flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
            <div>
              <h3 className="font-display text-base font-bold text-[#0B1F3A]">
                السجل الأكاديمي: {academicStudent.fullName}
              </h3>
              <p className="text-xs text-slate-500">
                {academicStudent.className} · شعبة {academicStudent.sectionName} · رقم الهوية الوطنية{' '}
                <span className="font-mono">{academicStudent.inquiryCode}</span>
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <ActionMenu
                label="عرض كشف أو بطاقة (A4)"
                icon={FileText}
                variant="navy"
                items={[
                  {
                    id: 'card-all',
                    label: 'البطاقة الشاملة (كل الامتحانات A4 بالعرض)',
                    description: 'النموذج العراقي الكامل مع السعي والامتحان النهائي',
                    icon: FileText,
                    tone: 'primary',
                    onClick: () => void loadReportPreview(academicStudent.id, 'all'),
                  },
                  ...exams.map((ex, idx) => ({
                    id: `card-exam-${ex.id}`,
                    label: `كشف: ${ex.name} (A4 بالطول)`,
                    icon: FileText,
                    dividerBefore: idx === 0,
                    onClick: () => void loadReportPreview(academicStudent.id, ex.id),
                  })),
                ]}
              />
              <button
                type="button"
                onClick={() => {
                  setAcademicStudent(null);
                  setPreviewReport(null);
                  setPreviewAllReport(null);
                }}
                className="p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg cursor-pointer"
                aria-label="إغلاق السجل الأكاديمي"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {academicRows.length === 0 ? (
            <p className="no-print text-sm text-slate-500">لا توجد درجات مسجلة لهذا الطالب بعد.</p>
          ) : (
            <div className="no-print overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 font-bold text-slate-600">
                    <th className="px-3 py-2 text-right">الامتحان</th>
                    <th className="px-3 py-2 text-right">المادة</th>
                    <th className="px-3 py-2 text-center">الدرجة</th>
                    <th className="px-3 py-2 text-center">النهاية العظمى</th>
                    <th className="px-3 py-2 text-right">الحالة</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {academicRows.map((r) => (
                    <tr key={r.id}>
                      <td className="px-3 py-2 font-semibold">{r.examName}</td>
                      <td className="px-3 py-2">{r.subjectName}</td>
                      <td className="px-3 py-2 text-center font-bold tabular-nums">{r.score ?? '—'}</td>
                      <td className="px-3 py-2 text-center tabular-nums">{r.maxScore}</td>
                      <td className="px-3 py-2">{GRADE_STATUS_LABELS[r.status]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {previewAllReport && (
            <div className="pt-4 border-t border-slate-200 print:pt-0 print:border-t-0">
              <AllResultsReportCard allReport={previewAllReport} />
            </div>
          )}

          {previewReport && (
            <div className="pt-4 border-t border-slate-200 print:pt-0 print:border-t-0">
              <ReportCard report={previewReport} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
