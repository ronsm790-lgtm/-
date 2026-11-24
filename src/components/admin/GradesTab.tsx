import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from 'react';
import {
  AlertCircle,
  Award,
  Calculator,
  CheckCircle2,
  ChevronDown,
  CloudOff,
  Download,
  Eye,
  EyeOff,
  FileSpreadsheet,
  GraduationCap,
  Layers,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Upload,
} from 'lucide-react';
import { apiDownload, apiFetch } from '../../lib/api.ts';
import { getClassColorTheme } from '../../lib/classColors.ts';
import {
  isSubjectExcludedForClass,
  isTeacherAllowedExamName,
  matchIraqiExamSlot,
  sortStudentsAlphabetically,
  validateScoreInput,
  type NormalizedExemptionImport,
} from '../../lib/gradeRules.ts';
import { saveWithOfflineFallback } from '../../lib/offlineSync.ts';
import { parseSpreadsheetBuffer } from '../../lib/spreadsheet.ts';
import { useUndo } from '../../lib/undoManager.tsx';
import {
  GRADE_STATUS_LABELS,
  type AcademicYear,
  type AdminUser,
  type EffortCalculationResult,
  type EffortCalculationTarget,
  type Exam,
  type ExemptionDecision,
  type GradeStatus,
  type ImportPreviewResponse,
  type MinisterialDecision,
  type SchoolClass,
  type Section,
  type Subject,
} from '../../types/school.ts';
import { ActionMenu } from '../ui/ActionMenu.tsx';

interface BatchRow {
  studentId: number;
  fullName: string;
  inquiryCode: string;
  sectionName: string;
  gradeId: number | null;
  score: string;
  status: GradeStatus;
  notes: string;
  updatedBy: string | null;
  updatedAt: string | null;
}

interface QualGridRow {
  sequence: number;
  studentId: number;
  fullName: string;
  inquiryCode: string;
  sectionName: string;
  annualEffortBySubject: Record<number, number | null>;
  subjectDecisions: Record<number, MinisterialDecision | null>;
  overallDecision: MinisterialDecision | null;
  overallStatus: 'draft' | 'published';
  overallNotes: string;
}

interface QualImportPreviewNormalized {
  studentId: number;
  studentName: string;
  inquiryCode: string;
  overallDecision: MinisterialDecision | null;
  subjectDecisions: Array<{ subjectId: number; subjectName: string; decision: MinisterialDecision }>;
}

interface ExemptionGridRow {
  sequence: number;
  studentId: number;
  fullName: string;
  inquiryCode: string;
  sectionName: string;
  annualEffortBySubject: Record<number, number | null>;
  subjectDecisions: Record<number, ExemptionDecision | null>;
  subjectTypes: Record<number, 'individual' | 'general'>;
  overallDecision: ExemptionDecision | null;
  annualAverage: number | null;
  overallStatus: 'draft' | 'published';
}

interface NormalizedGradePreview {
  studentId: number;
  studentName: string;
  inquiryCode: string;
  subjectId: number;
  subjectName: string;
  examId: number;
  examName: string;
  score: number;
  notes: string;
}

interface SavedRowSnapshot {
  score: string;
  status: GradeStatus;
  notes: string;
}

interface GradesTabProps {
  admin: AdminUser;
  classes: SchoolClass[];
  sections: Section[];
  subjects: Subject[];
  exams: Exam[];
  selectedYearId?: number | null;
  selectedYear?: AcademicYear | null;
  canEdit: boolean;
  canPublish: boolean;
  onChanged: () => void;
}

export function GradesTab({
  admin,
  classes,
  sections,
  subjects,
  exams,
  selectedYearId = null,
  selectedYear = null,
  canEdit,
  canPublish,
  onChanged,
}: GradesTabProps) {
  const { pushUndo } = useUndo();
  const isTeacher = admin.role === 'teacher';
  const assignments = admin.assignments ?? [];

  // Scope available classes to teacher's assignments when role === 'teacher'
  const allowedClasses = useMemo(() => {
    if (!isTeacher) return classes;
    const assignedClassIds = new Set(assignments.map((a) => a.classId));
    return classes.filter((c) => assignedClassIds.has(c.id));
  }, [isTeacher, classes, assignments]);

  const [classId, setClassId] = useState<string>(
    allowedClasses[0] ? String(allowedClasses[0].id) : ''
  );

  useEffect(() => {
    if (allowedClasses.length > 0 && !allowedClasses.some((c) => String(c.id) === classId)) {
      setClassId(String(allowedClasses[0].id));
    }
  }, [allowedClasses, classId]);

  const selectedClassObj = useMemo(
    () => classes.find((c) => String(c.id) === classId) ?? null,
    [classes, classId]
  );

  // Scope available subjects based on teacher's assignments & exclude Grade 6 Computer
  const allowedSubjects = useMemo(() => {
    const activeSubjects = subjects.filter(
      (s) =>
        s.isActive &&
        (s.classId === null || s.classId === Number(classId)) &&
        !isSubjectExcludedForClass(s.name, selectedClassObj?.name, selectedClassObj?.isMinisterial)
    );
    if (!isTeacher) return activeSubjects.length > 0 ? activeSubjects : subjects;
    const assignedSubIds = new Set(
      assignments.filter((a) => a.classId === Number(classId)).map((a) => a.subjectId)
    );
    return subjects.filter(
      (s) =>
        assignedSubIds.has(s.id) &&
        !isSubjectExcludedForClass(s.name, selectedClassObj?.name, selectedClassObj?.isMinisterial)
    );
  }, [isTeacher, subjects, assignments, classId, selectedClassObj]);

  const [subjectId, setSubjectId] = useState<string>(
    allowedSubjects[0] ? String(allowedSubjects[0].id) : ''
  );

  useEffect(() => {
    if (allowedSubjects.length > 0 && !allowedSubjects.some((s) => String(s.id) === subjectId)) {
      setSubjectId(String(allowedSubjects[0].id));
    }
  }, [allowedSubjects, subjectId]);

  // Teachers are strictly restricted to the 6 Monthly & Semester Effort exams
  const allowedExams = useMemo(() => {
    if (!isTeacher) return exams;
    return exams.filter((ex) => isTeacherAllowedExamName(ex.name));
  }, [isTeacher, exams]);

  const [examId, setExamId] = useState<string>(
    allowedExams[0] ? String(allowedExams[0].id) : ''
  );

  useEffect(() => {
    if (allowedExams.length > 0 && !allowedExams.some((e) => String(e.id) === examId)) {
      setExamId(String(allowedExams[0].id));
    }
  }, [allowedExams, examId]);

  // Scope available sections for selected class + subject
  const canViewAllSections = useMemo(() => {
    if (!isTeacher) return true;
    return assignments.some(
      (a) =>
        a.classId === Number(classId) &&
        a.subjectId === Number(subjectId) &&
        a.sectionId === null
    );
  }, [isTeacher, assignments, classId, subjectId]);

  const filteredSections = useMemo(() => {
    const classSecs = sections.filter((s) => s.classId === Number(classId));
    if (!isTeacher) return classSecs;
    if (canViewAllSections) return classSecs;
    const assignedSecIds = new Set(
      assignments
        .filter((a) => a.classId === Number(classId) && a.subjectId === Number(subjectId) && a.sectionId !== null)
        .map((a) => a.sectionId!)
    );
    return classSecs.filter((s) => assignedSecIds.has(s.id));
  }, [sections, classId, isTeacher, canViewAllSections, assignments, subjectId]);

  const [sectionId, setSectionId] = useState<string>('');

  const effectiveSectionId = useMemo(() => {
    if (sectionId === 'all' && canViewAllSections) return 'all';
    if (filteredSections.some((s) => String(s.id) === sectionId)) return sectionId;
    if (canViewAllSections) return 'all';
    return filteredSections[0] ? String(filteredSections[0].id) : '';
  }, [sectionId, canViewAllSections, filteredSections]);

  // Mode toggle: manual vs unified batch import/export vs Grade 6 qual vs non-ministerial exemptions
  const [entryMode, setEntryMode] = useState<'manual' | 'batch' | 'qual' | 'exemptions'>('manual');
  const [showStudentsTable, setShowStudentsTable] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [maxScore, setMaxScore] = useState<number>(100);
  const [rows, setRows] = useState<BatchRow[]>([]);
  const [dirtyStudentIds, setDirtyStudentIds] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'offline' | 'error'>('idle');
  const [autoSaveNote, setAutoSaveNote] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null
  );

  // Unified Batch Excel state
  const [batchSubjectScope, setBatchSubjectScope] = useState<'selected' | 'all'>('selected');
  const [batchRawRows, setBatchRawRows] = useState<Record<string, string>[]>([]);
  const [batchPreview, setBatchPreview] =
    useState<ImportPreviewResponse<NormalizedGradePreview> | null>(null);
  const [batchTargetStatus, setBatchTargetStatus] = useState<'draft' | 'published'>('draft');
  const [downloadingTemplate, setDownloadingTemplate] = useState(false);

  // Manager-only explicit Effort & Final Grade calculation
  const [showEffortCalc, setShowEffortCalc] = useState(false);
  const [calcTarget, setCalcTarget] = useState<EffortCalculationTarget>('all');
  const [calcSubjectScope, setCalcSubjectScope] = useState<'all' | 'selected'>('all');
  const [calcRequirePublished, setCalcRequirePublished] = useState(false);
  const [calcTargetStatus, setCalcTargetStatus] = useState<'draft' | 'published'>('draft');
  const [calculating, setCalculating] = useState(false);

  // Grade 6 Ministerial Qualification state
  const [qualLoading, setQualLoading] = useState(false);
  const [qualSaving, setQualSaving] = useState(false);
  const [qualSubjects, setQualSubjects] = useState<Subject[]>([]);
  const [qualRows, setQualRows] = useState<QualGridRow[]>([]);
  const [qualDirty, setQualDirty] = useState(false);
  const [qualRuleInfo, setQualRuleInfo] = useState<{ maxFail: number; bonus: number }>({
    maxFail: selectedYear?.grade6MaxFailSubjects ?? 3,
    bonus: selectedYear?.grade6DecisionBonus ?? 10,
  });
  const [qualCalcStatus, setQualCalcStatus] = useState<'draft' | 'published'>('draft');
  const [qualImportRawRows, setQualImportRawRows] = useState<Record<string, string>[]>([]);
  const [qualImportPreview, setQualImportPreview] =
    useState<ImportPreviewResponse<QualImportPreviewNormalized> | null>(null);
  const [qualImportStatus, setQualImportStatus] = useState<'draft' | 'published'>('draft');

  // Non-Ministerial Iraqi Exemptions state (Individual >=90 & General >=75)
  const [exemptLoading, setExemptLoading] = useState(false);
  const [exemptSaving, setExemptSaving] = useState(false);
  const [exemptIsMinisterial, setExemptIsMinisterial] = useState(false);
  const [exemptSubjects, setExemptSubjects] = useState<Subject[]>([]);
  const [exemptRows, setExemptRows] = useState<ExemptionGridRow[]>([]);
  const [exemptDirty, setExemptDirty] = useState(false);
  const [exemptRules, setExemptRules] = useState<{
    generalMinAvg: number;
    minSubject: number;
    individualMin: number;
  }>({
    generalMinAvg: selectedYear?.exemptionGeneralMinAvg ?? 75,
    minSubject: selectedYear?.exemptionMinSubject ?? 75,
    individualMin: selectedYear?.exemptionIndividualMin ?? 90,
  });
  const [exemptCalcStatus, setExemptCalcStatus] = useState<'draft' | 'published'>('draft');
  const [exemptImportRawRows, setExemptImportRawRows] = useState<Record<string, string>[]>([]);
  const [exemptImportPreview, setExemptImportPreview] =
    useState<ImportPreviewResponse<NormalizedExemptionImport> | null>(null);
  const [exemptImportStatus, setExemptImportStatus] = useState<'draft' | 'published'>('draft');
  const [qualCalcSummary, setQualCalcSummary] = useState<{
    qualifiedCount: number;
    notQualifiedCount: number;
    incompleteCount: number;
    status: 'draft' | 'published';
  } | null>(null);
  const [exemptCalcSummary, setExemptCalcSummary] = useState<{
    processedStudents: number;
    generalCount: number;
    individualCount: number;
    status: 'draft' | 'published';
  } | null>(null);

  const [qualAutoState, setQualAutoState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [exemptAutoState, setExemptAutoState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const qualEditVersionRef = useRef(0);
  const exemptEditVersionRef = useRef(0);
  const qualRowsRef = useRef<QualGridRow[]>([]);
  qualRowsRef.current = qualRows;
  const qualSubjectsRef = useRef<Subject[]>([]);
  qualSubjectsRef.current = qualSubjects;
  const exemptRowsRef = useRef<ExemptionGridRow[]>([]);
  exemptRowsRef.current = exemptRows;

  const selectedExamObj = useMemo(
    () => allowedExams.find((e) => String(e.id) === examId) ?? null,
    [allowedExams, examId]
  );
  const selectedSubjectObj = useMemo(
    () => allowedSubjects.find((s) => String(s.id) === subjectId) ?? null,
    [allowedSubjects, subjectId]
  );

  const classTheme = useMemo(
    () => getClassColorTheme(selectedClassObj?.name || classId),
    [selectedClassObj, classId]
  );

  const isSecondRoundSelected = useMemo(() => {
    if (!selectedExamObj) return false;
    return (
      matchIraqiExamSlot(selectedExamObj.name) === 'secondRound' ||
      selectedExamObj.name.includes('الدور الثاني')
    );
  }, [selectedExamObj]);

  const scoreInputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const savedSnapshotRef = useRef<Record<number, SavedRowSnapshot>>({});
  const rowsRef = useRef<BatchRow[]>([]);
  rowsRef.current = rows;
  const activeContextRef = useRef<string>('');

  const buildBatchContextKey = useCallback(
    () => `${selectedYearId ?? 'cur'}:${classId}:${effectiveSectionId}:${subjectId}:${examId}`,
    [selectedYearId, classId, effectiveSectionId, subjectId, examId]
  );

  const loadBatch = useCallback(
    async (preserveFeedback = false) => {
      if (!classId || !effectiveSectionId || !subjectId || !examId) {
        setRows([]);
        savedSnapshotRef.current = {};
        setDirtyStudentIds([]);
        return;
      }
      const ctxKey = buildBatchContextKey();
      activeContextRef.current = ctxKey;
      setLoading(true);
      if (!preserveFeedback) {
        setFeedback(null);
        setAutoSaveStatus('idle');
        setAutoSaveNote(null);
      }
      setDirtyStudentIds([]);
      try {
        const yearQs = selectedYearId ? `&yearId=${selectedYearId}` : '';
        const data = await apiFetch<{
          subject: { id: number; name: string; maxScore: number };
          rows: Array<{
            studentId: number;
            fullName: string;
            inquiryCode: string;
            sectionName: string;
            gradeId: number | null;
            score: number | null;
            status: GradeStatus;
            notes: string;
            updatedBy: string | null;
            updatedAt: string | null;
          }>;
        }>(
          `/api/admin/grades/batch?classId=${classId}&sectionId=${effectiveSectionId}&subjectId=${subjectId}&examId=${examId}${yearQs}`
        );
        if (activeContextRef.current !== ctxKey) return;
        setMaxScore(data.subject.maxScore);
        const mapped: BatchRow[] = sortStudentsAlphabetically(data.rows).map((r) => ({
          ...r,
          score: r.score === null || r.score === undefined ? '' : String(r.score),
        }));
        const snap: Record<number, SavedRowSnapshot> = {};
        for (const r of mapped) {
          snap[r.studentId] = { score: r.score, status: r.status, notes: r.notes };
        }
        savedSnapshotRef.current = snap;
        setRows(mapped);
      } catch (err: any) {
        setFeedback({ type: 'error', message: err?.message || 'تعذر تحميل جدول الدرجات.' });
        setRows([]);
        savedSnapshotRef.current = {};
      } finally {
        setLoading(false);
      }
    },
    [buildBatchContextKey, classId, effectiveSectionId, examId, selectedYearId, subjectId]
  );

  useEffect(() => {
    void loadBatch();
  }, [loadBatch]);

  const loadQualificationGrid = useCallback(
    async (preserveFeedback = false) => {
      if (isTeacher || !classId) {
        setQualRows([]);
        return;
      }
      setQualLoading(true);
      if (!preserveFeedback) setFeedback(null);
      setQualDirty(false);
      try {
        const qs = new URLSearchParams({
          ...(selectedYearId ? { yearId: String(selectedYearId) } : {}),
          classId,
          sectionId: effectiveSectionId || 'all',
        }).toString();
        const data = await apiFetch<{
          academicYear: AcademicYear;
          subjects: Subject[];
          rows: Array<{
            sequence: number;
            studentId: number;
            fullName: string;
            inquiryCode: string;
            sectionName: string;
            annualEffortBySubject: Record<number, number | null>;
            subjectQualificationBySubject: Record<
              number,
              { decision: MinisterialDecision | null }
            >;
            overallQualification: {
              decision: MinisterialDecision | null;
              status: 'draft' | 'published';
              notes: string;
            };
          }>;
        }>(`/api/admin/grade6-qualification?${qs}`);

        setQualSubjects(data.subjects ?? []);
        if (data.academicYear) {
          setQualRuleInfo({
            maxFail: data.academicYear.grade6MaxFailSubjects,
            bonus: data.academicYear.grade6DecisionBonus,
          });
        }
        setQualRows(
          sortStudentsAlphabetically(data.rows ?? []).map((r, idx) => {
            const subMap: Record<number, MinisterialDecision | null> = {};
            for (const sub of data.subjects ?? []) {
              subMap[sub.id] = r.subjectQualificationBySubject?.[sub.id]?.decision ?? null;
            }
            return {
              sequence: idx + 1,
              studentId: r.studentId,
              fullName: r.fullName,
              inquiryCode: r.inquiryCode,
              sectionName: r.sectionName,
              annualEffortBySubject: r.annualEffortBySubject ?? {},
              subjectDecisions: subMap,
              overallDecision: r.overallQualification?.decision ?? null,
              overallStatus: r.overallQualification?.status ?? 'draft',
              overallNotes: r.overallQualification?.notes ?? '',
            };
          })
        );
      } catch (err: any) {
        setFeedback({ type: 'error', message: err?.message || 'تعذر تحميل سجل التأهيل الوزاري.' });
        setQualRows([]);
      } finally {
        setQualLoading(false);
      }
    },
    [classId, effectiveSectionId, isTeacher, selectedYearId]
  );

  useEffect(() => {
    if (entryMode === 'qual' && !isTeacher) {
      setQualAutoState('idle');
      void loadQualificationGrid();
    }
  }, [entryMode, isTeacher, loadQualificationGrid]);

  const loadExemptionsGrid = useCallback(
    async (preserveFeedback = false) => {
      if (isTeacher || !classId) {
        setExemptRows([]);
        return;
      }
      setExemptLoading(true);
      if (!preserveFeedback) setFeedback(null);
      setExemptDirty(false);
      try {
        const qs = new URLSearchParams({
          ...(selectedYearId ? { yearId: String(selectedYearId) } : {}),
          classId,
          sectionId: effectiveSectionId || 'all',
        }).toString();
        const data = await apiFetch<{
          isMinisterial: boolean;
          className: string;
          rules: { generalMinAvg: number; minSubject: number; individualMin: number };
          subjects: Subject[];
          rows: ExemptionGridRow[];
        }>(`/api/admin/exemptions?${qs}`);
        setExemptIsMinisterial(Boolean(data.isMinisterial));
        if (data.rules) setExemptRules(data.rules);
        setExemptSubjects(data.subjects ?? []);
        setExemptRows(
          sortStudentsAlphabetically(data.rows ?? []).map((r, idx) => ({
            ...r,
            sequence: idx + 1,
          }))
        );
      } catch (err: any) {
        setFeedback({ type: 'error', message: err?.message || 'تعذر تحميل سجل الإعفاء الفردي والعام.' });
        setExemptRows([]);
      } finally {
        setExemptLoading(false);
      }
    },
    [classId, effectiveSectionId, isTeacher, selectedYearId]
  );

  useEffect(() => {
    if (entryMode === 'exemptions' && !isTeacher) {
      setExemptAutoState('idle');
      void loadExemptionsGrid();
    }
  }, [entryMode, isTeacher, loadExemptionsGrid]);

  const displayedRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.fullName.toLowerCase().includes(q) || r.inquiryCode.toLowerCase().includes(q)
    );
  }, [rows, searchQuery]);

  const updateRow = (studentId: number, patch: Partial<BatchRow>) => {
    setDirtyStudentIds((prev) => (prev.includes(studentId) ? prev : [...prev, studentId]));
    setAutoSaveStatus('idle');
    setRows((prev) => prev.map((r) => (r.studentId === studentId ? { ...r, ...patch } : r)));
  };

  const applyBulkRowStatus = (nextStatus: GradeStatus) => {
    if (nextStatus === 'published' && !canPublish) return;
    const affectedIds = rowsRef.current
      .filter((r) => r.score.trim() !== '')
      .map((r) => r.studentId);
    if (affectedIds.length === 0) return;
    setDirtyStudentIds((prev) => Array.from(new Set([...prev, ...affectedIds])));
    setAutoSaveStatus('idle');
    setRows((prev) => prev.map((r) => (r.score.trim() !== '' ? { ...r, status: nextStatus } : r)));
  };

  const handleScoreKeyDown = (e: KeyboardEvent<HTMLInputElement>, index: number) => {
    if (e.key === 'Enter' || e.key === 'ArrowDown') {
      e.preventDefault();
      scoreInputRefs.current[index + 1]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      scoreInputRefs.current[index - 1]?.focus();
    }
  };

  // Debounced live auto-save (never triggers publishing; saves modified entries safely)
  useEffect(() => {
    if (
      entryMode !== 'manual' ||
      !canEdit ||
      loading ||
      !subjectId ||
      !examId ||
      dirtyStudentIds.length === 0
    ) {
      return;
    }

    const ctxAtSchedule = buildBatchContextKey();
    const targetSubjectId = Number(subjectId);
    const targetExamId = Number(examId);
    const targetYearId = selectedYearId;
    const idsToSave = [...dirtyStudentIds];

    const timer = window.setTimeout(async () => {
      if (activeContextRef.current !== ctxAtSchedule) return;
      const currentRows = rowsRef.current;
      const dirtyRows = currentRows.filter((r) => idsToSave.includes(r.studentId));
      if (dirtyRows.length === 0) return;

      for (const r of dirtyRows) {
        const check = validateScoreInput(r.score, maxScore);
        if (!check.valid) {
          setAutoSaveStatus('error');
          setAutoSaveNote(`${r.fullName}: ${check.error}`);
          return;
        }
      }

      const previousEntries = dirtyRows.map((r) => {
        const prev = savedSnapshotRef.current[r.studentId] ?? {
          score: '',
          status: 'draft' as GradeStatus,
          notes: '',
        };
        return {
          studentId: r.studentId,
          score: prev.score.trim() === '' ? null : Number(prev.score),
          scoreStr: prev.score,
          status: prev.status,
          notes: prev.notes,
        };
      });

      const entriesToSave = dirtyRows.map((r) => ({
        studentId: r.studentId,
        score: r.score.trim() === '' ? null : Number(r.score),
        status: r.status,
        notes: r.notes,
      }));

      setAutoSaveStatus('saving');
      setAutoSaveNote('جاري الحفظ...');
      try {
        const result = await saveWithOfflineFallback<{
          savedCount: number;
          revertedCount: number;
        }>(
          '/api/admin/grades/save',
          'POST',
          {
            ...(targetYearId ? { yearId: targetYearId } : {}),
            subjectId: targetSubjectId,
            examId: targetExamId,
            entries: entriesToSave,
          },
          `حفظ تلقائي (${dirtyRows.length} طالب)`
        );

        if (activeContextRef.current !== ctxAtSchedule) return;

        // Commit snapshot & handle published->draft safeguard mirror locally
        const reverted = !result.queued && (result.response?.revertedCount ?? 0) > 0;
        const nextRowsPatch = new Map<number, GradeStatus>();
        for (const r of dirtyRows) {
          const prevSnap = savedSnapshotRef.current[r.studentId];
          const changed =
            prevSnap &&
            (prevSnap.score !== r.score || prevSnap.notes.trim() !== r.notes.trim());
          const effectiveStatus: GradeStatus =
            !result.queued && prevSnap?.status === 'published' && changed
              ? 'draft'
              : r.status;
          savedSnapshotRef.current[r.studentId] = {
            score: r.score,
            status: effectiveStatus,
            notes: r.notes,
          };
          if (effectiveStatus !== r.status) {
            nextRowsPatch.set(r.studentId, effectiveStatus);
          }
        }
        if (nextRowsPatch.size > 0) {
          setRows((prev) =>
            prev.map((row) =>
              nextRowsPatch.has(row.studentId)
                ? { ...row, status: nextRowsPatch.get(row.studentId)! }
                : row
            )
          );
        }

        setDirtyStudentIds((prev) => prev.filter((id) => !idsToSave.includes(id)));

        if (result.queued) {
          setAutoSaveStatus('offline');
          setAutoSaveNote('تم الحفظ محلياً (دون إنترنت)');
        } else {
          setAutoSaveStatus('saved');
          setAutoSaveNote(
            reverted
              ? 'تم الحفظ تلقائياً (أُعيدت الدرجات المنشورة المعدلة لمسودة)'
              : 'تم الحفظ تلقائياً'
          );
          onChanged();
        }

        pushUndo(
          dirtyRows.length === 1
            ? `تعديل درجة ${dirtyRows[0].fullName}`
            : `تعديل ${dirtyRows.length} درجات`,
          async () => {
            await saveWithOfflineFallback(
              '/api/admin/grades/save',
              'POST',
              {
                ...(targetYearId ? { yearId: targetYearId } : {}),
                subjectId: targetSubjectId,
                examId: targetExamId,
                entries: previousEntries.map((p) => ({
                  studentId: p.studentId,
                  score: p.score,
                  status: p.status === 'published' && !canPublish ? 'draft' : p.status,
                  notes: p.notes,
                })),
              },
              'تراجع عن تعديل الدرجات'
            );
            await loadBatch(true);
            onChanged();
          }
        );
      } catch (err: any) {
        setAutoSaveStatus('error');
        setAutoSaveNote(err?.message || 'تعذر الحفظ التلقائي.');
      }
    }, 450);

    return () => window.clearTimeout(timer);
  }, [
    buildBatchContextKey,
    canEdit,
    canPublish,
    dirtyStudentIds,
    entryMode,
    examId,
    loadBatch,
    loading,
    maxScore,
    onChanged,
    pushUndo,
    selectedYearId,
    subjectId,
  ]);

  // Debounced auto-save for Grade 6 Ministerial Qualification drafts
  useEffect(() => {
    if (entryMode !== 'qual' || isTeacher || !canEdit || qualLoading || !qualDirty) return;
    const rowsSnap = qualRowsRef.current;
    const subjectsSnap = qualSubjectsRef.current;
    if (rowsSnap.length === 0) return;

    const verAtSchedule = qualEditVersionRef.current;
    const yearSnap = selectedYearId;
    const timer = window.setTimeout(async () => {
      setQualAutoState('saving');
      try {
        const entries = qualRowsRef.current.map((r) => ({
          studentId: r.studentId,
          overallDecision: r.overallDecision,
          overallNotes: r.overallNotes,
          subjectDecisions: subjectsSnap.map((sub) => ({
            subjectId: sub.id,
            decision: r.subjectDecisions[sub.id] ?? null,
          })),
        }));
        await apiFetch('/api/admin/grade6-qualification/save', {
          method: 'POST',
          body: JSON.stringify({
            ...(yearSnap ? { yearId: yearSnap } : {}),
            entries,
            status: 'draft',
          }),
        });
        if (qualEditVersionRef.current === verAtSchedule) {
          setQualDirty(false);
          setQualAutoState('saved');
          onChanged();
        }
      } catch (err: any) {
        setQualAutoState('error');
        setFeedback({ type: 'error', message: err?.message || 'تعذر الحفظ التلقائي لمسودة التأهيل.' });
      }
    }, 650);
    return () => window.clearTimeout(timer);
  }, [entryMode, isTeacher, canEdit, qualLoading, qualDirty, qualRows, selectedYearId, onChanged]);

  // Debounced auto-save for Non-Ministerial Exemptions drafts
  useEffect(() => {
    if (entryMode !== 'exemptions' || isTeacher || !canEdit || exemptLoading || !exemptDirty) return;
    if (exemptRowsRef.current.length === 0 || !classId) return;

    const verAtSchedule = exemptEditVersionRef.current;
    const yearSnap = selectedYearId;
    const classSnap = Number(classId);
    const timer = window.setTimeout(async () => {
      setExemptAutoState('saving');
      try {
        const entries = exemptRowsRef.current.map((r) => ({
          studentId: r.studentId,
          overallDecision: r.overallDecision,
          annualAverage: r.annualAverage,
          subjectDecisions: { ...r.subjectDecisions },
          subjectTypes: { ...r.subjectTypes },
        }));
        await saveWithOfflineFallback(
          '/api/admin/exemptions/save',
          'POST',
          {
            ...(yearSnap ? { yearId: yearSnap } : {}),
            classId: classSnap,
            entries,
            status: 'draft',
          },
          'حفظ تلقائي لمسودة الإعفاءات'
        );
        if (exemptEditVersionRef.current === verAtSchedule) {
          setExemptDirty(false);
          setExemptAutoState('saved');
          onChanged();
        }
      } catch (err: any) {
        setExemptAutoState('error');
        setFeedback({ type: 'error', message: err?.message || 'تعذر الحفظ التلقائي لمسودة الإعفاء.' });
      }
    }, 650);
    return () => window.clearTimeout(timer);
  }, [entryMode, isTeacher, canEdit, exemptLoading, exemptDirty, exemptRows, classId, selectedYearId, onChanged]);

  const handleBatchStatus = async (status: GradeStatus) => {
    setFeedback(null);
    setSaving(true);
    try {
      const res = await apiFetch<{ updatedCount: number }>('/api/admin/grades/status', {
        method: 'POST',
        body: JSON.stringify({
          ...(selectedYearId ? { yearId: selectedYearId } : {}),
          classId: Number(classId),
          sectionId: effectiveSectionId === 'all' ? 'all' : Number(effectiveSectionId),
          subjectId: Number(subjectId),
          examId: Number(examId),
          status,
        }),
      });
      setFeedback({
        type: 'success',
        message:
          status === 'published'
            ? `تم اعتماد ونشر ${res.updatedCount} درجة في "${GRADE_STATUS_LABELS[status]}". لتوليد رابط مشاركة خارجي، استخدم تبويب "الإعلانات والاعتراضات".`
            : `تم تحديث حالة ${res.updatedCount} درجة مرصودة إلى "${GRADE_STATUS_LABELS[status]}".`,
      });
      await loadBatch(true);
      onChanged();
    } catch (err: any) {
      setFeedback({ type: 'error', message: err?.message || 'تعذر تحديث الحالة.' });
    } finally {
      setSaving(false);
    }
  };

  const handlePublishAllSubjects = async () => {
    if (!classId || !examId) return;
    setFeedback(null);
    setSaving(true);
    try {
      const res = await apiFetch<{ updatedCount: number; subjectCount: number }>(
        '/api/admin/grades/publish-all-subjects',
        {
          method: 'POST',
          body: JSON.stringify({
            ...(selectedYearId ? { yearId: selectedYearId } : {}),
            classId: Number(classId),
            sectionId: effectiveSectionId === 'all' ? 'all' : Number(effectiveSectionId),
            examId: Number(examId),
            status: 'published',
          }),
        }
      );
      setFeedback({
        type: 'success',
        message:
          res.updatedCount > 0
            ? `تم نشر جميع المواد دفعة واحدة لهذا الامتحان (${res.subjectCount} مادة — ${res.updatedCount} درجة معتمدة). يمكنك الآن إنشاء رابط النشرة من قسم "الإعلانات والاعتراضات".`
            : 'لا توجد درجات مسجلة لنشرها في هذا الامتحان وهذا الصف حتى الآن.',
      });
      await loadBatch(true);
      onChanged();
    } catch (err: any) {
      setFeedback({ type: 'error', message: err?.message || 'تعذر نشر جميع المواد.' });
    } finally {
      setSaving(false);
    }
  };

  const handleCalculateEfforts = async () => {
    if (!classId || isTeacher) return;
    setFeedback(null);
    setCalculating(true);
    try {
      const res = await apiFetch<EffortCalculationResult>('/api/admin/grades/calculate-efforts', {
        method: 'POST',
        body: JSON.stringify({
          ...(selectedYearId ? { yearId: selectedYearId } : {}),
          target: calcTarget,
          classId: Number(classId),
          sectionId: effectiveSectionId === 'all' ? 'all' : Number(effectiveSectionId),
          subjectId: calcSubjectScope === 'selected' && subjectId ? Number(subjectId) : 'all',
          requirePublishedComponents: calcRequirePublished,
          targetStatus: canPublish ? calcTargetStatus : 'draft',
        }),
      });
      setFeedback({
        type: 'success',
        message:
          res.calculatedCount > 0
            ? `تم الاحتساب بأمر المدير لـ (${res.targetExamNames.join('، ')}): اعتُمد حساب ${res.calculatedCount} درجة، وتُركت ${res.skippedIncompleteCount} خانة غير مكتملة الدرجات دون حساب (${res.status === 'published' ? 'منشورة' : 'مسودة للمراجعة'}).`
            : `لم يتم احتساب أي خانة لعدم اكتمال الدرجات المطلوبة في هذا النطاق (غير مكتمل: ${res.skippedIncompleteCount}).`,
      });
      await loadBatch(true);
      onChanged();
    } catch (err: any) {
      setFeedback({ type: 'error', message: err?.message || 'تعذر تنفيذ الاحتساب التلقائي للسعي.' });
    } finally {
      setCalculating(false);
    }
  };

  const handleDownloadScopedTemplate = async (scope: 'selected' | 'all') => {
    setDownloadingTemplate(true);
    setFeedback(null);
    try {
      const params = new URLSearchParams({
        ...(selectedYearId ? { yearId: String(selectedYearId) } : {}),
        classId,
        sectionId: effectiveSectionId || 'all',
        subjectId: scope === 'all' ? 'all' : subjectId,
        examId,
      });
      await apiDownload(
        `/api/admin/export/template/grades?${params.toString()}`,
        scope === 'all'
          ? `قالب-درجات-كل-المواد-${classId}.xlsx`
          : `قالب-درجات-${subjectId}-${examId}.xlsx`
      );
    } catch (err: any) {
      setFeedback({ type: 'error', message: err?.message || 'تعذر تنزيل قالب الدرجات.' });
    } finally {
      setDownloadingTemplate(false);
    }
  };

  const handleExportGradesExcel = async (scope: 'subject' | 'all' = 'all') => {
    setDownloadingTemplate(true);
    setFeedback(null);
    try {
      const params = new URLSearchParams({
        ...(selectedYearId ? { yearId: String(selectedYearId) } : {}),
        ...(classId ? { classId } : {}),
        ...(effectiveSectionId && effectiveSectionId !== 'all' ? { sectionId: effectiveSectionId } : {}),
        ...(examId ? { examId } : {}),
        ...(scope === 'subject' && subjectId ? { subjectId } : {}),
      });
      await apiDownload(
        `/api/admin/export/grades.xlsx?${params.toString()}`,
        scope === 'subject' && subjectId
          ? `سجل-درجات-المادة-${classId || 'all'}.xlsx`
          : `سجل-الدرجات-${classId || 'all'}.xlsx`
      );
    } catch (err: any) {
      setFeedback({ type: 'error', message: err?.message || 'تعذر تصدير سجل الدرجات.' });
    } finally {
      setDownloadingTemplate(false);
    }
  };

  const handleExportQualificationRegister = async () => {
    if (!classId) return;
    setDownloadingTemplate(true);
    setFeedback(null);
    try {
      const qs = new URLSearchParams({
        ...(selectedYearId ? { yearId: String(selectedYearId) } : {}),
        classId: String(classId),
        ...(effectiveSectionId && effectiveSectionId !== 'all' ? { sectionId: effectiveSectionId } : {}),
      });
      await apiDownload(`/api/admin/export/grade6-qualification.xlsx?${qs.toString()}`, `سجل-تأهيل-السادس-${classId}.xlsx`);
    } catch (err: any) {
      setFeedback({ type: 'error', message: err?.message || 'تعذر تصدير سجل التأهيل الوزاري.' });
    } finally {
      setDownloadingTemplate(false);
    }
  };

  const handleExportExemptionsRegister = async () => {
    if (!classId) return;
    setDownloadingTemplate(true);
    setFeedback(null);
    try {
      const qs = new URLSearchParams({
        ...(selectedYearId ? { yearId: String(selectedYearId) } : {}),
        classId: String(classId),
        ...(effectiveSectionId && effectiveSectionId !== 'all' ? { sectionId: effectiveSectionId } : {}),
      });
      await apiDownload(`/api/admin/export/exemptions.xlsx?${qs.toString()}`, `سجل-الإعفاءات-${classId}.xlsx`);
    } catch (err: any) {
      setFeedback({ type: 'error', message: err?.message || 'تعذر تصدير سجل الإعفاءات.' });
    } finally {
      setDownloadingTemplate(false);
    }
  };

  // Grade 6 Ministerial Qualification handlers
  const updateQualRowSubject = (
    studentId: number,
    subjId: number,
    val: MinisterialDecision | null
  ) => {
    qualEditVersionRef.current += 1;
    setQualDirty(true);
    setQualAutoState('idle');
    setQualRows((prev) =>
      prev.map((r) =>
        r.studentId === studentId
          ? { ...r, subjectDecisions: { ...r.subjectDecisions, [subjId]: val } }
          : r
      )
    );
  };

  const updateQualRowOverall = (
    studentId: number,
    val: MinisterialDecision | null,
    notes?: string
  ) => {
    qualEditVersionRef.current += 1;
    setQualDirty(true);
    setQualAutoState('idle');
    setQualRows((prev) =>
      prev.map((r) =>
        r.studentId === studentId
          ? {
              ...r,
              overallDecision: val,
              ...(notes !== undefined ? { overallNotes: notes } : {}),
            }
          : r
      )
    );
  };

  const handleSaveQualification = async (targetStatus: 'draft' | 'published') => {
    if (isTeacher || qualRows.length === 0) return;
    setFeedback(null);
    setQualSaving(true);
    try {
      const entries = qualRows.map((r) => ({
        studentId: r.studentId,
        overallDecision: r.overallDecision,
        overallNotes: r.overallNotes,
        subjectDecisions: qualSubjects.map((sub) => ({
          subjectId: sub.id,
          decision: r.subjectDecisions[sub.id] ?? null,
        })),
      }));
      const res = await apiFetch<{
        savedSubjects: number;
        savedOverall: number;
        status: 'draft' | 'published';
      }>('/api/admin/grade6-qualification/save', {
        method: 'POST',
        body: JSON.stringify({
          ...(selectedYearId ? { yearId: selectedYearId } : {}),
          entries,
          status: targetStatus,
        }),
      });
      setFeedback({
        type: 'success',
        message:
          res.status === 'published'
            ? `تم اعتماد ونشر التأهيل الوزاري للسادس بنجاح (${res.savedSubjects} تأهيل مادة، ${res.savedOverall} قرار عام).`
            : `تم حفظ مسودة التأهيل الوزاري (${res.savedSubjects} مادة، ${res.savedOverall} قرار عام).`,
      });
      await loadQualificationGrid(true);
      onChanged();
    } catch (err: any) {
      setFeedback({ type: 'error', message: err?.message || 'تعذر حفظ التأهيل الوزاري.' });
    } finally {
      setQualSaving(false);
    }
  };

  const handleCalculateQualification = async () => {
    if (isTeacher || !classId) return;
    setFeedback(null);
    setQualSaving(true);
    try {
      const res = await apiFetch<{
        processedCount: number;
        qualifiedCount: number;
        notQualifiedCount: number;
        incompleteCount: number;
        status: 'draft' | 'published';
      }>('/api/admin/grade6-qualification/calculate', {
        method: 'POST',
        body: JSON.stringify({
          ...(selectedYearId ? { yearId: selectedYearId } : {}),
          classId: Number(classId),
          sectionId: effectiveSectionId || 'all',
          targetStatus: canPublish ? qualCalcStatus : 'draft',
        }),
      });
      setQualCalcSummary({
        qualifiedCount: res.qualifiedCount,
        notQualifiedCount: res.notQualifiedCount,
        incompleteCount: res.incompleteCount,
        status: res.status,
      });
      setFeedback({
        type: 'success',
        message: `تم احتساب التأهيل الوزاري بأمر المدير (ضابط ${qualRuleInfo.maxFail} دروس + ${qualRuleInfo.bonus} قرار): مؤهل ${res.qualifiedCount} · غير مؤهل ${res.notQualifiedCount} · غير مكتمل السعي السنوي ${res.incompleteCount} (${res.status === 'published' ? 'منشور' : 'مسودة للمراجعة'}).`,
      });
      await loadQualificationGrid(true);
      onChanged();
    } catch (err: any) {
      setFeedback({ type: 'error', message: err?.message || 'تعذر تنفيذ حساب التأهيل الوزاري.' });
    } finally {
      setQualSaving(false);
    }
  };

  const handleDownloadQualificationTemplate = async () => {
    if (!classId) return;
    setDownloadingTemplate(true);
    setFeedback(null);
    try {
      const qs = new URLSearchParams({
        ...(selectedYearId ? { yearId: String(selectedYearId) } : {}),
        classId,
        sectionId: effectiveSectionId || 'all',
      }).toString();
      await apiDownload(
        `/api/admin/export/template/grade6-qualification?${qs}`,
        `قالب-تأهيل-السادس-${classId}.xlsx`
      );
    } catch (err: any) {
      setFeedback({ type: 'error', message: err?.message || 'تعذر تنزيل قالب التأهيل الوزاري.' });
    } finally {
      setDownloadingTemplate(false);
    }
  };

  const handleQualExcelUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFeedback(null);
    setQualImportPreview(null);
    setQualSaving(true);
    try {
      const buffer = await file.arrayBuffer();
      const normalized = parseSpreadsheetBuffer(buffer, file.name);
      setQualImportRawRows(normalized);
      const previewRes = await apiFetch<ImportPreviewResponse<QualImportPreviewNormalized>>(
        '/api/admin/grade6-qualification/import-preview',
        {
          method: 'POST',
          body: JSON.stringify({
            ...(selectedYearId ? { yearId: selectedYearId } : {}),
            classId: Number(classId),
            sectionId: effectiveSectionId || 'all',
            rows: normalized,
          }),
        }
      );
      setQualImportPreview(previewRes);
    } catch (err: any) {
      setFeedback({ type: 'error', message: err?.message || 'تعذر قراءة ملف التأهيل الوزاري.' });
    } finally {
      setQualSaving(false);
      e.target.value = '';
    }
  };

  const handleCommitQualImport = async () => {
    if (qualImportRawRows.length === 0) return;
    setFeedback(null);
    setQualSaving(true);
    try {
      await apiFetch('/api/admin/grade6-qualification/import-commit', {
        method: 'POST',
        body: JSON.stringify({
          ...(selectedYearId ? { yearId: selectedYearId } : {}),
          classId: Number(classId),
          sectionId: effectiveSectionId || 'all',
          rows: qualImportRawRows,
          targetStatus: canPublish ? qualImportStatus : 'draft',
        }),
      });
      setQualImportPreview(null);
      setQualImportRawRows([]);
      setFeedback({
        type: 'success',
        message: 'تم اعتماد استيراد قرارات التأهيل الوزاري وحفظها في النظام.',
      });
      await loadQualificationGrid(true);
      onChanged();
    } catch (err: any) {
      setFeedback({ type: 'error', message: err?.message || 'تعذر اعتماد استيراد التأهيل.' });
    } finally {
      setQualSaving(false);
    }
  };

  // Non-Ministerial Iraqi Exemptions handlers
  const updateExemptionSubject = (
    studentId: number,
    subjId: number,
    val: ExemptionDecision | null
  ) => {
    exemptEditVersionRef.current += 1;
    setExemptDirty(true);
    setExemptAutoState('idle');
    setExemptRows((prev) =>
      prev.map((r) =>
        r.studentId === studentId
          ? {
              ...r,
              subjectDecisions: { ...r.subjectDecisions, [subjId]: val },
              subjectTypes: { ...r.subjectTypes, [subjId]: r.overallDecision === 'exempt' ? 'general' : 'individual' },
            }
          : r
      )
    );
  };

  const updateExemptionOverall = (studentId: number, val: ExemptionDecision | null) => {
    exemptEditVersionRef.current += 1;
    setExemptDirty(true);
    setExemptAutoState('idle');
    setExemptRows((prev) =>
      prev.map((r) => {
        if (r.studentId !== studentId) return r;
        const nextSubjDecisions = { ...r.subjectDecisions };
        const nextSubjTypes = { ...r.subjectTypes };
        if (val === 'exempt') {
          for (const sub of exemptSubjects) {
            nextSubjDecisions[sub.id] = 'exempt';
            nextSubjTypes[sub.id] = 'general';
          }
        }
        return {
          ...r,
          overallDecision: val,
          subjectDecisions: nextSubjDecisions,
          subjectTypes: nextSubjTypes,
        };
      })
    );
  };

  const handleSaveExemptions = async (targetStatus: 'draft' | 'published') => {
    if (isTeacher || exemptRows.length === 0) return;
    setFeedback(null);
    setExemptSaving(true);
    const snapshot = exemptRows.map((r) => ({
      studentId: r.studentId,
      overallDecision: r.overallDecision,
      annualAverage: r.annualAverage,
      subjectDecisions: { ...r.subjectDecisions },
      subjectTypes: { ...r.subjectTypes },
    }));
    try {
      const res = await saveWithOfflineFallback<{
        ok: boolean;
        savedCount: number;
        status: 'draft' | 'published';
      }>(
        '/api/admin/exemptions/save',
        'POST',
        {
          ...(selectedYearId ? { yearId: selectedYearId } : {}),
          classId: Number(classId),
          entries: snapshot,
          status: targetStatus,
        },
        'حفظ قرارات الإعفاء'
      );

      if (res.queued) {
        setFeedback({
          type: 'success',
          message: 'تم حفظ قرارات الإعفاء محلياً دون اتصال، وستُزامَن فور عودة الإنترنت.',
        });
      } else {
        setFeedback({
          type: 'success',
          message:
            res.response?.status === 'published'
              ? `تم اعتماد ونشر قرارات الإعفاء الفردي والعام (${res.response?.savedCount ?? snapshot.length} طالب).`
              : `تم حفظ مسودة قرارات الإعفاء (${res.response?.savedCount ?? snapshot.length} طالب).`,
        });
        await loadExemptionsGrid(true);
        onChanged();
      }
      setExemptDirty(false);
    } catch (err: any) {
      setFeedback({ type: 'error', message: err?.message || 'تعذر حفظ قرارات الإعفاء.' });
    } finally {
      setExemptSaving(false);
    }
  };

  const handleCalculateExemptions = async () => {
    if (isTeacher || !classId) return;
    setFeedback(null);
    setExemptSaving(true);
    try {
      const res = await apiFetch<{
        ok: boolean;
        processedStudents: number;
        generalExemptCount: number;
        individualSubjectCount: number;
        status: 'draft' | 'published';
      }>('/api/admin/exemptions/calculate', {
        method: 'POST',
        body: JSON.stringify({
          ...(selectedYearId ? { yearId: selectedYearId } : {}),
          classId: Number(classId),
          sectionId: effectiveSectionId || 'all',
          targetStatus: canPublish ? exemptCalcStatus : 'draft',
        }),
      });
      setExemptCalcSummary({
        processedStudents: res.processedStudents,
        generalCount: res.generalExemptCount,
        individualCount: res.individualSubjectCount,
        status: res.status,
      });
      setFeedback({
        type: 'success',
        message: `تم احتساب الإعفاءات بأمر المدير (${res.processedStudents} طالب): إعفاء عام (${res.generalExemptCount}) · مواد إعفاء فردي (${res.individualSubjectCount}) [${res.status === 'published' ? 'منشور للطلبة' : 'مسودة للمراجعة'}].`,
      });
      await loadExemptionsGrid(true);
      onChanged();
    } catch (err: any) {
      setFeedback({ type: 'error', message: err?.message || 'تعذر تنفيذ احتساب الإعفاءات.' });
    } finally {
      setExemptSaving(false);
    }
  };

  const handleDownloadExemptionTemplate = async () => {
    if (!classId) return;
    setDownloadingTemplate(true);
    setFeedback(null);
    try {
      const qs = new URLSearchParams({
        ...(selectedYearId ? { yearId: String(selectedYearId) } : {}),
        classId,
        sectionId: effectiveSectionId || 'all',
      }).toString();
      await apiDownload(
        `/api/admin/export/template/exemptions?${qs}`,
        `قالب-الإعفاءات-${classId}.xlsx`
      );
    } catch (err: any) {
      setFeedback({ type: 'error', message: err?.message || 'تعذر تنزيل قالب الإعفاءات.' });
    } finally {
      setDownloadingTemplate(false);
    }
  };

  const handleExemptionExcelUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFeedback(null);
    setExemptImportPreview(null);
    setExemptSaving(true);
    try {
      const buffer = await file.arrayBuffer();
      const normalized = parseSpreadsheetBuffer(buffer, file.name);
      setExemptImportRawRows(normalized);
      const previewRes = await apiFetch<ImportPreviewResponse<NormalizedExemptionImport>>(
        '/api/admin/exemptions/import-preview',
        {
          method: 'POST',
          body: JSON.stringify({
            ...(selectedYearId ? { yearId: selectedYearId } : {}),
            classId: Number(classId),
            sectionId: effectiveSectionId || 'all',
            rows: normalized,
          }),
        }
      );
      setExemptImportPreview(previewRes);
    } catch (err: any) {
      setFeedback({ type: 'error', message: err?.message || 'تعذر قراءة ملف الإعفاءات.' });
    } finally {
      setExemptSaving(false);
      e.target.value = '';
    }
  };

  const handleCommitExemptionImport = async () => {
    if (exemptImportRawRows.length === 0) return;
    setFeedback(null);
    setExemptSaving(true);
    try {
      const res = await apiFetch<{ importedCount: number; rejectedCount: number }>(
        '/api/admin/exemptions/import-commit',
        {
          method: 'POST',
          body: JSON.stringify({
            ...(selectedYearId ? { yearId: selectedYearId } : {}),
            classId: Number(classId),
            sectionId: effectiveSectionId || 'all',
            rows: exemptImportRawRows,
            targetStatus: canPublish ? exemptImportStatus : 'draft',
          }),
        }
      );
      setExemptImportPreview(null);
      setExemptImportRawRows([]);
      setFeedback({
        type: 'success',
        message: `تم استيراد واعتماد قرارات الإعفاء (${res.importedCount} طالب، مرفوض: ${res.rejectedCount}).`,
      });
      await loadExemptionsGrid(true);
      onChanged();
    } catch (err: any) {
      setFeedback({ type: 'error', message: err?.message || 'تعذر اعتماد استيراد الإعفاءات.' });
    } finally {
      setExemptSaving(false);
    }
  };

  // Unified Batch Grade Import handlers (supports single subject or all subjects matrix)
  const handleBatchExcelUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFeedback(null);
    setBatchPreview(null);
    setSaving(true);
    try {
      const buffer = await file.arrayBuffer();
      const normalized = parseSpreadsheetBuffer(buffer, file.name);
      setBatchRawRows(normalized);

      const useAllScope = !isTeacher && batchSubjectScope === 'all';
      const previewRes = await apiFetch<ImportPreviewResponse<NormalizedGradePreview>>(
        '/api/admin/import/preview',
        {
          method: 'POST',
          body: JSON.stringify({
            type: 'grades',
            rows: normalized,
            ...(selectedYearId ? { yearId: selectedYearId } : {}),
            options: {
              ...(selectedYearId ? { yearId: selectedYearId } : {}),
              defaultSubjectId: useAllScope ? null : Number(subjectId),
              defaultExamId: Number(examId),
              defaultClassId: Number(classId),
              defaultSectionId: effectiveSectionId,
            },
          }),
        }
      );
      setBatchPreview(previewRes);
    } catch (err: any) {
      setFeedback({ type: 'error', message: err?.message || 'تعذر قراءة ملف Excel.' });
    } finally {
      setSaving(false);
      e.target.value = '';
    }
  };

  const handleCommitBatchExcel = async () => {
    if (batchRawRows.length === 0) return;
    setSaving(true);
    setFeedback(null);
    try {
      const useAllScope = !isTeacher && batchSubjectScope === 'all';
      const res = await apiFetch<{ importedCount: number; rejectedCount: number }>(
        '/api/admin/import/commit',
        {
          method: 'POST',
          body: JSON.stringify({
            type: 'grades',
            rows: batchRawRows,
            ...(selectedYearId ? { yearId: selectedYearId } : {}),
            options: {
              ...(selectedYearId ? { yearId: selectedYearId } : {}),
              defaultSubjectId: useAllScope ? null : Number(subjectId),
              defaultExamId: Number(examId),
              defaultClassId: Number(classId),
              defaultSectionId: effectiveSectionId,
              targetStatus: canPublish ? batchTargetStatus : 'draft',
            },
          }),
        }
      );
      setBatchPreview(null);
      setBatchRawRows([]);
      setEntryMode('manual');
      setShowStudentsTable(true);
      setFeedback({
        type: 'success',
        message: `تم رفع واعتماد ${res.importedCount} درجة بنجاح (مرفوض: ${res.rejectedCount}).`,
      });
      await loadBatch(true);
      onChanged();
    } catch (err: any) {
      setFeedback({ type: 'error', message: err?.message || 'تعذر اعتماد الدرجات المستوردة.' });
    } finally {
      setSaving(false);
    }
  };

  if (isTeacher && allowedClasses.length === 0) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-8 text-center text-sm text-amber-900">
        لم يتم إسناد أي مواد أو صفوف لحسابك التدريسي حتى الآن. يرجى مراجعة مدير المدرسة.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Teacher Scope Banner */}
      {isTeacher && (
        <div className="bg-[#0B1F3A] text-white rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <GraduationCap className="w-5 h-5 text-[#C59B27] shrink-0" />
            <div className="text-xs sm:text-sm">
              <span className="font-bold">نطاق الصلاحية التدريسية:</span> يمكنك رفع وتعديل درجات الأشهر وسعي الفصلين للمواد والصفوف الموكلة لك فقط.
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {assignments.map((a, i) => (
              <span
                key={i}
                className="px-2.5 py-1 rounded bg-white/10 border border-white/15 text-xs font-semibold text-[#C59B27]"
              >
                {a.subjectName} — {a.className} ({a.sectionId === null ? 'كل الشعب' : `شعبة ${a.sectionName}`})
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Selection Bar with soft class accent indicator */}
      <div className={`bg-white border rounded-xl p-4 space-y-3 ${classTheme.cardBorder}`}>
        <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-100">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-md border text-xs font-extrabold ${classTheme.badgeBg} ${classTheme.badgeText} ${classTheme.badgeBorder}`}
            >
              <span>{selectedClassObj?.name || 'اختر الصف'}</span>
              {selectedClassObj?.isMinisterial && <span>· سادس وزاري</span>}
            </span>
            {selectedSubjectObj && entryMode !== 'qual' && entryMode !== 'exemptions' && (
              <span className="text-xs font-bold text-[#0B1F3A]">
                {selectedSubjectObj.name} — {selectedExamObj?.name || ''}
              </span>
            )}
          </div>
          {autoSaveNote && entryMode === 'manual' && (
            <span
              role="status"
              className={`inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-md ${
                autoSaveStatus === 'offline'
                  ? 'bg-amber-100 text-amber-900'
                  : autoSaveStatus === 'error'
                    ? 'bg-red-100 text-red-800'
                    : autoSaveStatus === 'saving'
                      ? 'bg-slate-100 text-slate-700'
                      : 'bg-emerald-50 text-emerald-800'
              }`}
            >
              {autoSaveStatus === 'offline' && <CloudOff className="w-3.5 h-3.5" />}
              <span>{autoSaveNote}</span>
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label htmlFor="grades-class" className="block text-xs font-bold text-slate-600 mb-1">
              الصف الدراسي
            </label>
            <div className="relative">
              <select
                id="grades-class"
                value={classId}
                onChange={(e) => setClassId(e.target.value)}
                className="w-full min-h-[44px] appearance-none pr-3 pl-8 py-2 text-sm rounded-lg border border-slate-300 bg-white cursor-pointer"
              >
                {allowedClasses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <ChevronDown aria-hidden="true" className="w-4 h-4 text-slate-500 pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2" />
            </div>
          </div>

          <div>
            <label htmlFor="grades-subject" className="block text-xs font-bold text-slate-600 mb-1">
              المادة الدراسية
            </label>
            <div className="relative">
              <select
                id="grades-subject"
                value={subjectId}
                onChange={(e) => setSubjectId(e.target.value)}
                className="w-full min-h-[44px] appearance-none pr-3 pl-8 py-2 text-sm rounded-lg border border-slate-300 bg-white cursor-pointer"
              >
                {allowedSubjects.map((sub) => (
                  <option key={sub.id} value={sub.id}>
                    {sub.name} (من {sub.maxScore})
                  </option>
                ))}
              </select>
              <ChevronDown aria-hidden="true" className="w-4 h-4 text-slate-500 pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2" />
            </div>
          </div>

          <div>
            <label htmlFor="grades-section" className="block text-xs font-bold text-slate-600 mb-1">
              الشعبة
            </label>
            <div className="relative">
              <select
                id="grades-section"
                value={effectiveSectionId}
                onChange={(e) => setSectionId(e.target.value)}
                className="w-full min-h-[44px] appearance-none pr-3 pl-8 py-2 text-sm rounded-lg border border-slate-300 bg-white cursor-pointer"
              >
                {canViewAllSections && <option value="all">جميع الشعب</option>}
                {filteredSections.map((s) => (
                  <option key={s.id} value={s.id}>
                    شعبة {s.name}
                  </option>
                ))}
              </select>
              <ChevronDown aria-hidden="true" className="w-4 h-4 text-slate-500 pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2" />
            </div>
          </div>

          <div>
            <label htmlFor="grades-exam" className="block text-xs font-bold text-slate-600 mb-1">
              نوع الامتحان
            </label>
            <div className="relative">
              <select
                id="grades-exam"
                value={examId}
                onChange={(e) => setExamId(e.target.value)}
                className="w-full min-h-[44px] appearance-none pr-3 pl-8 py-2 text-sm rounded-lg border border-slate-300 bg-white cursor-pointer"
              >
                {allowedExams.map((ex) => (
                  <option key={ex.id} value={ex.id}>
                    {ex.name}
                  </option>
                ))}
              </select>
              <ChevronDown aria-hidden="true" className="w-4 h-4 text-slate-500 pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2" />
            </div>
          </div>
        </div>
      </div>

      {/* Mode Switch & Quick Actions Bar */}
      <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg">
            <button
              type="button"
              onClick={() => setEntryMode('manual')}
              className={`min-h-[40px] px-3.5 py-1.5 text-xs font-bold rounded-md cursor-pointer transition-colors ${
                entryMode === 'manual'
                  ? 'bg-[#0B1F3A] text-white'
                  : 'text-slate-600 hover:text-[#0B1F3A]'
              }`}
            >
              الإدخال اليدوي المرن
            </button>
            <button
              type="button"
              onClick={() => setEntryMode('batch')}
              className={`min-h-[40px] px-3.5 py-1.5 text-xs font-bold rounded-md cursor-pointer transition-colors ${
                entryMode === 'batch'
                  ? 'bg-[#0B1F3A] text-white'
                  : 'text-slate-600 hover:text-[#0B1F3A]'
              }`}
            >
              الرفع والتصدير الجماعي (Excel)
            </button>
            {!isTeacher && (
              <button
                type="button"
                onClick={() => setEntryMode('exemptions')}
                className={`min-h-[40px] inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold rounded-md cursor-pointer transition-colors ${
                  entryMode === 'exemptions'
                    ? 'bg-[#0B1F3A] text-[#C59B27]'
                    : !selectedClassObj?.isMinisterial
                      ? 'bg-emerald-50 text-emerald-900 border border-emerald-200 hover:bg-emerald-100'
                      : 'text-slate-600 hover:text-[#0B1F3A]'
                }`}
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>الإعفاء الفردي والعام</span>
              </button>
            )}
            {!isTeacher && (
              <button
                type="button"
                onClick={() => setEntryMode('qual')}
                className={`min-h-[40px] inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold rounded-md cursor-pointer transition-colors ${
                  entryMode === 'qual'
                    ? 'bg-[#0B1F3A] text-[#C59B27]'
                    : selectedClassObj?.isMinisterial
                      ? 'bg-amber-50 text-amber-900 border border-amber-200 hover:bg-amber-100'
                      : 'text-slate-600 hover:text-[#0B1F3A]'
                }`}
              >
                <Award className="w-3.5 h-3.5" />
                <span>تأهيل السادس الوزاري</span>
              </button>
            )}
          </div>

          <span className="text-xs text-slate-600">
            {entryMode === 'qual' ? (
              <span className="inline-flex flex-wrap items-center gap-2">
                <span>
                  ضوابط السادس:{' '}
                  <strong className="text-[#0B1F3A] tabular-nums">
                    {qualRuleInfo.maxFail} دروس · {qualRuleInfo.bonus} درجات قرار
                  </strong>
                </span>
                <span
                  className={`px-2 py-0.5 rounded font-bold ${
                    qualAutoState === 'saving' || qualDirty
                      ? 'bg-amber-50 text-amber-900'
                      : qualAutoState === 'saved'
                        ? 'bg-emerald-50 text-emerald-800'
                        : qualAutoState === 'error'
                          ? 'bg-red-50 text-red-700'
                          : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {qualAutoState === 'saving'
                    ? 'جاري الحفظ تلقائياً...'
                    : qualDirty
                      ? 'جاري حفظ التعديلات...'
                      : qualAutoState === 'saved'
                        ? 'تم الحفظ تلقائياً'
                        : 'الحفظ التلقائي للمسودة مفعّل'}
                </span>
              </span>
            ) : entryMode === 'exemptions' ? (
              <span className="inline-flex flex-wrap items-center gap-2">
                <span>
                  ضوابط الإعفاء:{' '}
                  <strong className="text-[#0B1F3A] tabular-nums">
                    العام ≥{exemptRules.generalMinAvg} (أدنى {exemptRules.minSubject}) · الفردي ≥{exemptRules.individualMin}
                  </strong>
                </span>
                <span
                  className={`px-2 py-0.5 rounded font-bold ${
                    exemptAutoState === 'saving' || exemptDirty
                      ? 'bg-amber-50 text-amber-900'
                      : exemptAutoState === 'saved'
                        ? 'bg-emerald-50 text-emerald-800'
                        : exemptAutoState === 'error'
                          ? 'bg-red-50 text-red-700'
                          : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {exemptAutoState === 'saving'
                    ? 'جاري الحفظ تلقائياً...'
                    : exemptDirty
                      ? 'جاري حفظ التعديلات...'
                      : exemptAutoState === 'saved'
                        ? 'تم الحفظ تلقائياً'
                        : 'الحفظ التلقائي للمسودة مفعّل'}
                </span>
              </span>
            ) : (
              <>
                النهاية العظمى:{' '}
                <strong className="text-[#0B1F3A] tabular-nums">{maxScore}</strong>
                {dirtyStudentIds.length > 0 ? (
                  <span className="mr-2 px-2 py-0.5 rounded bg-amber-100 text-amber-900 font-bold">
                    جاري حفظ {dirtyStudentIds.length} تعديل...
                  </span>
                ) : (
                  <span className="mr-2 px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 font-semibold">
                    حفظ تلقائي مباشر
                  </span>
                )}
              </>
            )}
          </span>
        </div>

        {entryMode === 'manual' && (
          <div className="flex flex-wrap items-center gap-2">
            <ActionMenu
              label="إجراءات العرض والاحتساب"
              icon={showStudentsTable ? EyeOff : Eye}
              variant="secondary"
              items={[
                {
                  id: 'manual-toggle-table',
                  label: showStudentsTable ? 'إخفاء جدول الطلبة' : `عرض جدول الطلبة (${rows.length})`,
                  icon: showStudentsTable ? EyeOff : Eye,
                  onClick: () => setShowStudentsTable((v) => !v),
                },
                ...(!isTeacher && canEdit
                  ? [
                      {
                        id: 'manual-effort-calc',
                        label: showEffortCalc
                          ? 'إخفاء شريط احتساب السعي'
                          : 'احتساب السعي والدرجة النهائية (بأمر المدير)',
                        description: 'فصل أول / فصل ثاني / سعي سنوي / درجة نهائية',
                        icon: Calculator,
                        tone: 'primary' as const,
                        dividerBefore: true,
                        onClick: () => setShowEffortCalc((v) => !v),
                      },
                    ]
                  : []),
              ]}
            />

            {canPublish && (
              <ActionMenu
                label="أوامر النشر والحالة"
                icon={Send}
                variant="emerald"
                disabled={saving}
                items={[
                  {
                    id: 'manual-pub-subject',
                    label: 'نشر درجات هذه المادة للطلبة',
                    icon: Send,
                    disabled: rows.length === 0,
                    tone: 'emerald',
                    onClick: () => void handleBatchStatus('published'),
                  },
                  ...(!isTeacher
                    ? [
                        {
                          id: 'manual-pub-all-subjects',
                          label: 'نشر جميع المواد دفعة واحدة لهذا الامتحان',
                          description: 'اعتماد ونشر كل مواد الصف المختار',
                          icon: Layers,
                          disabled: !classId || !examId,
                          tone: 'primary' as const,
                          onClick: () => void handlePublishAllSubjects(),
                        },
                      ]
                    : []),
                  {
                    id: 'manual-withdraw',
                    label: 'سحب نشر هذه المادة',
                    description: 'إخفاء النتائج مؤقتاً للمراجعة',
                    icon: EyeOff,
                    disabled: rows.length === 0,
                    tone: 'amber',
                    dividerBefore: true,
                    onClick: () => void handleBatchStatus('withdrawn'),
                  },
                ]}
              />
            )}
          </div>
        )}
      </div>

      {/* Second Round Notice */}
      {isSecondRoundSelected && entryMode === 'manual' && (
        <div className="bg-amber-50 border border-amber-300 rounded-xl p-3.5 flex items-start gap-2.5 text-xs sm:text-sm text-amber-950">
          <Sparkles className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
          <div>
            <strong>وضع رصد الدور الثاني:</strong> عند حفظ أو نشر درجة الدور الثاني يتم احتساب الدرجة النهائية تلقائياً من السعي السنوي ودرجة الدور الثاني، مع تمييز المادة في بطاقة الطالب.
          </div>
        </div>
      )}

      {/* Manager-Only Explicit Effort & Final Grade Calculation Bar */}
      {!isTeacher && canEdit && showEffortCalc && (
        <section
          aria-label="احتساب السعي والدرجة النهائية بأمر المدير"
          className="bg-slate-50 border border-[#1E4E8C]/30 rounded-xl p-4 space-y-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-2.5">
            <div className="flex items-center gap-2">
              <Calculator className="w-4 h-4 text-[#1E4E8C]" />
              <h4 className="font-display text-sm font-bold text-[#0B1F3A]">
                احتساب السعي والدرجات المعتمدة بأمر المدير فقط
              </h4>
            </div>
            <span className="text-[11px] font-semibold text-slate-600">
              لا يُحسب السعي تلقائياً إلا بعد اكتمال درجات الأشهر المطلوبة وموافقة المدير.
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-center">
            <div>
              <label htmlFor="calc-target" className="block text-[11px] font-bold text-slate-600 mb-1">
                الحقل المطلوب احتسابه
              </label>
              <select
                id="calc-target"
                value={calcTarget}
                onChange={(e) => setCalcTarget(e.target.value as EffortCalculationTarget)}
                className="w-full min-h-[44px] px-3 py-2 text-xs font-semibold rounded-lg border border-slate-300 bg-white"
              >
                <option value="all">حساب الكل للمكتمل (الفصلين + السنوي + النهائية)</option>
                <option value="sem1Average">سعي الفصل الأول فقط</option>
                <option value="sem2Average">سعي الفصل الثاني فقط</option>
                <option value="annualEffort">السعي السنوي فقط</option>
                <option value="finalGrade">الدرجة النهائية فقط</option>
              </select>
            </div>

            <div>
              <label htmlFor="calc-subject-scope" className="block text-[11px] font-bold text-slate-600 mb-1">
                نطاق المواد
              </label>
              <select
                id="calc-subject-scope"
                value={calcSubjectScope}
                onChange={(e) => setCalcSubjectScope(e.target.value === 'selected' ? 'selected' : 'all')}
                className="w-full min-h-[44px] px-3 py-2 text-xs font-semibold rounded-lg border border-slate-300 bg-white"
              >
                <option value="all">كل المواد للصف المختار</option>
                <option value="selected">المادة المختارة أعلاه فقط</option>
              </select>
            </div>

            {canPublish && (
              <div>
                <label htmlFor="calc-status" className="block text-[11px] font-bold text-slate-600 mb-1">
                  حالة الدرجات الناتجة
                </label>
                <select
                  id="calc-status"
                  value={calcTargetStatus}
                  onChange={(e) =>
                    setCalcTargetStatus(e.target.value === 'published' ? 'published' : 'draft')
                  }
                  className="w-full min-h-[44px] px-3 py-2 text-xs font-semibold rounded-lg border border-slate-300 bg-white"
                >
                  <option value="draft">حفظ كمسودة للمراجعة أولاً</option>
                  <option value="published">اعتماد ونشر مباشر للطلبة</option>
                </select>
              </div>
            )}

            <div className="flex flex-col justify-end gap-2 pt-3 sm:pt-0">
              <label className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={calcRequirePublished}
                  onChange={(e) => setCalcRequirePublished(e.target.checked)}
                />
                <span>الاعتماد من الدرجات المنشورة فقط</span>
              </label>
              <button
                type="button"
                disabled={calculating || !classId}
                onClick={handleCalculateEfforts}
                className="min-h-[44px] inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-[#0B1F3A] hover:bg-[#1E4E8C] text-white text-xs font-bold rounded-lg cursor-pointer disabled:opacity-50"
              >
                <Calculator className="w-3.5 h-3.5 text-[#C59B27]" />
                <span>{calculating ? 'جاري الاحتساب...' : 'تنفيذ الاحتساب والاعتماد'}</span>
              </button>
            </div>
          </div>
        </section>
      )}

      {feedback && (
        <div
          role={feedback.type === 'error' ? 'alert' : 'status'}
          className={`flex items-center gap-2 p-3.5 rounded-lg border text-sm ${
            feedback.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-red-50 border-red-200 text-red-800'
          }`}
        >
          {feedback.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 shrink-0" />
          )}
          <span>{feedback.message}</span>
        </div>
      )}

      {/* ===================================================================== */}
      {/* UNIFIED BATCH EXCEL IMPORT & EXPORT MODE                              */}
      {/* ===================================================================== */}
      {entryMode === 'batch' && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
            <div>
              <h3 className="font-display text-base font-bold text-[#0B1F3A]">
                استيراد وتصدير الدرجات (Excel / CSV)
              </h3>
              <p className="text-xs text-slate-600 mt-0.5">
                نزّل قالب المادة الواحدة أو القالب العام لكل المواد بأسماء الطلبة وأرقامهم الوطنية، أو صدّر السجل الكامل للدرجات.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <ActionMenu
                label={
                  downloadingTemplate
                    ? 'جاري التنزيل / التصدير...'
                    : saving
                      ? 'جاري فحص الملف...'
                      : 'أوامر القوالب والتصدير والاستيراد (Excel)'
                }
                icon={FileSpreadsheet}
                variant="navy"
                disabled={downloadingTemplate || saving}
                items={[
                  {
                    id: 'tpl-selected',
                    label: 'تنزيل قالب المادة المختارة (Excel)',
                    description: 'مرتب بالأسماء وأرقام الهوية للمادة والامتحان المحددين',
                    icon: Download,
                    disabled: !classId || !subjectId || !examId,
                    onClick: () => void handleDownloadScopedTemplate('selected'),
                  },
                  ...(!isTeacher
                    ? [
                        {
                          id: 'tpl-all',
                          label: 'تنزيل القالب العام لكل المواد (Excel)',
                          description: 'يشمل جميع مواد الصف المختار في أعمدة مستقلة',
                          icon: Download,
                          disabled: !classId || !examId,
                          onClick: () => void handleDownloadScopedTemplate('all'),
                        },
                      ]
                    : []),
                  {
                    id: 'exp-grades-subject',
                    label: 'تصدير سجل درجات المادة الحالية (Excel)',
                    icon: FileSpreadsheet,
                    tone: 'emerald',
                    dividerBefore: true,
                    disabled: !subjectId,
                    onClick: () => void handleExportGradesExcel('subject'),
                  },
                  ...(!isTeacher
                    ? [
                        {
                          id: 'exp-grades-all',
                          label: 'تصدير سجل درجات جميع المواد (Excel)',
                          icon: FileSpreadsheet,
                          tone: 'emerald' as const,
                          onClick: () => void handleExportGradesExcel('all'),
                        },
                      ]
                    : []),
                  {
                    id: 'imp-grades-upload',
                    label: 'رفع ملف Excel / CSV لمعاينة الدرجات',
                    description: 'فحص الصفوف قبل اعتماد الحفظ في قاعدة البيانات',
                    icon: Upload,
                    tone: 'primary',
                    dividerBefore: true,
                    fileAccept: '.xlsx,.xls,.csv',
                    onFileChange: handleBatchExcelUpload,
                  },
                ]}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            {!isTeacher && (
              <div className="flex items-center gap-2 text-xs">
                <span className="font-bold text-slate-600">نطاق الاستيراد:</span>
                <select
                  aria-label="نطاق استيراد الدرجات"
                  value={batchSubjectScope}
                  onChange={(e) =>
                    setBatchSubjectScope(e.target.value === 'all' ? 'all' : 'selected')
                  }
                  className="min-h-[44px] px-3 py-1.5 rounded-lg border border-slate-300 bg-white font-semibold"
                >
                  <option value="selected">المادة المختارة أعلاه فقط</option>
                  <option value="all">جميع المواد (جدول شامل متعدد الأعمدة)</option>
                </select>
              </div>
            )}

            {canPublish && (
              <div className="flex items-center gap-2 text-xs">
                <span className="font-bold text-slate-600">الحالة عند الحفظ:</span>
                <select
                  value={batchTargetStatus}
                  onChange={(e) =>
                    setBatchTargetStatus(e.target.value === 'published' ? 'published' : 'draft')
                  }
                  className="min-h-[44px] px-3 py-1.5 rounded-lg border border-slate-300 bg-white font-semibold"
                >
                  <option value="draft">مسودة (بانتظار النشر)</option>
                  <option value="published">نشر مباشر للطلبة</option>
                </select>
              </div>
            )}
          </div>

          {batchPreview && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 text-xs sm:text-sm">
                <div className="flex items-center gap-4 tabular-nums">
                  <span>
                    الإجمالي: <strong>{batchPreview.totalRows}</strong>
                  </span>
                  <span className="text-emerald-700">
                    الصالح: <strong>{batchPreview.validCount}</strong>
                  </span>
                  <span className="text-red-700">
                    المرفوض: <strong>{batchPreview.invalidCount}</strong>
                  </span>
                </div>
                {batchPreview.validCount > 0 && (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={handleCommitBatchExcel}
                    className="min-h-[44px] inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold rounded-lg cursor-pointer disabled:opacity-50"
                  >
                    <FileSpreadsheet className="w-4 h-4" />
                    <span>اعتماد وحفظ الدرجات الصالحة ({batchPreview.validCount})</span>
                  </button>
                )}
              </div>

              <div className="max-h-80 overflow-auto border border-slate-200 rounded-lg">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 font-bold text-slate-600">
                      <th className="px-3 py-2 text-right">الصف</th>
                      <th className="px-3 py-2 text-right">الحالة</th>
                      <th className="px-3 py-2 text-right">الطالب</th>
                      <th className="px-3 py-2 text-right">المادة</th>
                      <th className="px-3 py-2 text-center">الدرجة</th>
                      <th className="px-3 py-2 text-right">السبب (عند الرفض)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {batchPreview.rows.map((r, i) => (
                      <tr key={`${r.rowNumber}-${i}`} className={r.valid ? 'bg-white' : 'bg-red-50/50'}>
                        <td className="px-3 py-2 font-mono tabular-nums">{r.rowNumber}</td>
                        <td className="px-3 py-2 font-bold">
                          <span className={r.valid ? 'text-emerald-700' : 'text-red-700'}>
                            {r.valid ? 'صالح' : 'مرفوض'}
                          </span>
                        </td>
                        <td className="px-3 py-2 font-bold text-[#0B1F3A]">
                          {r.normalized?.studentName || r.raw['اسم الطالب'] || '—'}
                        </td>
                        <td className="px-3 py-2 text-slate-700 font-semibold">
                          {r.normalized?.subjectName || r.raw['المادة'] || selectedSubjectObj?.name || '—'}
                        </td>
                        <td className="px-3 py-2 text-center font-bold tabular-nums">
                          {r.normalized?.score ?? r.raw['الدرجة'] ?? '—'}
                        </td>
                        <td className="px-3 py-2 text-red-700">{r.errors.join(' | ') || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ===================================================================== */}
      {/* MANUAL FLEXIBLE GRID MODE (HIDDEN BY DEFAULT UNTIL TOGGLED)           */}
      {/* ===================================================================== */}
      {entryMode === 'manual' && !showStudentsTable && (
        <div className={`border rounded-xl p-6 text-center space-y-3 ${classTheme.cardBg} ${classTheme.cardBorder}`}>
          <p className="text-sm font-bold text-[#0B1F3A]">
            قائمة طلبة {selectedClassObj?.name || 'الصف المختار'} ({rows.length} طالب) مخفية افتراضياً لسهولة التصفح.
          </p>
          <p className="text-xs text-slate-600">
            يتم حفظ التعديلات تلقائياً مع دعم العمل دون إنترنت وزر التراجع. اضغط الزر أدناه لإظهار جدول الدرجات.
          </p>
          <button
            type="button"
            onClick={() => setShowStudentsTable(true)}
            className="min-h-[44px] inline-flex items-center gap-2 px-5 py-2.5 bg-[#0B1F3A] hover:bg-[#1E4E8C] text-white text-xs sm:text-sm font-bold rounded-lg cursor-pointer"
          >
            <Eye className="w-4 h-4 text-[#C59B27]" />
            <span>عرض الطلاب ({rows.length})</span>
          </button>
        </div>
      )}

      {entryMode === 'manual' && showStudentsTable && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          {rows.length > 0 && (
            <div className="px-4 py-3 border-b border-slate-200 bg-slate-50/70 flex flex-wrap items-center justify-between gap-3">
              <div className="relative flex-1 min-w-[210px] max-w-xs">
                <Search className="w-4 h-4 text-slate-400 absolute right-3 top-3" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="بحث سريع باسم الطالب أو الهوية..."
                  className="w-full min-h-[40px] pr-9 pl-3 py-1.5 text-xs rounded-lg border border-slate-300 bg-white focus:border-[#1E4E8C] focus:outline-none"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-slate-500">
                  التنقل السريع: <strong className="text-[#0B1F3A]">Enter</strong> أو الأسهم للانتقال للطالب التالي
                </span>
                {canEdit && (
                  <select
                    aria-label="تعيين حالة جميع الدرجات المدخلة"
                    defaultValue=""
                    onChange={(e) => {
                      if (e.target.value) {
                        applyBulkRowStatus(e.target.value as GradeStatus);
                        e.target.value = '';
                      }
                    }}
                    className="min-h-[40px] px-2.5 py-1.5 rounded-md border border-slate-300 bg-white text-xs font-semibold cursor-pointer"
                  >
                    <option value="">تعيين حالة الكل...</option>
                    <option value="draft">مسودة</option>
                    <option value="ready">جاهزة للنشر</option>
                    {canPublish && <option value="published">منشورة</option>}
                  </select>
                )}
              </div>
            </div>
          )}

          {loading ? (
            <div className="p-8 text-center text-sm text-slate-500">جاري تحميل قائمة الطلبة...</div>
          ) : displayedRows.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">
              {rows.length === 0
                ? 'لا يوجد طلاب مسجلون في هذا الصف وهذه الشعبة.'
                : 'لا توجد نتائج مطابقة للبحث.'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-600">
                    <th className="px-3 py-2.5 text-right">ت</th>
                    <th className="px-3 py-2.5 text-right">اسم الطالب</th>
                    <th className="px-3 py-2.5 text-right">رقم الهوية الوطنية</th>
                    {effectiveSectionId === 'all' && (
                      <th className="px-3 py-2.5 text-center">الشعبة</th>
                    )}
                    <th className="px-3 py-2.5 text-center w-32">الدرجة (0-{maxScore})</th>
                    <th className="px-3 py-2.5 text-right w-36">حالة النتيجة</th>
                    <th className="px-3 py-2.5 text-right">ملاحظات</th>
                    <th className="px-3 py-2.5 text-right">آخر تعديل</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {displayedRows.map((r, idx) => {
                    const check = validateScoreInput(r.score, maxScore);
                    return (
                      <tr key={r.studentId} className={`${classTheme.rowBg} ${classTheme.rowHoverBg}`}>
                        <td className="px-3 py-2 text-xs tabular-nums text-slate-500">{idx + 1}</td>
                        <td className="px-3 py-2 font-bold text-[#0B1F3A]">{r.fullName}</td>
                        <td className="px-3 py-2 font-mono text-xs text-[#1E4E8C] tabular-nums">
                          {r.inquiryCode}
                        </td>
                        {effectiveSectionId === 'all' && (
                          <td className="px-3 py-2 text-center text-xs font-semibold text-slate-700">
                            {r.sectionName}
                          </td>
                        )}
                        <td className="px-3 py-1.5">
                          <input
                            ref={(el) => {
                              scoreInputRefs.current[idx] = el;
                            }}
                            aria-label={`درجة الطالب ${r.fullName}`}
                            type="number"
                            min={0}
                            max={maxScore}
                            step="0.5"
                            disabled={!canEdit}
                            value={r.score}
                            onKeyDown={(e) => handleScoreKeyDown(e, idx)}
                            onChange={(e) => updateRow(r.studentId, { score: e.target.value })}
                            className={`w-full px-2.5 py-1.5 text-center text-sm font-bold rounded-md border tabular-nums bg-white ${
                              !check.valid
                                ? 'border-red-500 bg-red-50 text-red-800'
                                : 'border-slate-300 focus:border-[#1E4E8C]'
                            }`}
                          />
                        </td>
                        <td className="px-3 py-1.5">
                          <select
                            aria-label={`حالة درجة الطالب ${r.fullName}`}
                            disabled={!canEdit}
                            value={r.status}
                            onChange={(e) =>
                              updateRow(r.studentId, { status: e.target.value as GradeStatus })
                            }
                            className="w-full px-2 py-1.5 text-xs font-semibold rounded-md border border-slate-300 bg-white"
                          >
                            {(Object.keys(GRADE_STATUS_LABELS) as GradeStatus[]).map((stKey) => (
                              <option
                                key={stKey}
                                value={stKey}
                                disabled={stKey === 'published' && !canPublish}
                              >
                                {GRADE_STATUS_LABELS[stKey]}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-1.5">
                          <input
                            type="text"
                            aria-label={`ملاحظات الطالب ${r.fullName}`}
                            disabled={!canEdit}
                            value={r.notes}
                            onChange={(e) => updateRow(r.studentId, { notes: e.target.value })}
                            placeholder="اختياري..."
                            className="w-full px-2.5 py-1.5 text-xs rounded-md border border-slate-300 bg-white"
                          />
                        </td>
                        <td className="px-3 py-1.5 text-xs text-slate-500">
                          {r.updatedBy ? (
                            <span>
                              <span dir="ltr" className="inline-block font-mono">
                                {r.updatedBy}
                              </span>{' '}
                              ·{' '}
                              <span dir="ltr" className="inline-block font-mono">
                                {r.updatedAt?.slice(0, 16)}
                              </span>
                            </span>
                          ) : (
                            '—'
                          )}
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

      {/* ===================================================================== */}
      {/* NON-MINISTERIAL IRAQI EXEMPTIONS MODE (INDIVIDUAL & GENERAL)          */}
      {/* ===================================================================== */}
      {entryMode === 'exemptions' && !isTeacher && (
        <div className="space-y-4">
          {exemptIsMinisterial ? (
            <div className="p-5 rounded-xl bg-amber-50 border border-amber-200 text-amber-950 text-xs sm:text-sm space-y-1">
              <p className="font-bold">
                الصف المختار ({selectedClassObj?.name || 'السادس'}) مصنّف كصف وزاري، ولا يشمله نظام الإعفاء الفردي أو العام.
              </p>
              <p>
                لإدارة تأهيل طلبة السادس للامتحان الوزاري، انتقل إلى تبويب «تأهيل السادس الوزاري».
              </p>
            </div>
          ) : (
            <>
              <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
                  <div>
                    <h3 className="font-display text-base font-bold text-[#0B1F3A]">
                      إدارة الإعفاء الفردي والعام ({selectedClassObj?.name || 'الصف المختار'})
                    </h3>
                    <p className="text-xs text-slate-600 mt-0.5">
                      الإعفاء العام: معدل سعي سنوي لا يقل عن {exemptRules.generalMinAvg} ولا تقل أي مادة عن {exemptRules.minSubject}. الإعفاء الفردي: درجة السعي السنوي ≥{exemptRules.individualMin} في المادة.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-bold ${
                        exemptAutoState === 'saving' || exemptDirty
                          ? 'bg-amber-50 border-amber-200 text-amber-900'
                          : exemptAutoState === 'saved'
                            ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                            : 'bg-slate-50 border-slate-200 text-slate-700'
                      }`}
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>
                        {exemptAutoState === 'saving' || exemptDirty
                          ? 'جاري الحفظ تلقائياً...'
                          : exemptAutoState === 'saved'
                            ? 'تم حفظ المسودة تلقائياً'
                            : 'حفظ تلقائي للمسودات'}
                      </span>
                    </span>
                    {canPublish && (
                      <ActionMenu
                        label="أوامر اعتماد الإعفاء"
                        icon={Send}
                        variant="emerald"
                        disabled={exemptSaving || exemptRows.length === 0}
                        items={[
                          {
                            id: 'exempt-publish',
                            label: 'اعتماد ونشر الإعفاء للطلبة',
                            icon: Send,
                            tone: 'emerald',
                            onClick: () => void handleSaveExemptions('published'),
                          },
                          {
                            id: 'exempt-draft',
                            label: 'حفظ التعديلات كمسودة',
                            icon: CheckCircle2,
                            onClick: () => void handleSaveExemptions('draft'),
                          },
                        ]}
                      />
                    )}
                  </div>
                </div>

                {exemptCalcSummary && (
                  <div className="rounded-xl border border-emerald-300 bg-emerald-50/70 p-4 flex flex-wrap items-center justify-between gap-3">
                    <div className="space-y-1 text-xs">
                      <p className="font-extrabold text-[#0B1F3A] text-sm">
                        نتائج احتساب الإعفاءات للمراجعة والاعتماد ({exemptCalcSummary.status === 'published' ? 'معتمد ومنشور' : 'مسودة بانتظار موافقة المدير'})
                      </p>
                      <div className="flex flex-wrap items-center gap-3 tabular-nums font-bold">
                        <span className="px-2.5 py-1 rounded bg-white border border-slate-200 text-[#0B1F3A]">
                          الطلبة المشمولون: {exemptCalcSummary.processedStudents}
                        </span>
                        <span className="px-2.5 py-1 rounded bg-emerald-100 text-emerald-900 border border-emerald-300">
                          إعفاء عام: {exemptCalcSummary.generalCount}
                        </span>
                        <span className="px-2.5 py-1 rounded bg-sky-100 text-sky-900 border border-sky-300">
                          مواد إعفاء فردي: {exemptCalcSummary.individualCount}
                        </span>
                      </div>
                    </div>
                    {canPublish && exemptCalcSummary.status === 'draft' && (
                      <button
                        type="button"
                        disabled={exemptSaving || exemptRows.length === 0}
                        onClick={() => handleSaveExemptions('published')}
                        className="min-h-[40px] inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold rounded-lg cursor-pointer"
                      >
                        <Send className="w-3.5 h-3.5" />
                        <span>موافقة ونشر الإعفاءات الآن</span>
                      </button>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <Calculator className="w-4 h-4 text-[#1E4E8C]" />
                      <h4 className="font-display text-sm font-bold text-[#0B1F3A]">
                        1) احتساب الإعفاء بأمر المدير
                      </h4>
                    </div>
                    <p className="text-xs text-slate-600 leading-relaxed">
                      يحتسب الإعفاء العام والفردي من درجات السعي السنوي المرصودة وفق الضوابط المعتمدة للعام الدراسي دون فرض تلقائي على الطالب قبل موافقة المدير.
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      {canPublish && (
                        <select
                          aria-label="حالة نتيجة حساب الإعفاء"
                          value={exemptCalcStatus}
                          onChange={(e) =>
                            setExemptCalcStatus(e.target.value === 'published' ? 'published' : 'draft')
                          }
                          className="min-h-[44px] px-3 py-2 text-xs font-semibold rounded-lg border border-slate-300 bg-white"
                        >
                          <option value="draft">حفظ الناتج كمسودة للمراجعة</option>
                          <option value="published">اعتماد ونشر مباشر للطلبة</option>
                        </select>
                      )}
                      <button
                        type="button"
                        disabled={exemptSaving || !classId}
                        onClick={handleCalculateExemptions}
                        className="min-h-[44px] inline-flex items-center gap-1.5 px-4 py-2 bg-[#1E4E8C] hover:bg-[#0B1F3A] text-white text-xs font-bold rounded-lg cursor-pointer disabled:opacity-50"
                      >
                        <Calculator className="w-4 h-4 text-[#C59B27]" />
                        <span>احتساب الإعفاء (بأمر المدير)</span>
                      </button>
                    </div>
                  </div>

                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <FileSpreadsheet className="w-4 h-4 text-emerald-700" />
                      <h4 className="font-display text-sm font-bold text-[#0B1F3A]">
                        2) القالب الجاهز والتصدير والاستيراد (Excel)
                      </h4>
                    </div>
                    <p className="text-xs text-slate-600 leading-relaxed">
                      نزّل قالب الإعفاءات الجاهز المرفق بدرجات السعي السنوي، أو صدّر سجل الإعفاءات المعتمد، أو ارفع ملف الإعفاء للمعاينة.
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <ActionMenu
                        label="أوامر قوالب واستيراد الإعفاء (Excel)"
                        icon={FileSpreadsheet}
                        variant="navy"
                        disabled={downloadingTemplate || !classId}
                        items={[
                          {
                            id: 'exempt-tpl',
                            label: 'تنزيل قالب الإعفاء الجاهز (Excel)',
                            icon: Download,
                            onClick: () => void handleDownloadExemptionTemplate(),
                          },
                          {
                            id: 'exempt-export',
                            label: 'تصدير سجل الإعفاءات المعتمد (Excel)',
                            icon: FileSpreadsheet,
                            tone: 'emerald',
                            onClick: () => void handleExportExemptionsRegister(),
                          },
                          {
                            id: 'exempt-upload',
                            label: 'رفع ملف الإعفاء (Excel / CSV)',
                            icon: Upload,
                            tone: 'primary',
                            dividerBefore: true,
                            fileAccept: '.xlsx,.xls,.csv',
                            onFileChange: handleExemptionExcelUpload,
                          },
                        ]}
                      />
                    </div>
                  </div>
                </div>

                {exemptImportPreview && (
                  <div className="border border-emerald-200 bg-emerald-50/40 rounded-xl p-4 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
                      <div className="flex items-center gap-3 tabular-nums">
                        <span>
                          إجمالي الصفوف: <strong>{exemptImportPreview.totalRows}</strong>
                        </span>
                        <span className="text-emerald-700">
                          صالح: <strong>{exemptImportPreview.validCount}</strong>
                        </span>
                        <span className="text-red-700">
                          مرفوض: <strong>{exemptImportPreview.invalidCount}</strong>
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        {canPublish && (
                          <select
                            value={exemptImportStatus}
                            onChange={(e) =>
                              setExemptImportStatus(
                                e.target.value === 'published' ? 'published' : 'draft'
                              )
                            }
                            className="min-h-[40px] px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white font-semibold"
                          >
                            <option value="draft">مسودة</option>
                            <option value="published">نشر مباشر</option>
                          </select>
                        )}
                        {exemptImportPreview.validCount > 0 && (
                          <button
                            type="button"
                            disabled={exemptSaving}
                            onClick={handleCommitExemptionImport}
                            className="min-h-[40px] px-4 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white font-bold rounded-lg cursor-pointer"
                          >
                            اعتماد استيراد الإعفاءات ({exemptImportPreview.validCount})
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="max-h-56 overflow-auto border border-slate-200 rounded-lg bg-white">
                      <table className="w-full text-xs border-collapse">
                        <thead>
                          <tr className="bg-slate-50 border-b border-slate-200 font-bold text-slate-600">
                            <th className="px-3 py-2 text-right">الصف</th>
                            <th className="px-3 py-2 text-right">الحالة</th>
                            <th className="px-3 py-2 text-right">الطالب</th>
                            <th className="px-3 py-2 text-center">الإعفاء العام</th>
                            <th className="px-3 py-2 text-right">ملاحظات / سبب الرفض</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {exemptImportPreview.rows.map((r) => (
                            <tr key={r.rowNumber} className={r.valid ? 'bg-white' : 'bg-red-50/50'}>
                              <td className="px-3 py-2 font-mono">{r.rowNumber}</td>
                              <td className="px-3 py-2 font-bold">
                                <span className={r.valid ? 'text-emerald-700' : 'text-red-700'}>
                                  {r.valid ? 'صالح' : 'مرفوض'}
                                </span>
                              </td>
                              <td className="px-3 py-2 font-bold text-[#0B1F3A]">
                                {r.normalized?.studentName || r.raw['اسم الطالب'] || '—'}
                              </td>
                              <td className="px-3 py-2 text-center font-bold">
                                {r.normalized?.overallDecision === 'exempt'
                                  ? 'معفو عام'
                                  : r.normalized?.overallDecision === 'not_exempt'
                                    ? 'غير معفو'
                                    : '—'}
                              </td>
                              <td className="px-3 py-2 text-red-700">{r.errors.join(' | ') || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>

              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                {exemptLoading ? (
                  <div className="p-8 text-center text-sm text-slate-500">جاري تحميل جدول الإعفاء...</div>
                ) : exemptRows.length === 0 ? (
                  <div className="p-8 text-center text-sm text-slate-500">
                    لا يوجد طلبة مسجلون في هذا الصف وهذه الشعبة.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs border-collapse">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 font-bold text-slate-700">
                          <th className="px-2.5 py-3 text-center">ت</th>
                          <th className="px-3 py-3 text-right min-w-[160px]">اسم الطالب</th>
                          <th className="px-2.5 py-3 text-center">الهوية</th>
                          <th className="px-2 py-3 text-center">معدل السعي</th>
                          {exemptSubjects.map((sub) => (
                            <th key={sub.id} className="px-2 py-3 text-center min-w-[96px]">
                              {sub.name}
                            </th>
                          ))}
                          <th className="px-3 py-3 text-center min-w-[130px] bg-emerald-50/70 text-[#0B1F3A]">
                            الإعفاء العام
                          </th>
                          <th className="px-2.5 py-3 text-center">الحالة</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {exemptRows.map((row) => (
                          <tr key={row.studentId} className={`${classTheme.rowBg} ${classTheme.rowHoverBg}`}>
                            <td className="px-2.5 py-2 text-center tabular-nums text-slate-500">
                              {row.sequence}
                            </td>
                            <td className="px-3 py-2 font-bold text-[#0B1F3A]">{row.fullName}</td>
                            <td className="px-2.5 py-2 text-center font-mono text-[#1E4E8C] tabular-nums">
                              {row.inquiryCode}
                            </td>
                            <td className="px-2 py-2 text-center font-extrabold tabular-nums">
                              {row.annualAverage !== null && row.annualAverage !== undefined ? (
                                <span
                                  className={`inline-block px-2 py-0.5 rounded border text-xs ${
                                    row.annualAverage >= exemptRules.generalMinAvg
                                      ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                                      : 'bg-slate-100 border-slate-200 text-slate-800'
                                  }`}
                                >
                                  {row.annualAverage}
                                </span>
                              ) : (
                                <span className="text-slate-400">—</span>
                              )}
                            </td>
                            {exemptSubjects.map((sub) => {
                              const effortVal = row.annualEffortBySubject[sub.id];
                              const decVal = row.subjectDecisions[sub.id] ?? '';
                              const effortTone =
                                effortVal === null || effortVal === undefined
                                  ? 'bg-slate-100 border-slate-200 text-slate-500'
                                  : effortVal >= exemptRules.individualMin
                                    ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                                    : effortVal >= exemptRules.minSubject
                                      ? 'bg-sky-50 border-sky-200 text-sky-900'
                                      : 'bg-slate-100 border-slate-200 text-slate-700';
                              return (
                                <td key={sub.id} className="px-1.5 py-2 text-center">
                                  <div className="space-y-1">
                                    <span
                                      className={`block px-1.5 py-0.5 rounded border text-[11px] font-extrabold tabular-nums ${effortTone}`}
                                    >
                                      سعي: {effortVal !== null && effortVal !== undefined ? effortVal : '—'}
                                    </span>
                                    <select
                                      aria-label={`إعفاء ${sub.name} للطالب ${row.fullName}`}
                                      disabled={!canEdit}
                                      value={decVal || ''}
                                      onChange={(e) =>
                                        updateExemptionSubject(
                                          row.studentId,
                                          sub.id,
                                          e.target.value ? (e.target.value as ExemptionDecision) : null
                                        )
                                      }
                                      className={`w-full px-1.5 py-1 text-[11px] font-bold rounded border bg-white ${
                                        decVal === 'exempt'
                                          ? 'border-emerald-500 text-emerald-800'
                                          : decVal === 'not_exempt'
                                            ? 'border-slate-300 text-slate-700'
                                            : 'border-slate-300 text-slate-500'
                                      }`}
                                    >
                                      <option value="">—</option>
                                      <option value="exempt">معفو</option>
                                      <option value="not_exempt">غير معفو</option>
                                    </select>
                                  </div>
                                </td>
                              );
                            })}
                            <td className="px-2 py-2 text-center bg-emerald-50/30">
                              <select
                                aria-label={`الإعفاء العام للطالب ${row.fullName}`}
                                disabled={!canEdit}
                                value={row.overallDecision || ''}
                                onChange={(e) =>
                                  updateExemptionOverall(
                                    row.studentId,
                                    e.target.value ? (e.target.value as ExemptionDecision) : null
                                  )
                                }
                                className={`w-full px-2 py-1.5 text-xs font-extrabold rounded border bg-white ${
                                  row.overallDecision === 'exempt'
                                    ? 'border-emerald-600 text-emerald-800'
                                    : 'border-slate-300 text-slate-600'
                                }`}
                              >
                                <option value="">—</option>
                                <option value="exempt">معفو عام</option>
                                <option value="not_exempt">غير معفو</option>
                              </select>
                            </td>
                            <td className="px-2.5 py-2 text-center">
                              <span
                                className={`inline-block px-2 py-0.5 rounded text-[11px] font-bold ${
                                  row.overallStatus === 'published'
                                    ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                                    : 'bg-slate-100 text-slate-600'
                                }`}
                              >
                                {row.overallStatus === 'published' ? 'منشور' : 'مسودة'}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* ===================================================================== */}
      {/* GRADE 6 MINISTERIAL QUALIFICATION MODE (EXPLICIT MANAGER CONTROL)     */}
      {/* ===================================================================== */}
      {entryMode === 'qual' && !isTeacher && (
        <div className="space-y-4">
          {!selectedClassObj?.isMinisterial && (
            <div className="p-3.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-xs sm:text-sm">
              تنبيه: الصف المختار حالياً ({selectedClassObj?.name || '—'}) غير مصنف كصف سادس وزاري. يُطبق التأهيل الوزاري حصرياً على صفوف السادس (العلمي / الأدبي / السادس) فقط.
            </div>
          )}

          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
              <div>
                <h3 className="font-display text-base font-bold text-[#0B1F3A]">
                  إدارة التأهيل الوزاري للسادس ({selectedClassObj?.name || 'الصف المختار'})
                </h3>
                <p className="text-xs text-slate-600 mt-0.5">
                  لا يُكتب أي تأهيل تلقائياً؛ يمكن للمدير احتسابه وفق ضابط ({qualRuleInfo.maxFail} دروس رسوب + {qualRuleInfo.bonus} درجات قرار) أو إدخاله يدوياً أو استيراده من Excel.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-bold ${
                    qualAutoState === 'saving' || qualDirty
                      ? 'bg-amber-50 border-amber-200 text-amber-900'
                      : qualAutoState === 'saved'
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                        : 'bg-slate-50 border-slate-200 text-slate-700'
                  }`}
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>
                    {qualAutoState === 'saving' || qualDirty
                      ? 'جاري الحفظ تلقائياً...'
                      : qualAutoState === 'saved'
                        ? 'تم حفظ المسودة تلقائياً'
                        : 'حفظ تلقائي للمسودات'}
                  </span>
                </span>
                {canPublish && (
                  <ActionMenu
                    label="أوامر اعتماد التأهيل الوزاري"
                    icon={Send}
                    variant="emerald"
                    disabled={qualSaving || qualRows.length === 0}
                    items={[
                      {
                        id: 'qual-publish',
                        label: 'اعتماد ونشر التأهيل الوزاري للطلبة',
                        icon: Send,
                        tone: 'emerald',
                        onClick: () => void handleSaveQualification('published'),
                      },
                      {
                        id: 'qual-draft',
                        label: 'حفظ التعديلات كمسودة',
                        icon: CheckCircle2,
                        onClick: () => void handleSaveQualification('draft'),
                      },
                    ]}
                  />
                )}
              </div>
            </div>

            {qualCalcSummary && (
              <div className="rounded-xl border border-amber-300 bg-amber-50/70 p-4 flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1 text-xs">
                  <p className="font-extrabold text-[#0B1F3A] text-sm">
                    ملخص احتساب التأهيل الوزاري للمراجعة ({qualCalcSummary.status === 'published' ? 'معتمد ومنشور' : 'مسودة بانتظار موافقة المدير'})
                  </p>
                  <div className="flex flex-wrap items-center gap-3 tabular-nums font-bold">
                    <span className="px-2.5 py-1 rounded bg-emerald-100 text-emerald-900 border border-emerald-300">
                      مؤهل للوزاري: {qualCalcSummary.qualifiedCount}
                    </span>
                    <span className="px-2.5 py-1 rounded bg-red-100 text-red-800 border border-red-300">
                      غير مؤهل: {qualCalcSummary.notQualifiedCount}
                    </span>
                    <span className="px-2.5 py-1 rounded bg-white text-slate-700 border border-slate-200">
                      غير مكتمل السعي السنوي: {qualCalcSummary.incompleteCount}
                    </span>
                  </div>
                </div>
                {canPublish && qualCalcSummary.status === 'draft' && (
                  <button
                    type="button"
                    disabled={qualSaving || qualRows.length === 0}
                    onClick={() => handleSaveQualification('published')}
                    className="min-h-[40px] inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold rounded-lg cursor-pointer"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>موافقة ونشر التأهيل الآن</span>
                  </button>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Calculator className="w-4 h-4 text-[#1E4E8C]" />
                  <h4 className="font-display text-sm font-bold text-[#0B1F3A]">
                    1) احتساب التأهيل من السعي السنوي بأمر المدير
                  </h4>
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">
                  يفحص درجات «السعي السنوي» المرصودة ويطبّق ضابط العام الحالي ({qualRuleInfo.maxFail} دروس رسوب مع {qualRuleInfo.bonus} درجات قرار لتكميل الدروس القريبة من النجاح).
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  {canPublish && (
                    <select
                      aria-label="حالة نتيجة الحساب الوزاري"
                      value={qualCalcStatus}
                      onChange={(e) =>
                        setQualCalcStatus(e.target.value === 'published' ? 'published' : 'draft')
                      }
                      className="min-h-[44px] px-3 py-2 text-xs font-semibold rounded-lg border border-slate-300 bg-white"
                    >
                      <option value="draft">حفظ الناتج كمسودة للمراجعة</option>
                      <option value="published">اعتماد ونشر مباشر للطلبة</option>
                    </select>
                  )}
                  <button
                    type="button"
                    disabled={qualSaving || !classId}
                    onClick={handleCalculateQualification}
                    className="min-h-[44px] inline-flex items-center gap-1.5 px-4 py-2 bg-[#1E4E8C] hover:bg-[#0B1F3A] text-white text-xs font-bold rounded-lg cursor-pointer disabled:opacity-50"
                  >
                    <Calculator className="w-4 h-4 text-[#C59B27]" />
                    <span>احتساب التأهيل الوزاري (بأمر المدير)</span>
                  </button>
                </div>
              </div>

              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <FileSpreadsheet className="w-4 h-4 text-emerald-700" />
                  <h4 className="font-display text-sm font-bold text-[#0B1F3A]">
                    2) القالب الجاهز والتصدير والاستيراد (Excel)
                  </h4>
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">
                  نزّل قالب التأهيل بأسماء الطلبة والمواد ودرجات السعي السنوي، أو صدّر سجل التأهيل المعتمد، أو ارفع ملف التأهيل للمعاينة.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <ActionMenu
                    label="أوامر قوالب واستيراد التأهيل (Excel)"
                    icon={FileSpreadsheet}
                    variant="navy"
                    disabled={downloadingTemplate || !classId}
                    items={[
                      {
                        id: 'qual-tpl',
                        label: 'تنزيل قالب التأهيل (Excel)',
                        icon: Download,
                        onClick: () => void handleDownloadQualificationTemplate(),
                      },
                      {
                        id: 'qual-export',
                        label: 'تصدير سجل التأهيل الوزاري (Excel)',
                        icon: FileSpreadsheet,
                        tone: 'emerald',
                        onClick: () => void handleExportQualificationRegister(),
                      },
                      {
                        id: 'qual-upload',
                        label: 'رفع ملف التأهيل (Excel / CSV)',
                        icon: Upload,
                        tone: 'primary',
                        dividerBefore: true,
                        fileAccept: '.xlsx,.xls,.csv',
                        onFileChange: handleQualExcelUpload,
                      },
                    ]}
                  />
                </div>
              </div>
            </div>

            {qualImportPreview && (
              <div className="border border-emerald-200 bg-emerald-50/40 rounded-xl p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-3 tabular-nums">
                    <span>
                      إجمالي الصفوف: <strong>{qualImportPreview.totalRows}</strong>
                    </span>
                    <span className="text-emerald-700">
                      صالح: <strong>{qualImportPreview.validCount}</strong>
                    </span>
                    <span className="text-red-700">
                      مرفوض: <strong>{qualImportPreview.invalidCount}</strong>
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {canPublish && (
                      <select
                        value={qualImportStatus}
                        onChange={(e) =>
                          setQualImportStatus(e.target.value === 'published' ? 'published' : 'draft')
                        }
                        className="min-h-[40px] px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white font-semibold"
                      >
                        <option value="draft">مسودة</option>
                        <option value="published">نشر مباشر</option>
                      </select>
                    )}
                    {qualImportPreview.validCount > 0 && (
                      <button
                        type="button"
                        disabled={qualSaving}
                        onClick={handleCommitQualImport}
                        className="min-h-[40px] px-4 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white font-bold rounded-lg cursor-pointer"
                      >
                        اعتماد استيراد التأهيل ({qualImportPreview.validCount})
                      </button>
                    )}
                  </div>
                </div>

                <div className="max-h-56 overflow-auto border border-slate-200 rounded-lg bg-white">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 font-bold text-slate-600">
                        <th className="px-3 py-2 text-right">الصف</th>
                        <th className="px-3 py-2 text-right">الحالة</th>
                        <th className="px-3 py-2 text-right">الطالب</th>
                        <th className="px-3 py-2 text-center">القرار العام</th>
                        <th className="px-3 py-2 text-right">ملاحظات / سبب الرفض</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {qualImportPreview.rows.map((r) => (
                        <tr key={r.rowNumber} className={r.valid ? 'bg-white' : 'bg-red-50/50'}>
                          <td className="px-3 py-2 font-mono">{r.rowNumber}</td>
                          <td className="px-3 py-2 font-bold">
                            <span className={r.valid ? 'text-emerald-700' : 'text-red-700'}>
                              {r.valid ? 'صالح' : 'مرفوض'}
                            </span>
                          </td>
                          <td className="px-3 py-2 font-bold text-[#0B1F3A]">
                            {r.normalized?.studentName || r.raw['اسم الطالب'] || '—'}
                          </td>
                          <td className="px-3 py-2 text-center font-bold">
                            {r.normalized?.overallDecision === 'qualified'
                              ? 'مؤهل'
                              : r.normalized?.overallDecision === 'not_qualified'
                                ? 'غير مؤهل'
                                : '—'}
                          </td>
                          <td className="px-3 py-2 text-red-700">{r.errors.join(' | ') || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            {qualLoading ? (
              <div className="p-8 text-center text-sm text-slate-500">جاري تحميل جدول التأهيل الوزاري...</div>
            ) : qualRows.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500">
                لا يوجد طلبة مسجلون في هذا الصف وهذه الشعبة.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 font-bold text-slate-700">
                      <th className="px-2.5 py-3 text-center">ت</th>
                      <th className="px-3 py-3 text-right min-w-[160px]">اسم الطالب</th>
                      <th className="px-2.5 py-3 text-center">الهوية</th>
                      {qualSubjects.map((sub) => (
                        <th key={sub.id} className="px-2 py-3 text-center min-w-[96px]">
                          {sub.name}
                        </th>
                      ))}
                      <th className="px-3 py-3 text-center min-w-[135px] bg-amber-50/70 text-[#0B1F3A]">
                        التأهيل الوزاري العام
                      </th>
                      <th className="px-2.5 py-3 text-center">الحالة</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {qualRows.map((row) => (
                      <tr key={row.studentId} className={`${classTheme.rowBg} ${classTheme.rowHoverBg}`}>
                        <td className="px-2.5 py-2.5 text-center tabular-nums text-slate-500">
                          {row.sequence}
                        </td>
                        <td className="px-3 py-2.5 font-bold text-[#0B1F3A]">{row.fullName}</td>
                        <td className="px-2.5 py-2.5 text-center font-mono text-[#1E4E8C] tabular-nums">
                          {row.inquiryCode}
                        </td>
                        {qualSubjects.map((sub) => {
                          const effortVal = row.annualEffortBySubject[sub.id];
                          const decVal = row.subjectDecisions[sub.id] ?? '';
                          const effortTone =
                            effortVal === null || effortVal === undefined
                              ? 'bg-slate-100 border-slate-200 text-slate-500'
                              : effortVal >= 50
                                ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                                : 'bg-red-50 border-red-300 text-red-800';
                          return (
                            <td key={sub.id} className="px-1.5 py-2 text-center">
                              <div className="space-y-1">
                                <span
                                  className={`block px-1.5 py-0.5 rounded border text-[11px] font-extrabold tabular-nums ${effortTone}`}
                                >
                                  سعي: {effortVal !== null && effortVal !== undefined ? effortVal : '—'}
                                </span>
                                <select
                                  aria-label={`تأهيل ${sub.name} للطالب ${row.fullName}`}
                                  disabled={!canEdit}
                                  value={decVal || ''}
                                  onChange={(e) =>
                                    updateQualRowSubject(
                                      row.studentId,
                                      sub.id,
                                      e.target.value ? (e.target.value as MinisterialDecision) : null
                                    )
                                  }
                                  className={`w-full px-1.5 py-1 text-[11px] font-bold rounded border bg-white ${
                                    decVal === 'qualified'
                                      ? 'border-emerald-400 text-emerald-800'
                                      : decVal === 'not_qualified'
                                        ? 'border-red-400 text-red-700'
                                        : 'border-slate-300 text-slate-600'
                                  }`}
                                >
                                  <option value="">—</option>
                                  <option value="qualified">مؤهل</option>
                                  <option value="not_qualified">غير مؤهل</option>
                                </select>
                              </div>
                            </td>
                          );
                        })}
                        <td className="px-2 py-2 text-center bg-amber-50/30">
                          <select
                            aria-label={`التأهيل الوزاري العام للطالب ${row.fullName}`}
                            disabled={!canEdit}
                            value={row.overallDecision || ''}
                            onChange={(e) =>
                              updateQualRowOverall(
                                row.studentId,
                                e.target.value ? (e.target.value as MinisterialDecision) : null
                              )
                            }
                            className={`w-full px-2 py-1.5 text-xs font-extrabold rounded border bg-white ${
                              row.overallDecision === 'qualified'
                                ? 'border-emerald-500 text-emerald-800'
                                : row.overallDecision === 'not_qualified'
                                  ? 'border-red-500 text-red-700'
                                  : 'border-slate-300 text-slate-600'
                            }`}
                          >
                            <option value="">—</option>
                            <option value="qualified">مؤهل</option>
                            <option value="not_qualified">غير مؤهل</option>
                          </select>
                        </td>
                        <td className="px-2.5 py-2 text-center">
                          <span
                            className={`inline-block px-2 py-0.5 rounded text-[11px] font-bold ${
                              row.overallStatus === 'published'
                                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                                : 'bg-slate-100 text-slate-600'
                            }`}
                          >
                            {row.overallStatus === 'published' ? 'منشور' : 'مسودة'}
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
      )}
    </div>
  );
}
