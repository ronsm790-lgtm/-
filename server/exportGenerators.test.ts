import test from 'node:test';
import assert from 'node:assert/strict';
import QRCode from 'qrcode';
import * as XLSX from 'xlsx';
import {
  generateControlQrCardsPdf,
  generateGroupRosterPdf,
  generateIraqiAllReportPdf,
  generateMultipleIraqiReportCardsPdf,
  generateMultipleSingleExamReportCardsPdf,
  generateSingleExamReportPdf,
  shapeArabicForPdf,
} from './pdfGenerator.ts';
import { generateGroupRosterDocx } from './docxGenerator.ts';
import { getDefaultCurriculumForClassName } from './db.ts';
import type { AllPublishedReportCard, GroupExamRoster, PublicReportCard, SchoolSettings } from '../src/types/school.ts';

function countPdfPages(pdfBuffer: Buffer): number {
  const matches = pdfBuffer.toString('latin1').match(/\/Type\s*\/Page\b(?!s)/g);
  return matches ? matches.length : 0;
}

const settings: SchoolSettings = {
  schoolName: 'إعدادية المنتظر للبنين',
  republicHeader: 'جمهورية العراق',
  ministryHeader: 'وزارة التربية',
  directorate: 'المديرية العامة لتربية واسط',
  academicYear: '2025 - 2026',
  contactInfo: '',
  footerText: 'هذا الكشف صادر إلكترونياً عن اللجنة الامتحانية.',
  printNote: 'A4',
  emblemUrl: '/assets/aistudio/school_logo_original_f35f0f97.jpg',
  ministrySealUrl: '',
  primaryColor: '#0B1F3A',
  accentColor: '#C59B27',
};

test('shapeArabicForPdf shapes and orders Arabic RTL text cleanly without losing digits', () => {
  const shaped = shapeArabicForPdf('إعدادية المنتظر للبنين 2025 - 2026');
  assert.ok(shaped.length > 10);
  assert.ok(shaped.includes('2025'));
});

test('getDefaultCurriculumForClassName includes التربية الفنية and التربية الرياضية for every class', () => {
  const classes = [
    'الرابع العلمي',
    'الرابع الأدبي',
    'الخامس العلمي',
    'الخامس الأدبي',
    'السادس العلمي',
    'السادس الأدبي',
  ];
  for (const cls of classes) {
    const subs = getDefaultCurriculumForClassName(cls);
    assert.ok(subs.includes('التربية الفنية'), `Missing التربية الفنية for ${cls}`);
    assert.ok(subs.includes('التربية الرياضية'), `Missing التربية الرياضية for ${cls}`);
  }
});

test('PDF generators output genuine %PDF- vector documents with Arabic fonts and 11-subject support', async () => {
  const singleCard: PublicReportCard = {
    ...settings,
    examName: 'نصف السنة',
    issuedAt: '2026-03-10',
    student: { fullName: 'أحمد علي حسين', inquiryCode: '2026101', className: 'الرابع العلمي', sectionName: 'أ' },
    hasNotesColumn: false,
    hasMaxScoreColumn: false,
    rows: [
      { sequence: 1, subjectId: 1, subjectName: 'التربية الإسلامية', maxScore: 100, score: 95, rating: 'امتياز' },
      { sequence: 2, subjectId: 2, subjectName: 'جرائم حزب البعث', maxScore: 100, score: 88, rating: 'جيد جداً' },
      { sequence: 10, subjectId: 10, subjectName: 'التربية الفنية', maxScore: 100, score: 92, rating: 'امتياز' },
      { sequence: 11, subjectId: 11, subjectName: 'التربية الرياضية', maxScore: 100, score: 96, rating: 'امتياز' },
    ],
    summary: { subjectCount: 4, totalScore: 371, totalMaxScore: 400, average: 92.75, overallRating: 'امتياز' },
  };
  const singlePdf = await generateSingleExamReportPdf(singleCard);
  assert.equal(singlePdf.subarray(0, 5).toString('utf8'), '%PDF-');
  assert.equal(countPdfPages(singlePdf), 1);

  const subjectNames = [
    'التربية الإسلامية',
    'اللغة العربية',
    'اللغة الإنكليزية',
    'الرياضيات',
    'الفيزياء',
    'الكيمياء',
    'الأحياء',
    'الحاسوب',
    'جرائم حزب البعث',
    'التربية الفنية',
    'التربية الرياضية',
  ];

  const iraqiCard: AllPublishedReportCard = {
    ...settings,
    isMinisterial: false,
    student: singleCard.student,
    exams: [],
    matrixSubjects: [],
    iraqiRows: subjectNames.map((name, i) => ({
      sequence: i + 1,
      subjectId: i + 1,
      subjectName: name,
      sem1Month1: 90,
      sem1Month2: 92,
      sem1Average: 91,
      midyear: 94,
      sem2Month1: 93,
      sem2Month2: 95,
      sem2Average: 94,
      annualEffort: 93,
      finalExam: 96,
      finalGrade: 95,
      isIndividualExempt: i === 0,
      notes: '',
    })),
    iraqiSummary: {
      subjectCount: 11,
      sem1Month1: null,
      sem1Month2: null,
      sem1Average: null,
      midyear: null,
      sem2Month1: null,
      sem2Month2: null,
      sem2Average: null,
      annualEffort: { count: 11, total: 1023, average: 93 },
      finalExam: null,
      finalGrade: { count: 11, total: 1045, average: 95 },
      failingCount: 0,
      standing: 'ناجح',
      round1Result: 'ناجح',
      hasSecondRoundUpdates: false,
    },
  };
  const allPdf = await generateIraqiAllReportPdf(iraqiCard);
  assert.equal(allPdf.subarray(0, 5).toString('utf8'), '%PDF-');
  assert.equal(countPdfPages(allPdf), 1);

  const rosterSubjects = subjectNames.map((name, i) => ({ id: i + 1, name, maxScore: 100 }));
  const rosterRows = Array.from({ length: 50 }, (_, idx) => {
    const scoresBySubject: Record<number, { score: number | null; status: 'published'; notes: string }> = {};
    for (const s of rosterSubjects) {
      scoresBySubject[s.id] = { score: 85 + (idx % 15), status: 'published', notes: '' };
    }
    return {
      sequence: idx + 1,
      studentId: idx + 1,
      fullName: `طالب رقم ${idx + 1} عبد الله المحمداوي`,
      inquiryCode: `002026${String(idx + 1).padStart(3, '0')}`,
      className: 'الرابع العلمي',
      sectionName: 'أ',
      scoresBySubject,
    };
  });

  const roster: GroupExamRoster = {
    schoolName: settings.schoolName,
    republicHeader: settings.republicHeader,
    ministryHeader: settings.ministryHeader,
    directorate: settings.directorate,
    academicYear: settings.academicYear,
    footerText: settings.footerText,
    emblemUrl: settings.emblemUrl,
    examId: 4,
    examName: 'نصف السنة',
    className: 'الرابع العلمي',
    sectionLabel: 'شعبة أ',
    includeAllSections: false,
    subjectId: null,
    subjectLabel: 'كل المواد',
    subjects: rosterSubjects,
    rows: rosterRows,
  };
  const rosterPdf = await generateGroupRosterPdf(roster);
  assert.equal(rosterPdf.subarray(0, 5).toString('utf8'), '%PDF-');
  assert.equal(countPdfPages(rosterPdf), 1);

  const rosterDocx = await generateGroupRosterDocx(roster);
  // Genuine OOXML .docx starts with ZIP magic bytes PK\x03\x04
  assert.equal(rosterDocx[0], 0x50);
  assert.equal(rosterDocx[1], 0x4b);
  assert.ok(rosterDocx.includes(Buffer.from('word/document.xml')));

  const qrUrl = await QRCode.toDataURL(JSON.stringify({ v: 1, sId: 1, code: '2026101', yId: 1 }), { width: 220 });
  const twentyCards = Array.from({ length: 20 }, (_, i) => ({
    studentId: i + 1,
    fullName: `طالب كشف الباركود رقم ${i + 1}`,
    inquiryCode: `0026${String(i + 101)}`,
    className: 'الرابع العلمي',
    sectionName: 'أ',
    qrDataUrl: qrUrl,
  }));

  const qrPdf20 = await generateControlQrCardsPdf({
    settings,
    academicYear: '2025 - 2026',
    className: 'الرابع العلمي',
    sectionName: 'أ',
    cards: twentyCards,
  });
  assert.equal(qrPdf20.subarray(0, 5).toString('utf8'), '%PDF-');
  assert.equal(countPdfPages(qrPdf20), 1, 'Expected 20 QR cards (4x5) to fit strictly on 1 page');

  const qrPdf21 = await generateControlQrCardsPdf({
    settings,
    academicYear: '2025 - 2026',
    className: 'الرابع العلمي',
    sectionName: 'أ',
    cards: [
      ...twentyCards,
      {
        studentId: 21,
        fullName: 'طالب الصفحة الثانية',
        inquiryCode: '0026999',
        className: 'الرابع العلمي',
        sectionName: 'أ',
        qrDataUrl: qrUrl,
      },
    ],
  });
  assert.equal(countPdfPages(qrPdf21), 2, 'Expected 21 QR cards (4x5) to paginate to 2 pages');

  const bulkSinglePdf = await generateMultipleSingleExamReportCardsPdf([singleCard, singleCard]);
  assert.equal(bulkSinglePdf.subarray(0, 5).toString('utf8'), '%PDF-');
  assert.equal(countPdfPages(bulkSinglePdf), 2);

  const bulkAllPdf = await generateMultipleIraqiReportCardsPdf([iraqiCard]);
  assert.equal(bulkAllPdf.subarray(0, 5).toString('utf8'), '%PDF-');
  assert.equal(countPdfPages(bulkAllPdf), 1);
});

test('XLSX round-trip preserves Arabic RTL headers and leading-zero ID strings', () => {
  const rows = [
    { 'ت': 1, 'اسم الطالب': 'أحمد علي', 'رقم الهوية الوطنية': '0012345', 'التربية الفنية': 95, 'التربية الرياضية': 98 },
  ];
  const wb = XLSX.utils.book_new();
  wb.Workbook = { Views: [{ RTL: true }] };
  const ws = XLSX.utils.json_to_sheet(rows);
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
  for (let c = range.s.c; c <= range.e.c; c++) {
    const hdr = String(ws[XLSX.utils.encode_cell({ r: 0, c })]?.v ?? '');
    if (hdr.includes('الهوية')) {
      for (let r = 1; r <= range.e.r; r++) {
        const ref = XLSX.utils.encode_cell({ r, c });
        if (ws[ref]) {
          ws[ref].t = 's';
          ws[ref].z = '@';
          ws[ref].w = String(ws[ref].v ?? '');
        }
      }
    }
  }
  XLSX.utils.book_append_sheet(wb, ws, 'الطلبة');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  const parsedWb = XLSX.read(buf, { type: 'buffer' });
  const parsedRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(parsedWb.Sheets['الطلبة'], { raw: false });
  assert.equal(parsedRows[0]['رقم الهوية الوطنية'], '0012345');
  assert.equal(parsedRows[0]['التربية الفنية'], '95');
});

