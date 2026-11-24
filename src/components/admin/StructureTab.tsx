import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  Award,
  Calendar,
  CheckCircle2,
  Plus,
  Trash2,
} from 'lucide-react';
import { apiFetch } from '../../lib/api.ts';
import { getClassColorTheme } from '../../lib/classColors.ts';
import type {
  AcademicYear,
  Exam,
  SchoolClass,
  Section,
  Subject,
} from '../../types/school.ts';

interface StructureTabProps {
  classes: SchoolClass[];
  sections: Section[];
  subjects: Subject[];
  exams: Exam[];
  academicYears?: AcademicYear[];
  selectedYearId?: number | null;
  onSelectYear?: (yearId: number) => void;
  canManage: boolean;
  onChanged: () => void;
}

export function StructureTab({
  classes,
  sections,
  subjects,
  exams,
  academicYears = [],
  selectedYearId = null,
  onSelectYear,
  canManage,
  onChanged,
}: StructureTabProps) {
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Academic year creation & inline rule edits (Grade 6 Qualification + Exemptions thresholds)
  const [newYearName, setNewYearName] = useState('');
  const [cloneFromYearId, setCloneFromYearId] = useState<string>('');
  const [newYearMaxFail, setNewYearMaxFail] = useState('3');
  const [newYearBonus, setNewYearBonus] = useState('10');
  const [newYearExGenAvg, setNewYearExGenAvg] = useState('75');
  const [newYearExMinSubj, setNewYearExMinSubj] = useState('75');
  const [newYearExIndivMin, setNewYearExIndivMin] = useState('90');
  const [newYearSetCurrent, setNewYearSetCurrent] = useState(true);
  const [yearEdits, setYearEdits] = useState<
    Record<
      number,
      {
        maxFail: string;
        bonus: string;
        exGenAvg: string;
        exMinSubj: string;
        exIndivMin: string;
      }
    >
  >({});
  const [busyYear, setBusyYear] = useState(false);
  const [confirmDeleteYearId, setConfirmDeleteYearId] = useState<number | null>(null);
  const [yearAutoSaveState, setYearAutoSaveState] = useState<
    Record<number, 'idle' | 'saving' | 'saved' | 'error'>
  >({});
  const lastSavedYearEditsRef = useRef<Record<number, string>>({});

  // Classes / Sections / Subjects / Exams state
  const [newClassName, setNewClassName] = useState('');
  const [newClassOrder, setNewClassOrder] = useState('1');
  const [secClassId, setSecClassId] = useState<string>(classes[0] ? String(classes[0].id) : '');
  const [newSecName, setNewSecName] = useState('');
  const [subjectClassId, setSubjectClassId] = useState<string>(classes[0] ? String(classes[0].id) : '');
  const [newSubjName, setNewSubjName] = useState('');
  const [newSubjMax, setNewSubjMax] = useState('100');
  const [newSubjOrder, setNewSubjOrder] = useState('1');
  const [newExamName, setNewExamName] = useState('');
  const [newExamOrder, setNewExamOrder] = useState('11');

  useEffect(() => {
    if (!secClassId && classes[0]) setSecClassId(String(classes[0].id));
    if (!subjectClassId && classes[0]) setSubjectClassId(String(classes[0].id));
  }, [classes, secClassId, subjectClassId]);

  useEffect(() => {
    const edits: Record<
      number,
      {
        maxFail: string;
        bonus: string;
        exGenAvg: string;
        exMinSubj: string;
        exIndivMin: string;
      }
    > = {};
    const savedSnaps: Record<number, string> = {};
    for (const yr of academicYears) {
      const val = {
        maxFail: String(yr.grade6MaxFailSubjects ?? 3),
        bonus: String(yr.grade6DecisionBonus ?? 10),
        exGenAvg: String(yr.exemptionGeneralMinAvg ?? 75),
        exMinSubj: String(yr.exemptionMinSubject ?? 75),
        exIndivMin: String(yr.exemptionIndividualMin ?? 90),
      };
      edits[yr.id] = val;
      savedSnaps[yr.id] = JSON.stringify(val);
    }
    lastSavedYearEditsRef.current = savedSnaps;
    setYearEdits(edits);

    if (!cloneFromYearId && (selectedYearId || academicYears[0])) {
      setCloneFromYearId(String(selectedYearId || academicYears[0].id));
    }
  }, [academicYears, selectedYearId, cloneFromYearId]);

  // Debounced auto-save for academic year thresholds (never alters current year flag)
  useEffect(() => {
    if (!canManage || academicYears.length === 0) return;
    const dirtyYears = academicYears.filter((yr) => {
      const cur = yearEdits[yr.id];
      if (!cur) return false;
      const serialized = JSON.stringify(cur);
      return serialized !== lastSavedYearEditsRef.current[yr.id];
    });
    if (dirtyYears.length === 0) return;

    const timer = window.setTimeout(async () => {
      for (const yr of dirtyYears) {
        const ed = yearEdits[yr.id];
        if (!ed) continue;
        setYearAutoSaveState((prev) => ({ ...prev, [yr.id]: 'saving' }));
        try {
          await apiFetch(`/api/admin/academic-years/${yr.id}`, {
            method: 'PUT',
            body: JSON.stringify({
              name: yr.name,
              isCurrent: yr.isCurrent,
              isActive: yr.isActive,
              grade6MaxFailSubjects: Number(ed.maxFail || 3),
              grade6DecisionBonus: Number(ed.bonus || 10),
              exemptionGeneralMinAvg: Number(ed.exGenAvg || 75),
              exemptionMinSubject: Number(ed.exMinSubj || 75),
              exemptionIndividualMin: Number(ed.exIndivMin || 90),
            }),
          });
          lastSavedYearEditsRef.current[yr.id] = JSON.stringify(ed);
          setYearAutoSaveState((prev) => ({ ...prev, [yr.id]: 'saved' }));
          onChanged();
        } catch (err: any) {
          setYearAutoSaveState((prev) => ({ ...prev, [yr.id]: 'error' }));
          setError(err?.message || `تعذر حفظ ضوابط العام (${yr.name}) تلقائياً.`);
        }
      }
    }, 650);

    return () => window.clearTimeout(timer);
  }, [yearEdits, academicYears, canManage, onChanged]);

  const handleAction = async (fn: () => Promise<void>) => {
    setError(null);
    setNotice(null);
    try {
      await fn();
      onChanged();
    } catch (err: any) {
      setError(err?.message || 'تعذر تنفيذ العملية.');
    }
  };

  const handleCreateYear = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusyYear(true);
    try {
      const res = await apiFetch<{ academicYear: AcademicYear }>('/api/admin/academic-years', {
        method: 'POST',
        body: JSON.stringify({
          name: newYearName.trim(),
          setAsCurrent: newYearSetCurrent,
          cloneFromYearId: cloneFromYearId ? Number(cloneFromYearId) : null,
          grade6MaxFailSubjects: Number(newYearMaxFail || 3),
          grade6DecisionBonus: Number(newYearBonus || 10),
          exemptionGeneralMinAvg: Number(newYearExGenAvg || 75),
          exemptionMinSubject: Number(newYearExMinSubj || 75),
          exemptionIndividualMin: Number(newYearExIndivMin || 90),
        }),
      });
      setNewYearName('');
      setNotice(`تم إنشاء العام الدراسي المستقل (${res.academicYear.name}) بنجاح.`);
      if (res.academicYear?.id && onSelectYear) {
        onSelectYear(res.academicYear.id);
      }
      onChanged();
    } catch (err: any) {
      setError(err?.message || 'تعذر إنشاء العام الدراسي الجديد.');
    } finally {
      setBusyYear(false);
    }
  };

  const handleUpdateYear = async (yr: AcademicYear, makeCurrent?: boolean) => {
    setError(null);
    setNotice(null);
    setBusyYear(true);
    try {
      const ed = yearEdits[yr.id];
      await apiFetch(`/api/admin/academic-years/${yr.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: yr.name,
          isCurrent: makeCurrent ? true : yr.isCurrent,
          isActive: yr.isActive,
          grade6MaxFailSubjects: Number(ed?.maxFail ?? yr.grade6MaxFailSubjects),
          grade6DecisionBonus: Number(ed?.bonus ?? yr.grade6DecisionBonus),
          exemptionGeneralMinAvg: Number(ed?.exGenAvg ?? yr.exemptionGeneralMinAvg ?? 75),
          exemptionMinSubject: Number(ed?.exMinSubj ?? yr.exemptionMinSubject ?? 75),
          exemptionIndividualMin: Number(ed?.exIndivMin ?? yr.exemptionIndividualMin ?? 90),
        }),
      });
      setNotice(
        makeCurrent
          ? `تم تعيين العام (${yr.name}) كعام دراسي حالي في البوابة.`
          : `تم حفظ ضوابط التأهيل والإعفاء للعام (${yr.name}) بنجاح.`
      );
      onChanged();
    } catch (err: any) {
      setError(err?.message || 'تعذر تحديث إعدادات العام الدراسي.');
    } finally {
      setBusyYear(false);
    }
  };

  const handleDeleteYear = async (yr: AcademicYear) => {
    setError(null);
    setNotice(null);
    setBusyYear(true);
    try {
      await apiFetch(`/api/admin/academic-years/${yr.id}`, {
        method: 'DELETE',
      });
      setConfirmDeleteYearId(null);
      setNotice(`تم حذف العام الدراسي (${yr.name}) وجميع بياناته المرتبطة بنجاح.`);
      if (selectedYearId === yr.id && onSelectYear) {
        const remaining = academicYears.find((y) => y.id !== yr.id);
        if (remaining) onSelectYear(remaining.id);
      }
      onChanged();
    } catch (err: any) {
      setError(err?.message || 'تعذر حذف العام الدراسي.');
    } finally {
      setBusyYear(false);
    }
  };

  const addClass = (e: FormEvent) => {
    e.preventDefault();
    handleAction(async () => {
      await apiFetch('/api/admin/classes', {
        method: 'POST',
        body: JSON.stringify({ name: newClassName.trim(), displayOrder: Number(newClassOrder) }),
      });
      setNewClassName('');
    });
  };

  const addSection = (e: FormEvent) => {
    e.preventDefault();
    handleAction(async () => {
      await apiFetch('/api/admin/sections', {
        method: 'POST',
        body: JSON.stringify({
          ...(selectedYearId ? { yearId: selectedYearId } : {}),
          classId: Number(secClassId || classes[0]?.id),
          name: newSecName.trim(),
        }),
      });
      setNewSecName('');
    });
  };

  const addSubject = (e: FormEvent) => {
    e.preventDefault();
    const chosenClassId = Number(subjectClassId || classes[0]?.id);
    if (!chosenClassId) {
      setError('يرجى اختيار الصف الدراسي المستهدف للمادة.');
      return;
    }
    handleAction(async () => {
      await apiFetch('/api/admin/subjects', {
        method: 'POST',
        body: JSON.stringify({
          ...(selectedYearId ? { yearId: selectedYearId } : {}),
          classId: chosenClassId,
          name: newSubjName.trim(),
          maxScore: Number(newSubjMax),
          displayOrder: Number(newSubjOrder),
        }),
      });
      setNewSubjName('');
    });
  };

  const addExam = (e: FormEvent) => {
    e.preventDefault();
    handleAction(async () => {
      await apiFetch('/api/admin/exams', {
        method: 'POST',
        body: JSON.stringify({
          ...(selectedYearId ? { yearId: selectedYearId } : {}),
          name: newExamName.trim(),
          displayOrder: Number(newExamOrder),
        }),
      });
      setNewExamName('');
    });
  };

  return (
    <div className="space-y-6">
      {notice && (
        <div className="flex items-center gap-2 p-3.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-900 text-sm">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{notice}</span>
        </div>
      )}
      {error && (
        <div role="alert" className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm">
          {error}
        </div>
      )}

      {/* ===================================================================== */}
      {/* ACADEMIC YEARS & GRADE 6 MINISTERIAL RULES                            */}
      {/* ===================================================================== */}
      <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-[#0B1F3A] text-[#C59B27] flex items-center justify-center shrink-0">
              <Calendar className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-display text-base font-bold text-[#0B1F3A]">
                إدارة الأعوام الدراسية وضوابط التأهيل الوزاري (السادس)
              </h3>
              <p className="text-xs text-slate-500">
                كل عام دراسي مستقل بالكامل بطلابه وشعبه ومواده وامتحاناته ونتائجه، مع ضبط قاعدة التأهيل الوزاري للسادس.
              </p>
            </div>
          </div>
          <span className="text-xs font-bold bg-slate-100 text-slate-700 px-3 py-1.5 rounded-lg tabular-nums">
            الأعوام المسجلة: {academicYears.length}
          </span>
        </div>

        {canManage && (
          <form
            onSubmit={handleCreateYear}
            className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3"
          >
            <h4 className="text-sm font-bold text-[#0B1F3A]">إنشاء عام دراسي جديد</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
              <div>
                <label htmlFor="new-year-name" className="block text-[11px] font-bold text-slate-600 mb-1">
                  اسم العام الدراسي
                </label>
                <input
                  id="new-year-name"
                  type="text"
                  value={newYearName}
                  onChange={(e) => setNewYearName(e.target.value)}
                  placeholder="مثال: 2026 - 2027"
                  required
                  className="w-full px-3 py-2 text-xs font-bold rounded-lg border border-slate-300 bg-white"
                />
              </div>

              <div>
                <label htmlFor="clone-year-select" className="block text-[11px] font-bold text-slate-600 mb-1">
                  نسخ الهيكل (الشعب والمواد) من
                </label>
                <select
                  id="clone-year-select"
                  value={cloneFromYearId}
                  onChange={(e) => setCloneFromYearId(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-semibold rounded-lg border border-slate-300 bg-white"
                >
                  <option value="">إنشاء هيكل جديد فارغ</option>
                  {academicYears.map((yr) => (
                    <option key={yr.id} value={yr.id}>
                      نسخ من ({yr.name})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="new-year-fail-limit" className="block text-[11px] font-bold text-slate-600 mb-1">
                  حد مواد الرسوب للسادس
                </label>
                <input
                  id="new-year-fail-limit"
                  type="number"
                  min={0}
                  max={12}
                  value={newYearMaxFail}
                  onChange={(e) => setNewYearMaxFail(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-bold rounded-lg border border-slate-300 bg-white tabular-nums"
                />
              </div>

              <div>
                <label htmlFor="new-year-bonus" className="block text-[11px] font-bold text-slate-600 mb-1">
                  درجات القرار (السادس)
                </label>
                <input
                  id="new-year-bonus"
                  type="number"
                  min={0}
                  max={50}
                  value={newYearBonus}
                  onChange={(e) => setNewYearBonus(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-bold rounded-lg border border-slate-300 bg-white tabular-nums"
                />
              </div>

              <div>
                <label htmlFor="new-year-ex-avg" className="block text-[11px] font-bold text-slate-600 mb-1">
                  معدل الإعفاء العام (افتراضي 75)
                </label>
                <input
                  id="new-year-ex-avg"
                  type="number"
                  min={50}
                  max={100}
                  value={newYearExGenAvg}
                  onChange={(e) => setNewYearExGenAvg(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-bold rounded-lg border border-slate-300 bg-white tabular-nums"
                />
              </div>

              <div>
                <label htmlFor="new-year-ex-min" className="block text-[11px] font-bold text-slate-600 mb-1">
                  أدنى درجة مادة للإعفاء العام (75)
                </label>
                <input
                  id="new-year-ex-min"
                  type="number"
                  min={50}
                  max={100}
                  value={newYearExMinSubj}
                  onChange={(e) => setNewYearExMinSubj(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-bold rounded-lg border border-slate-300 bg-white tabular-nums"
                />
              </div>

              <div>
                <label htmlFor="new-year-ex-indiv" className="block text-[11px] font-bold text-slate-600 mb-1">
                  درجة الإعفاء الفردي للمادة (90)
                </label>
                <input
                  id="new-year-ex-indiv"
                  type="number"
                  min={50}
                  max={100}
                  value={newYearExIndivMin}
                  onChange={(e) => setNewYearExIndivMin(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-bold rounded-lg border border-slate-300 bg-white tabular-nums"
                />
              </div>

              <div className="flex flex-col gap-2">
                <label className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newYearSetCurrent}
                    onChange={(e) => setNewYearSetCurrent(e.target.checked)}
                  />
                  <span>تعيين كعام حالي</span>
                </label>
                <button
                  type="submit"
                  disabled={busyYear}
                  className="min-h-[42px] inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-[#0B1F3A] hover:bg-[#1E4E8C] text-white text-xs font-bold rounded-lg cursor-pointer disabled:opacity-50"
                >
                  <Plus className="w-4 h-4 text-[#C59B27]" />
                  <span>{busyYear ? 'جاري الإنشاء...' : 'إضافة العام الدراسي'}</span>
                </button>
              </div>
            </div>
          </form>
        )}

        <div className="divide-y divide-slate-200 border border-slate-200 rounded-xl overflow-hidden">
          {academicYears.map((yr) => {
            const editState = yearEdits[yr.id] ?? {
              maxFail: String(yr.grade6MaxFailSubjects),
              bonus: String(yr.grade6DecisionBonus),
              exGenAvg: String(yr.exemptionGeneralMinAvg ?? 75),
              exMinSubj: String(yr.exemptionMinSubject ?? 75),
              exIndivMin: String(yr.exemptionIndividualMin ?? 90),
            };
            const isSelected = yr.id === selectedYearId;
            return (
              <div
                key={yr.id}
                className={`p-4 flex flex-wrap items-center justify-between gap-4 ${
                  isSelected ? 'bg-blue-50/40' : 'bg-white'
                }`}
              >
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-display font-extrabold text-sm text-[#0B1F3A]" dir="ltr">
                      {yr.name}
                    </span>
                    {yr.isCurrent && (
                      <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 text-[11px] font-bold">
                        العام الحالي الافتراضي
                      </span>
                    )}
                    {isSelected && (
                      <span className="px-2 py-0.5 rounded bg-[#0B1F3A] text-[#C59B27] text-[11px] font-bold">
                        قيد التصفح الآن
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500">
                    التأهيل للسادس: حد {yr.grade6MaxFailSubjects} مواد رسوب + {yr.grade6DecisionBonus} قرار · الإعفاء: عام ≥{yr.exemptionGeneralMinAvg ?? 75}% (أدنى مادة {yr.exemptionMinSubject ?? 75}) / فردي ≥{yr.exemptionIndividualMin ?? 90}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {canManage && (
                    <>
                      <div className="flex items-center gap-1 text-xs">
                        <label className="text-slate-600 font-semibold">رسوب سادس:</label>
                        <input
                          type="number"
                          aria-label={`حد الرسوب لعام ${yr.name}`}
                          min={0}
                          max={12}
                          value={editState.maxFail}
                          onChange={(e) =>
                            setYearEdits((prev) => ({
                              ...prev,
                              [yr.id]: { ...editState, maxFail: e.target.value },
                            }))
                          }
                          className="w-14 px-1.5 py-1 text-center font-bold rounded border border-slate-300 bg-white tabular-nums"
                        />
                      </div>
                      <div className="flex items-center gap-1 text-xs">
                        <label className="text-slate-600 font-semibold">قرار:</label>
                        <input
                          type="number"
                          aria-label={`درجات القرار لعام ${yr.name}`}
                          min={0}
                          max={50}
                          value={editState.bonus}
                          onChange={(e) =>
                            setYearEdits((prev) => ({
                              ...prev,
                              [yr.id]: { ...editState, bonus: e.target.value },
                            }))
                          }
                          className="w-14 px-1.5 py-1 text-center font-bold rounded border border-slate-300 bg-white tabular-nums"
                        />
                      </div>
                      <div className="flex items-center gap-1 text-xs">
                        <label className="text-slate-600 font-semibold">إعفاء عام:</label>
                        <input
                          type="number"
                          aria-label={`معدل الإعفاء العام لعام ${yr.name}`}
                          min={50}
                          max={100}
                          value={editState.exGenAvg}
                          onChange={(e) =>
                            setYearEdits((prev) => ({
                              ...prev,
                              [yr.id]: { ...editState, exGenAvg: e.target.value },
                            }))
                          }
                          className="w-14 px-1.5 py-1 text-center font-bold rounded border border-slate-300 bg-white tabular-nums"
                        />
                      </div>
                      <div className="flex items-center gap-1 text-xs">
                        <label className="text-slate-600 font-semibold">أدنى مادة:</label>
                        <input
                          type="number"
                          aria-label={`أدنى مادة للإعفاء العام لعام ${yr.name}`}
                          min={50}
                          max={100}
                          value={editState.exMinSubj}
                          onChange={(e) =>
                            setYearEdits((prev) => ({
                              ...prev,
                              [yr.id]: { ...editState, exMinSubj: e.target.value },
                            }))
                          }
                          className="w-14 px-1.5 py-1 text-center font-bold rounded border border-slate-300 bg-white tabular-nums"
                        />
                      </div>
                      <div className="flex items-center gap-1 text-xs">
                        <label className="text-slate-600 font-semibold">فردي:</label>
                        <input
                          type="number"
                          aria-label={`درجة الإعفاء الفردي لعام ${yr.name}`}
                          min={50}
                          max={100}
                          value={editState.exIndivMin}
                          onChange={(e) =>
                            setYearEdits((prev) => ({
                              ...prev,
                              [yr.id]: { ...editState, exIndivMin: e.target.value },
                            }))
                          }
                          className="w-14 px-1.5 py-1 text-center font-bold rounded border border-slate-300 bg-white tabular-nums"
                        />
                      </div>
                      {(() => {
                        const autoSt = yearAutoSaveState[yr.id];
                        if (!autoSt || autoSt === 'idle') return null;
                        return (
                          <span
                            role="status"
                            className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                              autoSt === 'saving'
                                ? 'bg-slate-100 text-slate-700'
                                : autoSt === 'error'
                                  ? 'bg-red-50 text-red-700'
                                  : 'bg-emerald-50 text-emerald-800'
                            }`}
                          >
                            {autoSt === 'saving'
                              ? 'جاري الحفظ تلقائياً...'
                              : autoSt === 'error'
                                ? 'تعذر الحفظ'
                                : 'تم حفظ الضوابط تلقائياً'}
                          </span>
                        );
                      })()}
                      {!yr.isCurrent && (
                        <button
                          type="button"
                          disabled={busyYear}
                          onClick={() => handleUpdateYear(yr, true)}
                          className="min-h-[36px] px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-900 border border-emerald-200 text-xs font-bold rounded-md cursor-pointer"
                        >
                          تعيين كعام حالي
                        </button>
                      )}
                      {academicYears.length > 1 && (
                        confirmDeleteYearId === yr.id ? (
                          <div className="flex flex-wrap items-center gap-1.5 bg-red-50 border border-red-200 px-2.5 py-1 rounded-md">
                            <span className="text-[11px] font-bold text-red-900">
                              تأكيد حذف العام ({yr.name})؟
                            </span>
                            <button
                              type="button"
                              disabled={busyYear}
                              onClick={() => void handleDeleteYear(yr)}
                              className="px-2 py-0.5 bg-red-700 hover:bg-red-800 text-white text-[11px] font-bold rounded cursor-pointer disabled:opacity-50"
                            >
                              حذف نهائي
                            </button>
                            <button
                              type="button"
                              disabled={busyYear}
                              onClick={() => setConfirmDeleteYearId(null)}
                              className="px-2 py-0.5 bg-white border border-slate-300 text-slate-700 text-[11px] font-bold rounded cursor-pointer"
                            >
                              إلغاء
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            disabled={busyYear}
                            onClick={() => setConfirmDeleteYearId(yr.id)}
                            className="min-h-[36px] inline-flex items-center gap-1 px-2.5 py-1.5 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 text-xs font-bold rounded-md cursor-pointer disabled:opacity-50"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>حذف العام</span>
                          </button>
                        )
                      )}
                    </>
                  )}
                  {onSelectYear && !isSelected && (
                    <button
                      type="button"
                      onClick={() => onSelectYear(yr.id)}
                      className="min-h-[36px] px-3 py-1.5 bg-[#0B1F3A] hover:bg-[#1E4E8C] text-white text-xs font-bold rounded-md cursor-pointer"
                    >
                      عرض وإدارة هذا العام
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>



      {/* ===================================================================== */}
      {/* CLASSES / SECTIONS / SUBJECTS / EXAMS (SCOPED BY ACTIVE YEAR)         */}
      {/* ===================================================================== */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Classes */}
        <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <h3 className="font-display text-base font-bold text-[#0B1F3A]">إدارة الصفوف الدراسية</h3>
          {canManage && (
            <form onSubmit={addClass} className="flex flex-wrap gap-2">
              <input
                type="text"
                value={newClassName}
                onChange={(e) => setNewClassName(e.target.value)}
                placeholder="اسم الصف الجديد..."
                required
                className="flex-1 min-w-[160px] px-3 py-2 text-sm rounded-lg border border-slate-300"
              />
              <input
                type="number"
                value={newClassOrder}
                onChange={(e) => setNewClassOrder(e.target.value)}
                className="w-20 px-3 py-2 text-sm rounded-lg border border-slate-300 tabular-nums"
                title="الترتيب"
              />
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#0B1F3A] text-white text-xs font-bold rounded-lg hover:bg-[#1E4E8C] cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>إضافة</span>
              </button>
            </form>
          )}
          <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
            {classes.map((c) => {
              const clsSections = sections.filter((s) => s.classId === c.id);
              const theme = getClassColorTheme(c.name);
              return (
                <div key={c.id} className={`px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-sm ${theme.rowBg}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`px-2 py-0.5 rounded border text-xs font-bold ${theme.badgeBg} ${theme.badgeText} ${theme.badgeBorder}`}>{c.name}</span>
                    <span className="text-xs text-slate-600">({clsSections.length} شعب)</span>
                    {c.isMinisterial && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-50 border border-amber-200 text-amber-900 text-[11px] font-bold">
                        <Award className="w-3 h-3" />
                        <span>صف وزاري حصري (عمود التأهيل)</span>
                      </span>
                    )}
                  </div>
                  {canManage && (
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          handleAction(() => apiFetch(`/api/admin/classes/${c.id}`, { method: 'DELETE' }))
                        }
                        aria-label={`حذف ${c.name}`}
                        className="p-1.5 text-red-600 hover:bg-red-50 rounded-md cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* Sections */}
        <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <h3 className="font-display text-base font-bold text-[#0B1F3A]">إدارة الشعب (للعام النشط)</h3>
          {canManage && (
            <form onSubmit={addSection} className="flex flex-wrap gap-2">
              <select
                value={secClassId || (classes[0]?.id ? String(classes[0].id) : '')}
                onChange={(e) => setSecClassId(e.target.value)}
                className="px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white"
              >
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={newSecName}
                onChange={(e) => setNewSecName(e.target.value)}
                placeholder="اسم الشعبة (مثل: ج)"
                required
                className="flex-1 min-w-[120px] px-3 py-2 text-sm rounded-lg border border-slate-300"
              />
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#0B1F3A] text-white text-xs font-bold rounded-lg hover:bg-[#1E4E8C] cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>إضافة</span>
              </button>
            </form>
          )}
          <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-lg">
            {sections.map((s) => {
              const theme = getClassColorTheme(s.className || '');
              return (
                <div key={s.id} className={`px-4 py-2.5 flex items-center justify-between text-sm ${theme.rowBg}`}>
                  <span>
                    <span className={`inline-block px-2 py-0.5 rounded border text-xs font-bold ${theme.badgeBg} ${theme.badgeText} ${theme.badgeBorder}`}>
                      {s.className}
                    </span>
                    <span className="text-slate-400 mx-2">·</span>
                    <span className="font-semibold text-[#0B1F3A]">شعبة {s.name}</span>
                  </span>
                  {canManage && (
                    <button
                      type="button"
                      onClick={() =>
                        handleAction(() => apiFetch(`/api/admin/sections/${s.id}`, { method: 'DELETE' }))
                      }
                      aria-label={`حذف شعبة ${s.name}`}
                      className="p-1.5 text-red-600 hover:bg-red-50 rounded-md cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* Class-Scoped Subjects */}
        <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-display text-base font-bold text-[#0B1F3A]">
                إدارة المواد الدراسية (مخصصة لكل صف)
              </h3>
              <p className="text-xs text-slate-500">
                اختر الصف لعرض مواده وإضافة مواد خاصة به دون تداخل مع بقية الصفوف.
              </p>
            </div>
            <select
              aria-label="اختيار الصف لإدارة مواده"
              value={subjectClassId || (classes[0]?.id ? String(classes[0].id) : '')}
              onChange={(e) => setSubjectClassId(e.target.value)}
              className="px-3 py-1.5 text-xs font-bold rounded-lg border border-slate-300 bg-slate-50"
            >
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  مواد: {c.name}
                </option>
              ))}
            </select>
          </div>

          {canManage && (
            <form onSubmit={addSubject} className="flex flex-wrap gap-2">
              <input
                type="text"
                value={newSubjName}
                onChange={(e) => setNewSubjName(e.target.value)}
                placeholder="اسم المادة للصف المختار..."
                required
                className="flex-1 min-w-[140px] px-3 py-2 text-sm rounded-lg border border-slate-300"
              />
              <input
                type="number"
                value={newSubjMax}
                onChange={(e) => setNewSubjMax(e.target.value)}
                placeholder="العظمى"
                className="w-20 px-3 py-2 text-sm rounded-lg border border-slate-300 tabular-nums"
              />
              <input
                type="number"
                value={newSubjOrder}
                onChange={(e) => setNewSubjOrder(e.target.value)}
                placeholder="الترتيب"
                className="w-20 px-3 py-2 text-sm rounded-lg border border-slate-300 tabular-nums"
              />
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#0B1F3A] text-white text-xs font-bold rounded-lg hover:bg-[#1E4E8C] cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>إضافة للصف</span>
              </button>
            </form>
          )}
          <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-lg">
            {subjects
              .filter((sub) => sub.classId === null || sub.classId === Number(subjectClassId))
              .map((sub) => {
                const clsName =
                  classes.find((c) => c.id === sub.classId)?.name || 'مشتركة لكل الصفوف';
                const theme = sub.classId ? getClassColorTheme(clsName) : getClassColorTheme('');
                return (
                  <div
                    key={sub.id}
                    className={`px-4 py-2.5 flex items-center justify-between text-sm ${
                      sub.classId ? theme.rowBg : 'bg-white'
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-[#0B1F3A]">{sub.name}</span>
                      <span className={`px-2 py-0.5 rounded border text-[10px] font-bold ${theme.badgeBg} ${theme.badgeText} ${theme.badgeBorder}`}>
                        {sub.classId ? clsName : 'عامة'}
                      </span>
                      <span className="text-xs text-slate-500 tabular-nums">
                        العظمى: {sub.maxScore} · الترتيب: {sub.displayOrder}
                      </span>
                    </div>
                    {canManage && (
                      <button
                        type="button"
                        onClick={() =>
                          handleAction(() => apiFetch(`/api/admin/subjects/${sub.id}`, { method: 'DELETE' }))
                        }
                        aria-label={`حذف مادة ${sub.name}`}
                        className="p-1.5 text-red-600 hover:bg-red-50 rounded-md cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                );
              })}
          </div>
        </section>

        {/* Independent Assessments / Exams */}
        <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <h3 className="font-display text-base font-bold text-[#0B1F3A]">
            إدارة الامتحانات (للعام النشط)
          </h3>
          {canManage && (
            <form onSubmit={addExam} className="flex flex-wrap gap-2">
              <input
                type="text"
                value={newExamName}
                onChange={(e) => setNewExamName(e.target.value)}
                placeholder="اسم امتحان جديد (مثال: الدور الثاني)"
                required
                className="flex-1 min-w-[160px] px-3 py-2 text-sm rounded-lg border border-slate-300"
              />
              <input
                type="number"
                value={newExamOrder}
                onChange={(e) => setNewExamOrder(e.target.value)}
                className="w-20 px-3 py-2 text-sm rounded-lg border border-slate-300 tabular-nums"
              />
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#0B1F3A] text-white text-xs font-bold rounded-lg hover:bg-[#1E4E8C] cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>إضافة</span>
              </button>
            </form>
          )}
          <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
            {exams.map((ex) => (
              <div key={ex.id} className="px-4 py-2.5 flex items-center justify-between text-sm">
                <div>
                  <span className="font-bold text-[#0B1F3A]">{ex.name}</span>
                  <span className="text-xs text-slate-500 mr-2 tabular-nums">
                    {ex.academicYear} · ترتيب {ex.displayOrder}
                  </span>
                </div>
                <span className={ex.isActive ? 'text-xs font-semibold text-emerald-700' : 'text-xs text-slate-400'}>
                  {ex.isActive ? 'مفعل' : 'معطل'}
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
