import type {
  AllPublishedReportCard,
  EffortCalculationTarget,
  Exam,
  ExemptionDecision,
  Grade6OverallQualification,
  Grade6SubjectQualification,
  GradeRecord,
  GradeStatus,
  GroupExamRoster,
  ImportPreviewResponse,
  ImportRowPreview,
  IraqiCardColumnSummary,
  IraqiCardRow,
  IraqiCardSummary,
  MinisterialDecision,
  OverallExemption,
  PromotionCandidate,
  PublicReportCard,
  ReportCardRow,
  SchoolClass,
  SchoolSettings,
  Section,
  Student,
  Subject,
  SubjectExemption,
  TeacherAssignment,
} from '../types/school.ts';

export const TEACHER_ALLOWED_EXAM_NAMES = [
  'الشهر الأول (الفصل الأول)',
  'الشهر الثاني (الفصل الأول)',
  'سعي الفصل الأول',
  'الشهر الأول (الفصل الثاني)',
  'الشهر الثاني (الفصل الثاني)',
  'سعي الفصل الثاني',
] as const;

export function isTeacherAllowedExamName(examName: string): boolean {
  const n = normalizeArabicText(examName);
  return TEACHER_ALLOWED_EXAM_NAMES.some((allowed) => normalizeArabicText(allowed) === n);
}

export function isSubjectExcludedForClass(
  subjectName: string,
  className?: string | null,
  isMinisterial?: boolean
): boolean {
  const isGrade6 = Boolean(isMinisterial) || (className ? className.includes('السادس') : false);
  if (!isGrade6) return false;
  const norm = normalizeArabicText(subjectName);
  return norm.includes('حاسوب');
}

export function compareArabicNames(a: string, b: string): number {
  return a.trim().localeCompare(b.trim(), 'ar', { sensitivity: 'base' });
}

export function sortStudentsAlphabetically<T extends { fullName: string }>(students: T[]): T[] {
  return [...students].sort((a, b) => compareArabicNames(a.fullName, b.fullName));
}

export function buildScopedArabicFilename(params: {
  prefix?: string;
  academicYear?: string;
  className?: string;
  sectionName?: string;
  subjectName?: string;
  examName?: string;
  studentName?: string;
  ext: string;
}): string {
  const segments = [
    params.prefix,
    params.academicYear,
    params.className,
    params.sectionName ? `شعبة_${params.sectionName}` : undefined,
    params.subjectName,
    params.examName,
    params.studentName,
  ]
    .map((s) =>
      String(s ?? '')
        .trim()
        .replace(/[\\/:*?"<>|]/g, '-')
        .replace(/\s+/g, '_')
    )
    .filter((s) => s.length > 0);
  const base = segments.length > 0 ? segments.join('_-_') : 'تقرير_المنتظر';
  const ext = params.ext.replace(/^\./, '');
  return `${base}.${ext}`;
}

export interface ScoreValidationResult {
  valid: boolean;
  score: number | null;
  error?: string;
}

export function validateScoreInput(
  rawValue: unknown,
  maxScore: number
): ScoreValidationResult {
  if (rawValue === null || rawValue === undefined || String(rawValue).trim() === '') {
    return { valid: true, score: null };
  }

  const str = String(rawValue).trim();
  const parsed = Number(str);

  if (!Number.isFinite(parsed) || Number.isNaN(parsed)) {
    return { valid: false, score: null, error: 'يجب إدخال قيمة رقمية صحيحة للدرجة.' };
  }

  if (parsed < 0) {
    return { valid: false, score: null, error: 'لا يُسمح بإدخال درجة سالبة.' };
  }

  if (parsed > maxScore) {
    return {
      valid: false,
      score: null,
      error: `الدرجة المدخلة (${parsed}) تتجاوز النهاية العظمى للمادة (${maxScore}).`,
    };
  }

  return { valid: true, score: Math.round(parsed * 100) / 100 };
}

/**
 * Enforces the safety invariant:
 * Modifying the score or notes of an already published grade automatically reverts
 * its status to 'draft' (or 'in_review' if explicitly specified), so students never
 * see unapproved edited grades until explicitly republished.
 */
export function resolveStatusOnGradeEdit(
  previousStatus: GradeStatus | null,
  previousScore: number | null,
  previousNotes: string,
  nextScore: number | null,
  nextNotes: string,
  requestedStatus: GradeStatus
): { status: GradeStatus; revertedFromPublished: boolean } {
  const valueChanged =
    previousScore !== nextScore ||
    (previousNotes || '').trim() !== (nextNotes || '').trim();

  if (previousStatus === 'published' && valueChanged) {
    const safeStatus: GradeStatus =
      requestedStatus === 'in_review' ? 'in_review' : 'draft';
    return { status: safeStatus, revertedFromPublished: true };
  }

  return { status: requestedStatus, revertedFromPublished: false };
}

export function computeIraqiRating(score: number, maxScore: number): string {
  if (maxScore <= 0) return '—';
  const pct = (score / maxScore) * 100;
  if (pct >= 90) return 'امتياز';
  if (pct >= 80) return 'جيد جداً';
  if (pct >= 70) return 'جيد';
  if (pct >= 60) return 'متوسط';
  if (pct >= 50) return 'مقبول';
  return 'راسب';
}

export function buildPublicReportCard(params: {
  student: Student;
  className: string;
  sectionName: string;
  exam: Exam;
  subjects: Subject[];
  grades: GradeRecord[];
  settings: SchoolSettings;
}): PublicReportCard | null {
  const { student, className, sectionName, exam, subjects, grades, settings } = params;

  // Strictly filter ONLY published grades for this exact student and this exact exam
  const publishedGrades = grades.filter(
    (g) =>
      g.studentId === student.id &&
      g.examId === exam.id &&
      g.status === 'published' &&
      g.score !== null
  );

  if (publishedGrades.length === 0) {
    return null;
  }

  const gradeBySubject = new Map<number, GradeRecord>();
  for (const g of publishedGrades) {
    gradeBySubject.set(g.subjectId, g);
  }

  const orderedSubjects = [...subjects]
    .filter((s) => !isSubjectExcludedForClass(s.name, className))
    .sort((a, b) => a.displayOrder - b.displayOrder || a.id - b.id);

  const rawRows: Array<{
    subjectId: number;
    subjectName: string;
    maxScore: number | null;
    score: number;
    rating: string;
    notes: string;
    publishedAt: string | null;
  }> = [];

  for (const subj of orderedSubjects) {
    const g = gradeBySubject.get(subj.id);
    if (!g || g.score === null) continue;
    const maxScore = subj.maxScore > 0 ? subj.maxScore : null;
    rawRows.push({
      subjectId: subj.id,
      subjectName: subj.name,
      maxScore,
      score: g.score,
      rating: maxScore ? computeIraqiRating(g.score, maxScore) : '—',
      notes: (g.notes || '').trim(),
      publishedAt: g.publishedAt,
    });
  }

  if (rawRows.length === 0) {
    return null;
  }

  const hasNotesColumn = rawRows.some((r) => r.notes.length > 0);
  const hasMaxScoreColumn = false;

  const rows: ReportCardRow[] = rawRows.map((r, index) => ({
    sequence: index + 1,
    subjectId: r.subjectId,
    subjectName: r.subjectName,
    maxScore: r.maxScore,
    score: r.score,
    rating: r.rating,
    ...(hasNotesColumn ? { notes: r.notes || '—' } : {}),
  }));

  const totalScore = Math.round(rawRows.reduce((acc, r) => acc + r.score, 0) * 100) / 100;
  const allHaveMax = rawRows.every((r) => r.maxScore !== null && r.maxScore > 0);
  const totalMaxScore = allHaveMax
    ? rawRows.reduce((acc, r) => acc + (r.maxScore ?? 0), 0)
    : null;
  const average = Math.round((totalScore / rawRows.length) * 100) / 100;
  const overallRating =
    totalMaxScore && totalMaxScore > 0
      ? computeIraqiRating(totalScore, totalMaxScore)
      : '—';

  const latestPublishedAt = rawRows
    .map((r) => r.publishedAt)
    .filter((d): d is string => Boolean(d))
    .sort()
    .pop() ?? null;

  return {
    schoolName: settings.schoolName,
    republicHeader: settings.republicHeader,
    ministryHeader: settings.ministryHeader,
    directorate: settings.directorate,
    academicYear: exam.academicYear || settings.academicYear,
    footerText: settings.footerText,
    emblemUrl: settings.emblemUrl,
    ministrySealUrl: settings.ministrySealUrl,
    primaryColor: settings.primaryColor,
    accentColor: settings.accentColor,
    examName: exam.name,
    issuedAt: latestPublishedAt,
    student: {
      fullName: student.fullName,
      inquiryCode: student.inquiryCode,
      className,
      sectionName,
    },
    hasNotesColumn,
    hasMaxScoreColumn,
    rows,
    summary: {
      subjectCount: rows.length,
      totalScore,
      totalMaxScore,
      average,
      overallRating,
    },
  };
}

export function roundIraqiHalfUp(value: number): number {
  return Math.round(value);
}

type IraqiExamSlot =
  | 'sem1Month1'
  | 'sem1Month2'
  | 'sem1Average'
  | 'midyear'
  | 'sem2Month1'
  | 'sem2Month2'
  | 'sem2Average'
  | 'annualEffort'
  | 'finalExam'
  | 'finalGrade'
  | 'secondRound';

export function matchIraqiExamSlot(examName: string): IraqiExamSlot | null {
  const n = examName.trim().replace(/\s+/g, ' ');
  if (n === 'الشهر الأول (الفصل الأول)' || n === 'الشهر الأول') return 'sem1Month1';
  if (n === 'الشهر الثاني (الفصل الأول)' || n === 'الشهر الثاني') return 'sem1Month2';
  if (n === 'سعي الفصل الأول') return 'sem1Average';
  if (n === 'نصف السنة') return 'midyear';
  if (n === 'الشهر الأول (الفصل الثاني)' || n === 'الشهر الثالث') return 'sem2Month1';
  if (n === 'الشهر الثاني (الفصل الثاني)' || n === 'الشهر الرابع') return 'sem2Month2';
  if (n === 'سعي الفصل الثاني') return 'sem2Average';
  if (n === 'السعي السنوي') return 'annualEffort';
  if (n === 'الامتحان النهائي') return 'finalExam';
  if (n === 'الدرجة النهائية') return 'finalGrade';
  if (n === 'الدور الثاني') return 'secondRound';
  return null;
}

function summarizeIraqiColumn(values: Array<number | null>): IraqiCardColumnSummary | null {
  const valid = values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (valid.length === 0) return null;
  const total = Math.round(valid.reduce((acc, v) => acc + v, 0) * 100) / 100;
  const average = Math.round((total / valid.length) * 100) / 100;
  return { count: valid.length, total, average };
}

function buildStudentIraqiMatrix(params: {
  student: Student;
  exams: Exam[];
  subjects: Subject[];
  publishedGrades: GradeRecord[];
  isMinisterial?: boolean;
  subjectQualifications?: Grade6SubjectQualification[];
  overallQualification?: Grade6OverallQualification | null;
  subjectExemptions?: SubjectExemption[];
  overallExemption?: OverallExemption | null;
}): { iraqiRows: IraqiCardRow[]; iraqiSummary: IraqiCardSummary } {
  const {
    student,
    exams,
    subjects,
    publishedGrades,
    isMinisterial = false,
    subjectQualifications = [],
    overallQualification = null,
    subjectExemptions = [],
    overallExemption = null,
  } = params;

  const examIdsBySlot = new Map<IraqiExamSlot, number[]>();
  for (const ex of exams) {
    const slot = matchIraqiExamSlot(ex.name);
    if (!slot) continue;
    const list = examIdsBySlot.get(slot) ?? [];
    list.push(ex.id);
    examIdsBySlot.set(slot, list);
  }

  const gradeBySubjAndExam = new Map<string, GradeRecord>();
  const subjectIdsWithGrades = new Set<number>();
  for (const g of publishedGrades) {
    if (g.studentId !== student.id || g.status !== 'published' || g.score === null) continue;
    gradeBySubjAndExam.set(`${g.subjectId}:${g.examId}`, g);
    subjectIdsWithGrades.add(g.subjectId);
  }

  // Strictly read published ministerial qualification per subject (never auto-compute silently)
  const qualBySubject = new Map<number, Grade6SubjectQualification>();
  for (const q of subjectQualifications) {
    if (q.studentId !== student.id || q.status !== 'published' || !q.decision) continue;
    qualBySubject.set(q.subjectId, q);
  }

  // Strictly read published Iraqi exemptions (Individual / General) for non-ministerial classes ONLY
  const exemptBySubject = new Map<number, SubjectExemption>();
  if (!isMinisterial) {
    for (const ex of subjectExemptions) {
      if (ex.studentId !== student.id || ex.status !== 'published' || !ex.decision) continue;
      exemptBySubject.set(ex.subjectId, ex);
    }
  }
  const hasPublishedGeneralExempt =
    !isMinisterial &&
    Boolean(
      overallExemption &&
        overallExemption.studentId === student.id &&
        overallExemption.status === 'published' &&
        overallExemption.decision === 'exempt'
    );

  const getSlotGrade = (subjectId: number, slot: IraqiExamSlot): { score: number | null; notes: string } => {
    const ids = examIdsBySlot.get(slot);
    if (!ids) return { score: null, notes: '' };
    for (const eid of ids) {
      const rec = gradeBySubjAndExam.get(`${subjectId}:${eid}`);
      if (rec && rec.score !== null) {
        return { score: rec.score, notes: (rec.notes || '').trim() };
      }
    }
    return { score: null, notes: '' };
  };

  const applicableSubjects = [...subjects]
    .filter((s) => {
      if (isSubjectExcludedForClass(s.name, student.className, isMinisterial)) return false;
      if (subjectIdsWithGrades.has(s.id) || qualBySubject.has(s.id) || exemptBySubject.has(s.id)) return true;
      if (!s.isActive) return false;
      const classOk = s.classId === null || s.classId === student.classId;
      const sectionOk = s.sectionId === null || s.sectionId === student.sectionId;
      return classOk && sectionOk;
    })
    .sort((a, b) => a.displayOrder - b.displayOrder || a.id - b.id);

  const iraqiRows: IraqiCardRow[] = applicableSubjects.map((subj, idx) => {
    const s1m1 = getSlotGrade(subj.id, 'sem1Month1');
    const s1m2 = getSlotGrade(subj.id, 'sem1Month2');
    const directS1Avg = getSlotGrade(subj.id, 'sem1Average');
    const mid = getSlotGrade(subj.id, 'midyear');
    const s2m1 = getSlotGrade(subj.id, 'sem2Month1');
    const s2m2 = getSlotGrade(subj.id, 'sem2Month2');
    const directS2Avg = getSlotGrade(subj.id, 'sem2Average');
    const directAnnual = getSlotGrade(subj.id, 'annualEffort');
    const finalEx = getSlotGrade(subj.id, 'finalExam');
    const directFinal = getSlotGrade(subj.id, 'finalGrade');
    const secondRound = getSlotGrade(subj.id, 'secondRound');

    const sem1Average =
      directS1Avg.score !== null ? roundIraqiHalfUp(directS1Avg.score) : null;

    const sem2Average =
      directS2Avg.score !== null ? roundIraqiHalfUp(directS2Avg.score) : null;

    const annualEffort =
      directAnnual.score !== null ? roundIraqiHalfUp(directAnnual.score) : null;

    const subjExempt = !isMinisterial ? exemptBySubject.get(subj.id) : undefined;
    const isExempt =
      !isMinisterial &&
      (hasPublishedGeneralExempt || (subjExempt?.decision === 'exempt'));
    const isGeneralExempt = isExempt && (hasPublishedGeneralExempt || subjExempt?.exemptionType === 'general');
    const isIndividualExempt = isExempt && !isGeneralExempt;

    let finalExamVal: number | null = isMinisterial || isExempt ? null : finalEx.score;
    let finalGradeVal: number | null =
      directFinal.score !== null ? roundIraqiHalfUp(directFinal.score) : null;

    if (!isMinisterial && isExempt && annualEffort !== null) {
      finalGradeVal = annualEffort;
    }

    const isSecondRoundUpdated = !isMinisterial && secondRound.score !== null;
    if (!isMinisterial && secondRound.score !== null) {
      if (annualEffort !== null && finalGradeVal === null) {
        finalGradeVal = roundIraqiHalfUp((annualEffort + secondRound.score) / 2);
      }
      if (finalExamVal === null && !isExempt) {
        finalExamVal = secondRound.score;
      }
    }

    const subjQual = isMinisterial ? qualBySubject.get(subj.id) : undefined;

    const combinedNotes = [
      s1m1.notes,
      s1m2.notes,
      mid.notes,
      s2m1.notes,
      s2m2.notes,
      isMinisterial ? '' : finalEx.notes,
      secondRound.notes ? `دور ثاني: ${secondRound.notes}` : '',
      subjExempt?.notes || '',
      subjQual?.notes || '',
    ]
      .filter((n) => n.length > 0)
      .join(' · ');

    return {
      sequence: idx + 1,
      subjectId: subj.id,
      subjectName: subj.name,
      sem1Month1: s1m1.score,
      sem1Month2: s1m2.score,
      sem1Average,
      midyear: mid.score,
      sem2Month1: s2m1.score,
      sem2Month2: s2m2.score,
      sem2Average,
      annualEffort,
      finalExam: finalExamVal,
      finalGrade: isMinisterial ? null : finalGradeVal,
      ...(secondRound.score !== null
        ? { secondRoundScore: secondRound.score, isSecondRoundUpdated: true }
        : {}),
      ...(isExempt ? { isIndividualExempt, isGeneralExempt } : {}),
      ...(isMinisterial
        ? { ministerialQualification: subjQual?.decision ?? null }
        : {}),
      notes: combinedNotes,
    };
  });

  const finalScores = iraqiRows.map((r) => r.finalGrade);
  const allFinalsReady =
    iraqiRows.length > 0 && finalScores.every((score) => score !== null);
  const failingRows = iraqiRows.filter(
    (r) => r.finalGrade !== null && r.finalGrade < 50
  );
  const failingCount = failingRows.length;
  const round1FailingSubjects = failingRows.map((r) => r.subjectName);
  const hasSecondRoundUpdates = iraqiRows.some((r) => Boolean(r.isSecondRoundUpdated));

  let standing: IraqiCardSummary['standing'] = 'قيد استكمال العام الدراسي';
  if (!isMinisterial && allFinalsReady) {
    if (failingCount === 0) standing = 'ناجح';
    else if (failingCount <= 2) standing = 'مكمل';
    else standing = 'راسب';
  }

  let round1Result: IraqiCardSummary['round1Result'] = '';
  if (!isMinisterial) {
    if (failingCount >= 3) {
      round1Result = 'راسب';
    } else if (allFinalsReady) {
      round1Result = failingCount === 0 ? 'ناجح' : 'مكمل';
    }
  }

  const publishedOverallDecision: MinisterialDecision | null =
    isMinisterial && overallQualification && overallQualification.status === 'published'
      ? overallQualification.decision
      : null;

  const ministerialResultText: IraqiCardSummary['ministerialResultText'] =
    publishedOverallDecision === 'qualified'
      ? 'مؤهل للامتحان الوزاري'
      : publishedOverallDecision === 'not_qualified'
        ? 'غير مؤهل للامتحان الوزاري'
        : '';

  const iraqiSummary: IraqiCardSummary = {
    subjectCount: iraqiRows.length,
    sem1Month1: summarizeIraqiColumn(iraqiRows.map((r) => r.sem1Month1)),
    sem1Month2: summarizeIraqiColumn(iraqiRows.map((r) => r.sem1Month2)),
    sem1Average: summarizeIraqiColumn(iraqiRows.map((r) => r.sem1Average)),
    midyear: summarizeIraqiColumn(iraqiRows.map((r) => r.midyear)),
    sem2Month1: summarizeIraqiColumn(iraqiRows.map((r) => r.sem2Month1)),
    sem2Month2: summarizeIraqiColumn(iraqiRows.map((r) => r.sem2Month2)),
    sem2Average: summarizeIraqiColumn(iraqiRows.map((r) => r.sem2Average)),
    annualEffort: summarizeIraqiColumn(iraqiRows.map((r) => r.annualEffort)),
    finalExam: summarizeIraqiColumn(iraqiRows.map((r) => r.finalExam)),
    finalGrade: summarizeIraqiColumn(iraqiRows.map((r) => r.finalGrade)),
    failingCount,
    standing,
    round1Result,
    round1FailingSubjects,
    isGeneralExempt: hasPublishedGeneralExempt,
    hasSecondRoundUpdates,
    ...(isMinisterial
      ? {
          ministerialDecision: publishedOverallDecision,
          ministerialResultText,
        }
      : {}),
  };

  return { iraqiRows, iraqiSummary };
}

/**
 * Builds a single-exam report card strictly from explicitly entered, imported,
 * or manager-calculated grades for that exam (no silent auto-calculation).
 */
export function buildComputedSingleExamReportCard(params: {
  student: Student;
  className: string;
  sectionName: string;
  targetExam: Exam;
  allExams: Exam[];
  subjects: Subject[];
  allGrades: GradeRecord[];
  settings: SchoolSettings;
  filterSubjectId?: number | null;
}): PublicReportCard | null {
  const effectiveSubjects = params.filterSubjectId
    ? params.subjects.filter((s) => s.id === params.filterSubjectId)
    : params.subjects;

  return buildPublicReportCard({
    student: params.student,
    className: params.className,
    sectionName: params.sectionName,
    exam: params.targetExam,
    subjects: effectiveSubjects,
    grades: params.allGrades,
    settings: params.settings,
  });
}

export interface ComputedEffortEntry {
  studentId: number;
  subjectId: number;
  examId: number;
  slot: 'sem1Average' | 'sem2Average' | 'annualEffort' | 'finalGrade';
  score: number;
}

/**
 * Pure calculation engine invoked ONLY by explicit manager approval.
 * Computes effort averages & final grades solely when all required component grades
 * are complete for a student & subject.
 */
export function computeEffortCalculations(params: {
  target: EffortCalculationTarget;
  students: Student[];
  subjects: Subject[];
  exams: Exam[];
  grades: GradeRecord[];
  requirePublishedComponents?: boolean;
}): {
  entries: ComputedEffortEntry[];
  skippedIncompleteCount: number;
  targetExamNames: string[];
} {
  const {
    target,
    students,
    subjects,
    exams,
    grades,
    requirePublishedComponents = false,
  } = params;

  const examBySlot = new Map<IraqiExamSlot, Exam>();
  for (const ex of exams) {
    const slot = matchIraqiExamSlot(ex.name);
    if (slot && !examBySlot.has(slot)) {
      examBySlot.set(slot, ex);
    }
  }

  // Latest score lookup by studentId:subjectId:slot
  const slotByExamId = new Map<number, IraqiExamSlot>();
  for (const ex of exams) {
    const slot = matchIraqiExamSlot(ex.name);
    if (slot) slotByExamId.set(ex.id, slot);
  }

  const scoreMap = new Map<string, number>();
  for (const g of grades) {
    if (g.score === null || !Number.isFinite(g.score)) continue;
    if (requirePublishedComponents && g.status !== 'published') continue;
    const slot = slotByExamId.get(g.examId);
    if (!slot) continue;
    scoreMap.set(`${g.studentId}:${g.subjectId}:${slot}`, g.score);
  }

  const orderedSlots: Array<'sem1Average' | 'sem2Average' | 'annualEffort' | 'finalGrade'> =
    target === 'all'
      ? ['sem1Average', 'sem2Average', 'annualEffort', 'finalGrade']
      : [target];

  const entries: ComputedEffortEntry[] = [];
  let skippedIncompleteCount = 0;
  const targetExamNamesSet = new Set<string>();

  for (const slot of orderedSlots) {
    const targetExam = examBySlot.get(slot);
    if (!targetExam) continue;
    targetExamNamesSet.add(targetExam.name);

    for (const student of students) {
      for (const subject of subjects) {
        const key = (s: IraqiExamSlot) => `${student.id}:${subject.id}:${s}`;
        let computed: number | null = null;

        if (slot === 'sem1Average') {
          const m1 = scoreMap.get(key('sem1Month1'));
          const m2 = scoreMap.get(key('sem1Month2'));
          if (m1 !== undefined && m2 !== undefined) {
            computed = roundIraqiHalfUp((m1 + m2) / 2);
          }
        } else if (slot === 'sem2Average') {
          const m1 = scoreMap.get(key('sem2Month1'));
          const m2 = scoreMap.get(key('sem2Month2'));
          if (m1 !== undefined && m2 !== undefined) {
            computed = roundIraqiHalfUp((m1 + m2) / 2);
          }
        } else if (slot === 'annualEffort') {
          const s1 = scoreMap.get(key('sem1Average'));
          const mid = scoreMap.get(key('midyear'));
          const s2 = scoreMap.get(key('sem2Average'));
          if (s1 !== undefined && mid !== undefined && s2 !== undefined) {
            computed = roundIraqiHalfUp((s1 + mid + s2) / 3);
          }
        } else if (slot === 'finalGrade') {
          const annual = scoreMap.get(key('annualEffort'));
          const finalEx = scoreMap.get(key('finalExam'));
          if (annual !== undefined && finalEx !== undefined) {
            computed = roundIraqiHalfUp((annual + finalEx) / 2);
          }
        }

        if (computed === null) {
          skippedIncompleteCount += 1;
          continue;
        }

        // Feed newly calculated effort into scoreMap so sequential 'all' mode can build Annual Effort -> Final Grade
        scoreMap.set(key(slot), computed);
        entries.push({
          studentId: student.id,
          subjectId: subject.id,
          examId: targetExam.id,
          slot,
          score: computed,
        });
      }
    }
  }

  return {
    entries,
    skippedIncompleteCount,
    targetExamNames: Array.from(targetExamNamesSet),
  };
}

export function buildAllPublishedReportCard(params: {
  student: Student;
  className: string;
  sectionName: string;
  exams: Exam[];
  subjects: Subject[];
  grades: GradeRecord[];
  settings: SchoolSettings;
  academicYearLabel?: string;
  isMinisterial?: boolean;
  subjectQualifications?: Grade6SubjectQualification[];
  overallQualification?: Grade6OverallQualification | null;
  subjectExemptions?: SubjectExemption[];
  overallExemption?: OverallExemption | null;
}): AllPublishedReportCard | null {
  const {
    student,
    className,
    sectionName,
    exams,
    subjects,
    grades,
    settings,
    academicYearLabel,
    isMinisterial = false,
    subjectQualifications = [],
    overallQualification = null,
    subjectExemptions = [],
    overallExemption = null,
  } = params;

  const publishedGrades = grades.filter(
    (g) => g.studentId === student.id && g.status === 'published' && g.score !== null
  );
  const hasPublishedQualifications =
    isMinisterial &&
    (subjectQualifications.some((q) => q.studentId === student.id && q.status === 'published' && q.decision) ||
      (overallQualification?.studentId === student.id &&
        overallQualification.status === 'published' &&
        Boolean(overallQualification.decision)));
  const hasPublishedExemptions =
    !isMinisterial &&
    (subjectExemptions.some((e) => e.studentId === student.id && e.status === 'published' && e.decision === 'exempt') ||
      (overallExemption?.studentId === student.id &&
        overallExemption.status === 'published' &&
        overallExemption.decision === 'exempt'));

  if (publishedGrades.length === 0 && !hasPublishedQualifications && !hasPublishedExemptions) {
    return null;
  }

  const orderedExams = [...exams]
    .filter((e) => e.isActive)
    .sort((a, b) => a.displayOrder - b.displayOrder || a.id - b.id);

  const builtExams: AllPublishedReportCard['exams'] = [];

  for (const exam of orderedExams) {
    const single = buildPublicReportCard({
      student,
      className,
      sectionName,
      exam,
      subjects,
      grades: publishedGrades,
      settings,
    });
    if (single) {
      builtExams.push({
        examId: exam.id,
        examName: exam.name,
        issuedAt: single.issuedAt,
        hasNotesColumn: single.hasNotesColumn,
        hasMaxScoreColumn: false,
        rows: single.rows,
        summary: single.summary,
      });
    }
  }

  if (builtExams.length === 0 && !hasPublishedQualifications) {
    return null;
  }

  const orderedSubjects = [...subjects].sort(
    (a, b) => a.displayOrder - b.displayOrder || a.id - b.id
  );

  const matrixSubjects: AllPublishedReportCard['matrixSubjects'] = [];
  let seq = 1;
  for (const subj of orderedSubjects) {
    const scoresByExam: Record<number, { score: number; rating: string; notes?: string } | undefined> = {};
    let hasAny = false;
    for (const ex of builtExams) {
      const found = ex.rows.find((r) => r.subjectId === subj.id);
      if (found) {
        hasAny = true;
        scoresByExam[ex.examId] = {
          score: found.score,
          rating: found.rating,
          notes: found.notes && found.notes !== '—' ? found.notes : undefined,
        };
      }
    }
    if (hasAny) {
      matrixSubjects.push({
        sequence: seq++,
        subjectId: subj.id,
        subjectName: subj.name,
        maxScore: subj.maxScore > 0 ? subj.maxScore : null,
        scoresByExam,
      });
    }
  }

  const { iraqiRows, iraqiSummary } = buildStudentIraqiMatrix({
    student,
    exams: orderedExams,
    subjects: orderedSubjects,
    publishedGrades,
    isMinisterial,
    subjectQualifications,
    overallQualification,
    subjectExemptions,
    overallExemption,
  });

  return {
    schoolName: settings.schoolName,
    republicHeader: settings.republicHeader,
    ministryHeader: settings.ministryHeader,
    directorate: settings.directorate,
    academicYear: academicYearLabel || orderedExams[0]?.academicYear || settings.academicYear,
    footerText: settings.footerText,
    emblemUrl: settings.emblemUrl,
    ministrySealUrl: settings.ministrySealUrl,
    primaryColor: settings.primaryColor,
    accentColor: settings.accentColor,
    isMinisterial,
    student: {
      fullName: student.fullName,
      inquiryCode: student.inquiryCode,
      className,
      sectionName,
    },
    exams: builtExams,
    matrixSubjects,
    iraqiRows,
    iraqiSummary,
  };
}

export interface NormalizedStudentImport {
  fullName: string;
  inquiryCode: string;
  classId: number;
  sectionId: number;
  notes: string;
  action: 'create' | 'update';
}

export interface StudentImportOptions {
  defaultClassId?: number | null;
  defaultSectionId?: number | null;
  allowUpdateExisting?: boolean;
}

export function normalizeArabicIndicDigits(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/[٠۰]/g, '0')
    .replace(/[١۱]/g, '1')
    .replace(/[٢۲]/g, '2')
    .replace(/[٣۳]/g, '3')
    .replace(/[٤۴]/g, '4')
    .replace(/[٥۵]/g, '5')
    .replace(/[٦۶]/g, '6')
    .replace(/[٧۷]/g, '7')
    .replace(/[٨۸]/g, '8')
    .replace(/[٩۹]/g, '9')
    .replace(/[\u200B-\u200F\u202A-\u202E\uFEFF\u061C]/g, '')
    .trim();
}

export function normalizeArabicText(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه');
}

export function isTeacherAuthorizedForScope(
  assignments: TeacherAssignment[] | undefined,
  classId: number,
  sectionId: number | null,
  subjectId: number
): boolean {
  if (!assignments || assignments.length === 0) return false;
  return assignments.some((a) => {
    if (a.classId !== classId || a.subjectId !== subjectId) return false;
    if (a.sectionId === null) return true; // All sections of this class
    if (sectionId === null) return false; // Requested all sections, but teacher only has specific section(s)
    return a.sectionId === sectionId;
  });
}

export function validateStudentImportRows(
  rows: Record<string, string>[],
  existingInquiryCodes: Set<string>,
  classes: SchoolClass[],
  sections: Section[],
  options: StudentImportOptions = {}
): ImportPreviewResponse<NormalizedStudentImport> {
  const seenInFile = new Set<string>();
  const classByName = new Map(classes.map((c) => [c.name.trim(), c]));
  const classById = new Map(classes.map((c) => [c.id, c]));
  const previewRows: ImportRowPreview<NormalizedStudentImport>[] = [];

  rows.forEach((raw, idx) => {
    const errors: string[] = [];
    const fullName = (
      raw.fullName ||
      raw['الاسم الكامل'] ||
      raw['اسم الطالب'] ||
      raw['الاسم'] ||
      ''
    ).trim();
    const inquiryCode = (
      raw.inquiryCode ||
      raw['رقم الهوية الوطنية'] ||
      raw['رقم الهوية'] ||
      raw['الهوية الوطنية'] ||
      raw['رقم الاستعلام'] ||
      raw['الرقم التعريفي'] ||
      ''
    ).trim();
    const className = (raw.className || raw['الصف'] || raw['الصف الدراسي'] || '').trim();
    const sectionName = (raw.sectionName || raw['الشعبة'] || '').trim();
    const notes = (raw.notes || raw['ملاحظات'] || '').trim();

    let action: 'create' | 'update' = 'create';

    if (!fullName || fullName.length < 3) {
      errors.push('اسم الطالب مفقود أو قصير جداً.');
    }
    if (!inquiryCode) {
      errors.push('رقم الهوية الوطنية مفقود.');
    } else if (seenInFile.has(inquiryCode)) {
      errors.push(`رقم الهوية الوطنية (${inquiryCode}) مكرر داخل الملف.`);
    } else if (existingInquiryCodes.has(inquiryCode)) {
      if (options.allowUpdateExisting) {
        action = 'update';
      } else {
        errors.push(`رقم الهوية الوطنية (${inquiryCode}) مسجل مسبقاً في قاعدة البيانات.`);
      }
    }

    const cls = className
      ? classByName.get(className)
      : options.defaultClassId
        ? classById.get(options.defaultClassId)
        : undefined;

    if (!cls) {
      errors.push(
        className
          ? `الصف "${className}" غير موجود في النظام.`
          : 'عمود الصف مفقود ولم يتم تحديد صف افتراضي.'
      );
    }

    const sec = cls
      ? sectionName
        ? sections.find((s) => s.classId === cls.id && s.name.trim() === sectionName)
        : options.defaultSectionId
          ? sections.find((s) => s.classId === cls.id && s.id === options.defaultSectionId)
          : undefined
      : undefined;

    if (cls && !sec) {
      errors.push(
        sectionName
          ? `الشعبة "${sectionName}" غير موجودة ضمن الصف "${cls.name}".`
          : `عمود الشعبة مفقود ولم يتم تحديد شعبة افتراضية للصف "${cls.name}".`
      );
    }

    if (inquiryCode) {
      seenInFile.add(inquiryCode);
    }

    const valid = errors.length === 0 && Boolean(cls) && Boolean(sec);
    previewRows.push({
      rowNumber: idx + 2,
      raw: {
        ...raw,
        ...(fullName ? { 'اسم الطالب': fullName } : {}),
        ...(inquiryCode ? { 'رقم الهوية الوطنية': inquiryCode } : {}),
        ...(cls ? { 'الصف': cls.name } : {}),
        ...(sec ? { 'الشعبة': sec.name } : {}),
      },
      valid,
      errors,
      normalized:
        valid && cls && sec
          ? {
              fullName,
              inquiryCode,
              classId: cls.id,
              sectionId: sec.id,
              notes,
              action,
            }
          : undefined,
    });
  });

  const validCount = previewRows.filter((r) => r.valid).length;
  return {
    totalRows: previewRows.length,
    validCount,
    invalidCount: previewRows.length - validCount,
    rows: previewRows,
  };
}

export interface NormalizedGradeImport {
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

export interface GradeImportOptions {
  defaultSubjectId?: number | null;
  defaultExamId?: number | null;
  defaultClassId?: number | null;
  defaultSectionId?: number | null;
  subjects?: Subject[];
  teacherAssignments?: TeacherAssignment[];
  restrictToTeacher?: boolean;
}

const SUBJECT_ALIASES: Record<string, string> = {
  'الجرائم': 'جرائم حزب البعث',
  'جرائم البعث': 'جرائم حزب البعث',
  'الاسلامية': 'التربية الإسلامية',
  'التربية الاسلامية': 'التربية الإسلامية',
  'العربي': 'اللغة العربية',
  'اللغة العربية': 'اللغة العربية',
  'الانكليزي': 'اللغة الإنكليزية',
  'الانكليزية': 'اللغة الإنكليزية',
  'اللغة الانكليزية': 'اللغة الإنكليزية',
  'الكردي': 'اللغة الكردية',
  'الكردية': 'اللغة الكردية',
  'اللغة الكردية': 'اللغة الكردية',
};

function resolveScopedSubjectByHeader(
  rawName: string,
  allSubjects: Subject[],
  subjectsByName: Map<string, Subject>,
  normalizedSubjectsByName: Map<string, Subject>,
  studentClassId?: number | null
): Subject | undefined {
  const clean = rawName.trim();
  const aliasTarget = SUBJECT_ALIASES[normalizeArabicText(clean)] ?? clean;
  const normTarget = normalizeArabicText(aliasTarget);

  if (studentClassId && allSubjects.length > 0) {
    const classExact = allSubjects.find(
      (s) => s.classId === studentClassId && (s.name.trim() === clean || normalizeArabicText(s.name) === normTarget)
    );
    if (classExact) return classExact;
  }
  return subjectsByName.get(clean) ?? normalizedSubjectsByName.get(normTarget);
}

export function validateGradeImportRows(
  rows: Record<string, string>[],
  studentsByCode: Map<string, Student>,
  subjectsByName: Map<string, Subject>,
  examsByName: Map<string, Exam>,
  options: GradeImportOptions = {}
): ImportPreviewResponse<NormalizedGradeImport> {
  const seenKeys = new Set<string>();
  const previewRows: ImportRowPreview<NormalizedGradeImport>[] = [];

  const allSubjectsList = options.subjects && options.subjects.length > 0
    ? options.subjects
    : Array.from(subjectsByName.values());

  const subjectsById = new Map<number, Subject>();
  for (const s of allSubjectsList) subjectsById.set(s.id, s);

  const examsById = new Map<number, Exam>();
  for (const e of examsByName.values()) examsById.set(e.id, e);

  // Scoped name lookup for quick roster sheets where user may match by full name
  const allStudents = Array.from(studentsByCode.values());
  const scopedStudents = allStudents.filter((st) => {
    if (options.defaultClassId && st.classId !== options.defaultClassId) return false;
    if (options.defaultSectionId && st.sectionId !== options.defaultSectionId) return false;
    return true;
  });

  const studentsByNormalizedName = new Map<string, Student[]>();
  for (const st of scopedStudents) {
    const key = normalizeArabicText(st.fullName);
    const arr = studentsByNormalizedName.get(key) ?? [];
    arr.push(st);
    studentsByNormalizedName.set(key, arr);
  }

  // Build normalized lookup maps for subjects & exams
  const normalizedSubjectsByName = new Map<string, Subject>();
  for (const s of allSubjectsList) {
    if (!options.defaultClassId || s.classId === null || s.classId === options.defaultClassId) {
      normalizedSubjectsByName.set(normalizeArabicText(s.name), s);
    }
  }
  for (const [k, s] of subjectsByName.entries()) {
    if (!normalizedSubjectsByName.has(normalizeArabicText(k))) {
      normalizedSubjectsByName.set(normalizeArabicText(k), s);
    }
  }
  const normalizedExamsByName = new Map<string, Exam>();
  for (const [k, e] of examsByName.entries()) {
    normalizedExamsByName.set(normalizeArabicText(k), e);
  }

  // Detect wide all-subjects matrix format ("القالب العام للدرجات لكل المواد")
  // Matrix files omit explicit 'المادة'/'subjectName' and 'الدرجة'/'score' columns, and put subject names directly as headers.
  const allHeaders = new Set<string>();
  for (const r of rows) {
    for (const key of Object.keys(r)) {
      allHeaders.add(key.trim());
    }
  }
  const hasRowWiseSubjectCol =
    allHeaders.has('المادة') || allHeaders.has('المادة الدراسية') || allHeaders.has('subjectName');
  const hasRowWiseScoreCol = allHeaders.has('الدرجة') || allHeaders.has('score');

  const matrixSubjectHeaders: Array<{ header: string; subject: Subject }> = [];
  if (!hasRowWiseSubjectCol && !hasRowWiseScoreCol) {
    for (const h of allHeaders) {
      const matched = resolveScopedSubjectByHeader(
        h,
        allSubjectsList,
        subjectsByName,
        normalizedSubjectsByName,
        options.defaultClassId
      );
      if (matched) {
        matrixSubjectHeaders.push({ header: h, subject: matched });
      }
    }
  }

  const isMatrixMode = matrixSubjectHeaders.length > 0;

  if (isMatrixMode) {
    rows.forEach((raw, idx) => {
      const excelRowNum = idx + 2;
      const inquiryCode = (
        raw.inquiryCode ||
        raw['رقم الهوية الوطنية'] ||
        raw['رقم الهوية'] ||
        raw['الهوية الوطنية'] ||
        raw['رقم الاستعلام'] ||
        raw['الرقم التعريفي'] ||
        ''
      ).trim();
      const rawStudentName = (
        raw.studentName ||
        raw.fullName ||
        raw['اسم الطالب'] ||
        raw['الاسم الكامل'] ||
        raw['الاسم'] ||
        ''
      ).trim();
      const examName = (
        raw.examName ||
        raw['الامتحان'] ||
        raw['نوع الامتحان'] ||
        raw['التقييم'] ||
        raw['نوع التقييم'] ||
        ''
      ).trim();
      const notes = (raw.notes || raw['ملاحظات'] || raw['الملاحظات'] || '').trim();

      const studentErrors: string[] = [];
      let student = inquiryCode ? studentsByCode.get(inquiryCode) : undefined;
      if (!student && rawStudentName) {
        const candidates =
          studentsByNormalizedName.get(normalizeArabicText(rawStudentName)) ?? [];
        if (candidates.length === 1) {
          student = candidates[0];
        } else if (candidates.length > 1) {
          studentErrors.push(
            `الاسم "${rawStudentName}" متطابق مع أكثر من طالب — يرجى استخدام رقم الهوية الوطنية.`
          );
        }
      }
      if (!student && studentErrors.length === 0) {
        if (inquiryCode) {
          studentErrors.push(`لا يوجد طالب برقم الهوية الوطنية "${inquiryCode}".`);
        } else if (rawStudentName) {
          studentErrors.push(`تعذر العثور على الطالب "${rawStudentName}".`);
        } else {
          studentErrors.push('يرجى تحديد رقم الهوية الوطنية أو اسم الطالب.');
        }
      }

      const exam = examName
        ? examsByName.get(examName) ?? normalizedExamsByName.get(normalizeArabicText(examName))
        : options.defaultExamId
          ? examsById.get(options.defaultExamId)
          : undefined;
      if (!exam) {
        studentErrors.push(
          examName
            ? `الامتحان "${examName}" غير معرف في النظام.`
            : 'نوع الامتحان غير محدد في الملف أو الاختيارات.'
        );
      }

      // Extract non-empty subject cells for this student row
      const nonEmptySubjectCells = matrixSubjectHeaders
        .map(({ header, subject }) => ({
          header,
          subject,
          rawScore: String(raw[header] ?? '').trim(),
        }))
        .filter((cell) => cell.rawScore !== '' && cell.rawScore !== '—' && cell.rawScore !== '-');

      if (nonEmptySubjectCells.length === 0 && studentErrors.length > 0) {
        previewRows.push({
          rowNumber: excelRowNum,
          raw,
          valid: false,
          errors: studentErrors,
        });
        return;
      }

      for (const cell of nonEmptySubjectCells) {
        const errors = [...studentErrors];
        const { subject, rawScore } = cell;

        if (
          options.restrictToTeacher &&
          student &&
          !isTeacherAuthorizedForScope(
            options.teacherAssignments,
            student.classId,
            student.sectionId,
            subject.id
          )
        ) {
          errors.push(
            `غير مخول: المادة "${subject.name}" أو صف الطالب (${student.className ?? ''}) غير موكل لحسابك.`
          );
        }

        const check = validateScoreInput(rawScore, subject.maxScore);
        if (!check.valid && check.error) {
          errors.push(`${subject.name}: ${check.error}`);
        }

        if (student && exam) {
          const compositeKey = `${student.id}:${subject.id}:${exam.id}`;
          if (seenKeys.has(compositeKey)) {
            errors.push(`تكرار للدرجة لنفس الطالب والمادة (${subject.name}) والامتحان داخل الملف.`);
          }
          seenKeys.add(compositeKey);
        }

        const scoreNum = check.score;
        const valid = errors.length === 0 && Boolean(student && exam && scoreNum !== null);
        previewRows.push({
          rowNumber: excelRowNum,
          raw: {
            ...raw,
            ...(student
              ? { 'اسم الطالب': student.fullName, 'رقم الهوية الوطنية': student.inquiryCode }
              : {}),
            'المادة': subject.name,
            ...(exam ? { 'الامتحان': exam.name } : {}),
            'الدرجة': rawScore,
          },
          valid,
          errors,
          normalized:
            valid && student && exam && scoreNum !== null
              ? {
                  studentId: student.id,
                  studentName: student.fullName,
                  inquiryCode: student.inquiryCode,
                  subjectId: subject.id,
                  subjectName: subject.name,
                  examId: exam.id,
                  examName: exam.name,
                  score: scoreNum,
                  notes,
                }
              : undefined,
        });
      }
    });

    const validCount = previewRows.filter((r) => r.valid).length;
    return {
      totalRows: previewRows.length,
      validCount,
      invalidCount: previewRows.length - validCount,
      rows: previewRows,
    };
  }

  rows.forEach((raw, idx) => {
    const errors: string[] = [];
    const inquiryCode = (
      raw.inquiryCode ||
      raw['رقم الهوية الوطنية'] ||
      raw['رقم الهوية'] ||
      raw['الهوية الوطنية'] ||
      raw['رقم الاستعلام'] ||
      raw['الرقم التعريفي'] ||
      ''
    ).trim();
    const rawStudentName = (
      raw.studentName ||
      raw.fullName ||
      raw['اسم الطالب'] ||
      raw['الاسم الكامل'] ||
      raw['الاسم'] ||
      ''
    ).trim();
    const subjectName = (raw.subjectName || raw['المادة'] || raw['المادة الدراسية'] || '').trim();
    const examName = (
      raw.examName ||
      raw['الامتحان'] ||
      raw['نوع الامتحان'] ||
      raw['التقييم'] ||
      raw['نوع التقييم'] ||
      ''
    ).trim();
    const rawScore = (raw.score ?? raw['الدرجة'] ?? '').toString().trim();
    const notes = (raw.notes || raw['ملاحظات'] || raw['الملاحظات'] || '').trim();

    let student = inquiryCode ? studentsByCode.get(inquiryCode) : undefined;
    if (!student && rawStudentName) {
      const candidates = studentsByNormalizedName.get(normalizeArabicText(rawStudentName)) ?? [];
      if (candidates.length === 1) {
        student = candidates[0];
      } else if (candidates.length > 1) {
        errors.push(`الاسم "${rawStudentName}" متطابق مع أكثر من طالب — يرجى استخدام رقم الهوية الوطنية.`);
      }
    }

    if (!student && errors.length === 0) {
      if (inquiryCode) {
        errors.push(`لا يوجد طالب برقم الهوية الوطنية "${inquiryCode}".`);
      } else if (rawStudentName) {
        errors.push(`تعذر العثور على الطالب "${rawStudentName}".`);
      } else {
        errors.push('يرجى تحديد رقم الهوية الوطنية أو اسم الطالب.');
      }
    }

    const subject = subjectName
      ? resolveScopedSubjectByHeader(
          subjectName,
          allSubjectsList,
          subjectsByName,
          normalizedSubjectsByName,
          student?.classId ?? options.defaultClassId
        )
      : options.defaultSubjectId
        ? subjectsById.get(options.defaultSubjectId)
        : undefined;
    if (!subject) {
      errors.push(
        subjectName
          ? `المادة "${subjectName}" غير معرفة في النظام.`
          : 'المادة الدراسية غير محددة في الملف أو الاختيارات.'
      );
    }

    const exam = examName
      ? examsByName.get(examName) ?? normalizedExamsByName.get(normalizeArabicText(examName))
      : options.defaultExamId
        ? examsById.get(options.defaultExamId)
        : undefined;
    if (!exam) {
      errors.push(
        examName
          ? `الامتحان "${examName}" غير معرف في النظام.`
          : 'نوع الامتحان غير محدد في الملف أو الاختيارات.'
      );
    }

    if (
      options.restrictToTeacher &&
      student &&
      subject &&
      !isTeacherAuthorizedForScope(options.teacherAssignments, student.classId, student.sectionId, subject.id)
    ) {
      errors.push(`غير مخول: المادة "${subject.name}" أو صف الطالب (${student.className ?? ''}) غير موكل لحسابك.`);
    }

    if (rawScore === '') {
      errors.push('الدرجة مطلوبة.');
    } else if (subject) {
      const check = validateScoreInput(rawScore, subject.maxScore);
      if (!check.valid && check.error) {
        errors.push(check.error);
      }
    } else {
      const parsed = Number(rawScore);
      if (!Number.isFinite(parsed) || parsed < 0) {
        errors.push('الدرجة يجب أن تكون رقماً غير سالب.');
      }
    }

    if (student && subject && exam) {
      const compositeKey = `${student.id}:${subject.id}:${exam.id}`;
      if (seenKeys.has(compositeKey)) {
        errors.push('صف مكرر لنفس الطالب والمادة والامتحان داخل الملف.');
      }
      seenKeys.add(compositeKey);
    }

    const scoreNum = Number(rawScore);
    const valid = errors.length === 0 && Boolean(student && subject && exam);
    previewRows.push({
      rowNumber: idx + 2,
      raw: {
        ...raw,
        ...(student ? { 'اسم الطالب': student.fullName, 'رقم الهوية الوطنية': student.inquiryCode } : {}),
        ...(subject ? { 'المادة': subject.name } : {}),
        ...(exam ? { 'الامتحان': exam.name } : {}),
        ...(rawScore !== '' ? { 'الدرجة': rawScore } : {}),
      },
      valid,
      errors,
      normalized:
        valid && student && subject && exam
          ? {
              studentId: student.id,
              studentName: student.fullName,
              inquiryCode: student.inquiryCode,
              subjectId: subject.id,
              subjectName: subject.name,
              examId: exam.id,
              examName: exam.name,
              score: Math.round(scoreNum * 100) / 100,
              notes,
            }
          : undefined,
    });
  });

  const validCount = previewRows.filter((r) => r.valid).length;
  return {
    totalRows: previewRows.length,
    validCount,
    invalidCount: previewRows.length - validCount,
    rows: previewRows,
  };
}

export function buildGroupExamRoster(params: {
  settings: SchoolSettings;
  exam: Exam;
  schoolClass: SchoolClass;
  section: Section | null;
  students: Student[];
  subjects: Subject[];
  grades: GradeRecord[];
  onlyPublished: boolean;
  subjectId?: number | null;
}): GroupExamRoster {
  const {
    settings,
    exam,
    schoolClass,
    section,
    students,
    subjects,
    grades,
    onlyPublished,
    subjectId = null,
  } = params;

  const filteredStudents = [...students]
    .filter(
      (s) =>
        s.isActive &&
        s.classId === schoolClass.id &&
        (section === null || s.sectionId === section.id)
    )
    .sort((a, b) => {
      const secCmp = (a.sectionName || '').localeCompare(b.sectionName || '', 'ar');
      if (secCmp !== 0) return secCmp;
      return a.fullName.localeCompare(b.fullName, 'ar');
    });

  const applicableSubjects = [...subjects]
    .filter(
      (sub) =>
        sub.isActive &&
        !isSubjectExcludedForClass(sub.name, schoolClass.name, schoolClass.isMinisterial) &&
        (sub.classId === null || sub.classId === schoolClass.id) &&
        (sub.sectionId === null || (section !== null && sub.sectionId === section.id)) &&
        (subjectId === null || sub.id === subjectId)
    )
    .sort((a, b) => a.displayOrder - b.displayOrder || a.id - b.id);

  const gradeMap = new Map<string, GradeRecord>();
  for (const g of grades) {
    if (g.examId !== exam.id) continue;
    if (onlyPublished && g.status !== 'published') continue;
    gradeMap.set(`${g.studentId}:${g.subjectId}`, g);
  }

  const rows = filteredStudents.map((st, idx) => {
    const scoresBySubject: Record<number, { score: number | null; status: GradeStatus; notes: string }> = {};
    for (const sub of applicableSubjects) {
      const rec = gradeMap.get(`${st.id}:${sub.id}`);
      scoresBySubject[sub.id] = rec
        ? { score: rec.score, status: rec.status, notes: rec.notes }
        : { score: null, status: 'draft', notes: '' };
    }
    return {
      sequence: idx + 1,
      studentId: st.id,
      fullName: st.fullName,
      inquiryCode: st.inquiryCode,
      className: st.className || schoolClass.name,
      sectionName: st.sectionName || section?.name || '',
      scoresBySubject,
    };
  });

  const selectedSubject =
    subjectId !== null ? applicableSubjects.find((s) => s.id === subjectId) ?? null : null;

  return {
    schoolName: settings.schoolName,
    republicHeader: settings.republicHeader,
    ministryHeader: settings.ministryHeader,
    directorate: settings.directorate,
    academicYear: exam.academicYear || settings.academicYear,
    footerText: settings.footerText,
    emblemUrl: settings.emblemUrl,
    examId: exam.id,
    examName: exam.name,
    className: schoolClass.name,
    sectionLabel: section ? `شعبة ${section.name}` : 'جميع الشعب',
    includeAllSections: section === null,
    subjectId: selectedSubject ? selectedSubject.id : null,
    subjectLabel: selectedSubject ? selectedSubject.name : 'كل المواد',
    subjects: applicableSubjects.map((s) => ({
      id: s.id,
      name: s.name,
      maxScore: s.maxScore,
    })),
    rows,
  };
}

// =============================================================================
// IRAQI GRADE 6 MINISTERIAL QUALIFICATION ENGINE ("3 LESSONS + 10 DECISION MARKS")
// =============================================================================

export interface Grade6QualificationEval {
  subjectDecisions: Array<{
    subjectId: number;
    subjectName: string;
    annualEffort: number | null;
    decision: MinisterialDecision | null;
    bonusApplied: number;
  }>;
  overallDecision: MinisterialDecision | null;
  incomplete: boolean;
  rawFailingCount: number;
  remainingFailingCount: number;
  bonusUsed: number;
}

/**
 * Pure Iraqi Grade 6 ministerial qualification evaluator invoked ONLY on explicit manager command.
 * Rule:
 * - A subject with annualEffort >= 50 is 'qualified' ("مؤهل"), < 50 is 'not_qualified' ("غير مؤهل").
 * - Up to `decisionBonus` (default 10) marks are allocated to failing subjects sorted by smallest deficit (50 - score)
 *   to lift as many subjects as possible to 50.
 * - If all applicable active subjects have annualEffort scores, student is overall 'qualified' ("مؤهل للامتحان الوزاري")
 *   when `remainingFailingCount <= maxFailSubjects` (default 3); otherwise 'not_qualified'.
 */
export function evaluateIraqiGrade6Qualification(params: {
  subjects: Subject[];
  annualEffortBySubjectId: Map<number, number>;
  maxFailSubjects: number;
  decisionBonus: number;
}): Grade6QualificationEval {
  const { subjects, annualEffortBySubjectId, maxFailSubjects, decisionBonus } = params;
  const safeMaxFail = Math.max(0, Math.floor(maxFailSubjects));
  const safeBonusBudget = Math.max(0, Number(decisionBonus) || 0);

  const rawItems = subjects.map((subj) => {
    const score = annualEffortBySubjectId.get(subj.id);
    const hasScore = score !== undefined && score !== null && Number.isFinite(score);
    const rounded = hasScore ? roundIraqiHalfUp(score) : null;
    const decision: MinisterialDecision | null =
      rounded === null ? null : rounded >= 50 ? 'qualified' : 'not_qualified';
    const deficit = rounded !== null && rounded < 50 ? 50 - rounded : 0;
    return {
      subjectId: subj.id,
      subjectName: subj.name,
      annualEffort: rounded,
      decision,
      deficit,
    };
  });

  const incomplete = rawItems.length === 0 || rawItems.some((item) => item.annualEffort === null);
  const failingItems = rawItems
    .filter((item) => item.annualEffort !== null && item.annualEffort < 50)
    .sort((a, b) => a.deficit - b.deficit || a.subjectId - b.subjectId);

  let remainingBonus = safeBonusBudget;
  let bonusUsed = 0;
  let liftedCount = 0;
  const bonusBySubject = new Map<number, number>();

  for (const item of failingItems) {
    if (item.deficit > 0 && item.deficit <= remainingBonus) {
      remainingBonus -= item.deficit;
      bonusUsed += item.deficit;
      liftedCount += 1;
      bonusBySubject.set(item.subjectId, item.deficit);
    }
  }

  const remainingFailingCount = failingItems.length - liftedCount;
  const overallDecision: MinisterialDecision | null = incomplete
    ? null
    : remainingFailingCount <= safeMaxFail
      ? 'qualified'
      : 'not_qualified';

  return {
    subjectDecisions: rawItems.map((item) => ({
      subjectId: item.subjectId,
      subjectName: item.subjectName,
      annualEffort: item.annualEffort,
      decision: item.decision,
      bonusApplied: bonusBySubject.get(item.subjectId) ?? 0,
    })),
    overallDecision,
    incomplete,
    rawFailingCount: failingItems.length,
    remainingFailingCount,
    bonusUsed,
  };
}

export function parseMinisterialDecisionText(rawValue: unknown): {
  valid: boolean;
  decision: MinisterialDecision | null;
} {
  const s = normalizeArabicText(String(rawValue ?? ''));
  if (!s || s === '—' || s === '-') {
    return { valid: true, decision: null };
  }
  if (
    s === 'غير مؤهل' ||
    s === 'غير موهل' ||
    s === 'غير مؤهل للامتحان الوزاري' ||
    s === 'غير موهل للامتحان الوزاري' ||
    s === 'راسب' ||
    s === 'لا' ||
    s === '0' ||
    s === 'not_qualified'
  ) {
    return { valid: true, decision: 'not_qualified' };
  }
  if (
    s === 'مؤهل' ||
    s === 'موهل' ||
    s === 'مؤهل للامتحان الوزاري' ||
    s === 'موهل للامتحان الوزاري' ||
    s === 'ناجح' ||
    s === 'نعم' ||
    s === '1' ||
    s === 'qualified'
  ) {
    return { valid: true, decision: 'qualified' };
  }
  return { valid: false, decision: null };
}

export interface NormalizedGrade6QualificationImport {
  studentId: number;
  studentName: string;
  inquiryCode: string;
  overallDecision: MinisterialDecision | null;
  subjectDecisions: Array<{ subjectId: number; subjectName: string; decision: MinisterialDecision }>;
  effortScores?: Array<{ subjectId: number; subjectName: string; score: number }>;
}

export function validateGrade6QualificationImportRows(
  rows: Record<string, string>[],
  students: Student[],
  subjects: Subject[]
): ImportPreviewResponse<NormalizedGrade6QualificationImport> {
  const studentsByCode = new Map(students.map((s) => [normalizeArabicIndicDigits(s.inquiryCode), s]));
  const studentsByNormName = new Map<string, Student[]>();
  for (const st of students) {
    const k = normalizeArabicText(st.fullName);
    const list = studentsByNormName.get(k) ?? [];
    list.push(st);
    studentsByNormName.set(k, list);
  }

  const subjectsByNormName = new Map<string, Subject>();
  for (const sub of subjects) {
    subjectsByNormName.set(normalizeArabicText(sub.name), sub);
  }

  const seenStudentIds = new Set<number>();
  const previewRows: ImportRowPreview<NormalizedGrade6QualificationImport>[] = [];

  rows.forEach((raw, idx) => {
    const errors: string[] = [];
    const inquiryCode = normalizeArabicIndicDigits(
      raw.inquiryCode ||
      raw['رقم الهوية الوطنية'] ||
      raw['رقم الهوية'] ||
      raw['الهوية الوطنية'] ||
      ''
    );
    const rawName = (
      raw.studentName ||
      raw.fullName ||
      raw['اسم الطالب'] ||
      raw['الاسم'] ||
      ''
    ).trim();

    let student = inquiryCode ? studentsByCode.get(inquiryCode) : undefined;
    if (!student && rawName) {
      const cands = studentsByNormName.get(normalizeArabicText(rawName)) ?? [];
      if (cands.length === 1) student = cands[0];
      else if (cands.length > 1) errors.push(`الاسم "${rawName}" متطابق مع أكثر من طالب — يرجى استخدام رقم الهوية الوطنية.`);
    }

    if (!student && errors.length === 0) {
      errors.push(
        inquiryCode
          ? `لا يوجد طالب في الصف المختار برقم الهوية "${inquiryCode}".`
          : 'يرجى تحديد رقم الهوية الوطنية أو اسم الطالب.'
      );
    }

    if (student) {
      if (seenStudentIds.has(student.id)) {
        errors.push(`تكرر الطالب "${student.fullName}" داخل الملف.`);
      }
      seenStudentIds.add(student.id);
    }

    const overallRaw =
      raw['التأهيل الوزاري العام'] ??
      raw['التأهيل الوزاري'] ??
      raw['النتيجة النهائية للتأهيل'] ??
      raw['نتيجة التأهيل'] ??
      raw['النتيجة الوزارية'] ??
      raw['النتيجة'] ??
      raw['overallDecision'] ??
      '';
    const parsedOverall = parseMinisterialDecisionText(overallRaw);
    if (!parsedOverall.valid) {
      errors.push(`قيمة التأهيل الوزاري العام "${overallRaw}" غير صالحة (استخدم: مؤهل / غير مؤهل).`);
    }

    const subjectDecisionsMap = new Map<number, { subjectId: number; subjectName: string; decision: MinisterialDecision }>();
    const effortScoresMap = new Map<number, { subjectId: number; subjectName: string; score: number }>();

    for (const [colHeader, colVal] of Object.entries(raw)) {
      const trimmedVal = String(colVal ?? '').trim();
      if (!trimmedVal || trimmedVal === '—' || trimmedVal === '-') continue;

      const isEffortCol = /^(سعي|درجة السعي)\s*[-–—:]?\s*/i.test(colHeader);
      const cleanHeader = colHeader
        .replace(/^(سعي|درجة السعي)\s*[-–—:]?\s*/i, '')
        .replace(/^(?:تأهيل|قرار\s*تأهيل)\s*[-–—:]?\s*/i, '')
        .trim();
      const sub = subjectsByNormName.get(normalizeArabicText(cleanHeader));
      if (!sub) continue;

      const normalizedDigits = normalizeArabicIndicDigits(trimmedVal);
      const parsedNum = Number(normalizedDigits);
      const isNumeric = normalizedDigits.length > 0 && Number.isFinite(parsedNum);

      if (isEffortCol || isNumeric) {
        if (!isNumeric || parsedNum < 0 || parsedNum > sub.maxScore) {
          errors.push(`${sub.name}: درجة السعي "${trimmedVal}" غير صالحة (يجب أن تكون بين 0 و ${sub.maxScore}).`);
        } else {
          effortScoresMap.set(sub.id, {
            subjectId: sub.id,
            subjectName: sub.name,
            score: Math.round(parsedNum * 100) / 100,
          });
          if (!subjectDecisionsMap.has(sub.id)) {
            subjectDecisionsMap.set(sub.id, {
              subjectId: sub.id,
              subjectName: sub.name,
              decision: parsedNum >= 50 ? 'qualified' : 'not_qualified',
            });
          }
        }
      } else {
        const parsed = parseMinisterialDecisionText(trimmedVal);
        if (!parsed.valid || !parsed.decision) {
          errors.push(`${sub.name}: القيمة "${trimmedVal}" غير صالحة (استخدم: مؤهل أو غير مؤهل أو درجة السعي الرقمية).`);
        } else {
          subjectDecisionsMap.set(sub.id, {
            subjectId: sub.id,
            subjectName: sub.name,
            decision: parsed.decision,
          });
        }
      }
    }

    const subjectDecisions = Array.from(subjectDecisionsMap.values());
    const effortScores = Array.from(effortScoresMap.values());

    if (errors.length === 0 && parsedOverall.decision === null && subjectDecisions.length === 0 && effortScores.length === 0) {
      errors.push('لم يتم العثور على أي قرار تأهيل أو درجة سعي للمواد أو للتأهيل العام في هذا الصف.');
    }

    const valid = errors.length === 0 && Boolean(student);
    previewRows.push({
      rowNumber: idx + 2,
      raw: {
        ...raw,
        ...(student ? { 'اسم الطالب': student.fullName, 'رقم الهوية الوطنية': student.inquiryCode } : {}),
      },
      valid,
      errors,
      normalized:
        valid && student
          ? {
              studentId: student.id,
              studentName: student.fullName,
              inquiryCode: student.inquiryCode,
              overallDecision: parsedOverall.decision,
              subjectDecisions,
              effortScores: effortScores.length > 0 ? effortScores : undefined,
            }
          : undefined,
    });
  });

  const validCount = previewRows.filter((r) => r.valid).length;
  return {
    totalRows: previewRows.length,
    validCount,
    invalidCount: previewRows.length - validCount,
    rows: previewRows,
  };
}

/**
 * Evaluates source-year active students for controlled manager promotion to the next academic year.
 * Strictly marks ONLY students with passing standing ('ناجح') as eligible=true.
 */
export function evaluatePromotionCandidates(params: {
  sourceStudents: Student[];
  sourceClass: SchoolClass;
  subjects: Subject[];
  exams: Exam[];
  grades: GradeRecord[];
  targetYearInquiryCodes: Set<string>;
  sectionsById: Map<number, Section>;
}): PromotionCandidate[] {
  const {
    sourceStudents,
    sourceClass,
    subjects,
    exams,
    grades,
    targetYearInquiryCodes,
    sectionsById,
  } = params;

  const finalGradeExamIds = new Set(
    exams.filter((e) => matchIraqiExamSlot(e.name) === 'finalGrade').map((e) => e.id)
  );

  return sourceStudents
    .filter((st) => st.isActive && st.classId === sourceClass.id)
    .map((st) => {
      const applicableSubjects = subjects.filter(
        (sub) =>
          sub.isActive &&
          (sub.classId === null || sub.classId === st.classId) &&
          (sub.sectionId === null || sub.sectionId === st.sectionId)
      );

      const finalScoreBySubj = new Map<number, number>();
      for (const g of grades) {
        if (g.studentId !== st.id || g.score === null) continue;
        if (!finalGradeExamIds.has(g.examId)) continue;
        finalScoreBySubj.set(g.subjectId, roundIraqiHalfUp(g.score));
      }

      const missingFinalSubjects = applicableSubjects.filter((s) => !finalScoreBySubj.has(s.id));
      const failingFinalSubjects = applicableSubjects.filter((s) => {
        const sc = finalScoreBySubj.get(s.id);
        return sc !== undefined && sc < 50;
      });

      let standing: PromotionCandidate['standing'] = 'قيد استكمال العام الدراسي';
      if (applicableSubjects.length > 0 && missingFinalSubjects.length === 0) {
        if (failingFinalSubjects.length === 0) standing = 'ناجح';
        else if (failingFinalSubjects.length <= 2) standing = 'مكمل';
        else standing = 'راسب';
      } else if (failingFinalSubjects.length >= 3) {
        standing = 'راسب';
      }

      const alreadyInTargetYear = targetYearInquiryCodes.has(st.inquiryCode);
      const eligible = standing === 'ناجح' && !alreadyInTargetYear;
      const reason = alreadyInTargetYear
        ? 'الطالب مرحّل ومسجل مسبقاً في العام الدراسي الهدف'
        : standing === 'ناجح'
          ? 'ناجح في جميع المواد — مؤهل للترحيل بعد موافقة المدير'
          : standing === 'مكمل'
            ? `مكمل في ${failingFinalSubjects.length} مادة — غير مشمول بترحيل الناجحين`
            : standing === 'راسب'
              ? `راسب في ${failingFinalSubjects.length} مادة — لا يرحّل`
              : 'الدرجات النهائية غير مكتملة لهذا الطالب';

      const secName = st.sectionName || sectionsById.get(st.sectionId)?.name || '';
      return {
        studentId: st.id,
        fullName: st.fullName,
        inquiryCode: st.inquiryCode,
        sourceClassId: st.classId,
        sourceClassName: st.className || sourceClass.name,
        sourceSectionId: st.sectionId,
        sourceSectionName: secName,
        standing,
        eligible,
        alreadyInTargetYear,
        reason,
      };
    });
}

// =============================================================================
// IRAQI EXEMPTIONS ENGINE (INDIVIDUAL >=90 & GENERAL AVG >=75 / MIN >=75)
// Strictly applies to NON-MINISTERIAL classes (e.g. الرابع / الخامس); NEVER السادس.
// =============================================================================

export interface IraqiExemptionRuleConfig {
  generalMinAvg: number; // default 75
  minSubject: number; // default 75
  individualMin: number; // default 90
}

export interface StudentExemptionEval {
  subjectDecisions: Array<{
    subjectId: number;
    subjectName: string;
    annualEffort: number | null;
    decision: ExemptionDecision | null;
    exemptionType: 'individual' | 'general';
  }>;
  overallDecision: ExemptionDecision | null;
  annualAverage: number | null;
  incomplete: boolean;
}

export function evaluateIraqiExemptions(params: {
  isMinisterial: boolean;
  subjects: Subject[];
  annualEffortBySubjectId: Map<number, number>;
  rules: IraqiExemptionRuleConfig;
}): StudentExemptionEval {
  const { isMinisterial, subjects, annualEffortBySubjectId, rules } = params;
  if (isMinisterial || subjects.length === 0) {
    return {
      subjectDecisions: subjects.map((s) => ({
        subjectId: s.id,
        subjectName: s.name,
        annualEffort: null,
        decision: null,
        exemptionType: 'individual',
      })),
      overallDecision: null,
      annualAverage: null,
      incomplete: isMinisterial ? false : true,
    };
  }

  const safeIndividual = Number.isFinite(rules.individualMin) ? rules.individualMin : 90;
  const safeMinSubj = Number.isFinite(rules.minSubject) ? rules.minSubject : 75;
  const safeGeneralAvg = Number.isFinite(rules.generalMinAvg) ? rules.generalMinAvg : 75;

  const efforts = subjects.map((sub) => {
    const raw = annualEffortBySubjectId.get(sub.id);
    const val = raw !== undefined && raw !== null && Number.isFinite(raw) ? roundIraqiHalfUp(raw) : null;
    return { sub, annualEffort: val };
  });

  const completeEfforts = efforts.filter((e): e is { sub: Subject; annualEffort: number } => e.annualEffort !== null);
  const incomplete = completeEfforts.length < subjects.length;

  let annualAverage: number | null = null;
  let generalQualified = false;
  if (!incomplete && completeEfforts.length > 0) {
    const sum = completeEfforts.reduce((acc, e) => acc + e.annualEffort, 0);
    annualAverage = Math.round((sum / completeEfforts.length) * 100) / 100;
    const allMeetMin = completeEfforts.every((e) => e.annualEffort >= safeMinSubj);
    if (allMeetMin && annualAverage >= safeGeneralAvg) {
      generalQualified = true;
    }
  }

  const overallDecision: ExemptionDecision | null = incomplete
    ? null
    : generalQualified
      ? 'exempt'
      : 'not_exempt';

  const subjectDecisions = efforts.map(({ sub, annualEffort }) => {
    if (generalQualified) {
      return {
        subjectId: sub.id,
        subjectName: sub.name,
        annualEffort,
        decision: 'exempt' as ExemptionDecision,
        exemptionType: 'general' as const,
      };
    }
    if (annualEffort === null) {
      return {
        subjectId: sub.id,
        subjectName: sub.name,
        annualEffort: null,
        decision: null,
        exemptionType: 'individual' as const,
      };
    }
    const isIndiv = annualEffort >= safeIndividual;
    return {
      subjectId: sub.id,
      subjectName: sub.name,
      annualEffort,
      decision: (isIndiv ? 'exempt' : 'not_exempt') as ExemptionDecision,
      exemptionType: 'individual' as const,
    };
  });

  return {
    subjectDecisions,
    overallDecision,
    annualAverage,
    incomplete,
  };
}

export function parseExemptionDecisionText(rawValue: unknown): {
  valid: boolean;
  decision: ExemptionDecision | null;
} {
  const s = normalizeArabicText(String(rawValue ?? ''));
  if (!s || s === '—' || s === '-') return { valid: true, decision: null };
  if (
    s === 'معفو' ||
    s === 'معفي' ||
    s === 'اعفاء' ||
    s === 'إعفاء' ||
    s === 'إعفاء عام' ||
    s === 'اعفاء عام' ||
    s === 'إعفاء فردي' ||
    s === 'اعفاء فردي' ||
    s === 'نعم' ||
    s === '1' ||
    s === 'exempt'
  ) {
    return { valid: true, decision: 'exempt' };
  }
  if (
    s === 'غير معفو' ||
    s === 'غير معفي' ||
    s === 'لا' ||
    s === '0' ||
    s === 'not_exempt'
  ) {
    return { valid: true, decision: 'not_exempt' };
  }
  return { valid: false, decision: null };
}

export interface NormalizedExemptionImport {
  studentId: number;
  studentName: string;
  inquiryCode: string;
  overallDecision: ExemptionDecision | null;
  subjectDecisions: Array<{ subjectId: number; subjectName: string; decision: ExemptionDecision }>;
  effortScores?: Array<{ subjectId: number; subjectName: string; score: number }>;
}

export function validateExemptionImportRows(
  rows: Record<string, string>[],
  students: Student[],
  subjects: Subject[]
): ImportPreviewResponse<NormalizedExemptionImport> {
  const studentsByCode = new Map(students.map((s) => [normalizeArabicIndicDigits(s.inquiryCode), s]));
  const studentsByNormName = new Map<string, Student[]>();
  for (const st of students) {
    const k = normalizeArabicText(st.fullName);
    const arr = studentsByNormName.get(k) ?? [];
    arr.push(st);
    studentsByNormName.set(k, arr);
  }

  const subjectsByNormName = new Map<string, Subject>();
  for (const sub of subjects) {
    subjectsByNormName.set(normalizeArabicText(sub.name), sub);
  }

  const seenStudentIds = new Set<number>();
  const previewRows: ImportRowPreview<NormalizedExemptionImport>[] = [];

  rows.forEach((raw, idx) => {
    const errors: string[] = [];
    const inquiryCode = normalizeArabicIndicDigits(
      raw.inquiryCode ||
      raw['رقم الهوية الوطنية'] ||
      raw['رقم الهوية'] ||
      raw['الهوية الوطنية'] ||
      ''
    );
    const rawName = (
      raw.studentName ||
      raw.fullName ||
      raw['اسم الطالب'] ||
      raw['الاسم'] ||
      ''
    ).trim();

    let student = inquiryCode ? studentsByCode.get(inquiryCode) : undefined;
    if (!student && rawName) {
      const cands = studentsByNormName.get(normalizeArabicText(rawName)) ?? [];
      if (cands.length === 1) student = cands[0];
      else if (cands.length > 1) {
        errors.push(`الاسم "${rawName}" متطابق مع أكثر من طالب — يرجى استخدام رقم الهوية الوطنية.`);
      }
    }

    if (!student && errors.length === 0) {
      errors.push(
        inquiryCode
          ? `لا يوجد طالب في الصف المختار برقم الهوية "${inquiryCode}".`
          : 'يرجى تحديد رقم الهوية الوطنية أو اسم الطالب.'
      );
    }

    if (student) {
      if (seenStudentIds.has(student.id)) {
        errors.push(`تكرر الطالب "${student.fullName}" داخل الملف.`);
      }
      seenStudentIds.add(student.id);
    }

    const overallRaw =
      raw['الإعفاء العام'] ??
      raw['الاعفاء العام'] ??
      raw['قرار الإعفاء العام'] ??
      raw['overallDecision'] ??
      '';
    const parsedOverall = parseExemptionDecisionText(overallRaw);
    if (!parsedOverall.valid) {
      errors.push(`قيمة الإعفاء العام "${overallRaw}" غير صالحة (استخدم: معفو / غير معفو).`);
    }

    const subjectDecisionsMap = new Map<number, { subjectId: number; subjectName: string; decision: ExemptionDecision }>();
    const effortScoresMap = new Map<number, { subjectId: number; subjectName: string; score: number }>();

    for (const [colHeader, colVal] of Object.entries(raw)) {
      const trimmedVal = String(colVal ?? '').trim();
      if (!trimmedVal || trimmedVal === '—' || trimmedVal === '-') continue;

      const isEffortCol = /^(سعي|درجة السعي)\s*[-–—:]?\s*/i.test(colHeader);
      const cleanHeader = colHeader
        .replace(/^(سعي|درجة السعي)\s*[-–—:]?\s*/i, '')
        .replace(/^(?:إعفاء|اعفاء|قرار\s*إعفاء)\s*[-–—:]?\s*/i, '')
        .trim();
      const aliasTarget = SUBJECT_ALIASES[normalizeArabicText(cleanHeader)] ?? cleanHeader;
      const sub = subjectsByNormName.get(normalizeArabicText(aliasTarget));
      if (!sub) continue;

      const normalizedDigits = normalizeArabicIndicDigits(trimmedVal);
      const parsedNum = Number(normalizedDigits);
      const isNumeric = normalizedDigits.length > 0 && Number.isFinite(parsedNum);

      if (isEffortCol || isNumeric) {
        if (!isNumeric || parsedNum < 0 || parsedNum > sub.maxScore) {
          errors.push(`${sub.name}: درجة السعي "${trimmedVal}" غير صالحة (يجب أن تكون بين 0 و ${sub.maxScore}).`);
        } else {
          effortScoresMap.set(sub.id, {
            subjectId: sub.id,
            subjectName: sub.name,
            score: Math.round(parsedNum * 100) / 100,
          });
          if (!subjectDecisionsMap.has(sub.id)) {
            subjectDecisionsMap.set(sub.id, {
              subjectId: sub.id,
              subjectName: sub.name,
              decision: parsedNum >= 90 ? 'exempt' : 'not_exempt',
            });
          }
        }
      } else {
        const parsed = parseExemptionDecisionText(trimmedVal);
        if (!parsed.valid || !parsed.decision) {
          errors.push(`${sub.name}: القيمة "${trimmedVal}" غير صالحة (استخدم: معفو أو غير معفو أو درجة السعي الرقمية).`);
        } else {
          subjectDecisionsMap.set(sub.id, {
            subjectId: sub.id,
            subjectName: sub.name,
            decision: parsed.decision,
          });
        }
      }
    }

    const subjectDecisions = Array.from(subjectDecisionsMap.values());
    const effortScores = Array.from(effortScoresMap.values());

    if (errors.length === 0 && parsedOverall.decision === null && subjectDecisions.length === 0 && effortScores.length === 0) {
      errors.push('لم يتم العثور على أي قرار إعفاء أو درجة سعي في هذا الصف.');
    }

    const valid = errors.length === 0 && Boolean(student);
    previewRows.push({
      rowNumber: idx + 2,
      raw: {
        ...raw,
        ...(student ? { 'اسم الطالب': student.fullName, 'رقم الهوية الوطنية': student.inquiryCode } : {}),
      },
      valid,
      errors,
      normalized:
        valid && student
          ? {
              studentId: student.id,
              studentName: student.fullName,
              inquiryCode: student.inquiryCode,
              overallDecision: parsedOverall.decision,
              subjectDecisions,
              effortScores: effortScores.length > 0 ? effortScores : undefined,
            }
          : undefined,
    });
  });

  const validCount = previewRows.filter((r) => r.valid).length;
  return {
    totalRows: previewRows.length,
    validCount,
    invalidCount: previewRows.length - validCount,
    rows: previewRows,
  };
}




