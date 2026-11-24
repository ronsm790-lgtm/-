export type GradeStatus =
  | 'draft'
  | 'in_review'
  | 'ready'
  | 'published'
  | 'withdrawn'
  | 'archived';

export const GRADE_STATUS_LABELS: Record<GradeStatus, string> = {
  draft: 'مسودة',
  in_review: 'قيد المراجعة',
  ready: 'جاهزة للنشر',
  published: 'منشورة',
  withdrawn: 'مسحوبة',
  archived: 'مؤرشفة',
};

export type AdminRole = 'owner' | 'supervisor' | 'teacher';

export interface TeacherAssignment {
  id?: number;
  classId: number;
  className?: string;
  sectionId: number | null;
  sectionName?: string | null;
  subjectId: number;
  subjectName?: string;
}

export interface AdminPermissions {
  manageStudents: boolean;
  manageStructure: boolean;
  manageGrades: boolean;
  publishGrades: boolean;
  manageImportExport: boolean;
  manageAnnouncements: boolean;
  manageSettings: boolean;
  manageNotes: boolean;
}

export interface AdminUser {
  id: number;
  username: string;
  fullName: string;
  role: AdminRole;
  isActive: boolean;
  googleEmail?: string | null;
  permissions: AdminPermissions;
  assignments?: TeacherAssignment[];
  createdAt: string;
  lastLoginAt: string | null;
}

export interface GroupRosterSubject {
  id: number;
  name: string;
  maxScore: number;
}

export interface GroupRosterRow {
  sequence: number;
  studentId: number;
  fullName: string;
  inquiryCode: string;
  className: string;
  sectionName: string;
  scoresBySubject: Record<number, { score: number | null; status: GradeStatus; notes: string }>;
}

export interface GroupExamRoster {
  schoolName: string;
  republicHeader: string;
  ministryHeader: string;
  directorate: string;
  academicYear: string;
  footerText: string;
  emblemUrl: string;
  examId: number;
  examName: string;
  className: string;
  sectionLabel: string;
  includeAllSections: boolean;
  subjectId: number | null;
  subjectLabel: string;
  subjects: GroupRosterSubject[];
  rows: GroupRosterRow[];
}

export type EffortCalculationTarget =
  | 'sem1Average'
  | 'sem2Average'
  | 'annualEffort'
  | 'finalGrade'
  | 'all';

export interface EffortCalculationResult {
  ok?: boolean;
  calculatedCount: number;
  skippedIncompleteCount: number;
  targetExamNames: string[];
  status: GradeStatus;
}

export interface AcademicYear {
  id: number;
  name: string;
  isCurrent: boolean;
  isActive: boolean;
  grade6MaxFailSubjects: number;
  grade6DecisionBonus: number;
  exemptionGeneralMinAvg: number;
  exemptionMinSubject: number;
  exemptionIndividualMin: number;
  createdAt: string;
}

export interface SchoolClass {
  id: number;
  name: string;
  displayOrder: number;
  isMinisterial: boolean;
  createdAt: string;
}

export interface Section {
  id: number;
  academicYearId: number;
  classId: number;
  className?: string;
  name: string;
  isActive: boolean;
  createdAt: string;
}

export interface Subject {
  id: number;
  academicYearId: number;
  name: string;
  maxScore: number;
  displayOrder: number;
  classId: number | null;
  sectionId: number | null;
  className?: string | null;
  sectionName?: string | null;
  isActive: boolean;
}

export interface Exam {
  id: number;
  academicYearId: number;
  name: string;
  displayOrder: number;
  isActive: boolean;
  academicYear: string;
  createdAt: string;
}

export interface Student {
  id: number;
  academicYearId: number;
  fullName: string;
  inquiryCode: string;
  classId: number;
  sectionId: number;
  className?: string;
  sectionName?: string;
  isActive: boolean;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface GradeRecord {
  id: number;
  academicYearId?: number;
  studentId: number;
  subjectId: number;
  examId: number;
  score: number | null;
  status: GradeStatus;
  notes: string;
  updatedBy: string;
  updatedAt: string;
  publishedAt: string | null;
}

export type MinisterialDecision = 'qualified' | 'not_qualified';

export interface Grade6SubjectQualification {
  id?: number;
  academicYearId: number;
  studentId: number;
  subjectId: number;
  decision: MinisterialDecision | null;
  decisionSource: 'manual' | 'import' | 'approved_calculation';
  bonusApplied: number;
  status: 'draft' | 'published';
  notes: string;
  updatedBy?: string;
  updatedAt?: string;
  publishedAt?: string | null;
}

export interface Grade6OverallQualification {
  id?: number;
  academicYearId: number;
  studentId: number;
  decision: MinisterialDecision | null;
  decisionSource: 'manual' | 'import' | 'approved_calculation';
  bonusUsed: number;
  maxFailSubjects: number;
  decisionBonusLimit: number;
  status: 'draft' | 'published';
  notes: string;
  updatedBy?: string;
  updatedAt?: string;
  publishedAt?: string | null;
}

export type ExemptionDecision = 'exempt' | 'not_exempt';

export interface SubjectExemption {
  id?: number;
  academicYearId: number;
  studentId: number;
  subjectId: number;
  decision: ExemptionDecision | null;
  exemptionType: 'individual' | 'general';
  decisionSource: 'manual' | 'import' | 'approved_calculation';
  status: 'draft' | 'published';
  notes: string;
  updatedBy?: string;
  updatedAt?: string;
  publishedAt?: string | null;
}

export interface OverallExemption {
  id?: number;
  academicYearId: number;
  studentId: number;
  decision: ExemptionDecision | null;
  annualAverage: number | null;
  decisionSource: 'manual' | 'import' | 'approved_calculation';
  status: 'draft' | 'published';
  notes: string;
  updatedBy?: string;
  updatedAt?: string;
  publishedAt?: string | null;
}

export type ObjectionStatus = 'pending' | 'matching' | 'mismatching';

export interface GradeObjection {
  id: number;
  academicYearId: number;
  studentId: number;
  studentName?: string;
  inquiryCode?: string;
  classId?: number;
  className?: string;
  sectionName?: string;
  subjectId: number;
  subjectName?: string;
  examId: number;
  examName?: string;
  recordedScore: number | null;
  reason: string;
  status: ObjectionStatus;
  correctedScore: number | null;
  adminNote: string;
  isPublished: boolean;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
}

export interface PublicObjectionNoticeItem {
  id: number;
  subjectId: number;
  subjectName: string;
  examId: number;
  examName: string;
  status: 'matching' | 'mismatching';
  recordedScore: number | null;
  correctedScore: number | null;
  adminNote: string;
  resolvedAt: string | null;
}

export interface ControlBarcodePayload {
  v: 1;
  sId: number;
  code: string;
  yId: number;
}

export interface PromotionCandidate {
  studentId: number;
  fullName: string;
  inquiryCode: string;
  sourceClassId: number;
  sourceClassName: string;
  sourceSectionId: number;
  sourceSectionName: string;
  standing: 'ناجح' | 'مكمل' | 'راسب' | 'قيد استكمال العام الدراسي';
  eligible: boolean;
  alreadyInTargetYear: boolean;
  reason: string;
}

export interface ReportCardRow {
  sequence: number;
  subjectId: number;
  subjectName: string;
  maxScore: number | null;
  score: number;
  rating: string;
  notes?: string;
  isSecondRoundUpdated?: boolean;
  isExempt?: boolean;
}

export interface PublicReportCard {
  schoolName: string;
  republicHeader: string;
  ministryHeader: string;
  directorate: string;
  academicYear: string;
  footerText: string;
  emblemUrl: string;
  ministrySealUrl: string;
  primaryColor: string;
  accentColor: string;
  examName: string;
  issuedAt: string | null;
  student: {
    fullName: string;
    inquiryCode: string;
    className: string;
    sectionName: string;
  };
  hasNotesColumn: boolean;
  hasMaxScoreColumn: boolean;
  rows: ReportCardRow[];
  summary: {
    subjectCount: number;
    totalScore: number;
    totalMaxScore: number | null;
    average: number;
    overallRating: string;
  } | null;
}

export interface IraqiCardRow {
  sequence: number;
  subjectId: number;
  subjectName: string;
  sem1Month1: number | null;
  sem1Month2: number | null;
  sem1Average: number | null;
  midyear: number | null;
  sem2Month1: number | null;
  sem2Month2: number | null;
  sem2Average: number | null;
  annualEffort: number | null;
  finalExam: number | null;
  finalGrade: number | null;
  secondRoundScore?: number | null;
  isSecondRoundUpdated?: boolean;
  isIndividualExempt?: boolean;
  isGeneralExempt?: boolean;
  ministerialQualification?: MinisterialDecision | null;
  notes: string;
}

export interface IraqiCardColumnSummary {
  count: number;
  total: number;
  average: number;
}

export interface IraqiCardSummary {
  subjectCount: number;
  sem1Month1: IraqiCardColumnSummary | null;
  sem1Month2: IraqiCardColumnSummary | null;
  sem1Average: IraqiCardColumnSummary | null;
  midyear: IraqiCardColumnSummary | null;
  sem2Month1: IraqiCardColumnSummary | null;
  sem2Month2: IraqiCardColumnSummary | null;
  sem2Average: IraqiCardColumnSummary | null;
  annualEffort: IraqiCardColumnSummary | null;
  finalExam: IraqiCardColumnSummary | null;
  finalGrade: IraqiCardColumnSummary | null;
  failingCount: number;
  standing: 'ناجح' | 'مكمل' | 'راسب' | 'قيد استكمال العام الدراسي';
  round1Result: 'ناجح' | 'مكمل' | 'راسب' | '';
  round1FailingSubjects?: string[];
  isGeneralExempt?: boolean;
  hasSecondRoundUpdates?: boolean;
  ministerialDecision?: MinisterialDecision | null;
  ministerialResultText?: 'مؤهل للامتحان الوزاري' | 'غير مؤهل للامتحان الوزاري' | '';
}

export interface PublishLink {
  id: number;
  academicYearId?: number;
  slug: string;
  title: string;
  classId: number;
  className?: string;
  sectionId: number | null;
  sectionName?: string | null;
  subjectId: number | null;
  subjectName?: string | null;
  examId: number;
  examName?: string;
  createdBy: string;
  createdAt: string;
}

export interface AllPublishedReportCard {
  schoolName: string;
  republicHeader: string;
  ministryHeader: string;
  directorate: string;
  academicYear: string;
  footerText: string;
  emblemUrl: string;
  ministrySealUrl: string;
  primaryColor: string;
  accentColor: string;
  isMinisterial?: boolean;
  student: {
    fullName: string;
    inquiryCode: string;
    className: string;
    sectionName: string;
  };
  exams: Array<{
    examId: number;
    examName: string;
    issuedAt: string | null;
    hasNotesColumn: boolean;
    hasMaxScoreColumn: boolean;
    rows: ReportCardRow[];
    summary: {
      subjectCount: number;
      totalScore: number;
      totalMaxScore: number | null;
      average: number;
      overallRating: string;
    } | null;
  }>;
  matrixSubjects: Array<{
    sequence: number;
    subjectId: number;
    subjectName: string;
    maxScore: number | null;
    scoresByExam: Record<number, { score: number; rating: string; notes?: string } | undefined>;
  }>;
  iraqiRows: IraqiCardRow[];
  iraqiSummary: IraqiCardSummary;
}

export interface SchoolSettings {
  schoolName: string;
  republicHeader: string;
  ministryHeader: string;
  directorate: string;
  academicYear: string;
  contactInfo: string;
  footerText: string;
  printNote: string;
  emblemUrl: string;
  ministrySealUrl: string;
  primaryColor: string;
  accentColor: string;
}

export interface Announcement {
  id: number;
  title: string;
  body: string;
  publishDate: string;
  status: 'published' | 'draft' | 'archived';
  createdBy: string;
  createdAt: string;
}

export interface AuditLog {
  id: number;
  actorUsername: string;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  createdAt: string;
}

export interface AdminNote {
  id: number;
  title: string;
  content: string;
  color: string;
  pinned: boolean;
  updatedBy: string;
  updatedAt: string;
}

export interface ImportRowPreview<T> {
  rowNumber: number;
  raw: Record<string, string>;
  valid: boolean;
  errors: string[];
  normalized?: T;
}

export interface ImportPreviewResponse<T> {
  totalRows: number;
  validCount: number;
  invalidCount: number;
  rows: ImportRowPreview<T>[];
}
