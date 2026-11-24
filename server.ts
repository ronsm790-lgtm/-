import 'dotenv/config';
import express, { type NextFunction, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import * as XLSX from 'xlsx';
import QRCode from 'qrcode';
import {
  clearLoginRateLimit,
  clearSessionCookie,
  checkLoginRateLimit,
  createSessionToken,
  csrfOriginGuard,
  extractSessionToken,
  hashPassword,
  hasPermission,
  recordFailedLogin,
  setSessionCookie,
  verifyPassword,
  verifySessionToken,
  type AdminRequest,
} from './server/auth.ts';
import {
  createBackupSnapshot,
  deletePublishLink,
  ensurePublishLink,
  getAcademicYearById,
  getBackupsDir,
  getCurrentAcademicYear,
  getDb,
  getDefaultCurriculumForClassName,
  getPublishLinkBySlug,
  getSettings,
  listAcademicYears,
  listAdminNotes,
  listAnnouncements,
  listAuditLogs,
  listClasses,
  listExams,
  listGrade6OverallQualifications,
  listGrade6SubjectQualifications,
  listGradeObjections,
  listGrades,
  listOverallExemptions,
  listPublicObjectionNotices,
  listPublishLinks,
  listSections,
  listStudents,
  listSubjectExemptions,
  listSubjects,
  mapAdminRow,
  OWNER_DEFAULT_PERMISSIONS,
  recordAuditLog,
  resolveAcademicYearId,
  restoreFromBackupFile,
  setTeacherAssignments,
  TEACHER_DEFAULT_PERMISSIONS,
  triggerAutoBackupSnapshot,
} from './server/db.ts';
import { generateOrEditSchoolImage, searchEducationalGuidance } from './server/ai.ts';
import {
  generateControlQrCardsPdf,
  generateGroupRosterPdf,
  generateIraqiAllReportPdf,
  generateMultipleIraqiReportCardsPdf,
  generateMultipleSingleExamReportCardsPdf,
  generateSingleExamReportPdf,
} from './server/pdfGenerator.ts';
import { generateGroupRosterDocx } from './server/docxGenerator.ts';
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
  matchIraqiExamSlot,
  normalizeArabicIndicDigits,
  normalizeArabicText,
  resolveStatusOnGradeEdit,
  roundIraqiHalfUp,
  sortStudentsAlphabetically,
  validateExemptionImportRows,
  validateGrade6QualificationImportRows,
  validateGradeImportRows,
  validateScoreInput,
  validateStudentImportRows,
} from './src/lib/gradeRules.ts';
import {
  GRADE_STATUS_LABELS,
  type AdminPermissions,
  type EffortCalculationTarget,
  type ExemptionDecision,
  type GradeStatus,
  type MinisterialDecision,
} from './src/types/school.ts';

function readFirebaseApiKey(): string {
  try {
    const cfgPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    if (fs.existsSync(cfgPath)) {
      const parsed = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      return String(parsed?.apiKey || '');
    }
  } catch {
    // ignore
  }
  return '';
}

async function verifyFirebaseGoogleToken(idToken: string): Promise<{
  verified: boolean;
  email?: string;
  localId?: string;
  error?: string;
}> {
  const apiKey = readFirebaseApiKey();
  if (!apiKey) {
    return { verified: false, error: 'إعدادات التحقق عبر Google غير مكتملة في الخادم.' };
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7000);
    const resp = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
        signal: controller.signal,
      }
    );
    clearTimeout(timer);
    if (!resp.ok) {
      return { verified: false, error: 'انتهت صلاحية جلسة Google أو أن الرمز غير صالح. يرجى إعادة المصادقة.' };
    }
    const data = (await resp.json()) as {
      users?: Array<{ localId?: string; email?: string; emailVerified?: boolean; disabled?: boolean }>;
    };
    const user = data?.users?.[0];
    if (!user || user.disabled || !user.email) {
      return { verified: false, error: 'حساب Google غير صالح أو معطل.' };
    }
    return { verified: true, email: user.email, localId: user.localId };
  } catch {
    return { verified: false, error: 'تعذر الاتصال بخدمة التحقق من حساب Google.' };
  }
}

function sendAttachmentBuffer(
  res: Response,
  buffer: Buffer,
  contentType: string,
  arabicFilename: string,
  asciiFallback: string
): void {
  const safeAscii =
    String(asciiFallback || 'export.bin')
      .replace(/[^\x20-\x7E]/g, '_')
      .replace(/["\\\r\n;]/g, '_')
      .trim() || 'export.bin';
  const safeUtf8 =
    String(arabicFilename || safeAscii)
      .replace(/[\r\n"\\]/g, '_')
      .trim() || safeAscii;
  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
  res.setHeader('Content-Length', String(buffer.length));
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${safeAscii}"; filename*=UTF-8''${encodeURIComponent(safeUtf8)}`
  );
  res.send(buffer);
}

const VALID_GRADE_STATUSES: GradeStatus[] = [
  'draft',
  'in_review',
  'ready',
  'published',
  'withdrawn',
  'archived',
];

function attachAdmin(req: AdminRequest, _res: Response, next: NextFunction): void {
  const token = extractSessionToken(req);
  const payload = verifySessionToken(token);
  if (payload) {
    const row = getDb()
      .prepare('SELECT * FROM admins WHERE id = ? AND is_active = 1')
      .get(payload.uid) as Record<string, unknown> | undefined;
    if (row) {
      const yearId = resolveAcademicYearId(req.query?.yearId ?? req.body?.yearId);
      req.admin = mapAdminRow(row, yearId);
    }
  }
  next();
}

function requireAdmin(req: AdminRequest, res: Response, next: NextFunction): void {
  if (!req.admin) {
    res.status(401).json({ error: 'غير مصرح بالدخول. يرجى تسجيل الدخول أولاً.' });
    return;
  }
  next();
}

function requireOwner(req: AdminRequest, res: Response, next: NextFunction): void {
  if (!req.admin || req.admin.role !== 'owner') {
    res.status(403).json({ error: 'هذه العملية حصرية لحساب المالك الأساسي فقط.' });
    return;
  }
  next();
}

function requireManager(req: AdminRequest, res: Response, next: NextFunction): void {
  if (!req.admin || req.admin.role === 'teacher') {
    res.status(403).json({ error: 'هذه الميزة حصرية لإدارة المدرسة والمشرفين فقط.' });
    return;
  }
  next();
}

function requirePerm(perm: keyof AdminPermissions) {
  return (req: AdminRequest, res: Response, next: NextFunction): void => {
    if (!req.admin || !hasPermission(req.admin, perm)) {
      res.status(403).json({ error: 'ليست لديك الصلاحية اللازمة لتنفيذ هذا الإجراء.' });
      return;
    }
    next();
  };
}

function escapeHtml(text: unknown): string {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function resolveLogoDataUri(emblemUrl: string): string {
  try {
    let localPath: string | null = null;
    if (emblemUrl.startsWith('/assets/')) {
      localPath = path.resolve(process.cwd(), 'public', emblemUrl.slice(1));
    } else if (emblemUrl.startsWith('/uploads/')) {
      localPath = path.resolve(process.cwd(), 'data', emblemUrl.slice(1));
    }
    if (localPath && fs.existsSync(localPath)) {
      const ext = path.extname(localPath).toLowerCase();
      const mime =
        ext === '.png'
          ? 'image/png'
          : ext === '.webp'
            ? 'image/webp'
            : ext === '.svg'
              ? 'image/svg+xml'
              : 'image/jpeg';
      const b64 = fs.readFileSync(localPath).toString('base64');
      return `data:${mime};base64,${b64}`;
    }
  } catch {
    // ignore missing local logo
  }
  return '';
}

function getCompactColumnFloor(header: string): number {
  if (header === 'ت') return 4;
  if (header === 'الشعبة') return 7;
  return 9;
}

function sanitizeExcelSheetName(name: string): string {
  const cleaned = String(name ?? 'البيانات')
    .replace(/[:\\/?*\[\]]/g, '-')
    .trim();
  return (cleaned.slice(0, 31) || 'البيانات').trim();
}

function applyArabicSheetLayout(
  wb: XLSX.WorkBook,
  ws: XLSX.WorkSheet,
  rows: Array<Record<string, unknown>>
): void {
  wb.Workbook = { Views: [{ RTL: true }] };
  ws['!views'] = [{ rightToLeft: true }];

  const ref = ws['!ref'];
  if (!ref) return;
  const range = XLSX.utils.decode_range(ref);
  const cols: XLSX.ColInfo[] = [];

  for (let c = range.s.c; c <= range.e.c; c++) {
    const headerCell = ws[XLSX.utils.encode_cell({ r: 0, c })];
    const rawHeader = String(headerCell?.v ?? '');
    const header = rawHeader.trim();
    const isTextCodeColumn = header.includes('الهوية') || header.includes('الكود');
    const minFloor = getCompactColumnFloor(header);
    let maxLen = Math.max(header.length + 5, minFloor);

    for (let r = 1; r <= range.e.r; r++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = ws[addr];
      if (cell && cell.v !== undefined && cell.v !== null && cell.v !== '') {
        if (isTextCodeColumn) {
          cell.t = 's';
          cell.v = String(cell.v).trim();
          cell.w = cell.v;
          cell.z = '@';
        }
        const cellLen = String(cell.v).trim().length + 4;
        if (cellLen > maxLen) maxLen = cellLen;
      }
    }

    for (let i = 0; i < rows.length; i++) {
      const val = rows[i]?.[rawHeader] ?? rows[i]?.[header];
      if (val !== null && val !== undefined) {
        const len = String(val).trim().length + 4;
        if (len > maxLen) maxLen = len;
      }
    }
    cols.push({ wch: Math.min(maxLen, 48) });
  }
  ws['!cols'] = cols;
}

function createArabicWorksheet(
  wb: XLSX.WorkBook,
  sheetName: string,
  rows: Array<Record<string, unknown>>,
  fallbackHeaders?: string[]
): XLSX.WorkSheet {
  let ws: XLSX.WorkSheet;
  let effectiveRows: Array<Record<string, unknown>> = rows;
  if (rows.length > 0) {
    ws = XLSX.utils.json_to_sheet(rows);
  } else if (fallbackHeaders && fallbackHeaders.length > 0) {
    const emptyRow: Record<string, string> = {};
    fallbackHeaders.forEach((h) => (emptyRow[h] = '—'));
    effectiveRows = [emptyRow];
    ws = XLSX.utils.json_to_sheet(effectiveRows);
  } else {
    effectiveRows = [{ 'ت': '—', 'اسم الطالب': 'لا توجد بيانات', 'ملاحظات': '' }];
    ws = XLSX.utils.json_to_sheet(effectiveRows);
  }
  applyArabicSheetLayout(wb, ws, effectiveRows);
  XLSX.utils.book_append_sheet(wb, ws, sanitizeExcelSheetName(sheetName));
  return ws;
}

async function startServer() {
  // Initialize SQLite database & seed defaults
  getDb();

  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '10mb' }));
  app.use(csrfOriginGuard);
  app.use(attachAdmin);

  const uploadsDir = path.resolve(process.cwd(), 'data', 'uploads');
  fs.mkdirSync(uploadsDir, { recursive: true });
  app.use('/uploads', express.static(uploadsDir));

  // Security headers
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  // =========================================================================
  // PUBLIC ROUTES (Student Results Portal + Announcements + Flask ZIP)
  // =========================================================================

  app.get('/api/public/bootstrap', (req, res) => {
    const academicYears = listAcademicYears(true);
    const currentYear = getCurrentAcademicYear();
    const selectedYearId = resolveAcademicYearId(req.query.yearId);
    const selectedYear = getAcademicYearById(selectedYearId) ?? currentYear;
    const settings = { ...getSettings(), academicYear: selectedYear.name };
    const exams = listExams(selectedYearId).filter((e) => e.isActive);
    const announcements = listAnnouncements(true);
    const classes = listClasses();
    res.json({ settings, academicYears, currentYear, selectedYear, exams, announcements, classes });
  });

  app.get('/api/public/publish-link/:slug', (req, res) => {
    const link = getPublishLinkBySlug(req.params.slug);
    if (!link) {
      res.status(404).json({ error: 'رابط النشرة غير موجود أو تم سحبه.' });
      return;
    }
    res.json({ link });
  });

  app.post('/api/public/results', (req, res) => {
    const inquiryCode = String(req.body?.inquiryCode ?? '').trim();
    const rawExamId = String(req.body?.examId ?? '').trim();
    const publishSlug = String(req.body?.publishSlug ?? '').trim();
    const activeLink = publishSlug ? getPublishLinkBySlug(publishSlug) : null;
    const yearId = activeLink?.academicYearId
      ? resolveAcademicYearId(activeLink.academicYearId)
      : resolveAcademicYearId(req.body?.yearId);
    const yearObj = getAcademicYearById(yearId) ?? getCurrentAcademicYear();
    const isAllMode = rawExamId === 'all';
    const examId = isAllMode ? 0 : Number(rawExamId);

    if (!inquiryCode || (!isAllMode && (!Number.isInteger(examId) || examId <= 0))) {
      res.status(400).json({ error: 'يرجى إدخال رقم الهوية الوطنية واختيار نوع الامتحان.' });
      return;
    }

    const db = getDb();
    const studentRow = db
      .prepare(
        `SELECT st.id, st.academic_year_id as academicYearId, st.full_name as fullName, st.inquiry_code as inquiryCode,
                st.class_id as classId, st.section_id as sectionId,
                c.name as className, c.is_ministerial as isMinisterial, sec.name as sectionName,
                st.is_active as isActive, st.notes, st.created_at as createdAt, st.updated_at as updatedAt
         FROM students st
         JOIN classes c ON c.id = st.class_id
         JOIN sections sec ON sec.id = st.section_id
         WHERE st.inquiry_code = ? AND st.academic_year_id = ? AND st.is_active = 1`
      )
      .get(inquiryCode, yearId) as any;

    if (!studentRow) {
      res.status(404).json({
        error: 'لا توجد نتيجة منشورة مطابقة لرقم الهوية الوطنية المدخل في هذا العام الدراسي. يرجى التأكد من الرقم أو العام الدراسي أو مراجعة إدارة المدرسة.',
      });
      return;
    }

    const subjects = listSubjects(yearId).filter((s) => s.isActive);
    const settings = { ...getSettings(), academicYear: yearObj.name };
    const isMinisterial = Boolean(studentRow.isMinisterial);

    if (isAllMode) {
      const activeExams = listExams(yearId).filter((e) => e.isActive);
      const publishedGrades = db
        .prepare(
          `SELECT id, academic_year_id as academicYearId, student_id as studentId, subject_id as subjectId, exam_id as examId,
                  score, status, notes, updated_by as updatedBy, updated_at as updatedAt, published_at as publishedAt
           FROM grades
           WHERE student_id = ? AND academic_year_id = ? AND status = 'published' AND score IS NOT NULL`
        )
        .all(studentRow.id, yearId) as any[];

      const subjectQualifications = isMinisterial
        ? listGrade6SubjectQualifications(yearId, studentRow.id)
        : [];
      const overallQualification = isMinisterial
        ? listGrade6OverallQualifications(yearId, studentRow.id)[0] ?? null
        : null;
      const subjectExemptions = !isMinisterial
        ? listSubjectExemptions(yearId, studentRow.id)
        : [];
      const overallExemption = !isMinisterial
        ? listOverallExemptions(yearId, studentRow.id)[0] ?? null
        : null;

      const allReport = buildAllPublishedReportCard({
        student: { ...studentRow, isActive: Boolean(studentRow.isActive), notes: '' },
        className: studentRow.className,
        sectionName: studentRow.sectionName,
        exams: activeExams,
        subjects,
        grades: publishedGrades,
        settings,
        academicYearLabel: yearObj.name,
        isMinisterial,
        subjectQualifications,
        overallQualification,
        subjectExemptions,
        overallExemption,
      });

      if (!allReport) {
        res.status(404).json({
          error: 'لا توجد نتائج منشورة لهذا الطالب في هذا العام الدراسي حتى الآن.',
        });
        return;
      }

      const objectionNotices = listPublicObjectionNotices(yearId, studentRow.id);
      res.json({ mode: 'all', allReport, objectionNotices, yearId });
      return;
    }

    if (activeLink) {
      if (studentRow.classId !== activeLink.classId) {
        res.status(404).json({
          error: `هذا الرابط مخصص لنشرة (${activeLink.className})، بينما الطالب مسجل في (${studentRow.className}). يمكنك اختيار «عرض كل النتائج» للاستعلام عن جميع نتائجه.`,
        });
        return;
      }
      if (activeLink.sectionId !== null && studentRow.sectionId !== activeLink.sectionId) {
        res.status(404).json({
          error: `هذا الرابط مخصص لـ (شعبة ${activeLink.sectionName})، بينما الطالب مسجل في (شعبة ${studentRow.sectionName}). يمكنك اختيار «عرض كل النتائج» للاستعلام العام.`,
        });
        return;
      }
    }

    const exam = db
      .prepare(
        `SELECT id, academic_year_id as academicYearId, name, display_order as displayOrder, is_active as isActive, academic_year as academicYear, created_at as createdAt
         FROM exams WHERE id = ? AND academic_year_id = ? AND is_active = 1`
      )
      .get(examId, yearId) as any;

    if (!exam) {
      res.status(404).json({
        error: 'الامتحان المحدد غير متاح حالياً في هذا العام الدراسي.',
      });
      return;
    }

    const allStudentPublishedGrades = db
      .prepare(
        `SELECT id, academic_year_id as academicYearId, student_id as studentId, subject_id as subjectId, exam_id as examId,
                score, status, notes, updated_by as updatedBy, updated_at as updatedAt, published_at as publishedAt
         FROM grades
         WHERE student_id = ? AND academic_year_id = ? AND status = 'published' AND score IS NOT NULL`
      )
      .all(studentRow.id, yearId) as any[];

    const activeExams = listExams(yearId).filter((e) => e.isActive);
    const report = buildComputedSingleExamReportCard({
      student: { ...studentRow, isActive: Boolean(studentRow.isActive), notes: '' },
      className: studentRow.className,
      sectionName: studentRow.sectionName,
      targetExam: { ...exam, isActive: Boolean(exam.isActive) },
      allExams: activeExams,
      subjects,
      allGrades: allStudentPublishedGrades,
      settings,
      filterSubjectId:
        activeLink && activeLink.examId === exam.id && activeLink.subjectId
          ? activeLink.subjectId
          : null,
    });

    if (!report) {
      res.status(404).json({
        error: 'النتائج غير منشورة حالياً لهذا الامتحان. سيتم إعلانها فور اعتمادها من قبل الإدارة.',
      });
      return;
    }

    const objectionNotices = listPublicObjectionNotices(yearId, studentRow.id);
    res.json({ mode: 'single', report, examId: exam.id, objectionNotices, yearId });
  });

  app.post('/api/public/report-pdf', async (req, res) => {
    const inquiryCode = String(req.body?.inquiryCode ?? '').trim();
    const rawExamId = String(req.body?.examId ?? 'all').trim();
    const publishSlug = String(req.body?.publishSlug ?? '').trim();
    const activeLink = publishSlug ? getPublishLinkBySlug(publishSlug) : null;
    const yearId = activeLink?.academicYearId
      ? resolveAcademicYearId(activeLink.academicYearId)
      : resolveAcademicYearId(req.body?.yearId);
    const yearObj = getAcademicYearById(yearId) ?? getCurrentAcademicYear();
    const isAllMode = rawExamId === 'all';
    const examId = isAllMode ? 0 : Number(rawExamId);

    const db = getDb();
    const studentRow = db
      .prepare(
        `SELECT st.id, st.academic_year_id as academicYearId, st.full_name as fullName, st.inquiry_code as inquiryCode,
                st.class_id as classId, st.section_id as sectionId,
                c.name as className, c.is_ministerial as isMinisterial, sec.name as sectionName,
                st.is_active as isActive, st.notes, st.created_at as createdAt, st.updated_at as updatedAt
         FROM students st
         JOIN classes c ON c.id = st.class_id
         JOIN sections sec ON sec.id = st.section_id
         WHERE st.inquiry_code = ? AND st.academic_year_id = ? AND st.is_active = 1`
      )
      .get(inquiryCode, yearId) as any;

    if (!studentRow) {
      res.status(404).json({ error: 'تعذر العثور على بطاقة الطالب.' });
      return;
    }

    const subjects = listSubjects(yearId).filter((s) => s.isActive);
    const settings = { ...getSettings(), academicYear: yearObj.name };
    const isMinisterial = Boolean(studentRow.isMinisterial);
    const activeExams = listExams(yearId).filter((e) => e.isActive);
    const publishedGrades = db
      .prepare(
        `SELECT id, academic_year_id as academicYearId, student_id as studentId, subject_id as subjectId, exam_id as examId,
                score, status, notes, updated_by as updatedBy, updated_at as updatedAt, published_at as publishedAt
         FROM grades
         WHERE student_id = ? AND academic_year_id = ? AND status = 'published' AND score IS NOT NULL`
      )
      .all(studentRow.id, yearId) as any[];

    if (isAllMode) {
      const card = buildAllPublishedReportCard({
        student: { ...studentRow, isActive: Boolean(studentRow.isActive), notes: '' },
        className: studentRow.className,
        sectionName: studentRow.sectionName,
        exams: activeExams,
        subjects,
        grades: publishedGrades,
        settings,
        academicYearLabel: yearObj.name,
        isMinisterial,
        subjectQualifications: isMinisterial ? listGrade6SubjectQualifications(yearId, studentRow.id) : [],
        overallQualification: isMinisterial ? listGrade6OverallQualifications(yearId, studentRow.id)[0] ?? null : null,
        subjectExemptions: !isMinisterial ? listSubjectExemptions(yearId, studentRow.id) : [],
        overallExemption: !isMinisterial ? listOverallExemptions(yearId, studentRow.id)[0] ?? null : null,
      });
      if (!card) {
        res.status(404).json({ error: 'لا توجد نتائج منشورة لتصديرها.' });
        return;
      }
      const pdfBuf = await generateIraqiAllReportPdf(card);
      const fname = buildScopedArabicFilename({
        prefix: 'بطاقة_درجات',
        academicYear: yearObj.name,
        className: studentRow.className,
        sectionName: studentRow.sectionName,
        studentName: studentRow.fullName,
        ext: 'pdf',
      });
      sendAttachmentBuffer(res, pdfBuf, 'application/pdf', fname, `report-${studentRow.inquiryCode}.pdf`);
      return;
    }

    const targetExam = activeExams.find((e) => e.id === examId);
    if (!targetExam) {
      res.status(404).json({ error: 'الامتحان غير موجود.' });
      return;
    }
    const single = buildComputedSingleExamReportCard({
      student: { ...studentRow, isActive: Boolean(studentRow.isActive), notes: '' },
      className: studentRow.className,
      sectionName: studentRow.sectionName,
      targetExam,
      allExams: activeExams,
      subjects,
      allGrades: publishedGrades,
      settings,
      filterSubjectId:
        activeLink && activeLink.examId === targetExam.id && activeLink.subjectId ? activeLink.subjectId : null,
    });
    if (!single) {
      res.status(404).json({ error: 'النتائج غير منشورة لهذا الامتحان.' });
      return;
    }
    const pdfBuf = await generateSingleExamReportPdf(single);
    const fname = buildScopedArabicFilename({
      prefix: 'نتيجة',
      academicYear: yearObj.name,
      className: studentRow.className,
      sectionName: studentRow.sectionName,
      examName: targetExam.name,
      studentName: studentRow.fullName,
      ext: 'pdf',
    });
    sendAttachmentBuffer(res, pdfBuf, 'application/pdf', fname, `report-${studentRow.inquiryCode}-${examId}.pdf`);
  });

  app.post('/api/public/objections', (req, res) => {
    const yearId = resolveAcademicYearId(req.body?.yearId);
    const inquiryCode = String(req.body?.inquiryCode ?? '').trim();
    const examId = Number(req.body?.examId);
    const subjectId = Number(req.body?.subjectId);
    const reason = String(req.body?.reason ?? '').trim();

    if (!inquiryCode || !Number.isInteger(examId) || examId <= 0 || !Number.isInteger(subjectId) || subjectId <= 0) {
      res.status(400).json({ error: 'يرجى تحديد الطالب والامتحان والمادة المطلوب الاعتراض عليها.' });
      return;
    }
    if (reason.length < 4) {
      res.status(400).json({ error: 'سبب الاعتراض إلزامي (يرجى كتابة سبب واضح لا يقل عن 4 أحرف).' });
      return;
    }

    const db = getDb();
    const student = db
      .prepare('SELECT id, full_name as fullName FROM students WHERE inquiry_code = ? AND academic_year_id = ? AND is_active = 1')
      .get(inquiryCode, yearId) as { id: number; fullName: string } | undefined;
    if (!student) {
      res.status(404).json({ error: 'لم يتم العثور على الطالب في العام الدراسي المحدد.' });
      return;
    }

    const publishedGrade = db
      .prepare(
        "SELECT id, score FROM grades WHERE student_id = ? AND subject_id = ? AND exam_id = ? AND academic_year_id = ? AND status = 'published'"
      )
      .get(student.id, subjectId, examId, yearId) as { id: number; score: number | null } | undefined;
    if (!publishedGrade) {
      res.status(400).json({ error: 'يمكن الاعتراض فقط على الدرجات المنشورة لهذا الطالب.' });
      return;
    }

    const existingPending = db
      .prepare(
        "SELECT id FROM grade_objections WHERE academic_year_id = ? AND student_id = ? AND subject_id = ? AND exam_id = ? AND status = 'pending'"
      )
      .get(yearId, student.id, subjectId, examId) as { id: number } | undefined;
    if (existingPending) {
      res.status(409).json({ error: 'يوجد اعتراض قيد المراجعة مسبقاً لنفس المادة والامتحان.' });
      return;
    }

    const info = db
      .prepare(
        `INSERT INTO grade_objections (academic_year_id, student_id, subject_id, exam_id, recorded_score, reason, status)
         VALUES (?, ?, ?, ?, ?, ?, 'pending')`
      )
      .run(yearId, student.id, subjectId, examId, publishedGrade.score, reason);

    recordAuditLog(inquiryCode, 'SUBMIT_OBJECTION', 'grade_objection', Number(info.lastInsertRowid), `تقديم اعتراض درجة للطالب ${student.fullName}`);
    triggerAutoBackupSnapshot();
    res.status(201).json({ ok: true, id: Number(info.lastInsertRowid) });
  });

  // =========================================================================
  // ADMIN AUTH ROUTES
  // =========================================================================

  app.get('/api/admin/me', (req: AdminRequest, res) => {
    if (!req.admin) {
      res.status(200).json({ authenticated: false, admin: null });
      return;
    }
    res.json({ authenticated: true, admin: req.admin });
  });

  app.post('/api/admin/login', async (req, res) => {
    const rawUsername = String(req.body?.username ?? '').trim();
    const password = String(req.body?.password ?? '');
    const googleIdToken = String(req.body?.googleIdToken ?? '').trim();

    if (!rawUsername || !password) {
      res.status(400).json({ error: 'يرجى إدخال اسم المستخدم وكلمة المرور.' });
      return;
    }

    const normalizedUsername = rawUsername.replace(/^@+/, '');
    const limit = checkLoginRateLimit(req, normalizedUsername);
    if (!limit.allowed) {
      res.status(429).json({
        error: `تم تجاوز الحد المسموح لمحاولات الدخول. يرجى الانتظار ${limit.retryAfterSeconds} ثانية.`,
      });
      return;
    }

    const db = getDb();
    let row = db
      .prepare('SELECT * FROM admins WHERE LOWER(username) = LOWER(?)')
      .get(rawUsername) as Record<string, unknown> | undefined;
    if (!row && rawUsername.startsWith('@')) {
      row = db
        .prepare('SELECT * FROM admins WHERE LOWER(username) = LOWER(?)')
        .get(normalizedUsername) as Record<string, unknown> | undefined;
    }

    if (
      !row ||
      !Boolean(row.is_active) ||
      !verifyPassword(password, String(row.password_hash), String(row.password_salt))
    ) {
      const failInfo = recordFailedLogin(req, normalizedUsername);
      res.status(401).json({
        error: failInfo.locked
          ? 'تم إيقاف المحاولات مؤقتاً لمدة 10 دقائق بسبب تكرار الأخطاء.'
          : 'اسم المستخدم أو كلمة المرور غير صحيحة.',
      });
      return;
    }

    let googleEmail: string | null = null;
    if (googleIdToken) {
      const googleCheck = await verifyFirebaseGoogleToken(googleIdToken);
      if (googleCheck.verified && googleCheck.email) {
        googleEmail = googleCheck.email;
      }
    }

    clearLoginRateLimit(req, normalizedUsername);
    if (googleEmail) {
      db.prepare("UPDATE admins SET last_login_at = datetime('now'), google_email = ? WHERE id = ?").run(
        googleEmail,
        Number(row.id)
      );
    } else {
      db.prepare("UPDATE admins SET last_login_at = datetime('now') WHERE id = ?").run(Number(row.id));
    }

    const updatedRow = db.prepare('SELECT * FROM admins WHERE id = ?').get(Number(row.id)) as Record<string, unknown>;
    const admin = mapAdminRow(updatedRow);
    const token = createSessionToken({ id: admin.id, username: admin.username, role: admin.role });
    setSessionCookie(req, res, token);
    recordAuditLog(
      admin.username,
      'LOGIN',
      'admin',
      admin.id,
      `تسجيل دخول إداري مباشر (${admin.role})`
    );

    res.json({ admin, sessionToken: token });
  });

  app.post('/api/admin/logout', (req: AdminRequest, res) => {
    if (req.admin) {
      recordAuditLog(req.admin.username, 'LOGOUT', 'admin', req.admin.id, 'تسجيل خروج إداري');
    }
    clearSessionCookie(req, res);
    res.json({ ok: true });
  });

  app.post('/api/admin/change-password', requireAdmin, (req: AdminRequest, res) => {
    const currentPassword = String(req.body?.currentPassword ?? '');
    const newPassword = String(req.body?.newPassword ?? '');

    if (!currentPassword || newPassword.length < 8) {
      res.status(400).json({ error: 'يجب إدخال كلمة المرور الحالية وكلمة مرور جديدة من 8 أحرف على الأقل.' });
      return;
    }

    const db = getDb();
    const row = db
      .prepare('SELECT * FROM admins WHERE id = ?')
      .get(req.admin!.id) as Record<string, unknown> | undefined;

    if (!row || !verifyPassword(currentPassword, String(row.password_hash), String(row.password_salt))) {
      res.status(400).json({ error: 'كلمة المرور الحالية غير صحيحة.' });
      return;
    }

    const { hash, salt } = hashPassword(newPassword);
    db.prepare('UPDATE admins SET password_hash = ?, password_salt = ? WHERE id = ?').run(
      hash,
      salt,
      req.admin!.id
    );
    recordAuditLog(req.admin!.username, 'CHANGE_PASSWORD', 'admin', req.admin!.id, 'تحديث كلمة مرور الحساب الشخصي');
    res.json({ ok: true });
  });

  app.put('/api/admin/owner-credentials', requireAdmin, requireOwner, (req: AdminRequest, res) => {
    const currentPassword = String(req.body?.currentPassword ?? '');
    const newUsername = String(req.body?.newUsername ?? '').trim();
    const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';

    if (!currentPassword || !newUsername || newUsername.length < 3) {
      res.status(400).json({ error: 'يرجى إدخال كلمة المرور الحالية واسم مستخدم لا يقل عن 3 أحرف.' });
      return;
    }
    if (newPassword && newPassword.length < 8) {
      res.status(400).json({ error: 'كلمة المرور الجديدة يجب ألا تقل عن 8 أحرف.' });
      return;
    }

    const db = getDb();
    const ownerRow = db
      .prepare('SELECT * FROM admins WHERE id = ?')
      .get(req.admin!.id) as Record<string, unknown> | undefined;
    if (!ownerRow || !verifyPassword(currentPassword, String(ownerRow.password_hash), String(ownerRow.password_salt))) {
      res.status(400).json({ error: 'كلمة المرور الحالية غير صحيحة.' });
      return;
    }

    const duplicate = db
      .prepare('SELECT id FROM admins WHERE LOWER(username) = LOWER(?) AND id != ?')
      .get(newUsername, req.admin!.id);
    if (duplicate) {
      res.status(409).json({ error: 'اسم المستخدم هذا مستخدم لحساب آخر بالفعل.' });
      return;
    }

    const oldUsername = String(ownerRow.username);
    db.transaction(() => {
      if (newPassword) {
        const { hash, salt } = hashPassword(newPassword);
        db.prepare('UPDATE admins SET username = ?, password_hash = ?, password_salt = ? WHERE id = ?').run(
          newUsername,
          hash,
          salt,
          req.admin!.id
        );
      } else {
        db.prepare('UPDATE admins SET username = ? WHERE id = ?').run(newUsername, req.admin!.id);
      }
      if (oldUsername !== newUsername) {
        db.prepare('UPDATE grades SET updated_by = ? WHERE updated_by = ?').run(newUsername, oldUsername);
        db.prepare('UPDATE announcements SET created_by = ? WHERE created_by = ?').run(newUsername, oldUsername);
        db.prepare('UPDATE admin_notes SET updated_by = ? WHERE updated_by = ?').run(newUsername, oldUsername);
      }
    })();

    const updatedRow = db.prepare('SELECT * FROM admins WHERE id = ?').get(req.admin!.id) as Record<string, unknown>;
    const updatedAdmin = mapAdminRow(updatedRow);
    const freshToken = createSessionToken({
      id: updatedAdmin.id,
      username: updatedAdmin.username,
      role: updatedAdmin.role,
    });
    setSessionCookie(req, res, freshToken);
    recordAuditLog(updatedAdmin.username, 'UPDATE_OWNER_CREDENTIALS', 'admin', updatedAdmin.id, 'تحديث اسم المستخدم أو كلمة مرور المالك');
    triggerAutoBackupSnapshot(true);
    res.json({ ok: true, admin: updatedAdmin, sessionToken: freshToken });
  });

  // =========================================================================
  // ADMIN OVERVIEW & DASHBOARD STATS
  // =========================================================================

  app.get('/api/admin/overview', requireAdmin, (req: AdminRequest, res) => {
    const db = getDb();
    const yearId = resolveAcademicYearId(req.query.yearId);
    if (req.admin!.role === 'teacher') {
      const assignments = req.admin!.assignments ?? [];
      const students = listStudents(yearId).filter(
        (st) =>
          st.isActive &&
          assignments.some(
            (a) => a.classId === st.classId && (a.sectionId === null || a.sectionId === st.sectionId)
          )
      );
      const uniqueClassIds = new Set(assignments.map((a) => a.classId));
      const uniqueSubjectIds = new Set(assignments.map((a) => a.subjectId));
      const totalExams = (
        db.prepare('SELECT COUNT(*) as c FROM exams WHERE is_active = 1 AND academic_year_id = ?').get(yearId) as { c: number }
      ).c;
      res.json({
        stats: {
          totalStudents: students.length,
          totalClasses: uniqueClassIds.size,
          totalSections: assignments.length,
          totalSubjects: uniqueSubjectIds.size,
          totalExams,
          publishedGrades: 0,
          unpublishedGrades: 0,
        },
        alerts:
          assignments.length === 0
            ? [
                {
                  level: 'warning',
                  message: 'لم يتم إسناد أي مواد أو صفوف لحسابك في هذا العام الدراسي حتى الآن. يرجى مراجعة مدير المدرسة.',
                },
              ]
            : [],
        auditLogs: [],
      });
      return;
    }

    const totalStudents = (
      db.prepare('SELECT COUNT(*) as c FROM students WHERE academic_year_id = ?').get(yearId) as { c: number }
    ).c;
    const totalClasses = (db.prepare('SELECT COUNT(*) as c FROM classes').get() as { c: number }).c;
    const totalSections = (
      db.prepare('SELECT COUNT(*) as c FROM sections WHERE academic_year_id = ?').get(yearId) as { c: number }
    ).c;
    const totalSubjects = (
      db.prepare('SELECT COUNT(*) as c FROM subjects WHERE academic_year_id = ?').get(yearId) as { c: number }
    ).c;
    const totalExams = (
      db.prepare('SELECT COUNT(*) as c FROM exams WHERE academic_year_id = ?').get(yearId) as { c: number }
    ).c;
    const publishedGrades = (
      db
        .prepare("SELECT COUNT(*) as c FROM grades WHERE academic_year_id = ? AND status = 'published'")
        .get(yearId) as { c: number }
    ).c;
    const unpublishedGrades = (
      db
        .prepare("SELECT COUNT(*) as c FROM grades WHERE academic_year_id = ? AND status != 'published'")
        .get(yearId) as { c: number }
    ).c;
    const draftOrReviewCount = (
      db
        .prepare("SELECT COUNT(*) as c FROM grades WHERE academic_year_id = ? AND status IN ('draft','in_review')")
        .get(yearId) as { c: number }
    ).c;

    const alerts: Array<{ level: 'warning' | 'info'; message: string }> = [];
    if (draftOrReviewCount > 0) {
      alerts.push({
        level: 'warning',
        message: `يوجد ${draftOrReviewCount} درجة في حالة مسودة أو قيد المراجعة ولم تُنشر للطلبة بعد.`,
      });
    }
    const studentsWithoutGrades = (
      db
        .prepare(
          'SELECT COUNT(*) as c FROM students st WHERE st.academic_year_id = ? AND st.is_active = 1 AND NOT EXISTS (SELECT 1 FROM grades g WHERE g.student_id = st.id)'
        )
        .get(yearId) as { c: number }
    ).c;
    if (studentsWithoutGrades > 0) {
      alerts.push({
        level: 'info',
        message: `يوجد ${studentsWithoutGrades} طالب نشط لم تُسجل لهم درجات في أي امتحان في هذا العام الدراسي حتى الآن.`,
      });
    }

    res.json({
      stats: {
        totalStudents,
        totalClasses,
        totalSections,
        totalSubjects,
        totalExams,
        publishedGrades,
        unpublishedGrades,
      },
      alerts,
      auditLogs: listAuditLogs(20),
    });
  });

  // =========================================================================
  // STUDENTS MANAGEMENT
  // =========================================================================

  app.get('/api/admin/students', requireAdmin, (req: AdminRequest, res) => {
    const yearId = resolveAcademicYearId(req.query.yearId);
    const all = listStudents(yearId);
    if (req.admin!.role === 'teacher') {
      const assignments = req.admin!.assignments ?? [];
      const filtered = all.filter((st) =>
        assignments.some(
          (a) => a.classId === st.classId && (a.sectionId === null || a.sectionId === st.sectionId)
        )
      );
      res.json({ students: filtered });
      return;
    }
    res.json({ students: all });
  });

  app.get('/api/admin/students/:id/academic', requireAdmin, requireManager, (req, res) => {
    const id = Number(req.params.id);
    const grades = getDb()
      .prepare(
        `SELECT g.id, g.exam_id as examId, e.name as examName, g.subject_id as subjectId,
                sub.name as subjectName, sub.max_score as maxScore, g.score, g.status, g.notes, g.updated_at as updatedAt
         FROM grades g
         JOIN exams e ON e.id = g.exam_id
         JOIN subjects sub ON sub.id = g.subject_id
         WHERE g.student_id = ?
         ORDER BY e.display_order ASC, sub.display_order ASC`
      )
      .all(id);
    res.json({ grades });
  });

  app.post('/api/admin/students', requireAdmin, requirePerm('manageStudents'), (req: AdminRequest, res) => {
    const yearId = resolveAcademicYearId(req.body?.yearId ?? req.query.yearId);
    const fullName = String(req.body?.fullName ?? '').trim();
    const inquiryCode = String(req.body?.inquiryCode ?? '').trim();
    const classId = Number(req.body?.classId);
    const sectionId = Number(req.body?.sectionId);
    const notes = String(req.body?.notes ?? '').trim();
    const isActive = req.body?.isActive !== false ? 1 : 0;

    if (fullName.length < 3 || !inquiryCode || !Number.isInteger(classId) || !Number.isInteger(sectionId)) {
      res.status(400).json({ error: 'يرجى إدخال اسم الطالب ورقم الاستعلام والصف والشعبة.' });
      return;
    }

    const db = getDb();
    const sec = db
      .prepare('SELECT id FROM sections WHERE id = ? AND class_id = ? AND academic_year_id = ?')
      .get(sectionId, classId, yearId);
    if (!sec) {
      res.status(400).json({ error: 'الشعبة المحددة لا تتبع الصف المختار في هذا العام الدراسي.' });
      return;
    }

    try {
      const info = db
        .prepare(
          'INSERT INTO students (academic_year_id, full_name, inquiry_code, class_id, section_id, is_active, notes) VALUES (?, ?, ?, ?, ?, ?, ?)'
        )
        .run(yearId, fullName, inquiryCode, classId, sectionId, isActive, notes);
      recordAuditLog(req.admin!.username, 'CREATE_STUDENT', 'student', Number(info.lastInsertRowid), `إضافة الطالب: ${fullName}`);
      res.status(201).json({ id: Number(info.lastInsertRowid) });
    } catch (err: any) {
      if (String(err?.message).includes('UNIQUE')) {
        res.status(409).json({ error: 'رقم الاستعلام التعريفي مستخدم لطالب آخر بالفعل في هذا العام الدراسي.' });
        return;
      }
      res.status(500).json({ error: 'تعذر حفظ بيانات الطالب.' });
    }
  });

  app.put('/api/admin/students/:id', requireAdmin, requirePerm('manageStudents'), (req: AdminRequest, res) => {
    const id = Number(req.params.id);
    const fullName = String(req.body?.fullName ?? '').trim();
    const inquiryCode = String(req.body?.inquiryCode ?? '').trim();
    const classId = Number(req.body?.classId);
    const sectionId = Number(req.body?.sectionId);
    const notes = String(req.body?.notes ?? '').trim();
    const isActive = req.body?.isActive !== false ? 1 : 0;

    if (fullName.length < 3 || !inquiryCode || !Number.isInteger(classId) || !Number.isInteger(sectionId)) {
      res.status(400).json({ error: 'بيانات الطالب غير مكتملة.' });
      return;
    }

    const db = getDb();
    const existingStudent = db.prepare('SELECT academic_year_id as academicYearId FROM students WHERE id = ?').get(id) as
      | { academicYearId: number }
      | undefined;
    if (!existingStudent) {
      res.status(404).json({ error: 'الطالب غير موجود.' });
      return;
    }

    const sec = db
      .prepare('SELECT id FROM sections WHERE id = ? AND class_id = ? AND academic_year_id = ?')
      .get(sectionId, classId, existingStudent.academicYearId);
    if (!sec) {
      res.status(400).json({ error: 'الشعبة المحددة لا تتبع الصف المختار.' });
      return;
    }

    try {
      db.prepare(
        `UPDATE students
         SET full_name = ?, inquiry_code = ?, class_id = ?, section_id = ?, is_active = ?, notes = ?, updated_at = datetime('now')
         WHERE id = ?`
      ).run(fullName, inquiryCode, classId, sectionId, isActive, notes, id);
      recordAuditLog(req.admin!.username, 'UPDATE_STUDENT', 'student', id, `تعديل بيانات الطالب: ${fullName}`);
      res.json({ ok: true });
    } catch (err: any) {
      if (String(err?.message).includes('UNIQUE')) {
        res.status(409).json({ error: 'رقم الاستعلام التعريفي مستخدم لطالب آخر في نفس العام الدراسي.' });
        return;
      }
      res.status(500).json({ error: 'تعذر تحديث بيانات الطالب.' });
    }
  });

  app.delete('/api/admin/students/:id', requireAdmin, requirePerm('manageStudents'), (req: AdminRequest, res) => {
    const id = Number(req.params.id);
    const db = getDb();
    const student = db.prepare('SELECT full_name as fullName FROM students WHERE id = ?').get(id) as
      | { fullName: string }
      | undefined;
    if (!student) {
      res.status(404).json({ error: 'الطالب غير موجود.' });
      return;
    }
    db.prepare('DELETE FROM students WHERE id = ?').run(id);
    recordAuditLog(req.admin!.username, 'DELETE_STUDENT', 'student', id, `حذف الطالب: ${student.fullName}`);
    res.json({ ok: true });
  });

  // =========================================================================
  // ACADEMIC YEARS, PROMOTION, CLASSES, SECTIONS, SUBJECTS, EXAMS
  // =========================================================================

  app.get('/api/admin/academic-years', requireAdmin, (_req, res) => {
    res.json({
      academicYears: listAcademicYears(false),
      currentYear: getCurrentAcademicYear(),
    });
  });

  app.post('/api/admin/academic-years', requireAdmin, requireManager, requirePerm('manageStructure'), (req: AdminRequest, res) => {
    const name = String(req.body?.name ?? '').trim();
    const setAsCurrent = Boolean(req.body?.setAsCurrent);
    const cloneFromYearId = req.body?.cloneFromYearId ? Number(req.body.cloneFromYearId) : null;
    const grade6MaxFailSubjects = Math.max(0, Math.min(12, Math.floor(Number(req.body?.grade6MaxFailSubjects ?? 3))));
    const grade6DecisionBonus = Math.max(0, Math.min(50, Number(req.body?.grade6DecisionBonus ?? 10)));
    const exemptionGeneralMinAvg = Math.max(50, Math.min(100, Number(req.body?.exemptionGeneralMinAvg ?? 75)));
    const exemptionMinSubject = Math.max(50, Math.min(100, Number(req.body?.exemptionMinSubject ?? 75)));
    const exemptionIndividualMin = Math.max(50, Math.min(100, Number(req.body?.exemptionIndividualMin ?? 90)));

    if (!name || name.length < 4) {
      res.status(400).json({ error: 'يرجى إدخال اسم العام الدراسي (مثال: 2026 - 2027).' });
      return;
    }

    const db = getDb();
    try {
      let newYearId = 0;
      const tx = db.transaction(() => {
        if (setAsCurrent) {
          db.prepare('UPDATE academic_years SET is_current = 0').run();
          db.prepare(
            "INSERT INTO settings (key, value, updated_at) VALUES ('academicYear', ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')"
          ).run(name);
        }

        const info = db
          .prepare(
            `INSERT INTO academic_years
               (name, is_current, is_active, grade6_max_fail_subjects, grade6_decision_bonus,
                exemption_general_min_avg, exemption_min_subject, exemption_individual_min)
             VALUES (?, ?, 1, ?, ?, ?, ?, ?)`
          )
          .run(
            name,
            setAsCurrent ? 1 : 0,
            grade6MaxFailSubjects,
            grade6DecisionBonus,
            exemptionGeneralMinAvg,
            exemptionMinSubject,
            exemptionIndividualMin
          );
        newYearId = Number(info.lastInsertRowid);

        // Clone structure (sections + subjects + exams) WITHOUT students or grades
        if (cloneFromYearId && getAcademicYearById(cloneFromYearId)) {
          const oldSections = listSections(cloneFromYearId);
          const sectionIdMap = new Map<number, number>();
          const insertSec = db.prepare(
            'INSERT INTO sections (academic_year_id, class_id, name, is_active) VALUES (?, ?, ?, ?)'
          );
          for (const sec of oldSections) {
            const sInfo = insertSec.run(newYearId, sec.classId, sec.name, sec.isActive ? 1 : 0);
            sectionIdMap.set(sec.id, Number(sInfo.lastInsertRowid));
          }

          const oldSubjects = listSubjects(cloneFromYearId);
          const insertSubj = db.prepare(
            'INSERT INTO subjects (academic_year_id, name, max_score, display_order, class_id, section_id, is_active) VALUES (?, ?, ?, ?, ?, ?, ?)'
          );
          for (const sub of oldSubjects) {
            const mappedSecId = sub.sectionId ? sectionIdMap.get(sub.sectionId) ?? null : null;
            insertSubj.run(
              newYearId,
              sub.name,
              sub.maxScore,
              sub.displayOrder,
              sub.classId,
              mappedSecId,
              sub.isActive ? 1 : 0
            );
          }

          const oldExams = listExams(cloneFromYearId);
          const insertExam = db.prepare(
            'INSERT INTO exams (academic_year_id, name, display_order, is_active, academic_year) VALUES (?, ?, ?, ?, ?)'
          );
          for (const ex of oldExams) {
            insertExam.run(newYearId, ex.name, ex.displayOrder, ex.isActive ? 1 : 0, name);
          }
        } else {
          // Seed standard Iraqi exams, sections, and default class subjects cleanly
          const allClasses = listClasses();
          const insertSec = db.prepare(
            'INSERT INTO sections (academic_year_id, class_id, name, is_active) VALUES (?, ?, ?, 1)'
          );
          const insertSubj = db.prepare(
            'INSERT INTO subjects (academic_year_id, name, max_score, display_order, class_id, section_id, is_active) VALUES (?, ?, 100, ?, ?, NULL, 1)'
          );
          for (const cls of allClasses) {
            for (const secName of ['أ', 'ب']) {
              insertSec.run(newYearId, cls.id, secName);
            }
            const curriculum = getDefaultCurriculumForClassName(cls.name);
            curriculum.forEach((subjName, idx) => {
              insertSubj.run(newYearId, subjName, idx + 1, cls.id);
            });
          }

          const defaultExams: Array<[string, number]> = [
            ['الشهر الأول (الفصل الأول)', 1],
            ['الشهر الثاني (الفصل الأول)', 2],
            ['سعي الفصل الأول', 3],
            ['نصف السنة', 4],
            ['الشهر الأول (الفصل الثاني)', 5],
            ['الشهر الثاني (الفصل الثاني)', 6],
            ['سعي الفصل الثاني', 7],
            ['السعي السنوي', 8],
            ['الامتحان النهائي', 9],
            ['الدرجة النهائية', 10],
            ['الدور الثاني', 11],
          ];
          const insertExam = db.prepare(
            'INSERT INTO exams (academic_year_id, name, display_order, is_active, academic_year) VALUES (?, ?, ?, 1, ?)'
          );
          for (const [exName, order] of defaultExams) {
            insertExam.run(newYearId, exName, order, name);
          }
        }
      });
      tx();

      recordAuditLog(
        req.admin!.username,
        'CREATE_ACADEMIC_YEAR',
        'academic_year',
        newYearId,
        `إنشاء عام دراسي مستقل جديد: ${name}`
      );
      res.status(201).json({ academicYear: getAcademicYearById(newYearId) });
    } catch (err: any) {
      if (String(err?.message).includes('UNIQUE')) {
        res.status(409).json({ error: 'يوجد عام دراسي مسجل بهذا الاسم مسبقاً.' });
        return;
      }
      res.status(500).json({ error: 'تعذر إنشاء العام الدراسي الجديد.' });
    }
  });

  app.put('/api/admin/academic-years/:id', requireAdmin, requireManager, requirePerm('manageStructure'), (req: AdminRequest, res) => {
    const id = Number(req.params.id);
    const existing = getAcademicYearById(id);
    if (!existing) {
      res.status(404).json({ error: 'العام الدراسي غير موجود.' });
      return;
    }

    const name = String(req.body?.name ?? existing.name).trim();
    const isCurrent = req.body?.isCurrent !== undefined ? Boolean(req.body.isCurrent) : existing.isCurrent;
    const isActive = req.body?.isActive !== undefined ? Boolean(req.body.isActive) : existing.isActive;
    const grade6MaxFailSubjects =
      req.body?.grade6MaxFailSubjects !== undefined
        ? Math.max(0, Math.min(12, Math.floor(Number(req.body.grade6MaxFailSubjects))))
        : existing.grade6MaxFailSubjects;
    const grade6DecisionBonus =
      req.body?.grade6DecisionBonus !== undefined
        ? Math.max(0, Math.min(50, Number(req.body.grade6DecisionBonus)))
        : existing.grade6DecisionBonus;
    const exemptionGeneralMinAvg =
      req.body?.exemptionGeneralMinAvg !== undefined
        ? Math.max(50, Math.min(100, Number(req.body.exemptionGeneralMinAvg)))
        : existing.exemptionGeneralMinAvg;
    const exemptionMinSubject =
      req.body?.exemptionMinSubject !== undefined
        ? Math.max(50, Math.min(100, Number(req.body.exemptionMinSubject)))
        : existing.exemptionMinSubject;
    const exemptionIndividualMin =
      req.body?.exemptionIndividualMin !== undefined
        ? Math.max(50, Math.min(100, Number(req.body.exemptionIndividualMin)))
        : existing.exemptionIndividualMin;

    if (!name || name.length < 4) {
      res.status(400).json({ error: 'اسم العام الدراسي غير صالح.' });
      return;
    }

    const db = getDb();
    try {
      db.transaction(() => {
        if (isCurrent) {
          db.prepare('UPDATE academic_years SET is_current = 0').run();
          db.prepare(
            "INSERT INTO settings (key, value, updated_at) VALUES ('academicYear', ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')"
          ).run(name);
        }
        db.prepare(
          `UPDATE academic_years
           SET name = ?, is_current = ?, is_active = ?,
               grade6_max_fail_subjects = ?, grade6_decision_bonus = ?,
               exemption_general_min_avg = ?, exemption_min_subject = ?, exemption_individual_min = ?
           WHERE id = ?`
        ).run(
          name,
          isCurrent ? 1 : 0,
          isActive ? 1 : 0,
          grade6MaxFailSubjects,
          grade6DecisionBonus,
          exemptionGeneralMinAvg,
          exemptionMinSubject,
          exemptionIndividualMin,
          id
        );

        if (name !== existing.name) {
          db.prepare('UPDATE exams SET academic_year = ? WHERE academic_year_id = ?').run(name, id);
        }
      })();

      recordAuditLog(
        req.admin!.username,
        'UPDATE_ACADEMIC_YEAR',
        'academic_year',
        id,
        `تحديث إعدادات العام الدراسي (${name}) — التأهيل (${grade6MaxFailSubjects}/${grade6DecisionBonus}) والإعفاء (${exemptionGeneralMinAvg}/${exemptionIndividualMin})`
      );
      res.json({ academicYear: getAcademicYearById(id) });
    } catch {
      res.status(409).json({ error: 'اسم العام الدراسي مستخدم مسبقاً.' });
    }
  });

  app.delete('/api/admin/academic-years/:id', requireAdmin, requireManager, requirePerm('manageStructure'), (req: AdminRequest, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'معرّف العام الدراسي غير صالح.' });
      return;
    }
    const allYears = listAcademicYears(false);
    if (allYears.length <= 1) {
      res.status(400).json({ error: 'لا يمكن حذف آخر عام دراسي متبقٍ في النظام.' });
      return;
    }
    const existing = getAcademicYearById(id);
    if (!existing) {
      res.status(404).json({ error: 'العام الدراسي غير موجود.' });
      return;
    }

    const db = getDb();
    db.transaction(() => {
      db.prepare('DELETE FROM grades WHERE academic_year_id = ?').run(id);
      db.prepare('DELETE FROM grade6_subject_qualifications WHERE academic_year_id = ?').run(id);
      db.prepare('DELETE FROM grade6_overall_qualifications WHERE academic_year_id = ?').run(id);
      db.prepare('DELETE FROM exemptions_subject WHERE academic_year_id = ?').run(id);
      db.prepare('DELETE FROM exemptions_overall WHERE academic_year_id = ?').run(id);
      db.prepare('DELETE FROM grade_objections WHERE academic_year_id = ?').run(id);
      db.prepare('DELETE FROM publish_links WHERE academic_year_id = ?').run(id);
      db.prepare('DELETE FROM teacher_assignments WHERE academic_year_id = ?').run(id);
      db.prepare('DELETE FROM students WHERE academic_year_id = ?').run(id);
      db.prepare('DELETE FROM subjects WHERE academic_year_id = ?').run(id);
      db.prepare('DELETE FROM exams WHERE academic_year_id = ?').run(id);
      db.prepare('DELETE FROM sections WHERE academic_year_id = ?').run(id);
      db.prepare('DELETE FROM academic_years WHERE id = ?').run(id);

      if (existing.isCurrent) {
        const nextCur = db
          .prepare('SELECT id, name FROM academic_years ORDER BY id DESC LIMIT 1')
          .get() as { id: number; name: string } | undefined;
        if (nextCur) {
          db.prepare('UPDATE academic_years SET is_current = 1, is_active = 1 WHERE id = ?').run(nextCur.id);
          db.prepare(
            "INSERT INTO settings (key, value, updated_at) VALUES ('academicYear', ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')"
          ).run(nextCur.name);
        }
      }
    })();

    recordAuditLog(
      req.admin!.username,
      'DELETE_ACADEMIC_YEAR',
      'academic_year',
      id,
      `حذف العام الدراسي بالكامل (${existing.name})`
    );
    triggerAutoBackupSnapshot();
    res.json({ ok: true });
  });

  app.get('/api/admin/academic-years/promote-preview', requireAdmin, requireManager, requirePerm('manageStudents'), (req, res) => {
    const sourceYearId = Number(req.query.sourceYearId);
    const sourceClassId = Number(req.query.sourceClassId);
    const targetYearId = Number(req.query.targetYearId);

    const sourceYear = getAcademicYearById(sourceYearId);
    const targetYear = getAcademicYearById(targetYearId);
    const sourceClass = listClasses().find((c) => c.id === sourceClassId);

    if (!sourceYear || !targetYear || !sourceClass) {
      res.status(400).json({ error: 'يرجى اختيار العام المصدر والصف المصدر والعام الهدف الصحيحين.' });
      return;
    }

    const sourceStudents = listStudents(sourceYearId);
    const sourceSubjects = listSubjects(sourceYearId);
    const sourceExams = listExams(sourceYearId);
    const sourceGrades = listGrades(sourceYearId);
    const sourceSections = new Map(listSections(sourceYearId).map((s) => [s.id, s]));
    const targetYearCodes = new Set(listStudents(targetYearId).map((s) => s.inquiryCode));

    const candidates = evaluatePromotionCandidates({
      sourceStudents,
      sourceClass,
      subjects: sourceSubjects,
      exams: sourceExams,
      grades: sourceGrades,
      targetYearInquiryCodes: targetYearCodes,
      sectionsById: sourceSections,
    });

    res.json({
      sourceYear,
      targetYear,
      sourceClass,
      candidates,
      summary: {
        total: candidates.length,
        eligible: candidates.filter((c) => c.eligible).length,
        passing: candidates.filter((c) => c.standing === 'ناجح').length,
        supplementary: candidates.filter((c) => c.standing === 'مكمل').length,
        failing: candidates.filter((c) => c.standing === 'راسب').length,
        incomplete: candidates.filter((c) => c.standing === 'قيد استكمال العام الدراسي').length,
        alreadyInTarget: candidates.filter((c) => c.alreadyInTargetYear).length,
      },
    });
  });

  app.post('/api/admin/academic-years/promote', requireAdmin, requireManager, requirePerm('manageStudents'), (req: AdminRequest, res) => {
    const sourceYearId = Number(req.body?.sourceYearId);
    const sourceClassId = Number(req.body?.sourceClassId);
    const targetYearId = Number(req.body?.targetYearId);
    const targetClassId = Number(req.body?.targetClassId);
    const targetSectionId = Number(req.body?.targetSectionId);
    const requestedIds = Array.isArray(req.body?.studentIds)
      ? req.body.studentIds.map((x: unknown) => Number(x)).filter((n: number) => Number.isInteger(n) && n > 0)
      : [];

    if (!sourceYearId || !sourceClassId || !targetYearId || !targetClassId || !targetSectionId || requestedIds.length === 0) {
      res.status(400).json({ error: 'يرجى استكمال تحديد العام والصف والشعبة الهدف واختيار الطلبة الناجحين للترحيل.' });
      return;
    }
    if (sourceYearId === targetYearId) {
      res.status(400).json({ error: 'لا يمكن الترحيل إلى نفس العام الدراسي المصدر.' });
      return;
    }

    const db = getDb();
    const targetSec = db
      .prepare('SELECT id FROM sections WHERE id = ? AND class_id = ? AND academic_year_id = ?')
      .get(targetSectionId, targetClassId, targetYearId);
    if (!targetSec) {
      res.status(400).json({ error: 'الشعبة الهدف المحددة لا تتبع الصف الهدف أو العام الدراسي الهدف.' });
      return;
    }

    const sourceClass = listClasses().find((c) => c.id === sourceClassId);
    const targetClass = listClasses().find((c) => c.id === targetClassId);
    if (!sourceClass || !targetClass) {
      res.status(404).json({ error: 'الصف المصدر أو الصف الهدف غير موجود.' });
      return;
    }

    const sourceStudents = listStudents(sourceYearId);
    const sourceSections = new Map(listSections(sourceYearId).map((s) => [s.id, s]));
    const targetYearCodes = new Set(listStudents(targetYearId).map((s) => s.inquiryCode));
    const candidates = evaluatePromotionCandidates({
      sourceStudents,
      sourceClass,
      subjects: listSubjects(sourceYearId),
      exams: listExams(sourceYearId),
      grades: listGrades(sourceYearId),
      targetYearInquiryCodes: targetYearCodes,
      sectionsById: sourceSections,
    });

    const eligibleMap = new Map(candidates.filter((c) => c.eligible).map((c) => [c.studentId, c]));
    const rejected: Array<{ studentId: number; reason: string }> = [];
    const approvedIds: number[] = [];

    for (const sid of requestedIds) {
      if (eligibleMap.has(sid)) {
        approvedIds.push(sid);
      } else {
        const cand = candidates.find((c) => c.studentId === sid);
        rejected.push({
          studentId: sid,
          reason: cand?.reason || 'الطالب غير مؤهل للترحيل (الترحيل محصور بالناجحين فقط).',
        });
      }
    }

    if (approvedIds.length === 0) {
      res.status(400).json({
        error: rejected[0]?.reason || 'لا يوجد طلبة ناجحون مؤهلون للترحيل ضمن التحديد الحالي.',
        rejected,
      });
      return;
    }

    const studentById = new Map(sourceStudents.map((s) => [s.id, s]));
    const insertStu = db.prepare(
      'INSERT INTO students (academic_year_id, full_name, inquiry_code, class_id, section_id, is_active, notes) VALUES (?, ?, ?, ?, ?, 1, ?)'
    );

    let promotedCount = 0;
    db.transaction(() => {
      for (const sid of approvedIds) {
        const st = studentById.get(sid);
        if (!st) continue;
        insertStu.run(targetYearId, st.fullName, st.inquiryCode, targetClassId, targetSectionId, st.notes || '');
        promotedCount += 1;
      }
    })();

    const targetYearObj = getAcademicYearById(targetYearId);
    recordAuditLog(
      req.admin!.username,
      'PROMOTE_STUDENTS',
      'academic_year',
      targetYearId,
      `ترحيل ${promotedCount} طالب ناجح من (${sourceClass.name}) إلى (${targetClass.name}) في العام (${targetYearObj?.name || targetYearId})`
    );

    res.json({
      ok: true,
      promotedCount,
      rejectedCount: rejected.length,
      rejected,
    });
  });

  app.get('/api/admin/structure', requireAdmin, (req, res) => {
    const yearId = resolveAcademicYearId(req.query.yearId);
    res.json({
      classes: listClasses(),
      sections: listSections(yearId),
      subjects: listSubjects(yearId),
      exams: listExams(yearId),
    });
  });

  app.post('/api/admin/classes', requireAdmin, requirePerm('manageStructure'), (req: AdminRequest, res) => {
    const name = String(req.body?.name ?? '').trim();
    const displayOrder = Number(req.body?.displayOrder ?? 1);
    const isMinisterial = name.includes('السادس');
    if (!name) {
      res.status(400).json({ error: 'يرجى إدخال اسم الصف.' });
      return;
    }
    try {
      const info = getDb()
        .prepare('INSERT INTO classes (name, display_order, is_ministerial) VALUES (?, ?, ?)')
        .run(name, Number.isFinite(displayOrder) ? displayOrder : 1, isMinisterial ? 1 : 0);
      recordAuditLog(req.admin!.username, 'CREATE_CLASS', 'class', Number(info.lastInsertRowid), `إضافة الصف: ${name}`);
      res.status(201).json({ id: Number(info.lastInsertRowid) });
    } catch {
      res.status(409).json({ error: 'اسم الصف موجود مسبقاً.' });
    }
  });

  app.put('/api/admin/classes/:id', requireAdmin, requirePerm('manageStructure'), (req: AdminRequest, res) => {
    const id = Number(req.params.id);
    const name = String(req.body?.name ?? '').trim();
    const displayOrder = Number(req.body?.displayOrder ?? 1);
    const isMinisterial = name.includes('السادس');
    if (!name) {
      res.status(400).json({ error: 'يرجى إدخال اسم الصف.' });
      return;
    }
    try {
      getDb()
        .prepare('UPDATE classes SET name = ?, display_order = ?, is_ministerial = ? WHERE id = ?')
        .run(name, Number.isFinite(displayOrder) ? displayOrder : 1, isMinisterial ? 1 : 0, id);
      recordAuditLog(req.admin!.username, 'UPDATE_CLASS', 'class', id, `تعديل الصف: ${name}`);
      res.json({ ok: true });
    } catch {
      res.status(409).json({ error: 'اسم الصف مستخدم مسبقاً.' });
    }
  });

  app.delete('/api/admin/classes/:id', requireAdmin, requirePerm('manageStructure'), (req: AdminRequest, res) => {
    const id = Number(req.params.id);
    const db = getDb();
    const linkedStudents = (db.prepare('SELECT COUNT(*) as c FROM students WHERE class_id = ?').get(id) as { c: number }).c;
    const linkedSections = (db.prepare('SELECT COUNT(*) as c FROM sections WHERE class_id = ?').get(id) as { c: number }).c;
    if (linkedStudents > 0 || linkedSections > 0) {
      res.status(409).json({
        error: `لا يمكن حذف هذا الصف لارتباطه بـ ${linkedSections} شعبة و${linkedStudents} طالب.`,
      });
      return;
    }
    db.prepare('DELETE FROM classes WHERE id = ?').run(id);
    recordAuditLog(req.admin!.username, 'DELETE_CLASS', 'class', id, 'حذف صف دراسي');
    res.json({ ok: true });
  });

  app.post('/api/admin/sections', requireAdmin, requirePerm('manageStructure'), (req: AdminRequest, res) => {
    const yearId = resolveAcademicYearId(req.body?.yearId ?? req.query.yearId);
    const classId = Number(req.body?.classId);
    const name = String(req.body?.name ?? '').trim();
    if (!Number.isInteger(classId) || !name) {
      res.status(400).json({ error: 'يرجى تحديد الصف واسم الشعبة.' });
      return;
    }
    try {
      const info = getDb()
        .prepare('INSERT INTO sections (academic_year_id, class_id, name, is_active) VALUES (?, ?, ?, 1)')
        .run(yearId, classId, name);
      recordAuditLog(req.admin!.username, 'CREATE_SECTION', 'section', Number(info.lastInsertRowid), `إضافة الشعبة: ${name}`);
      res.status(201).json({ id: Number(info.lastInsertRowid) });
    } catch {
      res.status(409).json({ error: 'الشعبة موجودة مسبقاً ضمن هذا الصف في نفس العام الدراسي.' });
    }
  });

  app.put('/api/admin/sections/:id', requireAdmin, requirePerm('manageStructure'), (req: AdminRequest, res) => {
    const id = Number(req.params.id);
    const name = String(req.body?.name ?? '').trim();
    const isActive = req.body?.isActive !== false ? 1 : 0;
    if (!name) {
      res.status(400).json({ error: 'يرجى إدخال اسم الشعبة.' });
      return;
    }
    getDb().prepare('UPDATE sections SET name = ?, is_active = ? WHERE id = ?').run(name, isActive, id);
    recordAuditLog(req.admin!.username, 'UPDATE_SECTION', 'section', id, `تعديل الشعبة: ${name}`);
    res.json({ ok: true });
  });

  app.delete('/api/admin/sections/:id', requireAdmin, requirePerm('manageStructure'), (req: AdminRequest, res) => {
    const id = Number(req.params.id);
    const db = getDb();
    const linked = (db.prepare('SELECT COUNT(*) as c FROM students WHERE section_id = ?').get(id) as { c: number }).c;
    if (linked > 0) {
      res.status(409).json({ error: `لا يمكن حذف الشعبة لوجود ${linked} طالب مسجل فيها.` });
      return;
    }
    db.prepare('DELETE FROM sections WHERE id = ?').run(id);
    recordAuditLog(req.admin!.username, 'DELETE_SECTION', 'section', id, 'حذف شعبة');
    res.json({ ok: true });
  });

  app.post('/api/admin/subjects', requireAdmin, requirePerm('manageStructure'), (req: AdminRequest, res) => {
    const yearId = resolveAcademicYearId(req.body?.yearId ?? req.query.yearId);
    const name = String(req.body?.name ?? '').trim();
    const maxScore = Number(req.body?.maxScore ?? 100);
    const displayOrder = Number(req.body?.displayOrder ?? 1);
    const classId = req.body?.classId ? Number(req.body.classId) : null;
    const sectionId = req.body?.sectionId ? Number(req.body.sectionId) : null;
    if (!name || !Number.isFinite(maxScore) || maxScore <= 0) {
      res.status(400).json({ error: 'يرجى إدخال اسم المادة والنهاية العظمى الصحيحة.' });
      return;
    }
    if (classId) {
      const cls = listClasses().find((c) => c.id === classId);
      if (cls && cls.name.includes('السادس') && name.includes('الحاسوب')) {
        res.status(400).json({ error: 'مواد الصف السادس الإعدادي وزارية ولا تشمل مادة الحاسوب.' });
        return;
      }
    }
    const info = getDb()
      .prepare('INSERT INTO subjects (academic_year_id, name, max_score, display_order, class_id, section_id, is_active) VALUES (?, ?, ?, ?, ?, ?, 1)')
      .run(yearId, name, maxScore, displayOrder, classId, sectionId);
    recordAuditLog(req.admin!.username, 'CREATE_SUBJECT', 'subject', Number(info.lastInsertRowid), `إضافة المادة: ${name}`);
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  });

  app.put('/api/admin/subjects/:id', requireAdmin, requirePerm('manageStructure'), (req: AdminRequest, res) => {
    const id = Number(req.params.id);
    const name = String(req.body?.name ?? '').trim();
    const maxScore = Number(req.body?.maxScore ?? 100);
    const displayOrder = Number(req.body?.displayOrder ?? 1);
    const classId = req.body?.classId ? Number(req.body.classId) : null;
    const sectionId = req.body?.sectionId ? Number(req.body.sectionId) : null;
    const isActive = req.body?.isActive !== false ? 1 : 0;
    if (!name || !Number.isFinite(maxScore) || maxScore <= 0) {
      res.status(400).json({ error: 'بيانات المادة غير صالحة.' });
      return;
    }
    if (classId) {
      const cls = listClasses().find((c) => c.id === classId);
      if (cls && cls.name.includes('السادس') && name.includes('الحاسوب')) {
        res.status(400).json({ error: 'مواد الصف السادس الإعدادي وزارية ولا تشمل مادة الحاسوب.' });
        return;
      }
    }
    getDb()
      .prepare('UPDATE subjects SET name = ?, max_score = ?, display_order = ?, class_id = ?, section_id = ?, is_active = ? WHERE id = ?')
      .run(name, maxScore, displayOrder, classId, sectionId, isActive, id);
    recordAuditLog(req.admin!.username, 'UPDATE_SUBJECT', 'subject', id, `تعديل المادة: ${name}`);
    res.json({ ok: true });
  });

  app.delete('/api/admin/subjects/:id', requireAdmin, requirePerm('manageStructure'), (req: AdminRequest, res) => {
    const id = Number(req.params.id);
    const db = getDb();
    const linked = (db.prepare('SELECT COUNT(*) as c FROM grades WHERE subject_id = ?').get(id) as { c: number }).c;
    if (linked > 0) {
      res.status(409).json({ error: 'لا يمكن حذف المادة لوجود درجات مرتبطة بها. يمكنك تعطيلها بدلاً من الحذف.' });
      return;
    }
    db.prepare('DELETE FROM subjects WHERE id = ?').run(id);
    recordAuditLog(req.admin!.username, 'DELETE_SUBJECT', 'subject', id, 'حذف مادة');
    res.json({ ok: true });
  });

  app.post('/api/admin/exams', requireAdmin, requirePerm('manageStructure'), (req: AdminRequest, res) => {
    const yearId = resolveAcademicYearId(req.body?.yearId ?? req.query.yearId);
    const yearObj = getAcademicYearById(yearId);
    const name = String(req.body?.name ?? '').trim();
    const displayOrder = Number(req.body?.displayOrder ?? 1);
    const academicYear = String(req.body?.academicYear ?? yearObj?.name ?? getSettings().academicYear).trim();
    if (!name) {
      res.status(400).json({ error: 'يرجى إدخال اسم التقييم.' });
      return;
    }
    try {
      const info = getDb()
        .prepare('INSERT INTO exams (academic_year_id, name, display_order, is_active, academic_year) VALUES (?, ?, ?, 1, ?)')
        .run(yearId, name, displayOrder, academicYear);
      recordAuditLog(req.admin!.username, 'CREATE_EXAM', 'exam', Number(info.lastInsertRowid), `إضافة تقييم مستقل: ${name}`);
      res.status(201).json({ id: Number(info.lastInsertRowid) });
    } catch {
      res.status(409).json({ error: 'اسم التقييم موجود مسبقاً في نفس العام الدراسي.' });
    }
  });

  app.put('/api/admin/exams/:id', requireAdmin, requirePerm('manageStructure'), (req: AdminRequest, res) => {
    const id = Number(req.params.id);
    const name = String(req.body?.name ?? '').trim();
    const displayOrder = Number(req.body?.displayOrder ?? 1);
    const academicYear = String(req.body?.academicYear ?? getSettings().academicYear).trim();
    const isActive = req.body?.isActive !== false ? 1 : 0;
    if (!name) {
      res.status(400).json({ error: 'يرجى إدخال اسم التقييم.' });
      return;
    }
    getDb()
      .prepare('UPDATE exams SET name = ?, display_order = ?, academic_year = ?, is_active = ? WHERE id = ?')
      .run(name, displayOrder, academicYear, isActive, id);
    recordAuditLog(req.admin!.username, 'UPDATE_EXAM', 'exam', id, `تعديل التقييم: ${name}`);
    res.json({ ok: true });
  });

  // =========================================================================
  // GRADES MANAGEMENT (Batch, Single, Teacher Scoped, All Sections Support)
  // =========================================================================

  app.get('/api/admin/grades/batch', requireAdmin, (req: AdminRequest, res) => {
    const yearId = resolveAcademicYearId(req.query.yearId);
    const classId = Number(req.query.classId);
    const rawSectionId = String(req.query.sectionId ?? '').trim();
    const isAllSections = rawSectionId === 'all';
    const sectionId = isAllSections ? null : Number(rawSectionId);
    const subjectId = Number(req.query.subjectId);
    const examId = Number(req.query.examId);

    if (!classId || (!isAllSections && !sectionId) || !subjectId || !examId) {
      res.status(400).json({ error: 'يرجى تحديد الصف والشعبة والمادة والامتحان.' });
      return;
    }

    const db = getDb();
    const examRow = db
      .prepare('SELECT id, name FROM exams WHERE id = ? AND academic_year_id = ?')
      .get(examId, yearId) as { id: number; name: string } | undefined;

    if (req.admin!.role === 'teacher') {
      if (examRow && !isTeacherAllowedExamName(examRow.name)) {
        res.status(403).json({
          error: 'غير مخول: حساب المدرس يقتصر على امتحانات الأشهر وسعي الفصل الأول وسعي الفصل الثاني فقط.',
        });
        return;
      }
      const authorized = isTeacherAuthorizedForScope(
        req.admin!.assignments,
        classId,
        sectionId,
        subjectId
      );
      if (!authorized) {
        res.status(403).json({
          error: 'غير مخول: هذه المادة أو الصف أو الشعبة غير مسندة إلى حسابك التدريسي.',
        });
        return;
      }
    }

    const subject = db
      .prepare('SELECT id, name, max_score as maxScore FROM subjects WHERE id = ? AND academic_year_id = ?')
      .get(subjectId, yearId) as { id: number; name: string; maxScore: number } | undefined;

    if (!subject) {
      res.status(404).json({ error: 'المادة غير موجودة في هذا العام الدراسي.' });
      return;
    }

    const rowsRaw = (isAllSections
      ? db
          .prepare(
            `SELECT st.id as studentId, st.full_name as fullName, st.inquiry_code as inquiryCode,
                    sec.name as sectionName,
                    g.id as gradeId, g.score, COALESCE(g.status, 'draft') as status,
                    COALESCE(g.notes, '') as notes, g.updated_by as updatedBy,
                    g.updated_at as updatedAt, g.published_at as publishedAt
             FROM students st
             JOIN sections sec ON sec.id = st.section_id
             LEFT JOIN grades g
               ON g.student_id = st.id AND g.subject_id = ? AND g.exam_id = ? AND g.academic_year_id = ?
             WHERE st.academic_year_id = ? AND st.class_id = ? AND st.is_active = 1`
          )
          .all(subjectId, examId, yearId, yearId, classId)
      : db
          .prepare(
            `SELECT st.id as studentId, st.full_name as fullName, st.inquiry_code as inquiryCode,
                    sec.name as sectionName,
                    g.id as gradeId, g.score, COALESCE(g.status, 'draft') as status,
                    COALESCE(g.notes, '') as notes, g.updated_by as updatedBy,
                    g.updated_at as updatedAt, g.published_at as publishedAt
             FROM students st
             JOIN sections sec ON sec.id = st.section_id
             LEFT JOIN grades g
               ON g.student_id = st.id AND g.subject_id = ? AND g.exam_id = ? AND g.academic_year_id = ?
             WHERE st.academic_year_id = ? AND st.class_id = ? AND st.section_id = ? AND st.is_active = 1`
          )
          .all(subjectId, examId, yearId, yearId, classId, sectionId)) as Array<{ fullName: string }>;

    const rows = sortStudentsAlphabetically(rowsRaw);
    res.json({ subject, rows });
  });

  function syncSecondRoundFinalGrade(
    db: ReturnType<typeof getDb>,
    params: {
      yearId: number;
      studentId: number;
      subjectId: number;
      secondRoundScore: number | null;
      status: GradeStatus;
      publishedAt: string | null;
      actor: string;
    }
  ): void {
    if (params.secondRoundScore === null) return;
    const exams = listExams(params.yearId);
    const annualExam = exams.find((e) => matchIraqiExamSlot(e.name) === 'annualEffort');
    const finalGradeExam = exams.find((e) => matchIraqiExamSlot(e.name) === 'finalGrade');
    if (!annualExam || !finalGradeExam) return;

    const annualRec = db
      .prepare('SELECT score FROM grades WHERE student_id = ? AND subject_id = ? AND exam_id = ? AND academic_year_id = ?')
      .get(params.studentId, params.subjectId, annualExam.id, params.yearId) as { score: number | null } | undefined;
    if (!annualRec || annualRec.score === null) return;

    const newFinal = roundIraqiHalfUp((annualRec.score + params.secondRoundScore) / 2);
    db.prepare(`
      INSERT INTO grades (academic_year_id, student_id, subject_id, exam_id, score, status, notes, updated_by, updated_at, published_at)
      VALUES (?, ?, ?, ?, ?, ?, 'محدث بالدور الثاني', ?, datetime('now'), ?)
      ON CONFLICT(student_id, subject_id, exam_id) DO UPDATE SET
        score = excluded.score,
        status = excluded.status,
        notes = excluded.notes,
        updated_by = excluded.updated_by,
        updated_at = datetime('now'),
        published_at = excluded.published_at
    `).run(
      params.yearId,
      params.studentId,
      params.subjectId,
      finalGradeExam.id,
      newFinal,
      params.status,
      params.actor,
      params.publishedAt
    );
  }

  app.post('/api/admin/grades/save', requireAdmin, requirePerm('manageGrades'), (req: AdminRequest, res) => {
    const yearId = resolveAcademicYearId(req.body?.yearId ?? req.query.yearId);
    const subjectId = Number(req.body?.subjectId);
    const examId = Number(req.body?.examId);
    const entries = Array.isArray(req.body?.entries) ? req.body.entries : [];

    if (!subjectId || !examId || entries.length === 0) {
      res.status(400).json({ error: 'بيانات حفظ الدرجات غير مكتملة.' });
      return;
    }

    const db = getDb();
    const subject = db
      .prepare('SELECT id, name, max_score as maxScore FROM subjects WHERE id = ? AND academic_year_id = ?')
      .get(subjectId, yearId) as { id: number; name: string; maxScore: number } | undefined;
    const exam = db
      .prepare('SELECT id, name FROM exams WHERE id = ? AND academic_year_id = ?')
      .get(examId, yearId) as { id: number; name: string } | undefined;

    if (!subject || !exam) {
      res.status(404).json({ error: 'المادة أو الامتحان غير موجود في هذا العام الدراسي.' });
      return;
    }

    if (req.admin!.role === 'teacher' && !isTeacherAllowedExamName(exam.name)) {
      res.status(403).json({
        error: 'غير مخول: حساب المدرس يقتصر على امتحانات الأشهر وسعي الفصل الأول وسعي الفصل الثاني فقط.',
      });
      return;
    }

    const isSecondRoundExam = matchIraqiExamSlot(exam.name) === 'secondRound';

    const studentsById = new Map<number, { id: number; classId: number; sectionId: number; fullName: string }>();
    for (const s of listStudents(yearId)) {
      studentsById.set(s.id, { id: s.id, classId: s.classId, sectionId: s.sectionId, fullName: s.fullName });
    }

    const errors: string[] = [];
    const validated: Array<{
      studentId: number;
      score: number | null;
      notes: string;
      requestedStatus: GradeStatus;
    }> = [];

    for (const item of entries) {
      const studentId = Number(item.studentId);
      const student = studentsById.get(studentId);
      if (!student) {
        errors.push(`طالب غير موجود في هذا العام الدراسي (#${studentId}).`);
        continue;
      }

      if (
        req.admin!.role === 'teacher' &&
        !isTeacherAuthorizedForScope(req.admin!.assignments, student.classId, student.sectionId, subjectId)
      ) {
        errors.push(`غير مخول برصد درجات الطالب (${student.fullName}) في هذه المادة أو الشعبة.`);
        continue;
      }

      const check = validateScoreInput(item.score, subject.maxScore);
      if (!check.valid) {
        errors.push(`${student.fullName}: ${check.error}`);
        continue;
      }
      const reqStatus = VALID_GRADE_STATUSES.includes(item.status) ? (item.status as GradeStatus) : 'draft';
      if (reqStatus === 'published' && !hasPermission(req.admin!, 'publishGrades')) {
        errors.push('لا تملك صلاحية نشر الدرجات مباشرة.');
        continue;
      }
      validated.push({
        studentId,
        score: check.score,
        notes: String(item.notes ?? '').trim(),
        requestedStatus: reqStatus,
      });
    }

    if (errors.length > 0) {
      res.status(req.admin!.role === 'teacher' && errors[0].startsWith('غير مخول') ? 403 : 400).json({
        error: errors[0],
        errors,
      });
      return;
    }

    let revertedCount = 0;
    const selectExisting = db.prepare(
      'SELECT id, score, status, notes, published_at as publishedAt FROM grades WHERE student_id = ? AND subject_id = ? AND exam_id = ?'
    );
    const upsertGrade = db.prepare(`
      INSERT INTO grades (academic_year_id, student_id, subject_id, exam_id, score, status, notes, updated_by, updated_at, published_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)
      ON CONFLICT(student_id, subject_id, exam_id) DO UPDATE SET
        academic_year_id = excluded.academic_year_id,
        score = excluded.score,
        status = excluded.status,
        notes = excluded.notes,
        updated_by = excluded.updated_by,
        updated_at = datetime('now'),
        published_at = excluded.published_at
    `);

    const tx = db.transaction(() => {
      for (const entry of validated) {
        const prev = selectExisting.get(entry.studentId, subjectId, examId) as
          | { id: number; score: number | null; status: GradeStatus; notes: string; publishedAt: string | null }
          | undefined;

        const resolution = resolveStatusOnGradeEdit(
          prev?.status ?? null,
          prev?.score ?? null,
          prev?.notes ?? '',
          entry.score,
          entry.notes,
          entry.requestedStatus
        );

        if (resolution.revertedFromPublished) {
          revertedCount += 1;
        }

        const publishedAt =
          resolution.status === 'published'
            ? prev?.publishedAt || new Date().toISOString().slice(0, 19).replace('T', ' ')
            : null;

        upsertGrade.run(
          yearId,
          entry.studentId,
          subjectId,
          examId,
          entry.score,
          resolution.status,
          entry.notes,
          req.admin!.username,
          publishedAt
        );

        if (isSecondRoundExam && entry.score !== null) {
          syncSecondRoundFinalGrade(db, {
            yearId,
            studentId: entry.studentId,
            subjectId,
            secondRoundScore: entry.score,
            status: resolution.status,
            publishedAt,
            actor: req.admin!.username,
          });
        }
      }
    });
    tx();

    recordAuditLog(
      req.admin!.username,
      'SAVE_GRADES',
      'exam_subject',
      `${examId}:${subjectId}`,
      `حفظ ${validated.length} درجة لمادة ${subject.name} (${exam.name})${
        revertedCount > 0 ? ` — أُعيدت ${revertedCount} درجة منشورة إلى المسودة بعد تعديلها` : ''
      }`
    );
    triggerAutoBackupSnapshot();

    res.json({ ok: true, savedCount: validated.length, revertedCount });
  });

  app.post('/api/admin/grades/status', requireAdmin, (req: AdminRequest, res) => {
    const yearId = resolveAcademicYearId(req.body?.yearId ?? req.query.yearId);
    const classId = Number(req.body?.classId);
    const rawSectionId = String(req.body?.sectionId ?? '').trim();
    const isAllSections = rawSectionId === 'all';
    const sectionId = isAllSections ? null : Number(rawSectionId);
    const subjectId = Number(req.body?.subjectId);
    const examId = Number(req.body?.examId);
    const targetStatus = req.body?.status as GradeStatus;

    if (!VALID_GRADE_STATUSES.includes(targetStatus)) {
      res.status(400).json({ error: 'حالة الدرجة المطلوبة غير صالحة.' });
      return;
    }

    if (
      (targetStatus === 'published' || targetStatus === 'withdrawn' || targetStatus === 'archived') &&
      !hasPermission(req.admin!, 'publishGrades')
    ) {
      res.status(403).json({ error: 'لا تملك صلاحية نشر أو سحب أو أرشفة النتائج.' });
      return;
    }

    if (!hasPermission(req.admin!, 'manageGrades')) {
      res.status(403).json({ error: 'لا تملك صلاحية إدارة الدرجات.' });
      return;
    }

    const db = getDb();
    const examRow = db
      .prepare('SELECT id, name FROM exams WHERE id = ? AND academic_year_id = ?')
      .get(examId, yearId) as { id: number; name: string } | undefined;

    if (req.admin!.role === 'teacher') {
      if (examRow && !isTeacherAllowedExamName(examRow.name)) {
        res.status(403).json({
          error: 'غير مخول: حساب المدرس يقتصر على امتحانات الأشهر وسعي الفصل الأول وسعي الفصل الثاني فقط.',
        });
        return;
      }
      if (!isTeacherAuthorizedForScope(req.admin!.assignments, classId, sectionId, subjectId)) {
        res.status(403).json({ error: 'غير مخول لتعديل حالة هذه المادة أو الصف.' });
        return;
      }
    }

    const publishedAtExpr = targetStatus === 'published' ? "datetime('now')" : 'NULL';
    const info = isAllSections
      ? db
          .prepare(
            `UPDATE grades
             SET status = ?, updated_by = ?, updated_at = datetime('now'), published_at = ${publishedAtExpr}
             WHERE academic_year_id = ? AND exam_id = ? AND subject_id = ? AND score IS NOT NULL
               AND student_id IN (SELECT id FROM students WHERE academic_year_id = ? AND class_id = ? AND is_active = 1)`
          )
          .run(targetStatus, req.admin!.username, yearId, examId, subjectId, yearId, classId)
      : db
          .prepare(
            `UPDATE grades
             SET status = ?, updated_by = ?, updated_at = datetime('now'), published_at = ${publishedAtExpr}
             WHERE academic_year_id = ? AND exam_id = ? AND subject_id = ? AND score IS NOT NULL
               AND student_id IN (SELECT id FROM students WHERE academic_year_id = ? AND class_id = ? AND section_id = ? AND is_active = 1)`
          )
          .run(targetStatus, req.admin!.username, yearId, examId, subjectId, yearId, classId, sectionId);

    // If publishing/updating Second Round, sync corresponding finalGrade rows
    if (examRow && matchIraqiExamSlot(examRow.name) === 'secondRound') {
      const srRows = isAllSections
        ? (db
            .prepare(
              `SELECT g.student_id as studentId, g.score
               FROM grades g JOIN students st ON st.id = g.student_id
               WHERE g.academic_year_id = ? AND g.exam_id = ? AND g.subject_id = ? AND g.score IS NOT NULL
                 AND st.class_id = ? AND st.is_active = 1`
            )
            .all(yearId, examId, subjectId, classId) as Array<{ studentId: number; score: number }>)
        : (db
            .prepare(
              `SELECT g.student_id as studentId, g.score
               FROM grades g JOIN students st ON st.id = g.student_id
               WHERE g.academic_year_id = ? AND g.exam_id = ? AND g.subject_id = ? AND g.score IS NOT NULL
                 AND st.class_id = ? AND st.section_id = ? AND st.is_active = 1`
            )
            .all(yearId, examId, subjectId, classId, sectionId) as Array<{ studentId: number; score: number }>);
      const pubTime = targetStatus === 'published' ? new Date().toISOString().slice(0, 19).replace('T', ' ') : null;
      db.transaction(() => {
        for (const sr of srRows) {
          syncSecondRoundFinalGrade(db, {
            yearId,
            studentId: sr.studentId,
            subjectId,
            secondRoundScore: sr.score,
            status: targetStatus,
            publishedAt: pubTime,
            actor: req.admin!.username,
          });
        }
      })();
    }

    recordAuditLog(
      req.admin!.username,
      'BATCH_GRADE_STATUS',
      'exam_subject',
      `${examId}:${subjectId}`,
      `تغيير حالة ${info.changes} درجة إلى "${targetStatus}"`
    );
    triggerAutoBackupSnapshot();

    res.json({ ok: true, updatedCount: info.changes });
  });

  app.post('/api/admin/grades/publish-all-subjects', requireAdmin, requireManager, requirePerm('publishGrades'), (req: AdminRequest, res) => {
    const yearId = resolveAcademicYearId(req.body?.yearId ?? req.query.yearId);
    const classId = Number(req.body?.classId);
    const rawSectionId = String(req.body?.sectionId ?? 'all').trim();
    const isAllSections = rawSectionId === 'all' || !rawSectionId;
    const sectionId = isAllSections ? null : Number(rawSectionId);
    const examId = Number(req.body?.examId);
    const targetStatus: GradeStatus = req.body?.status === 'withdrawn' ? 'withdrawn' : 'published';

    if (!Number.isInteger(classId) || classId <= 0 || !Number.isInteger(examId) || examId <= 0) {
      res.status(400).json({ error: 'يرجى تحديد الصف والامتحان الصحيحين.' });
      return;
    }

    const db = getDb();
    const publishedAtExpr = targetStatus === 'published' ? "datetime('now')" : 'NULL';
    const info = isAllSections
      ? db
          .prepare(
            `UPDATE grades
             SET status = ?, updated_by = ?, updated_at = datetime('now'), published_at = ${publishedAtExpr}
             WHERE academic_year_id = ? AND exam_id = ? AND score IS NOT NULL
               AND student_id IN (SELECT id FROM students WHERE academic_year_id = ? AND class_id = ? AND is_active = 1)`
          )
          .run(targetStatus, req.admin!.username, yearId, examId, yearId, classId)
      : db
          .prepare(
            `UPDATE grades
             SET status = ?, updated_by = ?, updated_at = datetime('now'), published_at = ${publishedAtExpr}
             WHERE academic_year_id = ? AND exam_id = ? AND score IS NOT NULL
               AND student_id IN (SELECT id FROM students WHERE academic_year_id = ? AND class_id = ? AND section_id = ? AND is_active = 1)`
          )
          .run(targetStatus, req.admin!.username, yearId, examId, yearId, classId, sectionId);

    const subjectCountRow = (
      isAllSections
        ? db
            .prepare(
              `SELECT COUNT(DISTINCT subject_id) as c FROM grades
               WHERE academic_year_id = ? AND exam_id = ? AND score IS NOT NULL
                 AND student_id IN (SELECT id FROM students WHERE academic_year_id = ? AND class_id = ? AND is_active = 1)`
            )
            .get(yearId, examId, yearId, classId)
        : db
            .prepare(
              `SELECT COUNT(DISTINCT subject_id) as c FROM grades
               WHERE academic_year_id = ? AND exam_id = ? AND score IS NOT NULL
                 AND student_id IN (SELECT id FROM students WHERE academic_year_id = ? AND class_id = ? AND section_id = ? AND is_active = 1)`
            )
            .get(yearId, examId, yearId, classId, sectionId)
    ) as { c: number };

    recordAuditLog(
      req.admin!.username,
      'PUBLISH_ALL_SUBJECTS',
      'exam_class',
      `${examId}:${classId}`,
      `${targetStatus === 'published' ? 'نشر' : 'سحب'} جميع المواد (${subjectCountRow.c} مادة / ${info.changes} درجة)`
    );
    triggerAutoBackupSnapshot();

    res.json({
      ok: true,
      updatedCount: info.changes,
      subjectCount: subjectCountRow.c,
    });
  });

  app.post('/api/admin/grades/calculate-efforts', requireAdmin, requireManager, requirePerm('manageGrades'), (req: AdminRequest, res) => {
    const yearId = resolveAcademicYearId(req.body?.yearId ?? req.query.yearId);
    const validTargets: EffortCalculationTarget[] = [
      'sem1Average',
      'sem2Average',
      'annualEffort',
      'finalGrade',
      'all',
    ];
    const target: EffortCalculationTarget = validTargets.includes(req.body?.target)
      ? req.body.target
      : 'all';
    const classId = Number(req.body?.classId);
    const rawSectionId = String(req.body?.sectionId ?? 'all').trim();
    const isAllSections = !rawSectionId || rawSectionId === 'all';
    const sectionId = isAllSections ? null : Number(rawSectionId);
    const rawSubjectId = String(req.body?.subjectId ?? 'all').trim();
    const isAllSubjects = !rawSubjectId || rawSubjectId === 'all';
    const subjectId = isAllSubjects ? null : Number(rawSubjectId);
    const requirePublishedComponents = Boolean(req.body?.requirePublishedComponents);
    const requestedStatus: GradeStatus =
      req.body?.targetStatus === 'published' && hasPermission(req.admin!, 'publishGrades')
        ? 'published'
        : 'draft';

    if (!Number.isInteger(classId) || classId <= 0) {
      res.status(400).json({ error: 'يرجى تحديد الصف الدراسي لاحتساب السعي.' });
      return;
    }

    const scopedStudents = listStudents(yearId).filter(
      (st) => st.isActive && st.classId === classId && (sectionId === null || st.sectionId === sectionId)
    );
    const scopedSubjects = listSubjects(yearId).filter(
      (sub) =>
        sub.isActive &&
        (sub.classId === null || sub.classId === classId) &&
        (subjectId === null || sub.id === subjectId)
    );
    const activeExams = listExams(yearId).filter((ex) => ex.isActive);
    const allGrades = listGrades(yearId);

    const calc = computeEffortCalculations({
      target,
      students: scopedStudents,
      subjects: scopedSubjects,
      exams: activeExams,
      grades: allGrades,
      requirePublishedComponents,
    });

    const publishedAtValue =
      requestedStatus === 'published' ? new Date().toISOString().slice(0, 19).replace('T', ' ') : null;

    const db = getDb();
    const upsertStmt = db.prepare(`
      INSERT INTO grades (academic_year_id, student_id, subject_id, exam_id, score, status, notes, updated_by, updated_at, published_at)
      VALUES (?, ?, ?, ?, ?, ?, '', ?, datetime('now'), ?)
      ON CONFLICT(student_id, subject_id, exam_id) DO UPDATE SET
        academic_year_id = excluded.academic_year_id,
        score = excluded.score,
        status = excluded.status,
        updated_by = excluded.updated_by,
        updated_at = datetime('now'),
        published_at = excluded.published_at
    `);

    const tx = db.transaction(() => {
      for (const entry of calc.entries) {
        upsertStmt.run(
          yearId,
          entry.studentId,
          entry.subjectId,
          entry.examId,
          entry.score,
          requestedStatus,
          req.admin!.username,
          publishedAtValue
        );
      }
    });
    tx();

    recordAuditLog(
      req.admin!.username,
      'CALCULATE_EFFORTS',
      'exam_class',
      `${classId}:${target}`,
      `احتساب تلقائي بأمر المدير (${calc.targetExamNames.join('، ')}) — تم حساب ${calc.entries.length} درجة، غير مكتمل: ${calc.skippedIncompleteCount}`
    );

    res.json({
      ok: true,
      calculatedCount: calc.entries.length,
      skippedIncompleteCount: calc.skippedIncompleteCount,
      targetExamNames: calc.targetExamNames,
      status: requestedStatus,
    });
  });

  // =========================================================================
  // GRADE 6 MINISTERIAL QUALIFICATION (Manager-Only Manual / Import / Approved Calc)
  // =========================================================================

  app.get('/api/admin/grade6-qualification', requireAdmin, requireManager, (req, res) => {
    const yearId = resolveAcademicYearId(req.query.yearId);
    const yearObj = getAcademicYearById(yearId) ?? getCurrentAcademicYear();
    const classId = Number(req.query.classId);
    const rawSectionId = String(req.query.sectionId ?? 'all').trim();
    const sectionId = rawSectionId && rawSectionId !== 'all' ? Number(rawSectionId) : null;

    if (!Number.isInteger(classId) || classId <= 0) {
      res.status(400).json({ error: 'يرجى تحديد الصف الدراسي.' });
      return;
    }

    const classInfo = listClasses().find((c) => c.id === classId) ?? null;
    if (!classInfo) {
      res.status(404).json({ error: 'الصف غير موجود.' });
      return;
    }

    const scopedStudents = listStudents(yearId).filter(
      (st) => st.isActive && st.classId === classId && (sectionId === null || st.sectionId === sectionId)
    );
    const scopedSubjects = listSubjects(yearId).filter(
      (sub) =>
        sub.isActive &&
        (sub.classId === null || sub.classId === classId) &&
        (sectionId === null || sub.sectionId === null || sub.sectionId === sectionId) &&
        !isSubjectExcludedForClass(sub.name, classInfo.name, classInfo.isMinisterial)
    );
    const annualEffortExam = listExams(yearId).find((e) => e.name.trim() === 'السعي السنوي') ?? null;
    const annualGrades = annualEffortExam
      ? listGrades(yearId).filter((g) => g.examId === annualEffortExam.id && g.score !== null)
      : [];
    const annualScoreByKey = new Map<string, number>();
    for (const g of annualGrades) {
      if (g.score !== null) annualScoreByKey.set(`${g.studentId}:${g.subjectId}`, g.score);
    }

    const subjectQuals = listGrade6SubjectQualifications(yearId);
    const overallQuals = listGrade6OverallQualifications(yearId);

    const subjQualByKey = new Map(subjectQuals.map((q) => [`${q.studentId}:${q.subjectId}`, q]));
    const overallQualByStudent = new Map(overallQuals.map((q) => [q.studentId, q]));

    const rows = scopedStudents.map((st, idx) => {
      const annualEffortBySubject: Record<number, number | null> = {};
      const subjectQualificationBySubject: Record<
        number,
        {
          decision: MinisterialDecision | null;
          decisionSource: string;
          bonusApplied: number;
          status: 'draft' | 'published';
          notes: string;
        }
      > = {};

      for (const sub of scopedSubjects) {
        annualEffortBySubject[sub.id] = annualScoreByKey.get(`${st.id}:${sub.id}`) ?? null;
        const sq = subjQualByKey.get(`${st.id}:${sub.id}`);
        subjectQualificationBySubject[sub.id] = sq
          ? {
              decision: sq.decision,
              decisionSource: sq.decisionSource,
              bonusApplied: sq.bonusApplied,
              status: sq.status,
              notes: sq.notes,
            }
          : {
              decision: null,
              decisionSource: 'manual',
              bonusApplied: 0,
              status: 'draft',
              notes: '',
            };
      }

      const oq = overallQualByStudent.get(st.id);
      return {
        sequence: idx + 1,
        studentId: st.id,
        fullName: st.fullName,
        inquiryCode: st.inquiryCode,
        sectionName: st.sectionName || '',
        annualEffortBySubject,
        subjectQualificationBySubject,
        overallQualification: oq
          ? {
              decision: oq.decision,
              decisionSource: oq.decisionSource,
              bonusUsed: oq.bonusUsed,
              maxFailSubjects: oq.maxFailSubjects,
              decisionBonusLimit: oq.decisionBonusLimit,
              status: oq.status,
              notes: oq.notes,
            }
          : {
              decision: null,
              decisionSource: 'manual',
              bonusUsed: 0,
              maxFailSubjects: yearObj.grade6MaxFailSubjects,
              decisionBonusLimit: yearObj.grade6DecisionBonus,
              status: 'draft' as const,
              notes: '',
            },
      };
    });

    res.json({
      academicYear: yearObj,
      classInfo,
      subjects: scopedSubjects,
      rows,
    });
  });

  app.post('/api/admin/grade6-qualification/save', requireAdmin, requireManager, requirePerm('manageGrades'), (req: AdminRequest, res) => {
    const yearId = resolveAcademicYearId(req.body?.yearId ?? req.query.yearId);
    const yearObj = getAcademicYearById(yearId) ?? getCurrentAcademicYear();
    const entries = Array.isArray(req.body?.entries) ? req.body.entries : [];
    const requestedStatus: 'draft' | 'published' =
      req.body?.status === 'published' && hasPermission(req.admin!, 'publishGrades') ? 'published' : 'draft';

    if (req.body?.status === 'published' && !hasPermission(req.admin!, 'publishGrades')) {
      res.status(403).json({ error: 'لا تملك صلاحية نشر نتائج التأهيل الوزاري.' });
      return;
    }

    if (entries.length === 0) {
      res.status(400).json({ error: 'لا توجد بيانات تأهيل للحفظ.' });
      return;
    }

    const validStudentIds = new Set(listStudents(yearId).map((s) => s.id));
    const validSubjectIds = new Set(listSubjects(yearId).map((s) => s.id));
    const publishedAtVal =
      requestedStatus === 'published' ? new Date().toISOString().slice(0, 19).replace('T', ' ') : null;

    const db = getDb();
    const upsertSubjStmt = db.prepare(`
      INSERT INTO grade6_subject_qualifications
        (academic_year_id, student_id, subject_id, decision, decision_source, bonus_applied, status, notes, updated_by, updated_at, published_at)
      VALUES (?, ?, ?, ?, 'manual', 0, ?, ?, ?, datetime('now'), ?)
      ON CONFLICT(academic_year_id, student_id, subject_id) DO UPDATE SET
        decision = excluded.decision,
        decision_source = 'manual',
        status = excluded.status,
        notes = excluded.notes,
        updated_by = excluded.updated_by,
        updated_at = datetime('now'),
        published_at = excluded.published_at
    `);
    const deleteSubjStmt = db.prepare(
      'DELETE FROM grade6_subject_qualifications WHERE academic_year_id = ? AND student_id = ? AND subject_id = ?'
    );
    const upsertOverallStmt = db.prepare(`
      INSERT INTO grade6_overall_qualifications
        (academic_year_id, student_id, decision, decision_source, bonus_used, max_fail_subjects, decision_bonus_limit, status, notes, updated_by, updated_at, published_at)
      VALUES (?, ?, ?, 'manual', 0, ?, ?, ?, ?, ?, datetime('now'), ?)
      ON CONFLICT(academic_year_id, student_id) DO UPDATE SET
        decision = excluded.decision,
        decision_source = 'manual',
        max_fail_subjects = excluded.max_fail_subjects,
        decision_bonus_limit = excluded.decision_bonus_limit,
        status = excluded.status,
        notes = excluded.notes,
        updated_by = excluded.updated_by,
        updated_at = datetime('now'),
        published_at = excluded.published_at
    `);
    const deleteOverallStmt = db.prepare(
      'DELETE FROM grade6_overall_qualifications WHERE academic_year_id = ? AND student_id = ?'
    );

    let savedSubjects = 0;
    let savedOverall = 0;
    const tx = db.transaction(() => {
      for (const entry of entries) {
        const studentId = Number(entry.studentId);
        if (!validStudentIds.has(studentId)) continue;

        if (Array.isArray(entry.subjectDecisions)) {
          for (const sd of entry.subjectDecisions) {
            const subjectId = Number(sd.subjectId);
            if (!validSubjectIds.has(subjectId)) continue;
            const dec = sd.decision === 'qualified' || sd.decision === 'not_qualified' ? sd.decision : null;
            if (dec === null) {
              deleteSubjStmt.run(yearId, studentId, subjectId);
            } else {
              upsertSubjStmt.run(
                yearId,
                studentId,
                subjectId,
                dec,
                requestedStatus,
                String(sd.notes ?? '').trim(),
                req.admin!.username,
                publishedAtVal
              );
              savedSubjects += 1;
            }
          }
        }

        if (entry.overallDecision !== undefined) {
          const overallDec =
            entry.overallDecision === 'qualified' || entry.overallDecision === 'not_qualified'
              ? entry.overallDecision
              : null;
          if (overallDec === null) {
            deleteOverallStmt.run(yearId, studentId);
          } else {
            upsertOverallStmt.run(
              yearId,
              studentId,
              overallDec,
              yearObj.grade6MaxFailSubjects,
              yearObj.grade6DecisionBonus,
              requestedStatus,
              String(entry.overallNotes ?? '').trim(),
              req.admin!.username,
              publishedAtVal
            );
            savedOverall += 1;
          }
        }
      }
    });
    tx();

    recordAuditLog(
      req.admin!.username,
      'SAVE_GRADE6_QUALIFICATION',
      'academic_year',
      yearId,
      `حفظ التأهيل الوزاري للسادس يدوياً (${savedSubjects} مادة، ${savedOverall} قرار عام — الحالة: ${requestedStatus})`
    );
    res.json({ ok: true, savedSubjects, savedOverall, status: requestedStatus });
  });

  app.post('/api/admin/grade6-qualification/calculate', requireAdmin, requireManager, requirePerm('manageGrades'), (req: AdminRequest, res) => {
    const yearId = resolveAcademicYearId(req.body?.yearId ?? req.query.yearId);
    const yearObj = getAcademicYearById(yearId) ?? getCurrentAcademicYear();
    const classId = Number(req.body?.classId);
    const rawSectionId = String(req.body?.sectionId ?? 'all').trim();
    const sectionId = rawSectionId && rawSectionId !== 'all' ? Number(rawSectionId) : null;
    const requestedStatus: 'draft' | 'published' =
      req.body?.targetStatus === 'published' && hasPermission(req.admin!, 'publishGrades') ? 'published' : 'draft';

    if (req.body?.targetStatus === 'published' && !hasPermission(req.admin!, 'publishGrades')) {
      res.status(403).json({ error: 'لا تملك صلاحية نشر التأهيل الوزاري مباشرة.' });
      return;
    }

    if (!Number.isInteger(classId) || classId <= 0) {
      res.status(400).json({ error: 'يرجى تحديد الصف الدراسي لاحتساب التأهيل الوزاري.' });
      return;
    }

    const classInfo = listClasses().find((c) => c.id === classId) ?? null;
    const scopedStudents = listStudents(yearId).filter(
      (st) => st.isActive && st.classId === classId && (sectionId === null || st.sectionId === sectionId)
    );
    const scopedSubjects = listSubjects(yearId).filter(
      (sub) =>
        sub.isActive &&
        (sub.classId === null || sub.classId === classId) &&
        (sectionId === null || sub.sectionId === null || sub.sectionId === sectionId) &&
        !isSubjectExcludedForClass(sub.name, classInfo?.name, classInfo?.isMinisterial ?? true)
    );
    const annualEffortExam = listExams(yearId).find((e) => e.name.trim() === 'السعي السنوي') ?? null;
    if (!annualEffortExam) {
      res.status(400).json({ error: 'امتحان «السعي السنوي» غير معرف في هذا العام الدراسي.' });
      return;
    }

    const annualGrades = listGrades(yearId).filter((g) => g.examId === annualEffortExam.id && g.score !== null);
    const scoreByStudentSubject = new Map<string, number>();
    for (const g of annualGrades) {
      if (g.score !== null) scoreByStudentSubject.set(`${g.studentId}:${g.subjectId}`, g.score);
    }

    const publishedAtVal =
      requestedStatus === 'published' ? new Date().toISOString().slice(0, 19).replace('T', ' ') : null;
    const db = getDb();
    const upsertSubjStmt = db.prepare(`
      INSERT INTO grade6_subject_qualifications
        (academic_year_id, student_id, subject_id, decision, decision_source, bonus_applied, status, notes, updated_by, updated_at, published_at)
      VALUES (?, ?, ?, ?, 'approved_calculation', ?, ?, '', ?, datetime('now'), ?)
      ON CONFLICT(academic_year_id, student_id, subject_id) DO UPDATE SET
        decision = excluded.decision,
        decision_source = 'approved_calculation',
        bonus_applied = excluded.bonus_applied,
        status = excluded.status,
        updated_by = excluded.updated_by,
        updated_at = datetime('now'),
        published_at = excluded.published_at
    `);
    const upsertOverallStmt = db.prepare(`
      INSERT INTO grade6_overall_qualifications
        (academic_year_id, student_id, decision, decision_source, bonus_used, max_fail_subjects, decision_bonus_limit, status, notes, updated_by, updated_at, published_at)
      VALUES (?, ?, ?, 'approved_calculation', ?, ?, ?, ?, ?, ?, datetime('now'), ?)
      ON CONFLICT(academic_year_id, student_id) DO UPDATE SET
        decision = excluded.decision,
        decision_source = 'approved_calculation',
        bonus_used = excluded.bonus_used,
        max_fail_subjects = excluded.max_fail_subjects,
        decision_bonus_limit = excluded.decision_bonus_limit,
        status = excluded.status,
        notes = excluded.notes,
        updated_by = excluded.updated_by,
        updated_at = datetime('now'),
        published_at = excluded.published_at
    `);

    let qualifiedCount = 0;
    let notQualifiedCount = 0;
    let incompleteCount = 0;

    const tx = db.transaction(() => {
      for (const st of scopedStudents) {
        const studentSubjects = scopedSubjects.filter(
          (sub) => sub.sectionId === null || sub.sectionId === st.sectionId
        );
        const effortMap = new Map<number, number>();
        for (const sub of studentSubjects) {
          const val = scoreByStudentSubject.get(`${st.id}:${sub.id}`);
          if (val !== undefined) effortMap.set(sub.id, val);
        }

        const evalRes = evaluateIraqiGrade6Qualification({
          subjects: studentSubjects,
          annualEffortBySubjectId: effortMap,
          maxFailSubjects: yearObj.grade6MaxFailSubjects,
          decisionBonus: yearObj.grade6DecisionBonus,
        });

        for (const sd of evalRes.subjectDecisions) {
          if (!sd.decision) continue;
          upsertSubjStmt.run(
            yearId,
            st.id,
            sd.subjectId,
            sd.decision,
            sd.bonusApplied,
            requestedStatus,
            req.admin!.username,
            publishedAtVal
          );
        }

        if (evalRes.overallDecision === null) {
          incompleteCount += 1;
        } else {
          if (evalRes.overallDecision === 'qualified') qualifiedCount += 1;
          else notQualifiedCount += 1;
          const noteSummary =
            evalRes.bonusUsed > 0 ? `استفاد من ${evalRes.bonusUsed} درجة قرار وزاري` : '';
          upsertOverallStmt.run(
            yearId,
            st.id,
            evalRes.overallDecision,
            evalRes.bonusUsed,
            yearObj.grade6MaxFailSubjects,
            yearObj.grade6DecisionBonus,
            requestedStatus,
            noteSummary,
            req.admin!.username,
            publishedAtVal
          );
        }
      }
    });
    tx();

    recordAuditLog(
      req.admin!.username,
      'CALCULATE_GRADE6_QUALIFICATION',
      'exam_class',
      `${yearId}:${classId}`,
      `احتساب التأهيل الوزاري للسادس بأمر المدير (ضابط ${yearObj.grade6MaxFailSubjects} دروس + ${yearObj.grade6DecisionBonus} درجات): مؤهل ${qualifiedCount}، غير مؤهل ${notQualifiedCount}، غير مكتمل ${incompleteCount}`
    );

    res.json({
      ok: true,
      processedCount: scopedStudents.length,
      qualifiedCount,
      notQualifiedCount,
      incompleteCount,
      status: requestedStatus,
    });
  });

  app.get('/api/admin/export/template/grade6-qualification', requireAdmin, requireManager, (req, res) => {
    const yearId = resolveAcademicYearId(req.query.yearId);
    const classId = req.query.classId ? Number(req.query.classId) : null;
    const rawSectionId = String(req.query.sectionId ?? 'all').trim();
    const sectionId = rawSectionId && rawSectionId !== 'all' ? Number(rawSectionId) : null;

    const clsObj = classId ? listClasses().find((c) => c.id === classId) : undefined;
    const scopedStudents = sortStudentsAlphabetically(
      listStudents(yearId).filter(
        (st) => st.isActive && (!classId || st.classId === classId) && (!sectionId || st.sectionId === sectionId)
      )
    );
    const scopedSubjects = listSubjects(yearId).filter(
      (sub) =>
        sub.isActive &&
        (!classId || sub.classId === null || sub.classId === classId) &&
        (!sectionId || sub.sectionId === null || sub.sectionId === sectionId) &&
        !isSubjectExcludedForClass(sub.name, clsObj?.name, clsObj ? clsObj.isMinisterial : true)
    );
    const fallbackClassName =
      (classId ? listClasses().find((c) => c.id === classId)?.name : undefined) || 'السادس العلمي';
    const fallbackSectionName =
      (sectionId ? listSections(yearId).find((s) => s.id === sectionId)?.name : undefined) || 'أ';

    const subjectQuals = listGrade6SubjectQualifications(yearId);
    const overallQuals = listGrade6OverallQualifications(yearId);
    const subjMap = new Map(subjectQuals.map((q) => [`${q.studentId}:${q.subjectId}`, q.decision]));
    const overallMap = new Map(overallQuals.map((q) => [q.studentId, q.decision]));

    const sourceList =
      scopedStudents.length > 0
        ? scopedStudents
        : [
            {
              id: 0,
              fullName: 'حيدر علي حسين الكعبي',
              inquiryCode: '2026101',
              className: fallbackClassName,
              sectionName: fallbackSectionName,
            },
          ];

    const exams = listExams(yearId);
    const annualExamId = exams.find((e) => matchIraqiExamSlot(e.name) === 'annualEffort')?.id;
    const annualByStudentSubj = new Map<string, number>();
    if (annualExamId) {
      for (const g of listGrades(yearId)) {
        if (g.examId === annualExamId && g.score !== null) {
          annualByStudentSubj.set(`${g.studentId}:${g.subjectId}`, roundIraqiHalfUp(g.score));
        }
      }
    }

    const sheetRows = sourceList.map((st, idx) => {
      const row: Record<string, string | number> = {
        'ت': idx + 1,
        'اسم الطالب': st.fullName,
        'رقم الهوية الوطنية': st.inquiryCode,
        'الصف': st.className || fallbackClassName,
        'الشعبة': st.sectionName || fallbackSectionName,
      };
      for (const sub of scopedSubjects) {
        const eff = st.id ? annualByStudentSubj.get(`${st.id}:${sub.id}`) : undefined;
        row[`سعي - ${sub.name}`] = eff !== undefined ? eff : '—';
        const d = st.id ? subjMap.get(`${st.id}:${sub.id}`) : null;
        row[sub.name] = d === 'qualified' ? 'مؤهل' : d === 'not_qualified' ? 'غير مؤهل' : '';
      }
      const od = st.id ? overallMap.get(st.id) : null;
      row['التأهيل الوزاري العام'] =
        od === 'qualified' ? 'مؤهل' : od === 'not_qualified' ? 'غير مؤهل' : '';
      return row;
    });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(sheetRows);
    applyArabicSheetLayout(wb, ws, sheetRows);
    XLSX.utils.book_append_sheet(wb, ws, 'تأهيل السادس الوزاري');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    const yearObj = getAcademicYearById(yearId) ?? getCurrentAcademicYear();
    const fname = buildScopedArabicFilename({
      prefix: 'قالب_تأهيل_السادس',
      academicYear: yearObj.name,
      className: fallbackClassName,
      sectionName: sectionId ? fallbackSectionName : 'جميع_الشعب',
      ext: 'xlsx',
    });
    sendAttachmentBuffer(
      res,
      buf,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      fname,
      'grade6_qualification_template.xlsx'
    );
  });

  app.post('/api/admin/grade6-qualification/import-preview', requireAdmin, requireManager, requirePerm('manageImportExport'), (req, res) => {
    const yearId = resolveAcademicYearId(req.body?.yearId ?? req.query.yearId);
    const classId = req.body?.classId ? Number(req.body.classId) : null;
    const rawSectionId = String(req.body?.sectionId ?? 'all').trim();
    const sectionId = rawSectionId && rawSectionId !== 'all' ? Number(rawSectionId) : null;
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];

    const clsObj = classId ? listClasses().find((c) => c.id === classId) : undefined;
    const scopedStudents = listStudents(yearId).filter(
      (st) => st.isActive && (!classId || st.classId === classId) && (!sectionId || st.sectionId === sectionId)
    );
    const scopedSubjects = listSubjects(yearId).filter(
      (sub) =>
        sub.isActive &&
        (!classId || sub.classId === null || sub.classId === classId) &&
        !isSubjectExcludedForClass(sub.name, clsObj?.name, clsObj ? clsObj.isMinisterial : true)
    );
    const preview = validateGrade6QualificationImportRows(rows, scopedStudents, scopedSubjects);
    res.json(preview);
  });

  app.post('/api/admin/grade6-qualification/import-commit', requireAdmin, requireManager, requirePerm('manageImportExport'), (req: AdminRequest, res) => {
    const yearId = resolveAcademicYearId(req.body?.yearId ?? req.query.yearId);
    const yearObj = getAcademicYearById(yearId) ?? getCurrentAcademicYear();
    const classId = req.body?.classId ? Number(req.body.classId) : null;
    const rawSectionId = String(req.body?.sectionId ?? 'all').trim();
    const sectionId = rawSectionId && rawSectionId !== 'all' ? Number(rawSectionId) : null;
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    const requestedStatus: 'draft' | 'published' =
      req.body?.targetStatus === 'published' && hasPermission(req.admin!, 'publishGrades') ? 'published' : 'draft';

    if (req.body?.targetStatus === 'published' && !hasPermission(req.admin!, 'publishGrades')) {
      res.status(403).json({ error: 'لا تملك صلاحية نشر نتائج التأهيل الوزاري.' });
      return;
    }

    const clsObj = classId ? listClasses().find((c) => c.id === classId) : undefined;
    const scopedStudents = listStudents(yearId).filter(
      (st) => st.isActive && (!classId || st.classId === classId) && (!sectionId || st.sectionId === sectionId)
    );
    const scopedSubjects = listSubjects(yearId).filter(
      (sub) =>
        sub.isActive &&
        (!classId || sub.classId === null || sub.classId === classId) &&
        !isSubjectExcludedForClass(sub.name, clsObj?.name, clsObj ? clsObj.isMinisterial : true)
    );
    const preview = validateGrade6QualificationImportRows(rows, scopedStudents, scopedSubjects);
    const validRows = preview.rows.filter((r) => r.valid && r.normalized);

    const publishedAtVal =
      requestedStatus === 'published' ? new Date().toISOString().slice(0, 19).replace('T', ' ') : null;
    const db = getDb();
    const upsertSubjStmt = db.prepare(`
      INSERT INTO grade6_subject_qualifications
        (academic_year_id, student_id, subject_id, decision, decision_source, bonus_applied, status, notes, updated_by, updated_at, published_at)
      VALUES (?, ?, ?, ?, 'import', 0, ?, '', ?, datetime('now'), ?)
      ON CONFLICT(academic_year_id, student_id, subject_id) DO UPDATE SET
        decision = excluded.decision,
        decision_source = 'import',
        status = excluded.status,
        updated_by = excluded.updated_by,
        updated_at = datetime('now'),
        published_at = excluded.published_at
    `);
    const upsertOverallStmt = db.prepare(`
      INSERT INTO grade6_overall_qualifications
        (academic_year_id, student_id, decision, decision_source, bonus_used, max_fail_subjects, decision_bonus_limit, status, notes, updated_by, updated_at, published_at)
      VALUES (?, ?, ?, 'import', 0, ?, ?, ?, '', ?, datetime('now'), ?)
      ON CONFLICT(academic_year_id, student_id) DO UPDATE SET
        decision = excluded.decision,
        decision_source = 'import',
        max_fail_subjects = excluded.max_fail_subjects,
        decision_bonus_limit = excluded.decision_bonus_limit,
        status = excluded.status,
        updated_by = excluded.updated_by,
        updated_at = datetime('now'),
        published_at = excluded.published_at
    `);

    const tx = db.transaction(() => {
      const annualExam = listExams(yearId).find((e) => e.name.includes('السعي السنوي'));
      const upsertGradeStmt = annualExam
        ? db.prepare(`
            INSERT INTO grades (academic_year_id, student_id, subject_id, exam_id, score, status, notes, updated_by, updated_at, published_at)
            VALUES (?, ?, ?, ?, ?, ?, '', ?, datetime('now'), ?)
            ON CONFLICT(student_id, subject_id, exam_id) DO UPDATE SET
              score = excluded.score,
              status = excluded.status,
              updated_by = excluded.updated_by,
              updated_at = datetime('now'),
              published_at = excluded.published_at
          `)
        : null;

      for (const row of validRows) {
        const n = row.normalized!;
        for (const sd of n.subjectDecisions) {
          upsertSubjStmt.run(
            yearId,
            n.studentId,
            sd.subjectId,
            sd.decision,
            requestedStatus,
            req.admin!.username,
            publishedAtVal
          );
        }
        if (n.overallDecision !== null) {
          upsertOverallStmt.run(
            yearId,
            n.studentId,
            n.overallDecision,
            yearObj.grade6MaxFailSubjects,
            yearObj.grade6DecisionBonus,
            requestedStatus,
            req.admin!.username,
            publishedAtVal
          );
        }
        if (n.effortScores && n.effortScores.length > 0 && upsertGradeStmt && annualExam) {
          for (const eff of n.effortScores) {
            upsertGradeStmt.run(
              yearId,
              n.studentId,
              eff.subjectId,
              annualExam.id,
              eff.score,
              requestedStatus,
              req.admin!.username,
              publishedAtVal
            );
          }
        }
      }
    });
    tx();

    recordAuditLog(
      req.admin!.username,
      'IMPORT_GRADE6_QUALIFICATION',
      'academic_year',
      yearId,
      `استيراد تأهيل السادس الوزاري لعدد ${validRows.length} طالب (الحالة: ${requestedStatus} — مرفوض: ${preview.invalidCount})`
    );
    res.json({
      importedCount: validRows.length,
      rejectedCount: preview.invalidCount,
      rejectedRows: preview.rows.filter((r) => !r.valid),
      status: requestedStatus,
    });
  });

  // =========================================================================
  // IRAQI EXEMPTIONS ROUTES (INDIVIDUAL >=90 & GENERAL >=75 — NON-MINISTERIAL ONLY)
  // =========================================================================

  app.get('/api/admin/exemptions', requireAdmin, requireManager, (req, res) => {
    const yearId = resolveAcademicYearId(req.query.yearId);
    const yearObj = getAcademicYearById(yearId) ?? getCurrentAcademicYear();
    const classId = Number(req.query.classId);
    const rawSectionId = String(req.query.sectionId ?? 'all').trim();
    const sectionId = rawSectionId && rawSectionId !== 'all' ? Number(rawSectionId) : null;

    if (!Number.isInteger(classId) || classId <= 0) {
      res.status(400).json({ error: 'يرجى اختيار الصف الدراسي.' });
      return;
    }

    const schoolClass = listClasses().find((c) => c.id === classId);
    const isMinisterial = Boolean(schoolClass?.isMinisterial);

    const students = sortStudentsAlphabetically(
      listStudents(yearId).filter(
        (st) => st.isActive && st.classId === classId && (!sectionId || st.sectionId === sectionId)
      )
    );
    const subjects = listSubjects(yearId)
      .filter(
        (sub) =>
          sub.isActive &&
          (sub.classId === null || sub.classId === classId) &&
          (!sectionId || sub.sectionId === null || sub.sectionId === sectionId)
      )
      .sort((a, b) => a.displayOrder - b.displayOrder || a.id - b.id);

    const exams = listExams(yearId);
    const annualExamId = exams.find((e) => matchIraqiExamSlot(e.name) === 'annualEffort')?.id;
    const grades = annualExamId
      ? listGrades(yearId).filter((g) => g.examId === annualExamId && g.score !== null)
      : [];
    const annualMap = new Map<string, number>();
    for (const g of grades) {
      if (g.score !== null) annualMap.set(`${g.studentId}:${g.subjectId}`, roundIraqiHalfUp(g.score));
    }

    const subjExemptions = listSubjectExemptions(yearId);
    const overallExemptions = listOverallExemptions(yearId);
    const subjExMap = new Map(subjExemptions.map((e) => [`${e.studentId}:${e.subjectId}`, e]));
    const overallExMap = new Map(overallExemptions.map((e) => [e.studentId, e]));

    const rows = students.map((st, idx) => {
      const annualEffortBySubject: Record<number, number | null> = {};
      const subjectDecisions: Record<number, ExemptionDecision | null> = {};
      const subjectTypes: Record<number, 'individual' | 'general'> = {};
      let subjStatus: 'draft' | 'published' = 'draft';
      for (const sub of subjects) {
        annualEffortBySubject[sub.id] = annualMap.get(`${st.id}:${sub.id}`) ?? null;
        const ex = subjExMap.get(`${st.id}:${sub.id}`);
        subjectDecisions[sub.id] = ex?.decision ?? null;
        subjectTypes[sub.id] = ex?.exemptionType ?? 'individual';
        if (ex?.status === 'published') subjStatus = 'published';
      }
      const ov = overallExMap.get(st.id);
      return {
        sequence: idx + 1,
        studentId: st.id,
        fullName: st.fullName,
        inquiryCode: st.inquiryCode,
        sectionName: st.sectionName || '',
        annualEffortBySubject,
        subjectDecisions,
        subjectTypes,
        overallDecision: ov?.decision ?? null,
        annualAverage: ov?.annualAverage ?? null,
        overallStatus: ov?.status ?? subjStatus,
      };
    });

    res.json({
      isMinisterial,
      className: schoolClass?.name || '',
      rules: {
        generalMinAvg: yearObj.exemptionGeneralMinAvg,
        minSubject: yearObj.exemptionMinSubject,
        individualMin: yearObj.exemptionIndividualMin,
      },
      subjects,
      rows,
    });
  });

  app.post('/api/admin/exemptions/save', requireAdmin, requireManager, requirePerm('manageGrades'), (req: AdminRequest, res) => {
    const yearId = resolveAcademicYearId(req.body?.yearId ?? req.query.yearId);
    const classId = Number(req.body?.classId);
    const schoolClass = listClasses().find((c) => c.id === classId);
    if (schoolClass?.isMinisterial) {
      res.status(400).json({ error: 'الإعفاء الفردي والعام لا يشمل صفوف السادس الوزاري.' });
      return;
    }

    const entries = Array.isArray(req.body?.entries) ? req.body.entries : [];
    const targetStatus: 'draft' | 'published' =
      req.body?.status === 'published' && hasPermission(req.admin!, 'publishGrades') ? 'published' : 'draft';
    if (req.body?.status === 'published' && !hasPermission(req.admin!, 'publishGrades')) {
      res.status(403).json({ error: 'لا تملك صلاحية نشر نتائج الإعفاء.' });
      return;
    }

    const db = getDb();
    const pubAt = targetStatus === 'published' ? new Date().toISOString().slice(0, 19).replace('T', ' ') : null;
    const upsertSubj = db.prepare(`
      INSERT INTO exemptions_subject
        (academic_year_id, student_id, subject_id, decision, exemption_type, decision_source, status, notes, updated_by, updated_at, published_at)
      VALUES (?, ?, ?, ?, ?, 'manual', ?, '', ?, datetime('now'), ?)
      ON CONFLICT(academic_year_id, student_id, subject_id) DO UPDATE SET
        decision = excluded.decision,
        exemption_type = excluded.exemption_type,
        decision_source = 'manual',
        status = excluded.status,
        updated_by = excluded.updated_by,
        updated_at = datetime('now'),
        published_at = excluded.published_at
    `);
    const upsertOverall = db.prepare(`
      INSERT INTO exemptions_overall
        (academic_year_id, student_id, decision, annual_average, decision_source, status, notes, updated_by, updated_at, published_at)
      VALUES (?, ?, ?, ?, 'manual', ?, '', ?, datetime('now'), ?)
      ON CONFLICT(academic_year_id, student_id) DO UPDATE SET
        decision = excluded.decision,
        annual_average = excluded.annual_average,
        decision_source = 'manual',
        status = excluded.status,
        updated_by = excluded.updated_by,
        updated_at = datetime('now'),
        published_at = excluded.published_at
    `);

    const exams = listExams(yearId);
    const annualExamId = exams.find((e) => matchIraqiExamSlot(e.name) === 'annualEffort')?.id;
    const finalGradeExamId = exams.find((e) => matchIraqiExamSlot(e.name) === 'finalGrade')?.id;

    db.transaction(() => {
      for (const item of entries) {
        const sid = Number(item.studentId);
        if (!Number.isInteger(sid) || sid <= 0) continue;
        const ovDec = item.overallDecision === 'exempt' || item.overallDecision === 'not_exempt' ? item.overallDecision : null;
        upsertOverall.run(
          yearId,
          sid,
          ovDec,
          item.annualAverage ?? null,
          targetStatus,
          req.admin!.username,
          pubAt
        );
        const subjDecs = (item.subjectDecisions ?? {}) as Record<string, ExemptionDecision | null>;
        const subjTypes = (item.subjectTypes ?? {}) as Record<string, 'individual' | 'general'>;
        for (const [subIdStr, dec] of Object.entries(subjDecs)) {
          const subId = Number(subIdStr);
          if (!Number.isInteger(subId) || subId <= 0) continue;
          const cleanDec = dec === 'exempt' || dec === 'not_exempt' ? dec : null;
          const exType = ovDec === 'exempt' ? 'general' : subjTypes[subIdStr] === 'general' ? 'general' : 'individual';
          upsertSubj.run(yearId, sid, subId, cleanDec, exType, targetStatus, req.admin!.username, pubAt);

          if (cleanDec === 'exempt' && annualExamId && finalGradeExamId) {
            const ann = db
              .prepare('SELECT score FROM grades WHERE student_id = ? AND subject_id = ? AND exam_id = ? AND academic_year_id = ?')
              .get(sid, subId, annualExamId, yearId) as { score: number | null } | undefined;
            if (ann && ann.score !== null) {
              db.prepare(`
                INSERT INTO grades (academic_year_id, student_id, subject_id, exam_id, score, status, notes, updated_by, updated_at, published_at)
                VALUES (?, ?, ?, ?, ?, ?, 'معفو', ?, datetime('now'), ?)
                ON CONFLICT(student_id, subject_id, exam_id) DO UPDATE SET
                  score = excluded.score,
                  status = excluded.status,
                  notes = excluded.notes,
                  updated_by = excluded.updated_by,
                  updated_at = datetime('now'),
                  published_at = excluded.published_at
              `).run(yearId, sid, subId, finalGradeExamId, roundIraqiHalfUp(ann.score), targetStatus, req.admin!.username, pubAt);
            }
          }
        }
      }
    })();

    recordAuditLog(req.admin!.username, 'SAVE_EXEMPTIONS', 'academic_year', yearId, `حفظ قرارات الإعفاء الفردي والعام (${entries.length} طالب)`);
    triggerAutoBackupSnapshot();
    res.json({ ok: true, savedCount: entries.length, status: targetStatus });
  });

  app.post('/api/admin/exemptions/calculate', requireAdmin, requireManager, requirePerm('manageGrades'), (req: AdminRequest, res) => {
    const yearId = resolveAcademicYearId(req.body?.yearId ?? req.query.yearId);
    const yearObj = getAcademicYearById(yearId) ?? getCurrentAcademicYear();
    const classId = Number(req.body?.classId);
    const rawSectionId = String(req.body?.sectionId ?? 'all').trim();
    const sectionId = rawSectionId && rawSectionId !== 'all' ? Number(rawSectionId) : null;
    const targetStatus: 'draft' | 'published' =
      req.body?.targetStatus === 'published' && hasPermission(req.admin!, 'publishGrades') ? 'published' : 'draft';

    const schoolClass = listClasses().find((c) => c.id === classId);
    if (!schoolClass) {
      res.status(404).json({ error: 'الصف غير موجود.' });
      return;
    }
    if (schoolClass.isMinisterial) {
      res.status(400).json({ error: 'الإعفاء الفردي والعام لا يطبق على صفوف السادس الوزاري.' });
      return;
    }

    const students = listStudents(yearId).filter(
      (st) => st.isActive && st.classId === classId && (!sectionId || st.sectionId === sectionId)
    );
    const subjects = listSubjects(yearId)
      .filter((sub) => sub.isActive && (sub.classId === null || sub.classId === classId))
      .sort((a, b) => a.displayOrder - b.displayOrder || a.id - b.id);

    const exams = listExams(yearId);
    const annualExamId = exams.find((e) => matchIraqiExamSlot(e.name) === 'annualEffort')?.id;
    const finalGradeExamId = exams.find((e) => matchIraqiExamSlot(e.name) === 'finalGrade')?.id;
    if (!annualExamId) {
      res.status(400).json({ error: 'امتحان السعي السنوي غير معرف لهذا العام.' });
      return;
    }

    const annualGrades = listGrades(yearId).filter((g) => g.examId === annualExamId && g.score !== null);
    const db = getDb();
    const pubAt = targetStatus === 'published' ? new Date().toISOString().slice(0, 19).replace('T', ' ') : null;
    const upsertSubj = db.prepare(`
      INSERT INTO exemptions_subject
        (academic_year_id, student_id, subject_id, decision, exemption_type, decision_source, status, notes, updated_by, updated_at, published_at)
      VALUES (?, ?, ?, ?, ?, 'approved_calculation', ?, '', ?, datetime('now'), ?)
      ON CONFLICT(academic_year_id, student_id, subject_id) DO UPDATE SET
        decision = excluded.decision,
        exemption_type = excluded.exemption_type,
        decision_source = 'approved_calculation',
        status = excluded.status,
        updated_by = excluded.updated_by,
        updated_at = datetime('now'),
        published_at = excluded.published_at
    `);
    const upsertOverall = db.prepare(`
      INSERT INTO exemptions_overall
        (academic_year_id, student_id, decision, annual_average, decision_source, status, notes, updated_by, updated_at, published_at)
      VALUES (?, ?, ?, ?, 'approved_calculation', ?, '', ?, datetime('now'), ?)
      ON CONFLICT(academic_year_id, student_id) DO UPDATE SET
        decision = excluded.decision,
        annual_average = excluded.annual_average,
        decision_source = 'approved_calculation',
        status = excluded.status,
        updated_by = excluded.updated_by,
        updated_at = datetime('now'),
        published_at = excluded.published_at
    `);

    let generalExemptCount = 0;
    let individualSubjectCount = 0;

    db.transaction(() => {
      for (const st of students) {
        const effMap = new Map<number, number>();
        for (const g of annualGrades) {
          if (g.studentId === st.id && g.score !== null) {
            effMap.set(g.subjectId, g.score);
          }
        }
        const evalRes = evaluateIraqiExemptions({
          isMinisterial: false,
          subjects,
          annualEffortBySubjectId: effMap,
          rules: {
            generalMinAvg: yearObj.exemptionGeneralMinAvg,
            minSubject: yearObj.exemptionMinSubject,
            individualMin: yearObj.exemptionIndividualMin,
          },
        });
        if (evalRes.overallDecision === 'exempt') generalExemptCount += 1;

        upsertOverall.run(
          yearId,
          st.id,
          evalRes.overallDecision,
          evalRes.annualAverage,
          targetStatus,
          req.admin!.username,
          pubAt
        );

        for (const sd of evalRes.subjectDecisions) {
          if (sd.decision === 'exempt' && sd.exemptionType === 'individual') individualSubjectCount += 1;
          upsertSubj.run(
            yearId,
            st.id,
            sd.subjectId,
            sd.decision,
            sd.exemptionType,
            targetStatus,
            req.admin!.username,
            pubAt
          );
          if (sd.decision === 'exempt' && sd.annualEffort !== null && finalGradeExamId) {
            db.prepare(`
              INSERT INTO grades (academic_year_id, student_id, subject_id, exam_id, score, status, notes, updated_by, updated_at, published_at)
              VALUES (?, ?, ?, ?, ?, ?, 'معفو', ?, datetime('now'), ?)
              ON CONFLICT(student_id, subject_id, exam_id) DO UPDATE SET
                score = excluded.score,
                status = excluded.status,
                notes = excluded.notes,
                updated_by = excluded.updated_by,
                updated_at = datetime('now'),
                published_at = excluded.published_at
            `).run(yearId, st.id, sd.subjectId, finalGradeExamId, sd.annualEffort, targetStatus, req.admin!.username, pubAt);
          }
        }
      }
    })();

    recordAuditLog(
      req.admin!.username,
      'CALCULATE_EXEMPTIONS',
      'academic_year',
      yearId,
      `احتساب الإعفاءات بأمر المدير (${schoolClass.name}): إعفاء عام (${generalExemptCount})، مواد فردية (${individualSubjectCount})`
    );
    triggerAutoBackupSnapshot();
    res.json({
      ok: true,
      processedStudents: students.length,
      generalExemptCount,
      individualSubjectCount,
      status: targetStatus,
    });
  });

  app.get('/api/admin/export/template/exemptions', requireAdmin, requireManager, (req, res) => {
    const yearId = resolveAcademicYearId(req.query.yearId);
    const yearObj = getAcademicYearById(yearId) ?? getCurrentAcademicYear();
    const classId = req.query.classId ? Number(req.query.classId) : null;
    const rawSectionId = String(req.query.sectionId ?? 'all').trim();
    const sectionId = rawSectionId && rawSectionId !== 'all' ? Number(rawSectionId) : null;

    const scopedStudents = sortStudentsAlphabetically(
      listStudents(yearId).filter(
        (st) => st.isActive && (!classId || st.classId === classId) && (!sectionId || st.sectionId === sectionId)
      )
    );
    const schoolClass = classId ? listClasses().find((c) => c.id === classId) : null;
    const scopedSubjects = listSubjects(yearId).filter(
      (sub) =>
        sub.isActive &&
        (!classId || sub.classId === null || sub.classId === classId) &&
        !isSubjectExcludedForClass(sub.name, schoolClass?.name, schoolClass?.isMinisterial)
    );
    const clsName = schoolClass?.name || 'الصف';
    const secName = sectionId ? listSections(yearId).find((s) => s.id === sectionId)?.name || '' : 'جميع_الشعب';

    const exams = listExams(yearId);
    const annualExamId = exams.find((e) => matchIraqiExamSlot(e.name) === 'annualEffort')?.id;
    const annualMap = new Map<string, number>();
    if (annualExamId) {
      for (const g of listGrades(yearId)) {
        if (g.examId === annualExamId && g.score !== null) {
          annualMap.set(`${g.studentId}:${g.subjectId}`, roundIraqiHalfUp(g.score));
        }
      }
    }
    const subjExMap = new Map(listSubjectExemptions(yearId).map((e) => [`${e.studentId}:${e.subjectId}`, e.decision]));
    const ovExMap = new Map(listOverallExemptions(yearId).map((e) => [e.studentId, e.decision]));

    const sourceList = scopedStudents.length > 0 ? scopedStudents : [];
    const sheetRows = sourceList.map((st, idx) => {
      const row: Record<string, string | number> = {
        'ت': idx + 1,
        'اسم الطالب': st.fullName,
        'رقم الهوية الوطنية': st.inquiryCode,
        'الصف': st.className || clsName,
        'الشعبة': st.sectionName || secName,
      };
      for (const sub of scopedSubjects) {
        const eff = annualMap.get(`${st.id}:${sub.id}`);
        row[`سعي - ${sub.name}`] = eff !== undefined ? eff : '—';
        const d = subjExMap.get(`${st.id}:${sub.id}`);
        row[sub.name] = d === 'exempt' ? 'معفو' : d === 'not_exempt' ? 'غير معفو' : '';
      }
      const ov = ovExMap.get(st.id);
      row['الإعفاء العام'] = ov === 'exempt' ? 'معفو' : ov === 'not_exempt' ? 'غير معفو' : '';
      return row;
    });

    const wb = XLSX.utils.book_new();
    const effectiveRows =
      sheetRows.length > 0
        ? sheetRows
        : [{ 'ت': 1, 'اسم الطالب': 'طالب تجريبي', 'رقم الهوية الوطنية': '2026101', 'الإعفاء العام': 'غير معفو' }];
    const ws = XLSX.utils.json_to_sheet(effectiveRows);
    applyArabicSheetLayout(wb, ws, effectiveRows);
    XLSX.utils.book_append_sheet(wb, ws, 'الإعفاءات');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    const fname = buildScopedArabicFilename({
      prefix: 'قالب_الإعفاءات',
      academicYear: yearObj.name,
      className: clsName,
      sectionName: secName,
      ext: 'xlsx',
    });
    sendAttachmentBuffer(
      res,
      buf,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      fname,
      'exemptions_template.xlsx'
    );
  });

  app.post('/api/admin/exemptions/import-preview', requireAdmin, requireManager, requirePerm('manageImportExport'), (req, res) => {
    const yearId = resolveAcademicYearId(req.body?.yearId ?? req.query.yearId);
    const classId = req.body?.classId ? Number(req.body.classId) : null;
    const rawSectionId = String(req.body?.sectionId ?? 'all').trim();
    const sectionId = rawSectionId && rawSectionId !== 'all' ? Number(rawSectionId) : null;
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    const scopedStudents = listStudents(yearId).filter(
      (st) => st.isActive && (!classId || st.classId === classId) && (!sectionId || st.sectionId === sectionId)
    );
    const scopedSubjects = listSubjects(yearId).filter(
      (sub) => sub.isActive && (!classId || sub.classId === null || sub.classId === classId)
    );
    res.json(validateExemptionImportRows(rows, scopedStudents, scopedSubjects));
  });

  app.post('/api/admin/exemptions/import-commit', requireAdmin, requireManager, requirePerm('manageImportExport'), (req: AdminRequest, res) => {
    const yearId = resolveAcademicYearId(req.body?.yearId ?? req.query.yearId);
    const classId = req.body?.classId ? Number(req.body.classId) : null;
    const rawSectionId = String(req.body?.sectionId ?? 'all').trim();
    const sectionId = rawSectionId && rawSectionId !== 'all' ? Number(rawSectionId) : null;
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    const requestedStatus: 'draft' | 'published' =
      req.body?.targetStatus === 'published' && hasPermission(req.admin!, 'publishGrades') ? 'published' : 'draft';

    const scopedStudents = listStudents(yearId).filter(
      (st) => st.isActive && (!classId || st.classId === classId) && (!sectionId || st.sectionId === sectionId)
    );
    const scopedSubjects = listSubjects(yearId).filter(
      (sub) => sub.isActive && (!classId || sub.classId === null || sub.classId === classId)
    );
    const preview = validateExemptionImportRows(rows, scopedStudents, scopedSubjects);
    const validRows = preview.rows.filter((r) => r.valid && r.normalized);
    const pubAt = requestedStatus === 'published' ? new Date().toISOString().slice(0, 19).replace('T', ' ') : null;
    const db = getDb();

    const upsertSubj = db.prepare(`
      INSERT INTO exemptions_subject
        (academic_year_id, student_id, subject_id, decision, exemption_type, decision_source, status, notes, updated_by, updated_at, published_at)
      VALUES (?, ?, ?, ?, ?, 'import', ?, '', ?, datetime('now'), ?)
      ON CONFLICT(academic_year_id, student_id, subject_id) DO UPDATE SET
        decision = excluded.decision,
        exemption_type = excluded.exemption_type,
        decision_source = 'import',
        status = excluded.status,
        updated_by = excluded.updated_by,
        updated_at = datetime('now'),
        published_at = excluded.published_at
    `);
    const upsertOv = db.prepare(`
      INSERT INTO exemptions_overall
        (academic_year_id, student_id, decision, annual_average, decision_source, status, notes, updated_by, updated_at, published_at)
      VALUES (?, ?, ?, NULL, 'import', ?, '', ?, datetime('now'), ?)
      ON CONFLICT(academic_year_id, student_id) DO UPDATE SET
        decision = excluded.decision,
        decision_source = 'import',
        status = excluded.status,
        updated_by = excluded.updated_by,
        updated_at = datetime('now'),
        published_at = excluded.published_at
    `);

    db.transaction(() => {
      const annualExam = listExams(yearId).find((e) => e.name.includes('السعي السنوي'));
      const upsertGradeStmt = annualExam
        ? db.prepare(`
            INSERT INTO grades (academic_year_id, student_id, subject_id, exam_id, score, status, notes, updated_by, updated_at, published_at)
            VALUES (?, ?, ?, ?, ?, ?, '', ?, datetime('now'), ?)
            ON CONFLICT(student_id, subject_id, exam_id) DO UPDATE SET
              score = excluded.score,
              status = excluded.status,
              updated_by = excluded.updated_by,
              updated_at = datetime('now'),
              published_at = excluded.published_at
          `)
        : null;

      for (const row of validRows) {
        const n = row.normalized!;
        if (n.overallDecision !== null) {
          upsertOv.run(yearId, n.studentId, n.overallDecision, requestedStatus, req.admin!.username, pubAt);
        }
        for (const sd of n.subjectDecisions) {
          const exType = n.overallDecision === 'exempt' ? 'general' : 'individual';
          upsertSubj.run(yearId, n.studentId, sd.subjectId, sd.decision, exType, requestedStatus, req.admin!.username, pubAt);
        }
        if (n.effortScores && n.effortScores.length > 0 && upsertGradeStmt && annualExam) {
          for (const eff of n.effortScores) {
            upsertGradeStmt.run(
              yearId,
              n.studentId,
              eff.subjectId,
              annualExam.id,
              eff.score,
              requestedStatus,
              req.admin!.username,
              pubAt
            );
          }
        }
      }
    })();

    recordAuditLog(req.admin!.username, 'IMPORT_EXEMPTIONS', 'academic_year', yearId, `استيراد قرارات الإعفاء (${validRows.length} طالب)`);
    triggerAutoBackupSnapshot();
    res.json({ importedCount: validRows.length, rejectedCount: preview.invalidCount });
  });

  app.get('/api/admin/publish-links', requireAdmin, (req, res) => {
    const yearId = resolveAcademicYearId(req.query.yearId);
    res.json({ links: listPublishLinks(40, yearId) });
  });

  app.post('/api/admin/publish-links/generate', requireAdmin, requireManager, requirePerm('manageAnnouncements'), (req: AdminRequest, res) => {
    const yearId = resolveAcademicYearId(req.body?.yearId ?? req.query.yearId);
    const yearObj = getAcademicYearById(yearId) ?? getCurrentAcademicYear();
    const classId = Number(req.body?.classId);
    const rawSec = String(req.body?.sectionId ?? 'all').trim();
    const sectionId = rawSec && rawSec !== 'all' ? Number(rawSec) : null;
    const examIdsRaw = Array.isArray(req.body?.examIds)
      ? req.body.examIds.map(Number).filter((n: number) => Number.isInteger(n) && n > 0)
      : req.body?.examId
        ? [Number(req.body.examId)]
        : [];
    const subjectIdsRaw = Array.isArray(req.body?.subjectIds)
      ? req.body.subjectIds.map(Number).filter((n: number) => Number.isInteger(n) && n > 0)
      : [];
    const createAnnouncement = Boolean(req.body?.createAnnouncement);
    const customTitle = String(req.body?.customTitle ?? '').trim();

    if (!Number.isInteger(classId) || classId <= 0 || examIdsRaw.length === 0) {
      res.status(400).json({ error: 'يرجى اختيار الصف والامتحان أولاً.' });
      return;
    }

    const db = getDb();
    const cls = listClasses().find((c) => c.id === classId);
    const sec = sectionId ? listSections(yearId).find((s) => s.id === sectionId) : null;
    const allExams = listExams(yearId);
    const selectedExams = allExams.filter((e) => examIdsRaw.includes(e.id));
    if (!cls || selectedExams.length === 0) {
      res.status(404).json({ error: 'الصف أو الامتحان غير موجود.' });
      return;
    }

    // Verify ONLY published grades exist in the selected scope
    const placeholdersEx = examIdsRaw.map(() => '?').join(',');
    let querySql = `
      SELECT DISTINCT g.subject_id as subjectId, sub.name as subjectName, g.student_id as studentId
      FROM grades g
      JOIN students st ON st.id = g.student_id
      JOIN subjects sub ON sub.id = g.subject_id
      WHERE g.academic_year_id = ?
        AND st.class_id = ?
        AND st.is_active = 1
        AND g.status = 'published'
        AND g.score IS NOT NULL
        AND g.exam_id IN (${placeholdersEx})
    `;
    const params: unknown[] = [yearId, classId, ...examIdsRaw];
    if (sectionId) {
      querySql += ' AND st.section_id = ?';
      params.push(sectionId);
    }
    if (subjectIdsRaw.length > 0) {
      querySql += ` AND g.subject_id IN (${subjectIdsRaw.map(() => '?').join(',')})`;
      params.push(...subjectIdsRaw);
    }

    const publishedRows = db.prepare(querySql).all(...params) as Array<{
      subjectId: number;
      subjectName: string;
      studentId: number;
    }>;

    if (publishedRows.length === 0) {
      res.status(400).json({
        error: 'لا توجد درجات منشورة ضمن الصف والشعبة والامتحان والمواد المحددة. يرجى نشر الدرجات أولاً ثم إنشاء الرابط.',
      });
      return;
    }

    const publishedSubjectNames = Array.from(new Set(publishedRows.map((r) => r.subjectName)));
    const publishedStudentsCount = new Set(publishedRows.map((r) => r.studentId)).size;
    const singleSubjectId = subjectIdsRaw.length === 1 ? subjectIdsRaw[0] : null;

    const link = ensurePublishLink({
      academicYearId: yearId,
      classId,
      sectionId,
      subjectId: singleSubjectId,
      examId: selectedExams[0].id,
      createdBy: req.admin!.username,
    });

    const examLabels = selectedExams.map((e) => e.name).join(' و ');
    const secText = sec ? `شعبة ${sec.name}` : 'جميع الشعب';
    const title = customTitle || `نتائج ${examLabels} — ${cls.name} (${secText})`;
    const subjectsListText = publishedSubjectNames.join('، ');
    const announcementBody = `تعلن إدارة ${getSettings().schoolName} للعام الدراسي (${yearObj.name}) عن نشر نتائج (${examLabels}) للصف (${cls.name} — ${secText}) للمواد المنشورة التالية: ${subjectsListText}.\nعدد الطلبة المشمولين: ${publishedStudentsCount} طالب.\nيمكنكم الاستعلام فوراً عبر الرابط المرفق باستخدام رقم الهوية الوطنية.`;

    if (createAnnouncement) {
      db.prepare(
        "INSERT INTO announcements (title, body, publish_date, status, created_by) VALUES (?, ?, date('now'), 'published', ?)"
      ).run(title, announcementBody, req.admin!.username);
    }

    recordAuditLog(
      req.admin!.username,
      'GENERATE_PUBLISH_LINK',
      'publish_link',
      link?.id || classId,
      `توليد رابط وإعلان نشر يدوي لـ (${title})`
    );

    res.json({
      link,
      title,
      announcementBody,
      publishedSubjects: publishedSubjectNames,
      publishedStudentsCount,
      announcementCreated: createAnnouncement,
    });
  });

  app.delete('/api/admin/publish-links/:id', requireAdmin, requireManager, (req: AdminRequest, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'معرف الرابط غير صالح.' });
      return;
    }
    deletePublishLink(id);
    recordAuditLog(req.admin!.username, 'DELETE_PUBLISH_LINK', 'publish_link', id, 'حذف رابط نشرة');
    res.json({ ok: true });
  });

  // =========================================================================
  // CONTROL SECTION ROUTES (QR BARCODE 4x6 CARDS & CAMERA SCANNER GRADING)
  // =========================================================================

  app.get('/api/admin/control/students', requireAdmin, requireManager, (req, res) => {
    const yearId = resolveAcademicYearId(req.query.yearId);
    const classId = req.query.classId ? Number(req.query.classId) : null;
    const rawSec = String(req.query.sectionId ?? 'all').trim();
    const sectionId = rawSec && rawSec !== 'all' ? Number(rawSec) : null;

    const students = sortStudentsAlphabetically(
      listStudents(yearId).filter(
        (s) => s.isActive && (!classId || s.classId === classId) && (!sectionId || s.sectionId === sectionId)
      )
    );

    const cards = students.map((st) => {
      const payload = JSON.stringify({ v: 1, sId: st.id, code: st.inquiryCode, yId: yearId });
      return {
        studentId: st.id,
        fullName: st.fullName,
        inquiryCode: st.inquiryCode,
        classId: st.classId,
        className: st.className || '',
        sectionId: st.sectionId,
        sectionName: st.sectionName || '',
        payload,
      };
    });

    res.json({ students: cards });
  });

  app.get('/api/admin/control/qr-cards.pdf', requireAdmin, requireManager, async (req, res) => {
    const yearId = resolveAcademicYearId(req.query.yearId);
    const yearObj = getAcademicYearById(yearId) ?? getCurrentAcademicYear();
    const classId = req.query.classId ? Number(req.query.classId) : null;
    const rawSec = String(req.query.sectionId ?? 'all').trim();
    const sectionId = rawSec && rawSec !== 'all' ? Number(rawSec) : null;

    const students = sortStudentsAlphabetically(
      listStudents(yearId).filter(
        (s) => s.isActive && (!classId || s.classId === classId) && (!sectionId || s.sectionId === sectionId)
      )
    );

    const cardsWithQr = await Promise.all(
      students.map(async (st) => {
        const payload = JSON.stringify({ v: 1, sId: st.id, code: st.inquiryCode, yId: yearId });
        const qrDataUrl = await QRCode.toDataURL(payload, { margin: 1, width: 220, errorCorrectionLevel: 'M' });
        return {
          studentId: st.id,
          fullName: st.fullName,
          inquiryCode: st.inquiryCode,
          className: st.className || '',
          sectionName: st.sectionName || '',
          qrDataUrl,
        };
      })
    );

    const clsName = (classId ? listClasses().find((c) => c.id === classId)?.name : 'جميع الصفوف') || 'جميع الصفوف';
    const secName = sectionId ? listSections(yearId).find((s) => s.id === sectionId)?.name || '' : 'جميع_الشعب';
    const pdfBuf = await generateControlQrCardsPdf({
      settings: getSettings(),
      academicYear: yearObj.name,
      className: clsName,
      sectionName: secName,
      cards: cardsWithQr,
    });
    const fname = buildScopedArabicFilename({
      prefix: 'بطاقات_باركود_الكونترول',
      academicYear: yearObj.name,
      className: clsName,
      sectionName: secName,
      ext: 'pdf',
    });
    sendAttachmentBuffer(res, pdfBuf, 'application/pdf', fname, 'control-qr-cards.pdf');
  });

  app.post('/api/admin/control/resolve-student', requireAdmin, requireManager, (req, res) => {
    const yearId = resolveAcademicYearId(req.body?.yearId ?? req.query.yearId);
    const rawPayload = String(req.body?.payload ?? '').trim();
    const subjectId = req.body?.subjectId ? Number(req.body.subjectId) : null;
    const examId = req.body?.examId ? Number(req.body.examId) : null;

    if (!rawPayload) {
      res.status(400).json({ error: 'يرجى مسح رمز الباركود أو إدخال رقم الهوية الوطنية.' });
      return;
    }

    const cleanCodeStr = (val: string) =>
      normalizeArabicIndicDigits(val)
        .replace(/[\s\u200B-\u200F\u202A-\u202E\uFEFF\u061C]+/g, '')
        .trim();

    let targetStudentId: number | null = null;
    let targetCode: string | null = null;
    const normalizedTarget = cleanCodeStr(rawPayload);

    try {
      const parsed = JSON.parse(rawPayload);
      if (parsed && typeof parsed === 'object') {
        if (parsed.sId) targetStudentId = Number(parsed.sId);
        if (parsed.code) targetCode = cleanCodeStr(String(parsed.code));
      }
    } catch {
      targetCode = normalizedTarget;
    }

    const allYearStudents = listStudents(yearId);
    const activeStudents = allYearStudents.filter((s) => s.isActive);
    let student =
      (targetStudentId
        ? activeStudents.find(
            (s) => s.id === targetStudentId && (!targetCode || cleanCodeStr(s.inquiryCode) === targetCode)
          )
        : undefined) ||
      (targetCode ? activeStudents.find((s) => cleanCodeStr(s.inquiryCode) === targetCode) : undefined) ||
      (targetStudentId ? activeStudents.find((s) => s.id === targetStudentId) : undefined);

    if (!student && normalizedTarget) {
      student = activeStudents.find((s) => cleanCodeStr(s.inquiryCode) === normalizedTarget);
    }

    if (!student && rawPayload) {
      const cleanNormName = normalizeArabicText(rawPayload);
      const nameMatches = activeStudents.filter((s) => normalizeArabicText(s.fullName) === cleanNormName);
      if (nameMatches.length === 1) {
        student = nameMatches[0];
      }
    }

    if (!student) {
      const inactiveMatch = allYearStudents.find(
        (s) =>
          !s.isActive &&
          ((targetCode && cleanCodeStr(s.inquiryCode) === targetCode) ||
            (normalizedTarget && cleanCodeStr(s.inquiryCode) === normalizedTarget) ||
            (targetStudentId && s.id === targetStudentId))
      );
      if (inactiveMatch) {
        res.status(404).json({
          error: `الطالب «${inactiveMatch.fullName}» معطّل قيده حالياً في هذا العام الدراسي.`,
        });
        return;
      }
      const otherYearStudent = listStudents().find(
        (s) =>
          s.isActive &&
          s.academicYearId !== yearId &&
          ((targetCode && cleanCodeStr(s.inquiryCode) === targetCode) ||
            (normalizedTarget && cleanCodeStr(s.inquiryCode) === normalizedTarget))
      );
      if (otherYearStudent) {
        const otherYearName = getAcademicYearById(otherYearStudent.academicYearId)?.name ?? '';
        res.status(404).json({
          error: `رقم الهوية يعود للطالب «${otherYearStudent.fullName}» المسجل في عام دراسي آخر (${otherYearName}). يرجى تبديل العام الدراسي من الأعلى.`,
        });
        return;
      }
      res.status(404).json({ error: 'الباركود أو رقم الهوية غير مطابق لأي طالب نشط في هذا العام الدراسي.' });
      return;
    }

    let existingGrade: { score: number | null; status: string; notes: string } | null = null;
    if (subjectId && examId) {
      const db = getDb();
      const gradeRow = db
        .prepare('SELECT score, status, notes FROM grades WHERE academic_year_id = ? AND student_id = ? AND subject_id = ? AND exam_id = ?')
        .get(yearId, student.id, subjectId, examId) as { score: number | null; status: string; notes: string | null } | undefined;
      if (gradeRow) {
        existingGrade = {
          score: gradeRow.score,
          status: gradeRow.status,
          notes: gradeRow.notes ?? '',
        };
      }
    }

    res.json({ student, existingGrade });
  });

  app.post('/api/admin/control/scan-grade', requireAdmin, requireManager, requirePerm('manageGrades'), (req: AdminRequest, res) => {
    const yearId = resolveAcademicYearId(req.body?.yearId ?? req.query.yearId);
    const studentId = Number(req.body?.studentId);
    const subjectId = Number(req.body?.subjectId);
    const examId = Number(req.body?.examId);
    const notes = String(req.body?.notes ?? '').trim();

    const db = getDb();
    const student = listStudents(yearId).find((s) => s.id === studentId && s.isActive);
    const subject = listSubjects(yearId).find((s) => s.id === subjectId);
    const exam = listExams(yearId).find((e) => e.id === examId);

    if (!student || !subject || !exam) {
      res.status(404).json({ error: 'بيانات الطالب أو المادة أو الامتحان غير موجودة.' });
      return;
    }
    if (subject.classId !== null && subject.classId !== student.classId) {
      res.status(400).json({
        error: `المادة المختارة (${subject.name}) لا تتبع لصف الطالب (${student.className}).`,
      });
      return;
    }

    const check = validateScoreInput(req.body?.score, subject.maxScore);
    if (!check.valid || check.score === null) {
      res.status(400).json({ error: check.error || 'يرجى إدخال درجة صالحة.' });
      return;
    }

    db.transaction(() => {
      db.prepare(`
        INSERT INTO grades (academic_year_id, student_id, subject_id, exam_id, score, status, notes, updated_by, updated_at, published_at)
        VALUES (?, ?, ?, ?, ?, 'ready', ?, ?, datetime('now'), NULL)
        ON CONFLICT(student_id, subject_id, exam_id) DO UPDATE SET
          academic_year_id = excluded.academic_year_id,
          score = excluded.score,
          status = 'ready',
          notes = excluded.notes,
          updated_by = excluded.updated_by,
          updated_at = datetime('now'),
          published_at = NULL
      `).run(yearId, student.id, subject.id, exam.id, check.score, notes, req.admin!.username);

      if (matchIraqiExamSlot(exam.name) === 'secondRound') {
        syncSecondRoundFinalGrade(db, {
          yearId,
          studentId: student.id,
          subjectId: subject.id,
          secondRoundScore: check.score,
          status: 'ready',
          publishedAt: null,
          actor: req.admin!.username,
        });
      }
    })();

    recordAuditLog(
      req.admin!.username,
      'CONTROL_SCAN_GRADE',
      'grade',
      `${student.id}:${subject.id}:${exam.id}`,
      `رصد كونترول (جاهزة للنشر): ${student.fullName} — ${subject.name} (${exam.name}): ${check.score}`
    );
    triggerAutoBackupSnapshot();

    res.json({
      ok: true,
      saved: {
        studentId: student.id,
        fullName: student.fullName,
        inquiryCode: student.inquiryCode,
        subjectName: subject.name,
        examName: exam.name,
        score: check.score,
        status: 'ready',
      },
    });
  });

  // =========================================================================
  // GRADE OBJECTIONS MANAGEMENT ROUTES (ADMIN REVIEW & PUBLISH)
  // =========================================================================

  app.get('/api/admin/objections', requireAdmin, requireManager, (req, res) => {
    const yearId = resolveAcademicYearId(req.query.yearId);
    res.json({ objections: listGradeObjections(yearId) });
  });

  app.put('/api/admin/objections/:id/resolve', requireAdmin, requireManager, requirePerm('manageGrades'), (req: AdminRequest, res) => {
    const id = Number(req.params.id);
    const status = req.body?.status === 'mismatching' ? 'mismatching' : req.body?.status === 'matching' ? 'matching' : null;
    const adminNote = String(req.body?.adminNote ?? '').trim();
    const rawCorrected = req.body?.correctedScore;

    if (!status) {
      res.status(400).json({ error: 'حالة المراجعة يجب أن تكون "مطابقة" أو "غير مطابقة".' });
      return;
    }

    const db = getDb();
    const existing = db
      .prepare('SELECT * FROM grade_objections WHERE id = ?')
      .get(id) as
      | {
          id: number;
          academic_year_id: number;
          student_id: number;
          subject_id: number;
          exam_id: number;
          recorded_score: number | null;
        }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'الاعتراض غير موجود.' });
      return;
    }

    let correctedScore: number | null = null;
    if (status === 'mismatching') {
      const subject = db.prepare('SELECT max_score as maxScore FROM subjects WHERE id = ?').get(existing.subject_id) as
        | { maxScore: number }
        | undefined;
      const check = validateScoreInput(rawCorrected, subject?.maxScore ?? 100);
      if (!check.valid || check.score === null) {
        res.status(400).json({ error: check.error || 'يرجى إدخال الدرجة المعدلة الصحيحة عند اختيار "غير مطابقة".' });
        return;
      }
      correctedScore = check.score;
    }

    db.transaction(() => {
      db.prepare(
        `UPDATE grade_objections
         SET status = ?, corrected_score = ?, admin_note = ?, resolved_at = datetime('now'), resolved_by = ?
         WHERE id = ?`
      ).run(status, correctedScore, adminNote, req.admin!.username, id);

      if (status === 'mismatching' && correctedScore !== null) {
        db.prepare(
          `UPDATE grades
           SET score = ?, updated_by = ?, updated_at = datetime('now')
           WHERE student_id = ? AND subject_id = ? AND exam_id = ? AND academic_year_id = ?`
        ).run(
          correctedScore,
          req.admin!.username,
          existing.student_id,
          existing.subject_id,
          existing.exam_id,
          existing.academic_year_id
        );
      }
    })();

    recordAuditLog(
      req.admin!.username,
      'RESOLVE_OBJECTION',
      'grade_objection',
      id,
      status === 'mismatching'
        ? `تعديل درجة الاعتراض #${id} إلى ${correctedScore} (غير مطابقة)`
        : `اعتماد مطابقة الدرجة للاعتراض #${id}`
    );
    triggerAutoBackupSnapshot();
    res.json({ ok: true });
  });

  app.post('/api/admin/objections/publish', requireAdmin, requireManager, requirePerm('publishGrades'), (req: AdminRequest, res) => {
    const yearId = resolveAcademicYearId(req.body?.yearId ?? req.query.yearId);
    const ids = Array.isArray(req.body?.objectionIds)
      ? req.body.objectionIds.map(Number).filter((n: number) => Number.isInteger(n) && n > 0)
      : null;

    const db = getDb();
    let changes = 0;
    if (ids && ids.length > 0) {
      const info = db
        .prepare(
          `UPDATE grade_objections SET is_published = 1
           WHERE academic_year_id = ? AND status IN ('matching','mismatching') AND id IN (${ids.map(() => '?').join(',')})`
        )
        .run(yearId, ...ids);
      changes = info.changes;
    } else {
      const info = db
        .prepare(
          "UPDATE grade_objections SET is_published = 1 WHERE academic_year_id = ? AND status IN ('matching','mismatching')"
        )
        .run(yearId);
      changes = info.changes;
    }

    recordAuditLog(req.admin!.username, 'PUBLISH_OBJECTIONS', 'grade_objection', yearId, `نشر نتائج ${changes} اعتراض للطلبة`);
    res.json({ ok: true, publishedCount: changes });
  });

  // =========================================================================
  // IMPORT & EXPORT (Excel / CSV Templates, Preview, Commit, Exports)
  // =========================================================================

  app.post('/api/admin/import/preview', requireAdmin, requirePerm('manageImportExport'), (req: AdminRequest, res) => {
    const yearId = resolveAcademicYearId(req.body?.yearId ?? req.query.yearId);
    const type = req.body?.type === 'grades' ? 'grades' : 'students';
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    const options = (req.body?.options ?? {}) as Record<string, unknown>;

    if (type === 'students') {
      if (req.admin!.role === 'teacher') {
        res.status(403).json({ error: 'استيراد الطلاب مقتصر على إدارة المدرسة فقط.' });
        return;
      }
      const existingCodes = new Set(listStudents(yearId).map((s) => s.inquiryCode));
      const preview = validateStudentImportRows(rows, existingCodes, listClasses(), listSections(yearId), {
        defaultClassId: options.defaultClassId ? Number(options.defaultClassId) : null,
        defaultSectionId: options.defaultSectionId ? Number(options.defaultSectionId) : null,
        allowUpdateExisting: Boolean(options.allowUpdateExisting),
      });
      res.json(preview);
      return;
    }

    const allYearSubjects = listSubjects(yearId);
    const studentsByCode = new Map(listStudents(yearId).map((s) => [s.inquiryCode, s]));
    const subjectsByName = new Map(allYearSubjects.map((s) => [s.name.trim(), s]));
    const examsByName = new Map(listExams(yearId).map((e) => [e.name.trim(), e]));
    const preview = validateGradeImportRows(rows, studentsByCode, subjectsByName, examsByName, {
      defaultSubjectId: options.defaultSubjectId ? Number(options.defaultSubjectId) : null,
      defaultExamId: options.defaultExamId ? Number(options.defaultExamId) : null,
      defaultClassId: options.defaultClassId ? Number(options.defaultClassId) : null,
      defaultSectionId:
        options.defaultSectionId && String(options.defaultSectionId) !== 'all'
          ? Number(options.defaultSectionId)
          : null,
      subjects: allYearSubjects,
      teacherAssignments: req.admin!.assignments,
      restrictToTeacher: req.admin!.role === 'teacher',
    });

    if (req.admin!.role === 'teacher') {
      preview.rows.forEach((r) => {
        if (r.normalized && !isTeacherAllowedExamName(r.normalized.examName)) {
          r.valid = false;
          r.errors.push('غير مخول: المدرس يرفع درجات الأشهر وسعي الفصلين فقط.');
          r.normalized = undefined;
        }
      });
      preview.validCount = preview.rows.filter((r) => r.valid).length;
      preview.invalidCount = preview.rows.length - preview.validCount;
    }

    res.json(preview);
  });

  app.post('/api/admin/import/commit', requireAdmin, requirePerm('manageImportExport'), (req: AdminRequest, res) => {
    const yearId = resolveAcademicYearId(req.body?.yearId ?? req.query.yearId);
    const type = req.body?.type === 'grades' ? 'grades' : 'students';
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    const options = (req.body?.options ?? {}) as Record<string, unknown>;
    const db = getDb();

    if (type === 'students') {
      if (req.admin!.role === 'teacher') {
        res.status(403).json({ error: 'استيراد الطلاب مقتصر على إدارة المدرسة فقط.' });
        return;
      }
      const existingCodes = new Set(listStudents(yearId).map((s) => s.inquiryCode));
      const preview = validateStudentImportRows(rows, existingCodes, listClasses(), listSections(yearId), {
        defaultClassId: options.defaultClassId ? Number(options.defaultClassId) : null,
        defaultSectionId: options.defaultSectionId ? Number(options.defaultSectionId) : null,
        allowUpdateExisting: Boolean(options.allowUpdateExisting),
      });
      const validRows = preview.rows.filter((r) => r.valid && r.normalized);

      const insertStmt = db.prepare(
        'INSERT INTO students (academic_year_id, full_name, inquiry_code, class_id, section_id, is_active, notes) VALUES (?, ?, ?, ?, ?, 1, ?)'
      );
      const updateStmt = db.prepare(
        `UPDATE students SET full_name = ?, class_id = ?, section_id = ?, notes = ?, is_active = 1, updated_at = datetime('now')
         WHERE academic_year_id = ? AND inquiry_code = ?`
      );
      const tx = db.transaction(() => {
        for (const row of validRows) {
          const n = row.normalized!;
          if (n.action === 'update') {
            updateStmt.run(n.fullName, n.classId, n.sectionId, n.notes, yearId, n.inquiryCode);
          } else {
            insertStmt.run(yearId, n.fullName, n.inquiryCode, n.classId, n.sectionId, n.notes);
          }
        }
      });
      tx();

      recordAuditLog(
        req.admin!.username,
        'IMPORT_STUDENTS',
        'student',
        'batch',
        `استيراد ${validRows.length} طالب دفعة واحدة (مرفوض: ${preview.invalidCount})`
      );
      triggerAutoBackupSnapshot();
      res.json({
        importedCount: validRows.length,
        rejectedCount: preview.invalidCount,
        rejectedRows: preview.rows.filter((r) => !r.valid),
      });
      return;
    }

    const allYearSubjects = listSubjects(yearId);
    const studentsByCode = new Map(listStudents(yearId).map((s) => [s.inquiryCode, s]));
    const subjectsByName = new Map(allYearSubjects.map((s) => [s.name.trim(), s]));
    const examsByName = new Map(listExams(yearId).map((e) => [e.name.trim(), e]));
    const preview = validateGradeImportRows(rows, studentsByCode, subjectsByName, examsByName, {
      defaultSubjectId: options.defaultSubjectId ? Number(options.defaultSubjectId) : null,
      defaultExamId: options.defaultExamId ? Number(options.defaultExamId) : null,
      defaultClassId: options.defaultClassId ? Number(options.defaultClassId) : null,
      defaultSectionId:
        options.defaultSectionId && String(options.defaultSectionId) !== 'all'
          ? Number(options.defaultSectionId)
          : null,
      subjects: allYearSubjects,
      teacherAssignments: req.admin!.assignments,
      restrictToTeacher: req.admin!.role === 'teacher',
    });

    if (req.admin!.role === 'teacher') {
      preview.rows.forEach((r) => {
        if (r.normalized && !isTeacherAllowedExamName(r.normalized.examName)) {
          r.valid = false;
          r.errors.push('غير مخول: المدرس يرفع درجات الأشهر وسعي الفصلين فقط.');
          r.normalized = undefined;
        }
      });
      preview.validCount = preview.rows.filter((r) => r.valid).length;
      preview.invalidCount = preview.rows.length - preview.validCount;
    }

    const validRows = preview.rows.filter((r) => r.valid && r.normalized);

    const requestedStatus: GradeStatus =
      options.targetStatus === 'published' && hasPermission(req.admin!, 'publishGrades')
        ? 'published'
        : 'draft';
    const publishedAtValue =
      requestedStatus === 'published' ? new Date().toISOString().slice(0, 19).replace('T', ' ') : null;

    const upsertStmt = db.prepare(`
      INSERT INTO grades (academic_year_id, student_id, subject_id, exam_id, score, status, notes, updated_by, updated_at, published_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)
      ON CONFLICT(student_id, subject_id, exam_id) DO UPDATE SET
        academic_year_id = excluded.academic_year_id,
        score = excluded.score,
        status = excluded.status,
        notes = excluded.notes,
        updated_by = excluded.updated_by,
        updated_at = datetime('now'),
        published_at = excluded.published_at
    `);
    const tx = db.transaction(() => {
      for (const row of validRows) {
        const n = row.normalized!;
        upsertStmt.run(
          yearId,
          n.studentId,
          n.subjectId,
          n.examId,
          n.score,
          requestedStatus,
          n.notes,
          req.admin!.username,
          publishedAtValue
        );
        if (matchIraqiExamSlot(n.examName) === 'secondRound') {
          syncSecondRoundFinalGrade(db, {
            yearId,
            studentId: n.studentId,
            subjectId: n.subjectId,
            secondRoundScore: n.score,
            status: requestedStatus,
            publishedAt: publishedAtValue,
            actor: req.admin!.username,
          });
        }
      }
    });
    tx();

    recordAuditLog(
      req.admin!.username,
      'IMPORT_GRADES',
      'grade',
      'batch',
      `استيراد ${validRows.length} درجة (${requestedStatus === 'published' ? 'نشر مباشر' : 'مسودة'}) — مرفوض: ${preview.invalidCount}`
    );
    triggerAutoBackupSnapshot();
    res.json({
      importedCount: validRows.length,
      rejectedCount: preview.invalidCount,
      rejectedRows: preview.rows.filter((r) => !r.valid),
    });
  });

  app.get('/api/admin/export/template/:type', requireAdmin, (req: AdminRequest, res) => {
    const yearId = resolveAcademicYearId(req.query.yearId);
    const type = req.params.type === 'grades' ? 'grades' : 'students';
    const mode = String(req.query.mode ?? '').trim();
    const classId = req.query.classId ? Number(req.query.classId) : null;
    const rawSectionId = String(req.query.sectionId ?? '').trim();
    const sectionId = rawSectionId && rawSectionId !== 'all' ? Number(rawSectionId) : null;
    const rawSubjectId = String(req.query.subjectId ?? '').trim();
    const isAllSubjects = mode === 'general' || rawSubjectId === 'all';
    const subjectId = !isAllSubjects && rawSubjectId ? Number(rawSubjectId) : null;
    const examId = req.query.examId ? Number(req.query.examId) : null;

    const wb = XLSX.utils.book_new();
    let downloadName = `${type}_template.xlsx`;

    if (type === 'students') {
      const selectedClass = classId ? listClasses().find((c) => c.id === classId) : listClasses()[0];
      const selectedSection = sectionId
        ? listSections(yearId).find((s) => s.id === sectionId)
        : selectedClass
          ? listSections(yearId).find((s) => s.classId === selectedClass.id)
          : undefined;

      const matchingStudents = listStudents(yearId).filter(
        (st) =>
          st.isActive &&
          (!classId || st.classId === classId) &&
          (!sectionId || st.sectionId === sectionId)
      );

      const sheetRows =
        classId && matchingStudents.length > 0
          ? matchingStudents.map((st, idx) => ({
              'ت': idx + 1,
              'اسم الطالب': st.fullName,
              'رقم الهوية الوطنية': st.inquiryCode,
              'الصف': st.className || selectedClass?.name || 'السادس العلمي',
              'الشعبة': st.sectionName || selectedSection?.name || 'أ',
              'ملاحظات': st.notes || '',
            }))
          : [
              {
                'ت': 1,
                'اسم الطالب': 'أمير حسين عبد الله كاظم',
                'رقم الهوية الوطنية': '2026301',
                'الصف': selectedClass?.name || 'السادس العلمي',
                'الشعبة': selectedSection?.name || 'أ',
                'ملاحظات': '',
              },
            ];
      const ws = XLSX.utils.json_to_sheet(sheetRows);
      applyArabicSheetLayout(wb, ws, sheetRows);
      XLSX.utils.book_append_sheet(wb, ws, 'الطلاب');
    } else if (isAllSubjects) {
      downloadName = 'general_all_subjects_grades_template.xlsx';
      const exams = listExams(yearId);
      const examName = examId
        ? exams.find((e) => e.id === examId)?.name || 'الشهر الأول (الفصل الأول)'
        : exams[0]?.name || 'الشهر الأول (الفصل الأول)';

      let sampleStudents = listStudents(yearId).filter((st) => st.isActive);
      if (classId) {
        sampleStudents = sampleStudents.filter((st) => st.classId === classId);
      }
      if (sectionId) {
        sampleStudents = sampleStudents.filter((st) => st.sectionId === sectionId);
      }
      if (req.admin!.role === 'teacher') {
        const assignments = req.admin!.assignments ?? [];
        sampleStudents = sampleStudents.filter((st) =>
          assignments.some((a) => a.classId === st.classId && (a.sectionId === null || a.sectionId === st.sectionId))
        );
      }

      const templateClsObj = classId
        ? listClasses().find((c) => c.id === classId)
        : listClasses()[0];
      const effectiveTemplateClassId = templateClsObj?.id ?? classId;
      const applicableSubjects = listSubjects(yearId)
        .filter(
          (sub) =>
            sub.isActive &&
            (!effectiveTemplateClassId || sub.classId === null || sub.classId === effectiveTemplateClassId) &&
            (!sectionId || sub.sectionId === null || sub.sectionId === sectionId) &&
            !isSubjectExcludedForClass(sub.name, templateClsObj?.name, templateClsObj?.isMinisterial)
        )
        .sort((a, b) => a.displayOrder - b.displayOrder || a.id - b.id);

      const fallbackClassName =
        (classId ? listClasses().find((c) => c.id === classId)?.name : undefined) ||
        listClasses()[0]?.name ||
        'السادس العلمي';
      const fallbackSectionName =
        (sectionId ? listSections(yearId).find((s) => s.id === sectionId)?.name : undefined) || 'أ';

      const sourceList =
        sampleStudents.length > 0
          ? sampleStudents
          : [
              {
                id: 0,
                fullName: 'حيدر علي حسين الكعبي',
                inquiryCode: '2026101',
                className: fallbackClassName,
                sectionName: fallbackSectionName,
              },
            ];

      const sheetRows = sourceList.map((st, idx) => {
        const row: Record<string, string | number> = {
          'ت': idx + 1,
          'اسم الطالب': st.fullName,
          'رقم الهوية الوطنية': st.inquiryCode,
          'الصف': st.className || fallbackClassName,
          'الشعبة': st.sectionName || fallbackSectionName,
          'الامتحان': examName,
        };
        for (const sub of applicableSubjects) {
          row[sub.name] = '';
        }
        row['ملاحظات'] = '';
        return row;
      });

      const ws = XLSX.utils.json_to_sheet(sheetRows);
      applyArabicSheetLayout(wb, ws, sheetRows);
      XLSX.utils.book_append_sheet(wb, ws, 'القالب العام لكل المواد');
    } else {
      const subjects = listSubjects(yearId);
      const exams = listExams(yearId);
      const subjectName = subjectId
        ? subjects.find((s) => s.id === subjectId)?.name || 'الرياضيات'
        : subjects[0]?.name || 'الرياضيات';
      const examName = examId
        ? exams.find((e) => e.id === examId)?.name || 'الشهر الأول (الفصل الأول)'
        : exams[0]?.name || 'الشهر الأول (الفصل الأول)';

      let sampleStudents = listStudents(yearId).filter((st) => st.isActive);
      if (classId) {
        sampleStudents = sampleStudents.filter((st) => st.classId === classId);
      }
      if (sectionId) {
        sampleStudents = sampleStudents.filter((st) => st.sectionId === sectionId);
      }
      if (req.admin!.role === 'teacher') {
        const assignments = req.admin!.assignments ?? [];
        sampleStudents = sampleStudents.filter((st) =>
          assignments.some((a) => a.classId === st.classId && (a.sectionId === null || a.sectionId === st.sectionId))
        );
      }

      const selectedClassName =
        (classId ? listClasses().find((c) => c.id === classId)?.name : undefined) ||
        listClasses()[0]?.name ||
        'السادس العلمي';
      const selectedSectionName =
        (sectionId ? listSections(yearId).find((s) => s.id === sectionId)?.name : undefined) || 'أ';

      const sheetRows =
        classId && sampleStudents.length > 0
          ? sampleStudents.map((st, idx) => ({
              'ت': idx + 1,
              'اسم الطالب': st.fullName,
              'رقم الهوية الوطنية': st.inquiryCode,
              'الصف': st.className || selectedClassName,
              'الشعبة': st.sectionName || selectedSectionName,
              'المادة': subjectName,
              'الامتحان': examName,
              'الدرجة': '',
              'ملاحظات': '',
            }))
          : [
              {
                'ت': 1,
                'اسم الطالب': sampleStudents[0]?.fullName || 'حيدر علي حسين الكعبي',
                'رقم الهوية الوطنية': sampleStudents[0]?.inquiryCode || '2026101',
                'الصف': sampleStudents[0]?.className || selectedClassName,
                'الشعبة': sampleStudents[0]?.sectionName || selectedSectionName,
                'المادة': subjectName,
                'الامتحان': examName,
                'الدرجة': 92,
                'ملاحظات': '',
              },
            ];

      const ws = XLSX.utils.json_to_sheet(sheetRows);
      applyArabicSheetLayout(wb, ws, sheetRows);
      XLSX.utils.book_append_sheet(wb, ws, 'الدرجات');
    }

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    const yearObj = getAcademicYearById(yearId) ?? getCurrentAcademicYear();
    const clsObj = classId ? listClasses().find((c) => c.id === classId) : undefined;
    const secObj = sectionId ? listSections(yearId).find((s) => s.id === sectionId) : undefined;
    const subObj = subjectId ? listSubjects(yearId).find((s) => s.id === subjectId) : undefined;
    const exObj = examId ? listExams(yearId).find((e) => e.id === examId) : undefined;
    const arabicFilename = buildScopedArabicFilename({
      prefix: type === 'students' ? 'قالب_الطلاب' : isAllSubjects ? 'قالب_الدرجات_كل_المواد' : 'قالب_درجات',
      academicYear: yearObj.name,
      className: clsObj?.name,
      sectionName: secObj?.name || (classId && !sectionId ? 'جميع_الشعب' : undefined),
      subjectName: type === 'grades' && !isAllSubjects ? subObj?.name : undefined,
      examName: type === 'grades' ? exObj?.name : undefined,
      ext: 'xlsx',
    });
    sendAttachmentBuffer(
      res,
      buf,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      arabicFilename,
      downloadName
    );
  });

  app.get('/api/admin/export/students.xlsx', requireAdmin, requireManager, requirePerm('manageImportExport'), (req, res) => {
    const yearId = resolveAcademicYearId(req.query.yearId);
    const yearObj = getAcademicYearById(yearId) ?? getCurrentAcademicYear();
    const classId = req.query.classId ? Number(req.query.classId) : null;
    const sectionId = req.query.sectionId ? Number(req.query.sectionId) : null;

    let students = listStudents(yearId);
    if (classId) students = students.filter((s) => s.classId === classId);
    if (sectionId) students = students.filter((s) => s.sectionId === sectionId);
    students = sortStudentsAlphabetically(students);

    const sheetRows = students.map((s, idx) => ({
      'ت': idx + 1,
      'اسم الطالب': s.fullName,
      'رقم الهوية الوطنية': s.inquiryCode,
      'الصف': s.className,
      'الشعبة': s.sectionName,
      'الحالة': s.isActive ? 'نشط' : 'معطل',
    }));
    const wb = XLSX.utils.book_new();
    createArabicWorksheet(wb, 'الطلاب', sheetRows, ['ت', 'اسم الطالب', 'رقم الهوية الوطنية', 'الصف', 'الشعبة', 'الحالة']);
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    const clsName = classId ? listClasses().find((c) => c.id === classId)?.name : 'جميع_الصفوف';
    const secName = sectionId ? listSections(yearId).find((s) => s.id === sectionId)?.name : undefined;
    const arabicName = buildScopedArabicFilename({
      prefix: 'قائمة_الطلاب',
      academicYear: yearObj.name,
      className: clsName,
      sectionName: secName,
      ext: 'xlsx',
    });
    sendAttachmentBuffer(
      res,
      buf,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      arabicName,
      'students_export.xlsx'
    );
  });

  app.get('/api/admin/export/grades.xlsx', requireAdmin, requireManager, requirePerm('manageImportExport'), (req, res) => {
    const yearId = resolveAcademicYearId(req.query.yearId);
    const yearObj = getAcademicYearById(yearId) ?? getCurrentAcademicYear();
    const classId = req.query.classId ? Number(req.query.classId) : null;
    const sectionId = req.query.sectionId ? Number(req.query.sectionId) : null;
    const examId = req.query.examId ? Number(req.query.examId) : null;
    const subjectId = req.query.subjectId ? Number(req.query.subjectId) : null;

    let sql = `
      SELECT st.full_name as studentName, st.inquiry_code as inquiryCode,
             c.name as className, sec.name as sectionName,
             e.name as examName, sub.name as subjectName, sub.max_score as maxScore,
             g.score, g.status, g.notes
      FROM grades g
      JOIN students st ON st.id = g.student_id
      JOIN classes c ON c.id = st.class_id
      JOIN sections sec ON sec.id = st.section_id
      JOIN exams e ON e.id = g.exam_id
      JOIN subjects sub ON sub.id = g.subject_id
      WHERE g.academic_year_id = ?
    `;
    const params: unknown[] = [yearId];
    if (classId) {
      sql += ' AND st.class_id = ?';
      params.push(classId);
    }
    if (sectionId) {
      sql += ' AND st.section_id = ?';
      params.push(sectionId);
    }
    if (examId) {
      sql += ' AND g.exam_id = ?';
      params.push(examId);
    }
    if (subjectId) {
      sql += ' AND g.subject_id = ?';
      params.push(subjectId);
    }
    sql += ' ORDER BY c.display_order ASC, sec.name ASC, st.full_name ASC, sub.display_order ASC';

    const rows = getDb().prepare(sql).all(...params) as any[];
    const sheetRows = rows.map((r, idx) => ({
      'ت': idx + 1,
      'اسم الطالب': r.studentName,
      'رقم الهوية الوطنية': r.inquiryCode,
      'الصف': r.className,
      'الشعبة': r.sectionName,
      'الامتحان': r.examName,
      'المادة': r.subjectName,
      'الدرجة': r.score !== null && r.score !== undefined ? r.score : '—',
      'النهاية العظمى': r.maxScore,
      'الحالة': GRADE_STATUS_LABELS[r.status as GradeStatus] ?? r.status ?? 'مسودة',
      'الملاحظات': r.notes ?? '',
    }));
    const wb = XLSX.utils.book_new();
    createArabicWorksheet(wb, 'الدرجات', sheetRows, [
      'ت',
      'اسم الطالب',
      'رقم الهوية الوطنية',
      'الصف',
      'الشعبة',
      'الامتحان',
      'المادة',
      'الدرجة',
      'النهاية العظمى',
      'الحالة',
      'الملاحظات',
    ]);
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    const arabicName = buildScopedArabicFilename({
      prefix: 'سجل_الدرجات',
      academicYear: yearObj.name,
      className: classId ? listClasses().find((c) => c.id === classId)?.name : undefined,
      sectionName: sectionId ? listSections(yearId).find((s) => s.id === sectionId)?.name : undefined,
      subjectName: subjectId ? listSubjects(yearId).find((s) => s.id === subjectId)?.name : undefined,
      examName: examId ? listExams(yearId).find((e) => e.id === examId)?.name : undefined,
      ext: 'xlsx',
    });
    sendAttachmentBuffer(
      res,
      buf,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      arabicName,
      'grades_export.xlsx'
    );
  });

  app.get('/api/admin/export/grade6-qualification.xlsx', requireAdmin, requireManager, requirePerm('manageImportExport'), (req, res) => {
    const yearId = resolveAcademicYearId(req.query.yearId);
    const yearObj = getAcademicYearById(yearId) ?? getCurrentAcademicYear();
    const classId = req.query.classId ? Number(req.query.classId) : null;
    const rawSectionId = String(req.query.sectionId ?? 'all').trim();
    const sectionId = rawSectionId && rawSectionId !== 'all' ? Number(rawSectionId) : null;

    let students = listStudents(yearId).filter((s) => s.isActive);
    if (classId) students = students.filter((s) => s.classId === classId);
    if (sectionId) students = students.filter((s) => s.sectionId === sectionId);
    students = sortStudentsAlphabetically(students);

    const clsObj = classId ? listClasses().find((c) => c.id === classId) : undefined;
    const subjects = listSubjects(yearId)
      .filter(
        (s) =>
          s.isActive &&
          (!classId || s.classId === null || s.classId === classId) &&
          !isSubjectExcludedForClass(s.name, clsObj?.name, clsObj ? clsObj.isMinisterial : true)
      )
      .sort((a, b) => a.displayOrder - b.displayOrder || a.id - b.id);

    const allSubjQuals = listGrade6SubjectQualifications(yearId);
    const allOverallQuals = listGrade6OverallQualifications(yearId);
    const subjMap = new Map<string, string | null>();
    allSubjQuals.forEach((q) => subjMap.set(`${q.studentId}:${q.subjectId}`, q.decision));
    const overallMap = new Map<number, string | null>();
    allOverallQuals.forEach((q) => overallMap.set(q.studentId, q.decision));

    const annualExam = listExams(yearId).find((e) => e.name.includes('السعي السنوي'));
    const annualGrades = annualExam
      ? listGrades(yearId).filter((g) => g.examId === annualExam.id && g.score !== null)
      : [];
    const annualEffortMap = new Map<string, number | null>();
    annualGrades.forEach((g) => annualEffortMap.set(`${g.studentId}:${g.subjectId}`, g.score));

    const sheetRows = students.map((st, idx) => {
      const row: Record<string, string | number> = {
        'ت': idx + 1,
        'اسم الطالب': st.fullName,
        'رقم الهوية الوطنية': st.inquiryCode,
        'الصف': st.className || '',
        'الشعبة': st.sectionName || '',
      };
      for (const sub of subjects) {
        const eff = annualEffortMap.get(`${st.id}:${sub.id}`);
        row[`سعي - ${sub.name}`] = eff !== null && eff !== undefined ? eff : '—';
        const d = subjMap.get(`${st.id}:${sub.id}`);
        row[`تأهيل - ${sub.name}`] = d === 'qualified' ? 'مؤهل' : d === 'not_qualified' ? 'غير مؤهل' : '—';
      }
      const od = overallMap.get(st.id);
      row['التأهيل الوزاري العام'] = od === 'qualified' ? 'مؤهل' : od === 'not_qualified' ? 'غير مؤهل' : '—';
      return row;
    });

    const fallbackHeaders = [
      'ت',
      'اسم الطالب',
      'رقم الهوية الوطنية',
      'الصف',
      'الشعبة',
      ...subjects.flatMap((s) => [`سعي - ${s.name}`, `تأهيل - ${s.name}`]),
      'التأهيل الوزاري العام',
    ];

    const wb = XLSX.utils.book_new();
    createArabicWorksheet(wb, 'سجل التأهيل الوزاري', sheetRows, fallbackHeaders);
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    const clsName = classId ? listClasses().find((c) => c.id === classId)?.name : 'السادس الإعدادي';
    const secName = sectionId ? listSections(yearId).find((s) => s.id === sectionId)?.name : undefined;
    const arabicName = buildScopedArabicFilename({
      prefix: 'سجل_تأهيل_السادس_الوزاري',
      academicYear: yearObj.name,
      className: clsName,
      sectionName: secName,
      ext: 'xlsx',
    });
    sendAttachmentBuffer(
      res,
      buf,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      arabicName,
      'grade6_qualification_register.xlsx'
    );
  });

  app.get('/api/admin/export/exemptions.xlsx', requireAdmin, requireManager, requirePerm('manageImportExport'), (req, res) => {
    const yearId = resolveAcademicYearId(req.query.yearId);
    const yearObj = getAcademicYearById(yearId) ?? getCurrentAcademicYear();
    const classId = req.query.classId ? Number(req.query.classId) : null;
    const rawSectionId = String(req.query.sectionId ?? 'all').trim();
    const sectionId = rawSectionId && rawSectionId !== 'all' ? Number(rawSectionId) : null;

    let students = listStudents(yearId).filter((s) => s.isActive);
    if (classId) students = students.filter((s) => s.classId === classId);
    if (sectionId) students = students.filter((s) => s.sectionId === sectionId);
    students = sortStudentsAlphabetically(students);

    const exClsObj = classId ? listClasses().find((c) => c.id === classId) : undefined;
    const subjects = listSubjects(yearId)
      .filter(
        (s) =>
          s.isActive &&
          (!classId || s.classId === null || s.classId === classId) &&
          !isSubjectExcludedForClass(s.name, exClsObj?.name, exClsObj?.isMinisterial)
      )
      .sort((a, b) => a.displayOrder - b.displayOrder || a.id - b.id);

    const allSubjExemptions = listSubjectExemptions(yearId);
    const allOverallExemptions = listOverallExemptions(yearId);
    const subjExMap = new Map<string, string | null>();
    allSubjExemptions.forEach((e) => subjExMap.set(`${e.studentId}:${e.subjectId}`, e.decision));
    const ovExMap = new Map<number, { decision: string | null; avg: number | null }>();
    allOverallExemptions.forEach((e) => ovExMap.set(e.studentId, { decision: e.decision, avg: e.annualAverage }));

    const annualExam = listExams(yearId).find((e) => e.name.includes('السعي السنوي'));
    const annualGrades = annualExam
      ? listGrades(yearId).filter((g) => g.examId === annualExam.id && g.score !== null)
      : [];
    const annualEffortMap = new Map<string, number | null>();
    annualGrades.forEach((g) => annualEffortMap.set(`${g.studentId}:${g.subjectId}`, g.score));

    const sheetRows = students.map((st, idx) => {
      const ov = ovExMap.get(st.id);
      const row: Record<string, string | number> = {
        'ت': idx + 1,
        'اسم الطالب': st.fullName,
        'رقم الهوية الوطنية': st.inquiryCode,
        'الصف': st.className || '',
        'الشعبة': st.sectionName || '',
        'معدل السعي السنوي': ov?.avg !== null && ov?.avg !== undefined ? ov.avg : '—',
      };
      for (const sub of subjects) {
        const eff = annualEffortMap.get(`${st.id}:${sub.id}`);
        row[`سعي - ${sub.name}`] = eff !== null && eff !== undefined ? eff : '—';
        const d = subjExMap.get(`${st.id}:${sub.id}`);
        row[`إعفاء - ${sub.name}`] = d === 'exempt' ? 'معفو' : d === 'not_exempt' ? 'غير معفو' : '—';
      }
      row['الإعفاء العام'] = ov?.decision === 'exempt' ? 'معفو عام' : ov?.decision === 'not_exempt' ? 'غير معفو' : '—';
      return row;
    });

    const fallbackHeaders = [
      'ت',
      'اسم الطالب',
      'رقم الهوية الوطنية',
      'الصف',
      'الشعبة',
      'معدل السعي السنوي',
      ...subjects.flatMap((s) => [`سعي - ${s.name}`, `إعفاء - ${s.name}`]),
      'الإعفاء العام',
    ];

    const wb = XLSX.utils.book_new();
    createArabicWorksheet(wb, 'سجل الإعفاءات', sheetRows, fallbackHeaders);
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    const clsName = classId ? listClasses().find((c) => c.id === classId)?.name : 'الصفوف غير الوزارية';
    const secName = sectionId ? listSections(yearId).find((s) => s.id === sectionId)?.name : undefined;
    const arabicName = buildScopedArabicFilename({
      prefix: 'سجل_الإعفاءات',
      academicYear: yearObj.name,
      className: clsName,
      sectionName: secName,
      ext: 'xlsx',
    });
    sendAttachmentBuffer(
      res,
      buf,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      arabicName,
      'exemptions_register.xlsx'
    );
  });

  // =========================================================================
  // MANAGER-ONLY GROUP EXAM RESULTS ROSTER (JSON / WORD / EXCEL)
  // =========================================================================

  function computeRosterFromQuery(req: express.Request) {
    const yearId = resolveAcademicYearId(req.query.yearId);
    const yearObj = getAcademicYearById(yearId) ?? getCurrentAcademicYear();
    const examId = Number(req.query.examId);
    const classId = Number(req.query.classId);
    const rawSection = String(req.query.sectionId ?? 'all').trim();
    const rawSubject = String(req.query.subjectId ?? 'all').trim();
    const onlyPublished = req.query.onlyPublished !== 'false';

    const exam = listExams(yearId).find((e) => e.id === examId);
    const schoolClass = listClasses().find((c) => c.id === classId);
    if (!exam || !schoolClass) {
      return { error: 'يرجى اختيار الامتحان والصف الدراسي الصحيحين.' };
    }
    const section =
      rawSection && rawSection !== 'all'
        ? listSections(yearId).find((s) => s.id === Number(rawSection) && s.classId === schoolClass.id) ?? null
        : null;
    const subjectId =
      rawSubject && rawSubject !== 'all' && Number.isInteger(Number(rawSubject))
        ? Number(rawSubject)
        : null;

    const roster = buildGroupExamRoster({
      settings: { ...getSettings(), academicYear: yearObj.name },
      exam,
      schoolClass,
      section,
      students: listStudents(yearId),
      subjects: listSubjects(yearId),
      grades: listGrades(yearId),
      onlyPublished,
      subjectId,
    });
    return { roster };
  }

  app.get('/api/admin/group-results', requireAdmin, requireManager, (req, res) => {
    const result = computeRosterFromQuery(req);
    if ('error' in result) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.json({ roster: result.roster });
  });

  app.get('/api/admin/group-individual-cards', requireAdmin, requireManager, (req, res) => {
    const yearId = resolveAcademicYearId(req.query.yearId);
    const yearObj = getAcademicYearById(yearId) ?? getCurrentAcademicYear();
    const rawExamId = String(req.query.examId ?? 'all').trim();
    const classId = Number(req.query.classId);
    const rawSectionId = String(req.query.sectionId ?? 'all').trim();
    const onlyPublished = req.query.onlyPublished !== 'false';

    if (!Number.isInteger(classId) || classId <= 0) {
      res.status(400).json({ error: 'يرجى اختيار الصف الدراسي.' });
      return;
    }

    const schoolClass = listClasses().find((c) => c.id === classId);
    const isMinisterial = Boolean(schoolClass?.isMinisterial);

    const sectionId =
      rawSectionId && rawSectionId !== 'all' && Number.isInteger(Number(rawSectionId))
        ? Number(rawSectionId)
        : null;

    const scopedStudents = listStudents(yearId)
      .filter(
        (st) =>
          st.isActive &&
          st.classId === classId &&
          (sectionId === null || st.sectionId === sectionId)
      )
      .sort((a, b) => {
        const secCmp = (a.sectionName || '').localeCompare(b.sectionName || '', 'ar');
        if (secCmp !== 0) return secCmp;
        return a.fullName.localeCompare(b.fullName, 'ar');
      });

    const activeExams = listExams(yearId).filter((e) => e.isActive);
    const activeSubjects = listSubjects(yearId).filter((s) => s.isActive);
    const settings = { ...getSettings(), academicYear: yearObj.name };
    const allGrades = listGrades(yearId).filter((g) => g.score !== null);
    const allSubjQuals = isMinisterial ? listGrade6SubjectQualifications(yearId) : [];
    const allOverallQuals = isMinisterial ? listGrade6OverallQualifications(yearId) : [];
    const allSubjExemptions = !isMinisterial ? listSubjectExemptions(yearId) : [];
    const allOverallExemptions = !isMinisterial ? listOverallExemptions(yearId) : [];

    if (rawExamId === 'all') {
      const cards = [];
      for (const student of scopedStudents) {
        const stuGrades = allGrades
          .filter((g) => g.studentId === student.id && (!onlyPublished || g.status === 'published'))
          .map((g) => (onlyPublished ? g : { ...g, status: 'published' as const }));

        const stuSubjQuals = isMinisterial
          ? allSubjQuals
              .filter((q) => q.studentId === student.id && (!onlyPublished || q.status === 'published'))
              .map((q) => (onlyPublished ? q : { ...q, status: 'published' as const }))
          : [];
        const rawOverall = isMinisterial
          ? allOverallQuals.find((q) => q.studentId === student.id && (!onlyPublished || q.status === 'published')) ??
            null
          : null;
        const stuOverallQual =
          rawOverall && !onlyPublished ? { ...rawOverall, status: 'published' as const } : rawOverall;

        const stuSubjEx = !isMinisterial
          ? allSubjExemptions
              .filter((e) => e.studentId === student.id && (!onlyPublished || e.status === 'published'))
              .map((e) => (onlyPublished ? e : { ...e, status: 'published' as const }))
          : [];
        const rawOvEx = !isMinisterial
          ? allOverallExemptions.find((e) => e.studentId === student.id && (!onlyPublished || e.status === 'published')) ??
            null
          : null;
        const stuOvEx = rawOvEx && !onlyPublished ? { ...rawOvEx, status: 'published' as const } : rawOvEx;

        const card = buildAllPublishedReportCard({
          student,
          className: student.className || '',
          sectionName: student.sectionName || '',
          exams: activeExams,
          subjects: activeSubjects,
          grades: stuGrades,
          settings,
          academicYearLabel: yearObj.name,
          isMinisterial,
          subjectQualifications: stuSubjQuals,
          overallQualification: stuOverallQual,
          subjectExemptions: stuSubjEx,
          overallExemption: stuOvEx,
        });
        if (card) cards.push(card);
      }
      res.json({ mode: 'all', cards });
      return;
    }

    const examId = Number(rawExamId);
    const targetExam = activeExams.find((e) => e.id === examId);
    if (!targetExam) {
      res.status(404).json({ error: 'الامتحان المحدد غير موجود.' });
      return;
    }

    const cards = [];
    for (const student of scopedStudents) {
      const stuGrades = allGrades
        .filter((g) => g.studentId === student.id && (!onlyPublished || g.status === 'published'))
        .map((g) => (onlyPublished ? g : { ...g, status: 'published' as const }));
      const card = buildComputedSingleExamReportCard({
        student,
        className: student.className || '',
        sectionName: student.sectionName || '',
        targetExam,
        allExams: activeExams,
        subjects: activeSubjects,
        allGrades: stuGrades,
        settings,
      });
      if (card) cards.push(card);
    }
    res.json({ mode: 'single', cards });
  });

  app.get('/api/admin/group-individual-cards/pdf', requireAdmin, requireManager, async (req, res) => {
    const yearId = resolveAcademicYearId(req.query.yearId);
    const yearObj = getAcademicYearById(yearId) ?? getCurrentAcademicYear();
    const rawExamId = String(req.query.examId ?? 'all').trim();
    const classId = Number(req.query.classId);
    const rawSectionId = String(req.query.sectionId ?? 'all').trim();
    const onlyPublished = req.query.onlyPublished !== 'false';
    const sectionId = rawSectionId && rawSectionId !== 'all' ? Number(rawSectionId) : null;

    const schoolClass = listClasses().find((c) => c.id === classId);
    if (!schoolClass) {
      res.status(400).json({ error: 'يرجى اختيار الصف الدراسي.' });
      return;
    }
    const isMinisterial = Boolean(schoolClass.isMinisterial);
    const scopedStudents = sortStudentsAlphabetically(
      listStudents(yearId).filter(
        (st) => st.isActive && st.classId === classId && (sectionId === null || st.sectionId === sectionId)
      )
    );
    const activeExams = listExams(yearId).filter((e) => e.isActive);
    const activeSubjects = listSubjects(yearId).filter((s) => s.isActive);
    const settings = { ...getSettings(), academicYear: yearObj.name };
    const allGrades = listGrades(yearId).filter((g) => g.score !== null);

    let pdfBuf: Buffer;
    let examLabel: string | undefined;

    if (rawExamId !== 'all') {
      const examIdNum = Number(rawExamId);
      const targetExam = activeExams.find((e) => e.id === examIdNum);
      if (!targetExam) {
        res.status(404).json({ error: 'الامتحان المحدد غير موجود.' });
        return;
      }
      examLabel = targetExam.name;
      const singleCards = [];
      for (const student of scopedStudents) {
        const stuGrades = allGrades
          .filter((g) => g.studentId === student.id && (!onlyPublished || g.status === 'published'))
          .map((g) => (onlyPublished ? g : { ...g, status: 'published' as const }));
        const card = buildComputedSingleExamReportCard({
          student,
          className: student.className || '',
          sectionName: student.sectionName || '',
          targetExam,
          allExams: activeExams,
          subjects: activeSubjects,
          allGrades: stuGrades,
          settings,
        });
        if (card) singleCards.push(card);
      }

      if (singleCards.length === 0) {
        res.status(404).json({ error: 'لا توجد بطاقات نتائج صالحة للتصدير ضمن هذا الامتحان.' });
        return;
      }
      pdfBuf = await generateMultipleSingleExamReportCardsPdf(singleCards);
    } else {
      const allSubjQuals = isMinisterial ? listGrade6SubjectQualifications(yearId) : [];
      const allOverallQuals = isMinisterial ? listGrade6OverallQualifications(yearId) : [];
      const allSubjExemptions = !isMinisterial ? listSubjectExemptions(yearId) : [];
      const allOverallExemptions = !isMinisterial ? listOverallExemptions(yearId) : [];

      const cards = [];
      for (const student of scopedStudents) {
        const stuGrades = allGrades
          .filter((g) => g.studentId === student.id && (!onlyPublished || g.status === 'published'))
          .map((g) => (onlyPublished ? g : { ...g, status: 'published' as const }));
        const card = buildAllPublishedReportCard({
          student,
          className: student.className || '',
          sectionName: student.sectionName || '',
          exams: activeExams,
          subjects: activeSubjects,
          grades: stuGrades,
          settings,
          academicYearLabel: yearObj.name,
          isMinisterial,
          subjectQualifications: isMinisterial
            ? allSubjQuals
                .filter((q) => q.studentId === student.id && (!onlyPublished || q.status === 'published'))
                .map((q) => (onlyPublished ? q : { ...q, status: 'published' as const }))
            : [],
          overallQualification: isMinisterial
            ? (() => {
                const ov = allOverallQuals.find(
                  (q) => q.studentId === student.id && (!onlyPublished || q.status === 'published')
                );
                return ov && !onlyPublished ? { ...ov, status: 'published' as const } : ov ?? null;
              })()
            : null,
          subjectExemptions: !isMinisterial
            ? allSubjExemptions
                .filter((e) => e.studentId === student.id && (!onlyPublished || e.status === 'published'))
                .map((e) => (onlyPublished ? e : { ...e, status: 'published' as const }))
            : [],
          overallExemption: !isMinisterial
            ? (() => {
                const ov = allOverallExemptions.find(
                  (e) => e.studentId === student.id && (!onlyPublished || e.status === 'published')
                );
                return ov && !onlyPublished ? { ...ov, status: 'published' as const } : ov ?? null;
              })()
            : null,
        });
        if (card) cards.push(card);
      }

      if (cards.length === 0) {
        res.status(404).json({ error: 'لا توجد بطاقات نتائج صالحة للتصدير ضمن هذا النطاق.' });
        return;
      }

      pdfBuf = await generateMultipleIraqiReportCardsPdf(cards);
    }

    const fname = buildScopedArabicFilename({
      prefix: 'بطاقات_جماعية',
      academicYear: yearObj.name,
      className: schoolClass.name,
      sectionName: sectionId ? listSections(yearId).find((s) => s.id === sectionId)?.name : 'جميع_الشعب',
      examName: examLabel,
      ext: 'pdf',
    });
    sendAttachmentBuffer(res, pdfBuf, 'application/pdf', fname, 'group-cards.pdf');
  });

  app.get('/api/admin/group-results/word', requireAdmin, requireManager, async (req: AdminRequest, res) => {
    const result = computeRosterFromQuery(req);
    if ('error' in result) {
      res.status(400).json({ error: result.error });
      return;
    }
    const { roster } = result;
    const docxBuffer = await generateGroupRosterDocx(roster);

    recordAuditLog(
      req.admin!.username,
      'EXPORT_GROUP_WORD',
      'exam_class',
      `${roster.examId}:${roster.className}`,
      `تصدير قائمة نتائج جماعية Word .docx (${roster.examName} - ${roster.className} - ${roster.sectionLabel})`
    );

    const fname = buildScopedArabicFilename({
      prefix: 'قائمة_نتائج',
      academicYear: roster.academicYear,
      className: roster.className,
      sectionName: roster.sectionLabel.replace(/^شعبة\s+/, ''),
      subjectName: roster.subjectLabel,
      examName: roster.examName,
      ext: 'docx',
    });
    sendAttachmentBuffer(
      res,
      docxBuffer,
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      fname,
      `group-results-${roster.examId}.docx`
    );
  });

  app.get('/api/admin/group-results/pdf', requireAdmin, requireManager, async (req: AdminRequest, res) => {
    const result = computeRosterFromQuery(req);
    if ('error' in result) {
      res.status(400).json({ error: result.error });
      return;
    }
    const { roster } = result;
    const pdfBuf = await generateGroupRosterPdf(roster);
    recordAuditLog(
      req.admin!.username,
      'EXPORT_GROUP_PDF',
      'exam_class',
      `${roster.examId}:${roster.className}`,
      `تصدير قائمة نتائج جماعية PDF (${roster.examName} - ${roster.className})`
    );
    const fname = buildScopedArabicFilename({
      prefix: 'قائمة_نتائج',
      academicYear: roster.academicYear,
      className: roster.className,
      sectionName: roster.sectionLabel.replace(/^شعبة\s+/, ''),
      subjectName: roster.subjectLabel,
      examName: roster.examName,
      ext: 'pdf',
    });
    sendAttachmentBuffer(res, pdfBuf, 'application/pdf', fname, `group-results-${roster.examId}.pdf`);
  });

  app.get('/api/admin/group-results/xlsx', requireAdmin, requireManager, (req: AdminRequest, res) => {
    const result = computeRosterFromQuery(req);
    if ('error' in result) {
      res.status(400).json({ error: result.error });
      return;
    }
    const { roster } = result;
    const sheetRows = roster.rows.map((row) => {
      const out: Record<string, string | number> = {
        'ت': row.sequence,
        'اسم الطالب': row.fullName,
        'رقم الهوية الوطنية': row.inquiryCode,
      };
      if (roster.includeAllSections) {
        out['الشعبة'] = row.sectionName;
      }
      for (const sub of roster.subjects) {
        const cell = row.scoresBySubject[sub.id];
        out[sub.name] = cell && cell.score !== null ? cell.score : '—';
      }
      return out;
    });

    const wb = XLSX.utils.book_new();
    const fallbackHeaders = [
      'ت',
      'اسم الطالب',
      'رقم الهوية الوطنية',
      ...(roster.includeAllSections ? ['الشعبة'] : []),
      ...roster.subjects.map((s) => s.name),
    ];
    createArabicWorksheet(wb, 'قائمة النتائج', sheetRows, fallbackHeaders);
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

    recordAuditLog(
      req.admin!.username,
      'EXPORT_GROUP_XLSX',
      'exam_class',
      `${roster.examId}:${roster.className}`,
      `تصدير قائمة نتائج جماعية Excel (${roster.examName} - ${roster.className} - ${roster.subjectLabel})`
    );

    const fname = buildScopedArabicFilename({
      prefix: 'قائمة_نتائج',
      academicYear: roster.academicYear,
      className: roster.className,
      sectionName: roster.sectionLabel.replace(/^شعبة\s+/, ''),
      subjectName: roster.subjectLabel,
      examName: roster.examName,
      ext: 'xlsx',
    });
    sendAttachmentBuffer(
      res,
      buf,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      fname,
      `group-results-${roster.examId}.xlsx`
    );
  });

  app.post('/api/admin/upload-emblem', requireAdmin, requirePerm('manageSettings'), (req: AdminRequest, res) => {
    const dataUrl = String(req.body?.dataUrl ?? '');
    const match = /^data:image\/(png|jpeg|jpg|webp|svg\+xml);base64,([A-Za-z0-9+/=]+)$/i.exec(dataUrl);
    if (!match) {
      res.status(400).json({ error: 'صيغة الصورة غير صالحة. يرجى رفع صورة PNG أو JPG أو SVG.' });
      return;
    }
    const ext = match[1].toLowerCase() === 'svg+xml' ? 'svg' : match[1].toLowerCase() === 'jpeg' ? 'jpg' : match[1].toLowerCase();
    const buf = Buffer.from(match[2], 'base64');
    if (buf.length > 4 * 1024 * 1024) {
      res.status(400).json({ error: 'حجم الصورة يتجاوز الحد الأقصى (4 ميجابايت).' });
      return;
    }
    const filename = `school_emblem_${Date.now()}.${ext}`;
    fs.writeFileSync(path.join(uploadsDir, filename), buf);
    const url = `/uploads/${filename}`;
    getDb()
      .prepare("INSERT INTO settings (key, value, updated_at) VALUES ('emblemUrl', ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')")
      .run(url);
    recordAuditLog(req.admin!.username, 'UPLOAD_EMBLEM', 'settings', 'emblemUrl', `رفع شعار جديد للمدرسة (${filename})`);
    res.json({ url, settings: getSettings() });
  });

  // Admin preview of any student's report card (supports single exam, 'all' full Iraqi card, and optional includeDrafts)
  app.get('/api/admin/report-card', requireAdmin, requireManager, (req, res) => {
    const yearId = resolveAcademicYearId(req.query.yearId);
    const yearObj = getAcademicYearById(yearId) ?? getCurrentAcademicYear();
    const studentId = Number(req.query.studentId);
    const rawExamId = String(req.query.examId ?? '').trim();
    const includeDrafts = req.query.includeDrafts !== 'false';
    const student = listStudents(yearId).find((s) => s.id === studentId);
    if (!student) {
      res.status(404).json({ error: 'الطالب غير موجود في هذا العام الدراسي.' });
      return;
    }

    const schoolClass = listClasses().find((c) => c.id === student.classId);
    const isMinisterial = Boolean(schoolClass?.isMinisterial);
    const settings = { ...getSettings(), academicYear: yearObj.name };
    const rawGrades = listGrades(yearId).filter((g) => g.studentId === studentId && g.score !== null);
    const effectiveGrades = includeDrafts
      ? rawGrades.map((g) => ({ ...g, status: 'published' as const }))
      : rawGrades.filter((g) => g.status === 'published');

    if (rawExamId === 'all') {
      const rawSubjQuals = isMinisterial ? listGrade6SubjectQualifications(yearId, studentId) : [];
      const effectiveSubjQuals = includeDrafts
        ? rawSubjQuals.map((q) => ({ ...q, status: 'published' as const }))
        : rawSubjQuals.filter((q) => q.status === 'published');
      const rawOverall = isMinisterial ? listGrade6OverallQualifications(yearId, studentId)[0] ?? null : null;
      const effectiveOverall =
        rawOverall && (includeDrafts || rawOverall.status === 'published')
          ? includeDrafts
            ? { ...rawOverall, status: 'published' as const }
            : rawOverall
          : null;

      const allReport = buildAllPublishedReportCard({
        student,
        className: student.className || '',
        sectionName: student.sectionName || '',
        exams: listExams(yearId).filter((e) => e.isActive),
        subjects: listSubjects(yearId).filter((s) => s.isActive),
        grades: effectiveGrades,
        settings,
        academicYearLabel: yearObj.name,
        isMinisterial,
        subjectQualifications: effectiveSubjQuals,
        overallQualification: effectiveOverall,
      });
      if (!allReport) {
        res.status(404).json({ error: 'لا توجد درجات مسجلة لهذا الطالب حتى الآن.' });
        return;
      }
      res.json({ mode: 'all', allReport });
      return;
    }

    const examId = Number(rawExamId);
    const exam = listExams(yearId).find((e) => e.id === examId);
    if (!exam) {
      res.status(404).json({ error: 'الامتحان غير موجود في هذا العام الدراسي.' });
      return;
    }
    const report = buildComputedSingleExamReportCard({
      student,
      className: student.className || '',
      sectionName: student.sectionName || '',
      targetExam: exam,
      allExams: listExams(yearId).filter((e) => e.isActive),
      subjects: listSubjects(yearId),
      allGrades: effectiveGrades,
      settings,
    });
    if (!report) {
      res.status(404).json({ error: 'لا توجد درجات لهذا الطالب في هذا الامتحان.' });
      return;
    }
    res.json({ mode: 'single', report });
  });

  // =========================================================================
  // ANNOUNCEMENTS & ADMIN NOTES
  // =========================================================================

  app.get('/api/admin/announcements', requireAdmin, (_req, res) => {
    res.json({ announcements: listAnnouncements(false) });
  });

  app.post('/api/admin/announcements', requireAdmin, requirePerm('manageAnnouncements'), (req: AdminRequest, res) => {
    const title = String(req.body?.title ?? '').trim();
    const body = String(req.body?.body ?? '').trim();
    const publishDate = String(req.body?.publishDate ?? new Date().toISOString().slice(0, 10)).trim();
    const status = ['published', 'draft', 'archived'].includes(req.body?.status) ? req.body.status : 'published';

    if (!title || !body) {
      res.status(400).json({ error: 'يرجى إدخال عنوان الإعلان ونصه.' });
      return;
    }

    const info = getDb()
      .prepare('INSERT INTO announcements (title, body, publish_date, status, created_by) VALUES (?, ?, ?, ?, ?)')
      .run(title, body, publishDate, status, req.admin!.username);
    recordAuditLog(req.admin!.username, 'CREATE_ANNOUNCEMENT', 'announcement', Number(info.lastInsertRowid), title);
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  });

  app.put('/api/admin/announcements/:id', requireAdmin, requirePerm('manageAnnouncements'), (req: AdminRequest, res) => {
    const id = Number(req.params.id);
    const title = String(req.body?.title ?? '').trim();
    const body = String(req.body?.body ?? '').trim();
    const publishDate = String(req.body?.publishDate ?? '').trim();
    const status = ['published', 'draft', 'archived'].includes(req.body?.status) ? req.body.status : 'published';

    if (!title || !body) {
      res.status(400).json({ error: 'يرجى إدخال عنوان الإعلان ونصه.' });
      return;
    }

    getDb()
      .prepare('UPDATE announcements SET title = ?, body = ?, publish_date = ?, status = ? WHERE id = ?')
      .run(title, body, publishDate, status, id);
    recordAuditLog(req.admin!.username, 'UPDATE_ANNOUNCEMENT', 'announcement', id, title);
    res.json({ ok: true });
  });

  app.delete('/api/admin/announcements/:id', requireAdmin, requirePerm('manageAnnouncements'), (req: AdminRequest, res) => {
    const id = Number(req.params.id);
    getDb().prepare('DELETE FROM announcements WHERE id = ?').run(id);
    recordAuditLog(req.admin!.username, 'DELETE_ANNOUNCEMENT', 'announcement', id, 'حذف إعلان مدرسي');
    res.json({ ok: true });
  });

  app.get('/api/admin/notes', requireAdmin, (_req, res) => {
    res.json({ notes: listAdminNotes() });
  });

  app.post('/api/admin/notes', requireAdmin, requirePerm('manageNotes'), (req: AdminRequest, res) => {
    const title = String(req.body?.title ?? '').trim();
    const content = String(req.body?.content ?? '').trim();
    const color = String(req.body?.color ?? 'navy').trim();
    const pinned = req.body?.pinned ? 1 : 0;
    if (!title) {
      res.status(400).json({ error: 'يرجى إدخال عنوان الملاحظة.' });
      return;
    }
    const info = getDb()
      .prepare('INSERT INTO admin_notes (title, content, color, pinned, updated_by) VALUES (?, ?, ?, ?, ?)')
      .run(title, content, color, pinned, req.admin!.username);
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  });

  app.delete('/api/admin/notes/:id', requireAdmin, requirePerm('manageNotes'), (req, res) => {
    getDb().prepare('DELETE FROM admin_notes WHERE id = ?').run(Number(req.params.id));
    res.json({ ok: true });
  });

  // =========================================================================
  // SCHOOL SETTINGS, USERS RBAC (OWNER ONLY), BACKUPS & RESTORE (OWNER ONLY)
  // =========================================================================

  app.get('/api/admin/settings', requireAdmin, (_req, res) => {
    res.json({ settings: getSettings() });
  });

  app.put('/api/admin/settings', requireAdmin, requirePerm('manageSettings'), (req: AdminRequest, res) => {
    const allowedKeys = [
      'schoolName',
      'republicHeader',
      'ministryHeader',
      'directorate',
      'academicYear',
      'contactInfo',
      'footerText',
      'printNote',
      'emblemUrl',
      'ministrySealUrl',
      'primaryColor',
      'accentColor',
    ] as const;

    const db = getDb();
    const stmt = db.prepare(
      "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')"
    );
    const tx = db.transaction(() => {
      for (const k of allowedKeys) {
        if (typeof req.body?.[k] === 'string') {
          stmt.run(k, req.body[k].trim());
        }
      }
    });
    tx();
    recordAuditLog(req.admin!.username, 'UPDATE_SETTINGS', 'settings', 'school', 'تحديث إعدادات المدرسة والهوية البصرية');
    res.json({ settings: getSettings() });
  });

  app.get('/api/admin/users', requireAdmin, requireOwner, (req, res) => {
    const yearId = resolveAcademicYearId(req.query.yearId);
    const rows = getDb()
      .prepare('SELECT id, username, full_name, role, is_active, google_email, permissions_json, created_at, last_login_at FROM admins ORDER BY id ASC')
      .all() as Array<Record<string, unknown>>;
    res.json({ users: rows.map((row) => mapAdminRow(row, yearId)) });
  });

  app.post('/api/admin/users', requireAdmin, requireOwner, (req: AdminRequest, res) => {
    const yearId = resolveAcademicYearId(req.body?.yearId ?? req.query.yearId);
    const username = String(req.body?.username ?? '').trim();
    const fullName = String(req.body?.fullName ?? '').trim();
    const password = String(req.body?.password ?? '');
    const role = req.body?.role === 'teacher' ? 'teacher' : 'supervisor';
    const isActive = req.body?.isActive !== false ? 1 : 0;
    const permissions = (req.body?.permissions ?? {}) as Partial<AdminPermissions>;
    const assignmentsRaw = Array.isArray(req.body?.assignments) ? req.body.assignments : [];

    if (!username || !fullName || password.length < 6) {
      res.status(400).json({ error: 'يرجى إدخال اسم المستخدم والاسم الكامل وكلمة مرور لا تقل عن 6 أحرف.' });
      return;
    }

    if (role === 'teacher' && assignmentsRaw.length === 0) {
      res.status(400).json({ error: 'يرجى إسناد مادة وصف وشعبة واحدة على الأقل لحساب المدرس.' });
      return;
    }

    const safePerms: AdminPermissions =
      role === 'teacher'
        ? {
            ...TEACHER_DEFAULT_PERMISSIONS,
            publishGrades: Boolean(permissions.publishGrades),
          }
        : {
            ...OWNER_DEFAULT_PERMISSIONS,
            manageSettings: false,
            ...permissions,
          };

    const { hash, salt } = hashPassword(password);
    try {
      const info = getDb()
        .prepare(
          `INSERT INTO admins (username, full_name, role, password_hash, password_salt, is_active, permissions_json)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(username, fullName, role, hash, salt, isActive, JSON.stringify(safePerms));
      const newId = Number(info.lastInsertRowid);

      if (role === 'teacher') {
        setTeacherAssignments(
          newId,
          assignmentsRaw.map((a: any) => ({
            classId: Number(a.classId),
            sectionId: a.sectionId === null || a.sectionId === '' || a.sectionId === 'all' ? null : Number(a.sectionId),
            subjectId: Number(a.subjectId),
          })),
          yearId
        );
      }

      recordAuditLog(
        req.admin!.username,
        role === 'teacher' ? 'CREATE_TEACHER' : 'CREATE_SUPERVISOR',
        'admin',
        newId,
        `إضافة ${role === 'teacher' ? 'مدرس' : 'مشرف'}: ${fullName} (${username})`
      );
      res.status(201).json({ id: newId });
    } catch {
      res.status(409).json({ error: 'اسم المستخدم مسجل مسبقاً.' });
    }
  });

  app.put('/api/admin/users/:id', requireAdmin, requireOwner, (req: AdminRequest, res) => {
    const yearId = resolveAcademicYearId(req.body?.yearId ?? req.query.yearId);
    const id = Number(req.params.id);
    const db = getDb();
    const target = db.prepare('SELECT id, role, username, full_name FROM admins WHERE id = ?').get(id) as
      | { id: number; role: string; username: string; full_name: string }
      | undefined;

    if (!target) {
      res.status(404).json({ error: 'الحساب غير موجود.' });
      return;
    }
    if (target.role === 'owner') {
      res.status(403).json({ error: 'لا يمكن تعديل صلاحيات أو تعطيل المالك الأساسي من هذه الواجهة.' });
      return;
    }

    const fullName = String(req.body?.fullName ?? target.full_name).trim();
    const isActive = req.body?.isActive !== false ? 1 : 0;
    const newPassword = typeof req.body?.password === 'string' ? req.body.password : '';
    const permissionsObj = (req.body?.permissions ?? {}) as Partial<AdminPermissions>;
    const permissions =
      target.role === 'teacher'
        ? JSON.stringify({
            ...TEACHER_DEFAULT_PERMISSIONS,
            publishGrades: Boolean(permissionsObj.publishGrades),
          })
        : JSON.stringify(permissionsObj);

    if (newPassword && newPassword.length < 6) {
      res.status(400).json({ error: 'كلمة المرور الجديدة يجب ألا تقل عن 6 أحرف.' });
      return;
    }

    if (newPassword) {
      const { hash, salt } = hashPassword(newPassword);
      db.prepare(
        'UPDATE admins SET full_name = ?, is_active = ?, permissions_json = ?, password_hash = ?, password_salt = ? WHERE id = ?'
      ).run(fullName, isActive, permissions, hash, salt, id);
    } else {
      db.prepare('UPDATE admins SET full_name = ?, is_active = ?, permissions_json = ? WHERE id = ?').run(
        fullName,
        isActive,
        permissions,
        id
      );
    }

    if (target.role === 'teacher' && Array.isArray(req.body?.assignments)) {
      setTeacherAssignments(
        id,
        req.body.assignments.map((a: any) => ({
          classId: Number(a.classId),
          sectionId: a.sectionId === null || a.sectionId === '' || a.sectionId === 'all' ? null : Number(a.sectionId),
          subjectId: Number(a.subjectId),
        })),
        yearId
      );
    }

    recordAuditLog(
      req.admin!.username,
      target.role === 'teacher' ? 'UPDATE_TEACHER' : 'UPDATE_SUPERVISOR',
      'admin',
      id,
      `تحديث حساب ${target.role === 'teacher' ? 'المدرس' : 'المشرف'}: ${target.username} (${isActive ? 'نشط' : 'معطل'})`
    );
    res.json({ ok: true });
  });

  app.delete('/api/admin/users/:id', requireAdmin, requireOwner, (req: AdminRequest, res) => {
    const id = Number(req.params.id);
    const db = getDb();
    const target = db.prepare('SELECT id, role, username FROM admins WHERE id = ?').get(id) as
      | { id: number; role: string; username: string }
      | undefined;

    if (!target) {
      res.status(404).json({ error: 'الحساب غير موجود.' });
      return;
    }
    if (target.role === 'owner') {
      res.status(403).json({ error: 'يُحظر حذف حساب المالك الأساسي.' });
      return;
    }
    db.prepare('DELETE FROM admins WHERE id = ?').run(id);
    recordAuditLog(
      req.admin!.username,
      target.role === 'teacher' ? 'DELETE_TEACHER' : 'DELETE_SUPERVISOR',
      'admin',
      id,
      `حذف الحساب: ${target.username}`
    );
    res.json({ ok: true });
  });

  app.get('/api/admin/backups', requireAdmin, requireOwner, (_req, res) => {
    const dir = getBackupsDir();
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.db'))
      .map((filename) => {
        const stat = fs.statSync(path.join(dir, filename));
        return {
          filename,
          sizeBytes: stat.size,
          createdAt: stat.mtime.toISOString(),
        };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    res.json({ backups: files });
  });

  app.post('/api/admin/backups', requireAdmin, requireOwner, (req: AdminRequest, res) => {
    const snap = createBackupSnapshot();
    recordAuditLog(req.admin!.username, 'CREATE_BACKUP', 'backup', snap.filename, `إنشاء نسخة احتياطية: ${snap.filename}`);
    res.status(201).json({ backup: snap });
  });

  app.get('/api/admin/backups/:filename', requireAdmin, requireOwner, (req, res) => {
    const safeName = path.basename(req.params.filename);
    const filePath = path.join(getBackupsDir(), safeName);
    if (!safeName.endsWith('.db') || !fs.existsSync(filePath)) {
      res.status(404).json({ error: 'ملف النسخة الاحتياطية غير موجود.' });
      return;
    }
    res.download(filePath, safeName);
  });

  app.post('/api/admin/backups/restore', requireAdmin, requireOwner, (req: AdminRequest, res) => {
    const filename = String(req.body?.filename ?? '');
    try {
      restoreFromBackupFile(filename);
      recordAuditLog(req.admin!.username, 'RESTORE_BACKUP', 'backup', filename, `استعادة قاعدة البيانات من ${filename}`);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'تعذر استعادة النسخة الاحتياطية.' });
    }
  });

  // =========================================================================
  // GEMINI AI ROUTES (Google Search Grounding + Image Studio)
  // =========================================================================

  app.post('/api/ai/search-guidance', requireAdmin, async (req, res) => {
    const query = String(req.body?.query ?? '').trim();
    if (!query) {
      res.status(400).json({ error: 'يرجى إدخال نص الاستفسار التربوي.' });
      return;
    }
    try {
      const result = await searchEducationalGuidance(query);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'تعذر إتمام البحث التربوي حالياً.' });
    }
  });

  app.post('/api/ai/generate-emblem', requireAdmin, async (req: AdminRequest, res) => {
    const prompt = String(req.body?.prompt ?? '').trim();
    const aspectRatio = req.body?.aspectRatio || '1:1';
    const imageBase64 = typeof req.body?.imageBase64 === 'string' ? req.body.imageBase64 : undefined;
    const mimeType = typeof req.body?.mimeType === 'string' ? req.body.mimeType : undefined;

    if (!prompt) {
      res.status(400).json({ error: 'يرجى كتابة وصف الصورة أو التعديل المطلوب.' });
      return;
    }
    try {
      const result = await generateOrEditSchoolImage({ prompt, aspectRatio, imageBase64, mimeType });
      recordAuditLog(req.admin!.username, 'GENERATE_IMAGE', 'media', result.savedPath, 'توليد/تعديل صورة شعار عبر Gemini');
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'تعذر توليد الصورة عبر النموذج.' });
    }
  });

  // =========================================================================
  // VITE / STATIC SERVING
  // =========================================================================

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  // Trigger periodic automatic SQLite backup every 6 hours while server runs
  triggerAutoBackupSnapshot(false);
  const autoBackupTimer = setInterval(() => {
    triggerAutoBackupSnapshot(true);
  }, 1000 * 60 * 60 * 6);
  autoBackupTimer.unref();

  const PORT = Number(process.env.PORT) || 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Al-Muntadhar School Portal running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
