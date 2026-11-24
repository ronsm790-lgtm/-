import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAllPublishedReportCard,
  buildComputedSingleExamReportCard,
  buildGroupExamRoster,
  buildPublicReportCard,
  buildScopedArabicFilename,
  computeEffortCalculations,
  evaluateIraqiExemptions,
  evaluateIraqiGrade6Qualification,
  evaluatePromotionCandidates,
  isSubjectExcludedForClass,
  isTeacherAllowedExamName,
  isTeacherAuthorizedForScope,
  parseExemptionDecisionText,
  parseMinisterialDecisionText,
  resolveStatusOnGradeEdit,
  roundIraqiHalfUp,
  sortStudentsAlphabetically,
  validateExemptionImportRows,
  validateGrade6QualificationImportRows,
  validateGradeImportRows,
  validateScoreInput,
  validateStudentImportRows,
} from './gradeRules.ts';
import type {
  Exam,
  Grade6OverallQualification,
  Grade6SubjectQualification,
  GradeRecord,
  OverallExemption,
  SchoolSettings,
  Student,
  Subject,
  SubjectExemption,
  TeacherAssignment,
} from '../types/school.ts';
import { parseSpreadsheetBuffer } from './spreadsheet.ts';

const baseSettings: SchoolSettings = {
  schoolName: 'إعدادية المنتظر للبنين',
  republicHeader: 'جمهورية العراق',
  ministryHeader: 'وزارة التربية',
  directorate: 'المديرية العامة لتربية واسط',
  academicYear: '2025 - 2026',
  contactInfo: '',
  footerText: 'التوقيع الرسمي لإدارة المدرسة',
  printNote: 'A4',
  emblemUrl: '/assets/aistudio/school_logo_original_f35f0f97.jpg',
  ministrySealUrl: '/seal.jpg',
  primaryColor: '#0B1F3A',
  accentColor: '#C59B27',
};

const sampleStudent: Student = {
  id: 1,
  academicYearId: 1,
  fullName: 'حيدر علي حسين',
  inquiryCode: '2026101',
  classId: 1,
  sectionId: 1,
  isActive: true,
  notes: 'بيانات خاصة لا تظهر',
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
};

const exam1: Exam = { id: 1, academicYearId: 1, name: 'الشهر الأول (الفصل الأول)', displayOrder: 1, isActive: true, academicYear: '2025 - 2026', createdAt: '2026-01-01' };
const exam2: Exam = { id: 2, academicYearId: 1, name: 'الشهر الثاني (الفصل الأول)', displayOrder: 2, isActive: true, academicYear: '2025 - 2026', createdAt: '2026-01-01' };
const examSem1Avg: Exam = { id: 3, academicYearId: 1, name: 'سعي الفصل الأول', displayOrder: 3, isActive: true, academicYear: '2025 - 2026', createdAt: '2026-01-01' };
const examMid: Exam = { id: 4, academicYearId: 1, name: 'نصف السنة', displayOrder: 4, isActive: true, academicYear: '2025 - 2026', createdAt: '2026-01-01' };
const examSem2M1: Exam = { id: 5, academicYearId: 1, name: 'الشهر الأول (الفصل الثاني)', displayOrder: 5, isActive: true, academicYear: '2025 - 2026', createdAt: '2026-01-01' };
const examSem2M2: Exam = { id: 6, academicYearId: 1, name: 'الشهر الثاني (الفصل الثاني)', displayOrder: 6, isActive: true, academicYear: '2025 - 2026', createdAt: '2026-01-01' };
const examSem2Avg: Exam = { id: 7, academicYearId: 1, name: 'سعي الفصل الثاني', displayOrder: 7, isActive: true, academicYear: '2025 - 2026', createdAt: '2026-01-01' };
const examAnnual: Exam = { id: 8, academicYearId: 1, name: 'السعي السنوي', displayOrder: 8, isActive: true, academicYear: '2025 - 2026', createdAt: '2026-01-01' };
const examFinal: Exam = { id: 9, academicYearId: 1, name: 'الامتحان النهائي', displayOrder: 9, isActive: true, academicYear: '2025 - 2026', createdAt: '2026-01-01' };

const allExams: Exam[] = [
  exam1,
  exam2,
  examSem1Avg,
  examMid,
  examSem2M1,
  examSem2M2,
  examSem2Avg,
  examAnnual,
  examFinal,
];

const subjects: Subject[] = [
  { id: 1, academicYearId: 1, name: 'الرياضيات', maxScore: 100, displayOrder: 2, classId: 1, sectionId: null, isActive: true },
  { id: 2, academicYearId: 1, name: 'اللغة العربية', maxScore: 100, displayOrder: 1, classId: 1, sectionId: null, isActive: true },
];

test('validateScoreInput rejects negative, non-numeric, and over-max scores', () => {
  assert.equal(validateScoreInput(-5, 100).valid, false);
  assert.equal(validateScoreInput('abc', 100).valid, false);
  assert.equal(validateScoreInput(105, 100).valid, false);
  assert.equal(validateScoreInput(94.5, 100).valid, true);
  assert.equal(validateScoreInput(94.5, 100).score, 94.5);
  assert.equal(validateScoreInput('', 100).score, null);
});

test('roundIraqiHalfUp rounds .5 halves upward in student favor', () => {
  assert.equal(roundIraqiHalfUp(84.5), 85);
  assert.equal(roundIraqiHalfUp(84.4), 84);
  assert.equal(roundIraqiHalfUp(49.5), 50);
});

test('resolveStatusOnGradeEdit reverts published grade to draft when modified', () => {
  const edited = resolveStatusOnGradeEdit('published', 85, '', 90, '', 'published');
  assert.equal(edited.revertedFromPublished, true);
  assert.equal(edited.status, 'draft');

  const unchanged = resolveStatusOnGradeEdit('published', 85, '', 85, '', 'published');
  assert.equal(unchanged.revertedFromPublished, false);
  assert.equal(unchanged.status, 'published');
});

test('buildPublicReportCard strictly isolates published grades and omits max score column', () => {
  const grades: GradeRecord[] = [
    { id: 1, studentId: 1, subjectId: 2, examId: 1, score: 88, status: 'published', notes: '', updatedBy: 'system_actor', updatedAt: '2026-02-01', publishedAt: '2026-02-02' },
    { id: 2, studentId: 1, subjectId: 1, examId: 1, score: 77, status: 'draft', notes: 'مسودة', updatedBy: 'system_actor', updatedAt: '2026-02-01', publishedAt: null },
    { id: 3, studentId: 1, subjectId: 1, examId: 2, score: 95, status: 'published', notes: '', updatedBy: 'system_actor', updatedAt: '2026-03-01', publishedAt: '2026-03-02' },
    { id: 4, studentId: 2, subjectId: 1, examId: 1, score: 55, status: 'published', notes: '', updatedBy: 'system_actor', updatedAt: '2026-02-01', publishedAt: '2026-02-02' },
  ];

  const report = buildPublicReportCard({
    student: sampleStudent,
    className: 'السادس العلمي',
    sectionName: 'أ',
    exam: exam1,
    subjects,
    grades,
    settings: baseSettings,
  });

  assert.ok(report);
  assert.equal(report.examName, 'الشهر الأول (الفصل الأول)');
  assert.equal(report.hasMaxScoreColumn, false);
  assert.equal(report.rows.length, 1);
  assert.equal(report.rows[0].subjectName, 'اللغة العربية');
  assert.equal(report.rows[0].score, 88);
  assert.equal(report.hasNotesColumn, false);
  assert.equal(report.summary?.totalScore, 88);
});

const examFinalGrade: Exam = { id: 10, academicYearId: 1, name: 'الدرجة النهائية', displayOrder: 10, isActive: true, academicYear: '2025 - 2026', createdAt: '2026-01-01' };

test('effort and final grades never auto-compute silently, and computeEffortCalculations calculates Iraqi averages upon manager approval', () => {
  const grades: GradeRecord[] = [
    // Arabic (id 2): Complete year published
    // Sem1: 88 & 91 -> avg 89.5 => 90
    { id: 1, studentId: 1, subjectId: 2, examId: 1, score: 88, status: 'published', notes: '', updatedBy: 'system_actor', updatedAt: '2026-02-01', publishedAt: '2026-02-02' },
    { id: 2, studentId: 1, subjectId: 2, examId: 2, score: 91, status: 'published', notes: '', updatedBy: 'system_actor', updatedAt: '2026-03-01', publishedAt: '2026-03-02' },
    // Midyear: 85
    { id: 3, studentId: 1, subjectId: 2, examId: 4, score: 85, status: 'published', notes: '', updatedBy: 'system_actor', updatedAt: '2026-03-10', publishedAt: '2026-03-11' },
    // Sem2: 86 & 90 -> avg 88
    { id: 4, studentId: 1, subjectId: 2, examId: 5, score: 86, status: 'published', notes: '', updatedBy: 'system_actor', updatedAt: '2026-04-01', publishedAt: '2026-04-02' },
    { id: 5, studentId: 1, subjectId: 2, examId: 6, score: 90, status: 'published', notes: '', updatedBy: 'system_actor', updatedAt: '2026-05-01', publishedAt: '2026-05-02' },
    // Annual effort = (90 + 85 + 88) / 3 = 87.666 -> 88; Final Exam = 91 -> Final Grade = (88 + 91) / 2 = 89.5 -> 90
    { id: 6, studentId: 1, subjectId: 2, examId: 9, score: 91, status: 'published', notes: '', updatedBy: 'system_actor', updatedAt: '2026-06-01', publishedAt: '2026-06-02' },

    // Math (id 1): Sem1 M1 published (92), Sem1 M2 DRAFT (70)
    { id: 7, studentId: 1, subjectId: 1, examId: 1, score: 92, status: 'published', notes: '', updatedBy: 'system_actor', updatedAt: '2026-02-01', publishedAt: '2026-02-02' },
    { id: 8, studentId: 1, subjectId: 1, examId: 2, score: 70, status: 'draft', notes: 'مسودة', updatedBy: 'system_actor', updatedAt: '2026-03-01', publishedAt: null },
  ];

  const allExamsWithFinal = [...allExams, examFinalGrade];

  // 1) Before manager approval/calculation, monthly grades NEVER silently produce effort/final scores
  const beforeCalc = buildAllPublishedReportCard({
    student: sampleStudent,
    className: 'السادس العلمي',
    sectionName: 'أ',
    exams: allExamsWithFinal,
    subjects,
    grades,
    settings: baseSettings,
  });
  assert.ok(beforeCalc);
  const arabicBefore = beforeCalc.iraqiRows.find((r) => r.subjectId === 2);
  assert.ok(arabicBefore);
  assert.equal(arabicBefore.sem1Month1, 88);
  assert.equal(arabicBefore.sem1Average, null);
  assert.equal(arabicBefore.sem2Average, null);
  assert.equal(arabicBefore.annualEffort, null);
  assert.equal(arabicBefore.finalGrade, null);

  // 2) Manager triggers explicit effort calculation requiring published components
  const calc = computeEffortCalculations({
    target: 'all',
    students: [sampleStudent],
    subjects,
    exams: allExamsWithFinal,
    grades,
    requirePublishedComponents: true,
  });

  // Only Arabic completes sem1Average, sem2Average, annualEffort, finalGrade (4 entries)
  assert.equal(calc.entries.length, 4);
  assert.equal(calc.entries.every((e) => e.subjectId === 2), true);

  const gradesAfterApproval: GradeRecord[] = [
    ...grades,
    ...calc.entries.map((e, idx) => ({
      id: 100 + idx,
      studentId: e.studentId,
      subjectId: e.subjectId,
      examId: e.examId,
      score: e.score,
      status: 'published' as const,
      notes: '',
      updatedBy: 'manager',
      updatedAt: '2026-06-05',
      publishedAt: '2026-06-05',
    })),
  ];

  const allReport = buildAllPublishedReportCard({
    student: sampleStudent,
    className: 'السادس العلمي',
    sectionName: 'أ',
    exams: allExamsWithFinal,
    subjects,
    grades: gradesAfterApproval,
    settings: baseSettings,
  });

  assert.ok(allReport);
  assert.equal(allReport.iraqiRows.length, 2);

  const arabicRow = allReport.iraqiRows.find((r) => r.subjectId === 2);
  assert.ok(arabicRow);
  assert.equal(arabicRow.sem1Month1, 88);
  assert.equal(arabicRow.sem1Month2, 91);
  assert.equal(arabicRow.sem1Average, 90);
  assert.equal(arabicRow.midyear, 85);
  assert.equal(arabicRow.sem2Month1, 86);
  assert.equal(arabicRow.sem2Month2, 90);
  assert.equal(arabicRow.sem2Average, 88);
  assert.equal(arabicRow.annualEffort, 88);
  assert.equal(arabicRow.finalExam, 91);
  assert.equal(arabicRow.finalGrade, 90);

  const mathRow = allReport.iraqiRows.find((r) => r.subjectId === 1);
  assert.ok(mathRow);
  assert.equal(mathRow.sem1Month1, 92);
  assert.equal(mathRow.sem1Month2, null);
  assert.equal(mathRow.sem1Average, null);

  assert.equal(allReport.iraqiSummary.standing, 'قيد استكمال العام الدراسي');

  // Querying stored سعي الفصل الأول individually returns Arabic only (Math M2 was draft so not calculated)
  const singleSem1 = buildComputedSingleExamReportCard({
    student: sampleStudent,
    className: 'السادس العلمي',
    sectionName: 'أ',
    targetExam: examSem1Avg,
    allExams: allExamsWithFinal,
    subjects,
    allGrades: gradesAfterApproval,
    settings: baseSettings,
  });
  assert.ok(singleSem1);
  assert.equal(singleSem1.rows.length, 1);
  assert.equal(singleSem1.rows[0].subjectId, 2);
  assert.equal(singleSem1.rows[0].score, 90);
});

test('validateStudentImportRows catches duplicates and supports default class/section & update mode', () => {
  const classes = [{ id: 1, name: 'السادس العلمي', displayOrder: 1, isMinisterial: true, createdAt: '' }];
  const sections = [{ id: 1, academicYearId: 1, classId: 1, name: 'أ', isActive: true, createdAt: '' }];
  const existing = new Set(['2026101']);

  const preview = validateStudentImportRows(
    [
      { 'اسم الطالب': 'محمد جاسم', 'رقم الهوية الوطنية': '2026200', 'الصف': 'السادس العلمي', 'الشعبة': 'أ' },
      { 'اسم الطالب': 'مكرر قاعدة', 'رقم الهوية الوطنية': '2026101', 'الصف': 'السادس العلمي', 'الشعبة': 'أ' },
      { 'اسم الطالب': 'مكرر ملف', 'رقم الهوية الوطنية': '2026200', 'الصف': 'السادس العلمي', 'الشعبة': 'أ' },
      { 'اسم الطالب': 'صف خطأ', 'رقم الهوية الوطنية': '2026201', 'الصف': 'غير موجود', 'الشعبة': 'أ' },
    ],
    existing,
    classes,
    sections
  );

  assert.equal(preview.validCount, 1);
  assert.equal(preview.invalidCount, 3);

  // Test fallback defaults + allowUpdateExisting
  const smartPreview = validateStudentImportRows(
    [
      { 'اسم الطالب': 'كرار حيدر', 'رقم الهوية الوطنية': '2026305' },
      { 'اسم الطالب': 'حيدر علي حسين المعدل', 'رقم الهوية الوطنية': '2026101' },
    ],
    existing,
    classes,
    sections,
    { defaultClassId: 1, defaultSectionId: 1, allowUpdateExisting: true }
  );
  assert.equal(smartPreview.validCount, 2);
  assert.equal(smartPreview.rows[0].normalized?.action, 'create');
  assert.equal(smartPreview.rows[1].normalized?.action, 'update');
});

test('validateGradeImportRows supports scoped defaults, Arabic name matching, and enforces teacher scope', () => {
  const otherStudent: Student = {
    id: 2,
    academicYearId: 1,
    fullName: 'أحمد كريم علي',
    inquiryCode: '2026109',
    classId: 2,
    sectionId: 3,
    className: 'الخامس العلمي',
    isActive: true,
    notes: '',
    createdAt: '',
    updatedAt: '',
  };
  const studentsByCode = new Map([
    [sampleStudent.inquiryCode, sampleStudent],
    [otherStudent.inquiryCode, otherStudent],
  ]);
  const subjectsByName = new Map(subjects.map((s) => [s.name, s]));
  const examsByName = new Map([[exam1.name, exam1]]);

  const preview = validateGradeImportRows(
    [
      { 'رقم الهوية الوطنية': '2026101', 'المادة': 'الرياضيات', 'الامتحان': 'الشهر الأول (الفصل الأول)', 'الدرجة': '92' },
      { 'رقم الهوية الوطنية': '2026101', 'المادة': 'الرياضيات', 'الامتحان': 'الشهر الأول (الفصل الأول)', 'الدرجة': '95' },
      { 'رقم الهوية الوطنية': '2026101', 'المادة': 'اللغة العربية', 'التقييم': 'الشهر الأول (الفصل الأول)', 'الدرجة': '110' },
    ],
    studentsByCode,
    subjectsByName,
    examsByName
  );

  assert.equal(preview.validCount, 1);
  assert.equal(preview.invalidCount, 2);

  // Teacher authorized only for Subject 1 (Math), Class 1, all sections
  const teacherAssignments: TeacherAssignment[] = [
    { classId: 1, sectionId: null, subjectId: 1 },
  ];
  const scopedTeacherPreview = validateGradeImportRows(
    [
      { 'اسم الطالب': 'حيدر علي حسين', 'الدرجة': '94' }, // Authorized (Name matched in class 1, default math & exam1)
      { 'رقم الهوية الوطنية': '2026109', 'الدرجة': '80' }, // Unauthorized (student is in class 2)
    ],
    studentsByCode,
    subjectsByName,
    examsByName,
    {
      defaultSubjectId: 1,
      defaultExamId: 1,
      defaultClassId: 1,
      teacherAssignments,
      restrictToTeacher: true,
    }
  );
  assert.equal(scopedTeacherPreview.validCount, 1);
  assert.equal(scopedTeacherPreview.rows[0].normalized?.studentId, 1);
  assert.equal(scopedTeacherPreview.rows[1].valid, false);
});

test('isTeacherAuthorizedForScope checks class, subject, and sectionId null (all sections)', () => {
  const assignments: TeacherAssignment[] = [
    { classId: 1, sectionId: null, subjectId: 5 },
    { classId: 2, sectionId: 3, subjectId: 5 },
  ];
  assert.equal(isTeacherAuthorizedForScope(assignments, 1, 2, 5), true);
  assert.equal(isTeacherAuthorizedForScope(assignments, 1, null, 5), true);
  assert.equal(isTeacherAuthorizedForScope(assignments, 2, 3, 5), true);
  assert.equal(isTeacherAuthorizedForScope(assignments, 2, 4, 5), false);
  assert.equal(isTeacherAuthorizedForScope(assignments, 2, null, 5), false);
  assert.equal(isTeacherAuthorizedForScope(assignments, 1, 2, 9), false);
});

test('buildGroupExamRoster builds manager roster sorted by section/name and filters published vs all', () => {
  const cls = { id: 1, name: 'السادس العلمي', displayOrder: 1, isMinisterial: true, createdAt: '' };
  const secA = { id: 1, academicYearId: 1, classId: 1, name: 'أ', isActive: true, createdAt: '' };
  const st2: Student = { ...sampleStudent, id: 2, fullName: 'باسم عادل', inquiryCode: '2026102', sectionId: 1, sectionName: 'أ' };
  const grades: GradeRecord[] = [
    { id: 1, studentId: 1, subjectId: 2, examId: 1, score: 88, status: 'published', notes: '', updatedBy: 'admin', updatedAt: '', publishedAt: '' },
    { id: 2, studentId: 2, subjectId: 2, examId: 1, score: 75, status: 'draft', notes: '', updatedBy: 'admin', updatedAt: '', publishedAt: null },
  ];

  const publishedOnly = buildGroupExamRoster({
    settings: baseSettings,
    exam: exam1,
    schoolClass: cls,
    section: secA,
    students: [{ ...sampleStudent, sectionName: 'أ' }, st2],
    subjects,
    grades,
    onlyPublished: true,
  });
  assert.equal(publishedOnly.rows.length, 2);
  assert.equal(publishedOnly.rows[0].studentId, 2); // 'باسم' comes before 'حيدر'
  assert.equal(publishedOnly.rows[0].scoresBySubject[2].score, null);
  assert.equal(publishedOnly.rows[1].scoresBySubject[2].score, 88);

  const allRecorded = buildGroupExamRoster({
    settings: baseSettings,
    exam: exam1,
    schoolClass: cls,
    section: null,
    students: [{ ...sampleStudent, sectionName: 'أ' }, st2],
    subjects,
    grades,
    onlyPublished: false,
  });
  assert.equal(allRecorded.includeAllSections, true);
  assert.equal(allRecorded.rows[0].scoresBySubject[2].score, 75);
  assert.equal(allRecorded.subjectLabel, 'كل المواد');

  const singleSubjectRoster = buildGroupExamRoster({
    settings: baseSettings,
    exam: exam1,
    schoolClass: cls,
    section: secA,
    students: [{ ...sampleStudent, sectionName: 'أ' }, st2],
    subjects,
    grades,
    onlyPublished: false,
    subjectId: 2,
  });
  assert.equal(singleSubjectRoster.subjectId, 2);
  assert.equal(singleSubjectRoster.subjectLabel, 'اللغة العربية');
  assert.equal(singleSubjectRoster.subjects.length, 1);
  assert.equal(singleSubjectRoster.subjects[0].id, 2);
});

test('parseSpreadsheetBuffer preserves Arabic UTF-8 CSV headers and names with or without BOM', () => {
  const csvNoBom = new TextEncoder().encode('رقم الهوية الوطنية,الدرجة,ملاحظات\n2026102,96,ناجح\n');
  const rows1 = parseSpreadsheetBuffer(csvNoBom.buffer, 'grades.csv');
  assert.equal(rows1.length, 1);
  assert.equal(rows1[0]['رقم الهوية الوطنية'], '2026102');
  assert.equal(rows1[0]['الدرجة'], '96');
  assert.equal(rows1[0]['ملاحظات'], 'ناجح');

  const csvWithBom = new TextEncoder().encode('\uFEFFاسم الطالب,رقم الهوية الوطنية\nمصطفى كريم,2026102\n');
  const rows2 = parseSpreadsheetBuffer(csvWithBom.buffer, 'students.CSV');
  assert.equal(rows2[0]['اسم الطالب'], 'مصطفى كريم');
  assert.equal(rows2[0]['رقم الهوية الوطنية'], '2026102');
});

test('iraqiSummary.round1Result classifies incomplete, ناجح, مكمل, and راسب accurately from approved final grades', () => {
  const finalGradeExam: Exam = { id: 99, academicYearId: 1, name: 'الدرجة النهائية', displayOrder: 10, isActive: true, academicYear: '2025 - 2026', createdAt: '' };
  const allExamsWithFinal = [...allExams, finalGradeExam];

  // Complete year for both Arabic (id 2) and Math (id 1) + manager-calculated final grades
  const makeApprovedYearGrades = (arabicFinalExam: number, mathFinalExam: number): GradeRecord[] => {
    const base: GradeRecord[] = [
      // Arabic
      { id: 1, studentId: 1, subjectId: 2, examId: 1, score: 80, status: 'published', notes: '', updatedBy: 'a', updatedAt: '', publishedAt: '' },
      { id: 2, studentId: 1, subjectId: 2, examId: 2, score: 80, status: 'published', notes: '', updatedBy: 'a', updatedAt: '', publishedAt: '' },
      { id: 3, studentId: 1, subjectId: 2, examId: 4, score: 80, status: 'published', notes: '', updatedBy: 'a', updatedAt: '', publishedAt: '' },
      { id: 4, studentId: 1, subjectId: 2, examId: 5, score: 80, status: 'published', notes: '', updatedBy: 'a', updatedAt: '', publishedAt: '' },
      { id: 5, studentId: 1, subjectId: 2, examId: 6, score: 80, status: 'published', notes: '', updatedBy: 'a', updatedAt: '', publishedAt: '' },
      { id: 6, studentId: 1, subjectId: 2, examId: 9, score: arabicFinalExam, status: 'published', notes: '', updatedBy: 'a', updatedAt: '', publishedAt: '' },
      // Math
      { id: 7, studentId: 1, subjectId: 1, examId: 1, score: 40, status: 'published', notes: '', updatedBy: 'a', updatedAt: '', publishedAt: '' },
      { id: 8, studentId: 1, subjectId: 1, examId: 2, score: 40, status: 'published', notes: '', updatedBy: 'a', updatedAt: '', publishedAt: '' },
      { id: 9, studentId: 1, subjectId: 1, examId: 4, score: 40, status: 'published', notes: '', updatedBy: 'a', updatedAt: '', publishedAt: '' },
      { id: 10, studentId: 1, subjectId: 1, examId: 5, score: 40, status: 'published', notes: '', updatedBy: 'a', updatedAt: '', publishedAt: '' },
      { id: 11, studentId: 1, subjectId: 1, examId: 6, score: 40, status: 'published', notes: '', updatedBy: 'a', updatedAt: '', publishedAt: '' },
      { id: 12, studentId: 1, subjectId: 1, examId: 9, score: mathFinalExam, status: 'published', notes: '', updatedBy: 'a', updatedAt: '', publishedAt: '' },
    ];
    const calc = computeEffortCalculations({
      target: 'all',
      students: [sampleStudent],
      subjects,
      exams: allExamsWithFinal,
      grades: base,
      requirePublishedComponents: true,
    });
    return [
      ...base,
      ...calc.entries.map((e, idx) => ({
        id: 200 + idx,
        studentId: e.studentId,
        subjectId: e.subjectId,
        examId: e.examId,
        score: e.score,
        status: 'published' as const,
        notes: '',
        updatedBy: 'manager',
        updatedAt: '',
        publishedAt: '',
      })),
    ];
  };

  // Passing both (Math final = 60 -> (40+60)/2 = 50)
  const passCard = buildAllPublishedReportCard({
    student: sampleStudent,
    className: 'السادس العلمي',
    sectionName: 'أ',
    exams: allExamsWithFinal,
    subjects,
    grades: makeApprovedYearGrades(80, 60),
    settings: baseSettings,
  });
  assert.equal(passCard?.iraqiSummary.round1Result, 'ناجح');
  assert.equal(passCard?.iraqiSummary.round1FailingSubjects?.length, 0);

  // Failing 1 subject (Math final = 40 -> (40+40)/2 = 40 < 50 -> مكمل)
  const supplementaryCard = buildAllPublishedReportCard({
    student: sampleStudent,
    className: 'السادس العلمي',
    sectionName: 'أ',
    exams: allExamsWithFinal,
    subjects,
    grades: makeApprovedYearGrades(80, 40),
    settings: baseSettings,
  });
  assert.equal(supplementaryCard?.iraqiSummary.round1Result, 'مكمل');
  assert.deepEqual(supplementaryCard?.iraqiSummary.round1FailingSubjects, ['الرياضيات']);

  // Failing 3+ subjects -> راسب
  const extraSubjects: Subject[] = [
    ...subjects,
    { id: 3, academicYearId: 1, name: 'الفيزياء', maxScore: 100, displayOrder: 3, classId: 1, sectionId: null, isActive: true },
  ];
  const failGrades: GradeRecord[] = [
    ...makeApprovedYearGrades(20, 20), // Math finalGrade=30
    { id: 301, studentId: 1, subjectId: 2, examId: 99, score: 30, status: 'published', notes: '', updatedBy: 'a', updatedAt: '', publishedAt: '' },
    { id: 302, studentId: 1, subjectId: 3, examId: 99, score: 35, status: 'published', notes: '', updatedBy: 'a', updatedAt: '', publishedAt: '' },
  ];
  const failCard = buildAllPublishedReportCard({
    student: sampleStudent,
    className: 'السادس العلمي',
    sectionName: 'أ',
    exams: allExamsWithFinal,
    subjects: extraSubjects,
    grades: failGrades,
    settings: baseSettings,
  });
  assert.equal(failCard?.iraqiSummary.round1Result, 'راسب');
  assert.equal(failCard?.iraqiSummary.round1FailingSubjects?.length, 3);

  // Incomplete finals -> round1Result stays empty string ''
  const incomplete = buildAllPublishedReportCard({
    student: sampleStudent,
    className: 'السادس العلمي',
    sectionName: 'أ',
    exams: allExamsWithFinal,
    subjects,
    grades: makeApprovedYearGrades(80, 60).slice(0, 6),
    settings: baseSettings,
  });
  assert.equal(incomplete?.iraqiSummary.round1Result, '');

  // filterSubjectId scopes buildComputedSingleExamReportCard strictly to that subject
  const scopedSingle = buildComputedSingleExamReportCard({
    student: sampleStudent,
    className: 'السادس العلمي',
    sectionName: 'أ',
    targetExam: exam1,
    allExams: allExamsWithFinal,
    subjects,
    allGrades: makeApprovedYearGrades(80, 60),
    settings: baseSettings,
    filterSubjectId: 1,
  });
  assert.equal(scopedSingle?.rows.length, 1);
  assert.equal(scopedSingle?.rows[0].subjectId, 1);
});

test('validateGradeImportRows expands wide general all-subjects matrix and enforces teacher scope per subject column', () => {
  const studentsByCode = new Map([[sampleStudent.inquiryCode, sampleStudent]]);
  const subjectsByName = new Map(subjects.map((s) => [s.name, s]));
  const examsByName = new Map([[exam1.name, exam1]]);

  // Manager uploads wide matrix row with Arabic=91 and Math='' (skipped cleanly)
  const managerPreview = validateGradeImportRows(
    [
      {
        'ت': '1',
        'اسم الطالب': 'حيدر علي حسين',
        'رقم الهوية الوطنية': '2026101',
        'الصف': 'السادس العلمي',
        'الشعبة': 'أ',
        'الامتحان': 'الشهر الأول (الفصل الأول)',
        'اللغة العربية': '91',
        'الرياضيات': '',
      },
    ],
    studentsByCode,
    subjectsByName,
    examsByName
  );
  assert.equal(managerPreview.totalRows, 1);
  assert.equal(managerPreview.validCount, 1);
  assert.equal(managerPreview.rows[0].normalized?.subjectId, 2);
  assert.equal(managerPreview.rows[0].normalized?.score, 91);

  // Teacher authorized only for Math (id 1) uploading wide matrix with both Arabic (91) & Math (88)
  const teacherMatrixPreview = validateGradeImportRows(
    [
      {
        'رقم الهوية الوطنية': '2026101',
        'الامتحان': 'الشهر الأول (الفصل الأول)',
        'اللغة العربية': '91',
        'الرياضيات': '88',
      },
    ],
    studentsByCode,
    subjectsByName,
    examsByName,
    {
      teacherAssignments: [{ classId: 1, sectionId: null, subjectId: 1 }],
      restrictToTeacher: true,
    }
  );
  assert.equal(teacherMatrixPreview.totalRows, 2);
  assert.equal(teacherMatrixPreview.validCount, 1);
  assert.equal(teacherMatrixPreview.invalidCount, 1);
  const validEntry = teacherMatrixPreview.rows.find((r) => r.valid);
  assert.equal(validEntry?.normalized?.subjectId, 1);
  assert.equal(validEntry?.normalized?.score, 88);
});

test('evaluateIraqiGrade6Qualification applies configurable maxFailSubjects & decisionBonus accurately', () => {
  const g6Subjects: Subject[] = [
    { id: 1, academicYearId: 1, name: 'التربية الإسلامية', maxScore: 100, displayOrder: 1, classId: 1, sectionId: null, isActive: true },
    { id: 2, academicYearId: 1, name: 'اللغة العربية', maxScore: 100, displayOrder: 2, classId: 1, sectionId: null, isActive: true },
    { id: 3, academicYearId: 1, name: 'اللغة الإنكليزية', maxScore: 100, displayOrder: 3, classId: 1, sectionId: null, isActive: true },
    { id: 4, academicYearId: 1, name: 'الأحياء', maxScore: 100, displayOrder: 4, classId: 1, sectionId: null, isActive: true },
    { id: 5, academicYearId: 1, name: 'الرياضيات', maxScore: 100, displayOrder: 5, classId: 1, sectionId: null, isActive: true },
    { id: 6, academicYearId: 1, name: 'الكيمياء', maxScore: 100, displayOrder: 6, classId: 1, sectionId: null, isActive: true },
    { id: 7, academicYearId: 1, name: 'الفيزياء', maxScore: 100, displayOrder: 7, classId: 1, sectionId: null, isActive: true },
  ];

  // 1) All passing -> qualified, 0 failing, 0 bonus used
  const allPass = evaluateIraqiGrade6Qualification({
    subjects: g6Subjects,
    annualEffortBySubjectId: new Map([[1, 80], [2, 75], [3, 60], [4, 70], [5, 50], [6, 55], [7, 65]]),
    maxFailSubjects: 3,
    decisionBonus: 10,
  });
  assert.equal(allPass.overallDecision, 'qualified');
  assert.equal(allPass.bonusUsed, 0);
  assert.equal(allPass.subjectDecisions.every((s) => s.decision === 'qualified'), true);

  // 2) 3 failing -> qualified without using decision bonus
  const threeFail = evaluateIraqiGrade6Qualification({
    subjects: g6Subjects,
    annualEffortBySubjectId: new Map([[1, 80], [2, 75], [3, 60], [4, 70], [5, 30], [6, 35], [7, 38]]),
    maxFailSubjects: 3,
    decisionBonus: 10,
  });
  assert.equal(threeFail.overallDecision, 'qualified');
  assert.equal(threeFail.rawFailingCount, 3);

  // 3) 4 failing where smallest deficit is 40 (needs 10) -> lifted to 3 failing -> qualified!
  const fourFailLifted = evaluateIraqiGrade6Qualification({
    subjects: g6Subjects,
    annualEffortBySubjectId: new Map([[1, 80], [2, 75], [3, 60], [4, 40], [5, 30], [6, 35], [7, 38]]),
    maxFailSubjects: 3,
    decisionBonus: 10,
  });
  assert.equal(fourFailLifted.overallDecision, 'qualified');
  assert.equal(fourFailLifted.bonusUsed, 10);
  assert.equal(fourFailLifted.remainingFailingCount, 3);
  assert.equal(fourFailLifted.subjectDecisions.find((d) => d.subjectId === 4)?.decision, 'not_qualified');

  // 4) 4 failing where smallest score is 39 (needs 11 > 10) -> NOT qualified
  const fourFailRejected = evaluateIraqiGrade6Qualification({
    subjects: g6Subjects,
    annualEffortBySubjectId: new Map([[1, 80], [2, 75], [3, 60], [4, 39], [5, 30], [6, 35], [7, 38]]),
    maxFailSubjects: 3,
    decisionBonus: 10,
  });
  assert.equal(fourFailRejected.overallDecision, 'not_qualified');
  assert.equal(fourFailRejected.remainingFailingCount, 4);

  // 5) 5 failing with two small deficits [45, 46] summing 9 <= 10 -> lifted to 3 failing -> qualified!
  const fiveFailLifted = evaluateIraqiGrade6Qualification({
    subjects: g6Subjects,
    annualEffortBySubjectId: new Map([[1, 80], [2, 75], [3, 46], [4, 45], [5, 30], [6, 35], [7, 38]]),
    maxFailSubjects: 3,
    decisionBonus: 10,
  });
  assert.equal(fiveFailLifted.overallDecision, 'qualified');
  assert.equal(fiveFailLifted.bonusUsed, 9);
  assert.equal(fiveFailLifted.remainingFailingCount, 3);

  // 6) Custom per-year rule: maxFailSubjects = 2, decisionBonus = 5
  const customRule = evaluateIraqiGrade6Qualification({
    subjects: g6Subjects,
    annualEffortBySubjectId: new Map([[1, 80], [2, 75], [3, 60], [4, 65], [5, 45], [6, 35], [7, 38]]),
    maxFailSubjects: 2,
    decisionBonus: 5,
  });
  assert.equal(customRule.overallDecision, 'qualified');
  assert.equal(customRule.bonusUsed, 5);
  assert.equal(customRule.remainingFailingCount, 2);

  // 7) Incomplete annual effort -> overallDecision stays null
  const incomplete = evaluateIraqiGrade6Qualification({
    subjects: g6Subjects,
    annualEffortBySubjectId: new Map([[1, 80], [2, 75]]),
    maxFailSubjects: 3,
    decisionBonus: 10,
  });
  assert.equal(incomplete.incomplete, true);
  assert.equal(incomplete.overallDecision, null);
});

test('buildAllPublishedReportCard omits finalExam/finalGrade for ministerial Grade 6 and never auto-qualifies silently', () => {
  const grades: GradeRecord[] = [
    { id: 1, studentId: 1, subjectId: 2, examId: 8, score: 82, status: 'published', notes: '', updatedBy: 'admin', updatedAt: '', publishedAt: '2026-05-01' },
    { id: 2, studentId: 1, subjectId: 1, examId: 8, score: 42, status: 'published', notes: '', updatedBy: 'admin', updatedAt: '', publishedAt: '2026-05-01' },
    // Even if a final exam score was stored somehow, ministerial mode suppresses finalExam/finalGrade/round1Result
    { id: 3, studentId: 1, subjectId: 2, examId: 9, score: 90, status: 'published', notes: '', updatedBy: 'admin', updatedAt: '', publishedAt: '2026-06-01' },
  ];

  // Without published qualifications -> all ministerialQualification remain null (no silent calculation!)
  const unpublishedQualCard = buildAllPublishedReportCard({
    student: sampleStudent,
    className: 'السادس العلمي',
    sectionName: 'أ',
    exams: allExams,
    subjects,
    grades,
    settings: baseSettings,
    isMinisterial: true,
    subjectQualifications: [
      { academicYearId: 1, studentId: 1, subjectId: 2, decision: 'qualified', decisionSource: 'manual', bonusApplied: 0, status: 'draft', notes: '' },
    ],
    overallQualification: {
      academicYearId: 1, studentId: 1, decision: 'qualified', decisionSource: 'manual', bonusUsed: 0, maxFailSubjects: 3, decisionBonusLimit: 10, status: 'draft', notes: '',
    },
  });
  assert.ok(unpublishedQualCard);
  assert.equal(unpublishedQualCard.isMinisterial, true);
  assert.equal(unpublishedQualCard.iraqiRows[0].finalExam, null);
  assert.equal(unpublishedQualCard.iraqiRows[0].finalGrade, null);
  assert.equal(unpublishedQualCard.iraqiRows[0].ministerialQualification, null);
  assert.equal(unpublishedQualCard.iraqiSummary.round1Result, '');
  assert.equal(unpublishedQualCard.iraqiSummary.ministerialResultText, '');

  // With manager-published qualifications -> reflected cleanly
  const subjectQualifications: Grade6SubjectQualification[] = [
    { academicYearId: 1, studentId: 1, subjectId: 2, decision: 'qualified', decisionSource: 'approved_calculation', bonusApplied: 0, status: 'published', notes: '' },
    { academicYearId: 1, studentId: 1, subjectId: 1, decision: 'not_qualified', decisionSource: 'approved_calculation', bonusApplied: 0, status: 'published', notes: '' },
  ];
  const overallQualification: Grade6OverallQualification = {
    academicYearId: 1, studentId: 1, decision: 'qualified', decisionSource: 'approved_calculation', bonusUsed: 0, maxFailSubjects: 3, decisionBonusLimit: 10, status: 'published', notes: '',
  };
  const publishedQualCard = buildAllPublishedReportCard({
    student: sampleStudent,
    className: 'السادس العلمي',
    sectionName: 'أ',
    exams: allExams,
    subjects,
    grades,
    settings: baseSettings,
    isMinisterial: true,
    subjectQualifications,
    overallQualification,
  });
  assert.ok(publishedQualCard);
  assert.equal(publishedQualCard.iraqiRows.find((r) => r.subjectId === 2)?.ministerialQualification, 'qualified');
  assert.equal(publishedQualCard.iraqiRows.find((r) => r.subjectId === 1)?.ministerialQualification, 'not_qualified');
  assert.equal(publishedQualCard.iraqiSummary.ministerialResultText, 'مؤهل للامتحان الوزاري');
});

test('validateGrade6QualificationImportRows parses Arabic decisions cleanly', () => {
  assert.equal(parseMinisterialDecisionText('مؤهل').decision, 'qualified');
  assert.equal(parseMinisterialDecisionText('غير مؤهل').decision, 'not_qualified');
  assert.equal(parseMinisterialDecisionText('قيد').valid, false);

  const preview = validateGrade6QualificationImportRows(
    [
      {
        'رقم الهوية الوطنية': '2026101',
        'النتيجة النهائية للتأهيل': 'مؤهل للامتحان الوزاري',
        'اللغة العربية': 'مؤهل',
        'الرياضيات': 'غير مؤهل',
      },
      {
        'رقم الهوية الوطنية': '9999999',
        'النتيجة النهائية للتأهيل': 'مؤهل',
      },
    ],
    [sampleStudent],
    subjects
  );
  assert.equal(preview.validCount, 1);
  assert.equal(preview.invalidCount, 1);
  assert.equal(preview.rows[0].normalized?.overallDecision, 'qualified');
  assert.equal(preview.rows[0].normalized?.subjectDecisions.length, 2);
});

test('evaluatePromotionCandidates strictly marks only passing students not already in target year as eligible', () => {
  const cls5 = { id: 5, name: 'الخامس العلمي', displayOrder: 2, isMinisterial: false, createdAt: '' };
  const secA = { id: 10, academicYearId: 1, classId: 5, name: 'أ', isActive: true, createdAt: '' };
  const yearSubjects: Subject[] = [
    { id: 11, academicYearId: 1, name: 'العربية', maxScore: 100, displayOrder: 1, classId: 5, sectionId: null, isActive: true },
    { id: 12, academicYearId: 1, name: 'الرياضيات', maxScore: 100, displayOrder: 2, classId: 5, sectionId: null, isActive: true },
  ];
  const finalExam: Exam = { id: 50, academicYearId: 1, name: 'الدرجة النهائية', displayOrder: 10, isActive: true, academicYear: '2025 - 2026', createdAt: '' };

  const students: Student[] = [
    { id: 1, academicYearId: 1, fullName: 'ناجح مؤهل', inquiryCode: '1001', classId: 5, sectionId: 10, isActive: true, notes: '', createdAt: '', updatedAt: '' },
    { id: 2, academicYearId: 1, fullName: 'مكمل مادة', inquiryCode: '1002', classId: 5, sectionId: 10, isActive: true, notes: '', createdAt: '', updatedAt: '' },
    { id: 3, academicYearId: 1, fullName: 'مرحّل مسبقاً', inquiryCode: '1003', classId: 5, sectionId: 10, isActive: true, notes: '', createdAt: '', updatedAt: '' },
    { id: 4, academicYearId: 1, fullName: 'غير مكتمل', inquiryCode: '1004', classId: 5, sectionId: 10, isActive: true, notes: '', createdAt: '', updatedAt: '' },
  ];

  const grades: GradeRecord[] = [
    { id: 1, studentId: 1, subjectId: 11, examId: 50, score: 85, status: 'published', notes: '', updatedBy: 'a', updatedAt: '', publishedAt: '' },
    { id: 2, studentId: 1, subjectId: 12, examId: 50, score: 65, status: 'published', notes: '', updatedBy: 'a', updatedAt: '', publishedAt: '' },
    { id: 3, studentId: 2, subjectId: 11, examId: 50, score: 85, status: 'published', notes: '', updatedBy: 'a', updatedAt: '', publishedAt: '' },
    { id: 4, studentId: 2, subjectId: 12, examId: 50, score: 42, status: 'published', notes: '', updatedBy: 'a', updatedAt: '', publishedAt: '' },
    { id: 5, studentId: 3, subjectId: 11, examId: 50, score: 90, status: 'published', notes: '', updatedBy: 'a', updatedAt: '', publishedAt: '' },
    { id: 6, studentId: 3, subjectId: 12, examId: 50, score: 92, status: 'published', notes: '', updatedBy: 'a', updatedAt: '', publishedAt: '' },
    { id: 7, studentId: 4, subjectId: 11, examId: 50, score: 75, status: 'published', notes: '', updatedBy: 'a', updatedAt: '', publishedAt: '' },
  ];

  const candidates = evaluatePromotionCandidates({
    sourceStudents: students,
    sourceClass: cls5,
    subjects: yearSubjects,
    exams: [finalExam],
    grades,
    targetYearInquiryCodes: new Set(['1003']),
    sectionsById: new Map([[10, secA]]),
  });

  assert.equal(candidates.length, 4);
  assert.equal(candidates.find((c) => c.studentId === 1)?.eligible, true);
  assert.equal(candidates.find((c) => c.studentId === 1)?.standing, 'ناجح');
  assert.equal(candidates.find((c) => c.studentId === 2)?.eligible, false);
  assert.equal(candidates.find((c) => c.studentId === 2)?.standing, 'مكمل');
  assert.equal(candidates.find((c) => c.studentId === 3)?.eligible, false);
  assert.equal(candidates.find((c) => c.studentId === 3)?.alreadyInTargetYear, true);
  assert.equal(candidates.find((c) => c.studentId === 4)?.eligible, false);
});

test('isTeacherAllowedExamName enforces strictly the 6 monthly and semester effort exams', () => {
  const allowed = [
    'الشهر الأول (الفصل الأول)',
    'الشهر الثاني (الفصل الأول)',
    'سعي الفصل الأول',
    'الشهر الأول (الفصل الثاني)',
    'الشهر الثاني (الفصل الثاني)',
    'سعي الفصل الثاني',
  ];
  for (const name of allowed) {
    assert.equal(isTeacherAllowedExamName(name), true, `Expected ${name} to be allowed`);
  }

  const forbidden = [
    'نصف السنة',
    'السعي السنوي',
    'الامتحان النهائي',
    'الدرجة النهائية',
    'الدور الثاني',
  ];
  for (const name of forbidden) {
    assert.equal(isTeacherAllowedExamName(name), false, `Expected ${name} to be forbidden`);
  }
});

test('sortStudentsAlphabetically orders Arabic student names أ to ي and buildScopedArabicFilename formats clean names', () => {
  const unsorted = [
    { fullName: 'ياسر عمار' },
    { fullName: 'باسم محمد' },
    { fullName: 'أحمد علي' },
    { fullName: 'حيدر حسن' },
  ];
  const sorted = sortStudentsAlphabetically(unsorted);
  assert.deepEqual(
    sorted.map((s) => s.fullName),
    ['أحمد علي', 'باسم محمد', 'حيدر حسن', 'ياسر عمار']
  );

  const file = buildScopedArabicFilename({
    prefix: 'كشف_درجات',
    academicYear: '2025 - 2026',
    className: 'الرابع العلمي',
    sectionName: 'أ',
    subjectName: 'جرائم حزب البعث',
    examName: 'نصف السنة',
    ext: 'xlsx',
  });
  assert.ok(file.endsWith('.xlsx'));
  assert.ok(file.includes('الرابع_العلمي'));
  assert.ok(file.includes('شعبة_أ'));
  assert.ok(file.includes('جرائم_حزب_البعث'));
});

test('evaluateIraqiExemptions evaluates Individual (>=90) & General (>=75 avg & >=75 all subjects) only for non-ministerial classes', () => {
  const cls4Subjects: Subject[] = [
    { id: 1, academicYearId: 1, name: 'التربية الإسلامية', maxScore: 100, displayOrder: 1, classId: 2, sectionId: null, isActive: true },
    { id: 2, academicYearId: 1, name: 'اللغة العربية', maxScore: 100, displayOrder: 2, classId: 2, sectionId: null, isActive: true },
    { id: 3, academicYearId: 1, name: 'جرائم حزب البعث', maxScore: 100, displayOrder: 3, classId: 2, sectionId: null, isActive: true },
  ];
  const rules = { generalMinAvg: 75, minSubject: 75, individualMin: 90 };

  // 1) Ministerial Grade 6 MUST NEVER qualify for exemptions
  const ministerialAttempt = evaluateIraqiExemptions({
    isMinisterial: true,
    subjects: cls4Subjects,
    annualEffortBySubjectId: new Map([[1, 95], [2, 96], [3, 98]]),
    rules,
  });
  assert.equal(ministerialAttempt.overallDecision, null);
  assert.equal(ministerialAttempt.subjectDecisions.every((d) => d.decision === null), true);

  // 2) General Exemption: average >= 75 AND all subjects >= 75 -> all subjects 'exempt' with type 'general'
  const generalExempt = evaluateIraqiExemptions({
    isMinisterial: false,
    subjects: cls4Subjects,
    annualEffortBySubjectId: new Map([[1, 75], [2, 80], [3, 82]]),
    rules,
  });
  assert.equal(generalExempt.overallDecision, 'exempt');
  assert.equal(generalExempt.subjectDecisions.every((d) => d.decision === 'exempt' && d.exemptionType === 'general'), true);

  // 3) Average >= 75 overall, BUT one subject < 75 (70) -> NOT General, only Individual >= 90 exempted
  const individualOnly = evaluateIraqiExemptions({
    isMinisterial: false,
    subjects: cls4Subjects,
    annualEffortBySubjectId: new Map([[1, 92], [2, 70], [3, 88]]),
    rules,
  });
  assert.equal(individualOnly.overallDecision, 'not_exempt');
  assert.equal(individualOnly.subjectDecisions.find((d) => d.subjectId === 1)?.decision, 'exempt');
  assert.equal(individualOnly.subjectDecisions.find((d) => d.subjectId === 1)?.exemptionType, 'individual');
  assert.equal(individualOnly.subjectDecisions.find((d) => d.subjectId === 2)?.decision, 'not_exempt');
  assert.equal(individualOnly.subjectDecisions.find((d) => d.subjectId === 3)?.decision, 'not_exempt');
});

test('buildAllPublishedReportCard reflects exemptions (معفو, finalGrade=annualEffort) and Second Round updates', () => {
  const examSecondRound: Exam = {
    id: 11,
    academicYearId: 1,
    name: 'الدور الثاني',
    displayOrder: 11,
    isActive: true,
    academicYear: '2025 - 2026',
    createdAt: '',
  };
  const extendedExams = [...allExams, examSecondRound];
  const grades: GradeRecord[] = [
    // Subject 1: annualEffort 94 -> individual exempt -> finalGrade becomes 94, finalExam null
    { id: 1, studentId: 1, subjectId: 1, examId: 8, score: 94, status: 'published', notes: '', updatedBy: 'admin', updatedAt: '', publishedAt: '2026-05-01' },
    // Subject 2: annualEffort 60, Second Round 70 -> updated finalGrade = 65 + isSecondRoundUpdated=true
    { id: 2, studentId: 1, subjectId: 2, examId: 8, score: 60, status: 'published', notes: '', updatedBy: 'admin', updatedAt: '', publishedAt: '2026-05-01' },
    { id: 3, studentId: 1, subjectId: 2, examId: 11, score: 70, status: 'published', notes: 'ناجح بالدور الثاني', updatedBy: 'admin', updatedAt: '', publishedAt: '2026-08-20' },
  ];
  const subjectExemptions: SubjectExemption[] = [
    { academicYearId: 1, studentId: 1, subjectId: 1, decision: 'exempt', exemptionType: 'individual', decisionSource: 'approved_calculation', status: 'published', notes: '' },
  ];
  const overallExemption: OverallExemption | null = null;

  const card = buildAllPublishedReportCard({
    student: { ...sampleStudent, classId: 2 },
    className: 'الرابع العلمي',
    sectionName: 'أ',
    exams: extendedExams,
    subjects: subjects.slice(0, 2),
    grades,
    settings: baseSettings,
    isMinisterial: false,
    subjectExemptions,
    overallExemption,
  });

  assert.ok(card);
  const row1 = card.iraqiRows.find((r) => r.subjectId === 1);
  assert.equal(row1?.isIndividualExempt, true);
  assert.equal(row1?.finalExam, null);
  assert.equal(row1?.finalGrade, 94);

  const row2 = card.iraqiRows.find((r) => r.subjectId === 2);
  assert.equal(row2?.isSecondRoundUpdated, true);
  assert.equal(row2?.secondRoundScore, 70);
  assert.equal(row2?.finalGrade, 65);
  assert.equal(card.iraqiSummary.hasSecondRoundUpdates, true);
  assert.equal(card.iraqiSummary.standing, 'ناجح');
});

test('validateExemptionImportRows and جرائم حزب البعث alias parsing work cleanly', () => {
  assert.equal(parseExemptionDecisionText('معفو').decision, 'exempt');
  assert.equal(parseExemptionDecisionText('غير معفو').decision, 'not_exempt');

  const cls4Subjects: Subject[] = [
    { id: 30, academicYearId: 1, name: 'جرائم حزب البعث', maxScore: 100, displayOrder: 5, classId: 2, sectionId: null, isActive: true },
  ];
  const exPreview = validateExemptionImportRows(
    [{ 'رقم الهوية الوطنية': '2026101', 'الإعفاء العام': 'غير معفو', 'الجرائم': 'معفو' }],
    [sampleStudent],
    cls4Subjects
  );
  assert.equal(exPreview.validCount, 1);
  assert.equal(exPreview.rows[0].normalized?.subjectDecisions[0].subjectId, 30);
  assert.equal(exPreview.rows[0].normalized?.subjectDecisions[0].decision, 'exempt');

  const studentsByCode = new Map([[sampleStudent.inquiryCode, sampleStudent]]);
  const subjectsByName = new Map([['جرائم حزب البعث', cls4Subjects[0]]]);
  const examsByName = new Map(allExams.map((e) => [e.name, e]));
  const gradePreview = validateGradeImportRows(
    [{ 'رقم الهوية الوطنية': '2026101', 'الامتحان': 'نصف السنة', 'الجرائم': '88' }],
    studentsByCode,
    subjectsByName,
    examsByName,
    { subjects: cls4Subjects }
  );
  assert.equal(gradePreview.validCount, 1);
  assert.equal(gradePreview.rows[0].normalized?.subjectId, 30);
});

test('isSubjectExcludedForClass excludes Computer (الحاسوب) exclusively from Sixth grade ministerial classes', () => {
  assert.equal(isSubjectExcludedForClass('الحاسوب', 'السادس العلمي', true), true);
  assert.equal(isSubjectExcludedForClass('الحاسوب', 'السادس الأدبي', true), true);
  assert.equal(isSubjectExcludedForClass('حاسوب', 'السادس الابتدائي', false), true);
  assert.equal(isSubjectExcludedForClass('الحاسوب', 'الخامس العلمي', false), false);
  assert.equal(isSubjectExcludedForClass('الحاسوب', 'الرابع العلمي', false), false);
  assert.equal(isSubjectExcludedForClass('الرياضيات', 'السادس العلمي', true), false);

  const g6WithComputer: Subject[] = [
    ...subjects,
    { id: 9, academicYearId: 1, name: 'الحاسوب', maxScore: 100, displayOrder: 9, classId: 1, sectionId: null, isActive: true },
  ];
  const grades: GradeRecord[] = [
    { id: 1, studentId: 1, subjectId: 2, examId: 1, score: 88, status: 'published', notes: '', updatedBy: 'a', updatedAt: '', publishedAt: '' },
    { id: 2, studentId: 1, subjectId: 9, examId: 1, score: 99, status: 'published', notes: '', updatedBy: 'a', updatedAt: '', publishedAt: '' },
  ];

  const card = buildAllPublishedReportCard({
    student: { ...sampleStudent, className: 'السادس العلمي' },
    className: 'السادس العلمي',
    sectionName: 'أ',
    exams: allExams,
    subjects: g6WithComputer,
    grades,
    settings: baseSettings,
    isMinisterial: true,
  });
  assert.ok(card);
  assert.equal(card.iraqiRows.some((r) => r.subjectName === 'الحاسوب'), false);

  const roster = buildGroupExamRoster({
    settings: baseSettings,
    exam: exam1,
    schoolClass: { id: 1, name: 'السادس العلمي', displayOrder: 1, isMinisterial: true, createdAt: '' },
    section: { id: 1, academicYearId: 1, classId: 1, name: 'أ', isActive: true, createdAt: '' },
    students: [sampleStudent],
    subjects: g6WithComputer,
    grades,
    onlyPublished: false,
  });
  assert.equal(roster.subjects.some((s) => s.name === 'الحاسوب'), false);
});

