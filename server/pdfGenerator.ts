import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import type {
  AllPublishedReportCard,
  GroupExamRoster,
  PublicReportCard,
  SchoolSettings,
} from '../src/types/school.ts';

const ARABIC_FONT_REGULAR_PATH = fs.existsSync('/usr/share/fonts/truetype/noto/NotoSansArabic-Regular.ttf')
  ? '/usr/share/fonts/truetype/noto/NotoSansArabic-Regular.ttf'
  : fs.existsSync('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')
    ? '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
    : 'Helvetica';

const ARABIC_FONT_BOLD_PATH = fs.existsSync('/usr/share/fonts/truetype/noto/NotoSansArabic-Bold.ttf')
  ? '/usr/share/fonts/truetype/noto/NotoSansArabic-Bold.ttf'
  : ARABIC_FONT_REGULAR_PATH;

const LATIN_FONT_REGULAR_PATH = fs.existsSync('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')
  ? '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
  : ARABIC_FONT_REGULAR_PATH;

const LATIN_FONT_BOLD_PATH = fs.existsSync('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf')
  ? '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
  : LATIN_FONT_REGULAR_PATH;

const ARABIC_CHAR_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/;
const ARABIC_FONT_USES_NOTO = ARABIC_FONT_REGULAR_PATH.includes('NotoSansArabic');

/**
 * Normalizes logical UTF-8 Arabic text cleanly for PDF generation and tests.
 */
export function shapeArabicForPdf(input: unknown): string {
  const raw = String(input ?? '')
    .replace(/[\u200B-\u200F\u202A-\u202E\uFEFF\u061C]/g, '')
    .trim();
  if (!raw) return '';
  return raw.replace(/\s+/g, ' ');
}

/**
 * Formats text specifically for PDFKit rendering:
 * - Pure numeric/Latin text (no Arabic characters) uses DejaVuSans LTR directly (no reversal).
 * - Text containing Arabic uses NotoSansArabic with `{ features: ['rtla'] }`:
 *   - Replaces punctuation missing from NotoSansArabic (parentheses, em/en-dash, slash, middle dot)
 *     so zero tofu boxes (`▯`) ever appear.
 *   - Reverses embedded ASCII digit sequences because PDFKit `rtla` lays out glyph runs strictly RTL.
 */
function preparePdfText(input: unknown): {
  text: string;
  useRtlFont: boolean;
} {
  const normalized = shapeArabicForPdf(input);
  if (!normalized) return { text: '', useRtlFont: false };

  const hasArabic = ARABIC_CHAR_RE.test(normalized);
  if (!hasArabic) {
    // Pure numeric / LTR punctuation (e.g. "94", "2026101", "—"): draw LTR with DejaVuSans
    return { text: normalized, useRtlFont: false };
  }

  let formatted = normalized;
  if (ARABIC_FONT_USES_NOTO) {
    formatted = formatted
      .replace(/[—–]/g, ' - ')
      .replace(/[_~^]/g, ' ')
      .replace(/[·|]/g, ' - ')
      .replace(/\//g, ' - ')
      .replace(/\+/g, ' زائد ')
      .replace(/%/g, ' ٪ ')
      .replace(/=/g, ' يساوي ')
      .replace(/[(\[]/g, ' »')
      .replace(/[)\]]/g, '« ')
      .replace(/[{}]/g, ' ')
      .replace(/[A-Za-z]+/g, '')
      .replace(/[0-9]+(?:\.[0-9]+)?/g, (m) => m.split('').reverse().join(''))
      .replace(/\s+/g, ' ')
      .trim();
  }

  return { text: formatted, useRtlFont: true };
}

function selectFontAndOpts(
  doc: PDFKit.PDFDocument,
  useRtlFont: boolean,
  bold: boolean,
  fontSize: number,
  color: string
) {
  const fontName = useRtlFont
    ? bold
      ? 'ArabicBold'
      : 'ArabicRegular'
    : bold
      ? 'LatinBold'
      : 'LatinRegular';
  doc.font(fontName).fontSize(fontSize).fillColor(color);
}

function pdfTextOpts(
  useRtlFont: boolean,
  width: number,
  align: 'left' | 'center' | 'right',
  lineBreak = true
): PDFKit.Mixins.TextOptions {
  return {
    width,
    align,
    lineBreak,
    ...(useRtlFont && ARABIC_FONT_USES_NOTO ? { features: ['rtla' as const] } : {}),
  };
}

function resolvePublicAssetPath(urlOrPath?: string | null): string | null {
  if (!urlOrPath) return null;
  const clean = urlOrPath.split('?')[0].trim();
  if (!clean) return null;
  if (clean.startsWith('/assets/')) {
    const candidate = path.resolve(process.cwd(), 'public', clean.slice(1));
    if (fs.existsSync(candidate)) return candidate;
  }
  if (clean.startsWith('/src/assets/')) {
    const candidate = path.resolve(process.cwd(), clean.slice(1));
    if (fs.existsSync(candidate)) return candidate;
  }
  const fallback = path.resolve(process.cwd(), 'public/assets/aistudio/school_logo_original_f35f0f97.jpg');
  return fs.existsSync(fallback) ? fallback : null;
}

function createPdfDoc(options: PDFKit.PDFDocumentOptions): {
  doc: PDFKit.PDFDocument;
  bufferPromise: Promise<Buffer>;
} {
  const doc = new PDFDocument({
    autoFirstPage: true,
    bufferPages: true,
    ...options,
  });
  doc.registerFont('ArabicRegular', ARABIC_FONT_REGULAR_PATH);
  doc.registerFont('ArabicBold', ARABIC_FONT_BOLD_PATH);
  doc.registerFont('LatinRegular', LATIN_FONT_REGULAR_PATH);
  doc.registerFont('LatinBold', LATIN_FONT_BOLD_PATH);
  doc.font('ArabicRegular');

  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const bufferPromise = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  return { doc, bufferPromise };
}

function measurePreparedHeight(
  doc: PDFKit.PDFDocument,
  prepared: { text: string; useRtlFont: boolean },
  width: number,
  fontSize: number,
  bold: boolean,
  align: 'left' | 'center' | 'right' = 'center'
): number {
  if (!prepared.text) return fontSize * 1.2;
  selectFontAndOpts(doc, prepared.useRtlFont, bold, fontSize, '#0B1F3A');
  return doc.heightOfString(prepared.text, pdfTextOpts(prepared.useRtlFont, Math.max(10, width), align, true));
}

function computeSingleLineDrawY(
  y: number,
  height: number,
  fontSize: number,
  useRtlFont: boolean
): number {
  if (useRtlFont && ARABIC_FONT_USES_NOTO) {
    // NotoSansArabic has large ascent (1.374em); visual glyph center sits ~1.02em below linebox top
    return y + height / 2 - fontSize * 1.02;
  }
  return y + (height - fontSize * 1.18) / 2;
}

function drawRtlTextCentered(
  doc: PDFKit.PDFDocument,
  text: string,
  x: number,
  y: number,
  width: number,
  height: number,
  fontSize: number,
  bold = false,
  color = '#0B1F3A',
  singleLine = false
): void {
  const prepared = preparePdfText(text);
  if (!prepared.text) return;
  const innerW = Math.max(8, width - 4);
  selectFontAndOpts(doc, prepared.useRtlFont, bold, fontSize, color);
  const opts = pdfTextOpts(prepared.useRtlFont, innerW, 'center', !singleLine);
  const textHeight = singleLine ? fontSize * 1.2 : doc.heightOfString(prepared.text, opts);
  const isSingleLine = singleLine || textHeight <= fontSize * 2.4;
  const drawY = isSingleLine
    ? computeSingleLineDrawY(y, height, fontSize, prepared.useRtlFont)
    : y + Math.max(0.5, (height - textHeight) / 2);
  doc.text(prepared.text, x + 2, drawY, {
    ...opts,
    lineBreak: !singleLine,
  });
}

function drawRtlTextAligned(
  doc: PDFKit.PDFDocument,
  text: string,
  x: number,
  y: number,
  width: number,
  fontSize: number,
  align: 'left' | 'center' | 'right' = 'right',
  bold = false,
  color = '#0B1F3A'
): void {
  const prepared = preparePdfText(text);
  if (!prepared.text) return;
  selectFontAndOpts(doc, prepared.useRtlFont, bold, fontSize, color);
  doc.text(prepared.text, x, y, pdfTextOpts(prepared.useRtlFont, Math.max(10, width), align, true));
}

function drawOfficialHeader(
  doc: PDFKit.PDFDocument,
  params: {
    republicHeader: string;
    ministryHeader: string;
    directorate: string;
    schoolName: string;
    academicYear: string;
    title: string;
    emblemUrl?: string;
    x: number;
    y: number;
    width: number;
  }
): number {
  const {
    republicHeader,
    ministryHeader,
    directorate,
    schoolName,
    academicYear,
    title,
    emblemUrl,
    x,
    y,
    width,
  } = params;

  const sideW = Math.floor(width * 0.38);

  const pRep = preparePdfText(republicHeader);
  const pMin = preparePdfText(ministryHeader);
  const pDir = preparePdfText(directorate);
  const pSch = preparePdfText(schoolName);
  const pYear = preparePdfText(`العام الدراسي: ${academicYear}`);
  const pTitle = preparePdfText(title);

  const repH = measurePreparedHeight(doc, pRep, sideW, 9, true, 'right');
  const minH = measurePreparedHeight(doc, pMin, sideW, 9, true, 'right');
  const dirH = measurePreparedHeight(doc, pDir, sideW, 8.2, false, 'right');
  const schH = measurePreparedHeight(doc, pSch, sideW, 9.5, true, 'right');
  const rightTotalH = repH + minH + dirH + schH + 22;

  const yrH = measurePreparedHeight(doc, pYear, sideW, 9, true, 'left');
  const titleH = measurePreparedHeight(doc, pTitle, sideW, 9, true, 'left');
  const leftTotalH = yrH + titleH + 24;

  const headerH = Math.max(76, Math.ceil(Math.max(rightTotalH, leftTotalH)));

  doc.save();
  doc.lineWidth(1.2).strokeColor('#0B1F3A').rect(x, y, width, headerH).stroke();
  doc.lineWidth(0.5).strokeColor('#CBD5E1').rect(x + 2, y + 2, width - 4, headerH - 4).stroke();

  let rY = y + 6;
  const rightX = x + width - sideW - 10;
  drawRtlTextAligned(doc, republicHeader, rightX, rY, sideW, 9, 'right', true, '#0B1F3A');
  rY += repH + 2;
  drawRtlTextAligned(doc, ministryHeader, rightX, rY, sideW, 9, 'right', true, '#0B1F3A');
  rY += minH + 2;
  drawRtlTextAligned(doc, directorate, rightX, rY, sideW, 8.2, 'right', false, '#334155');
  rY += dirH + 2;
  drawRtlTextAligned(doc, schoolName, rightX, rY, sideW, 9.5, 'right', true, '#0B1F3A');

  const logoSize = Math.min(50, headerH - 16);
  const logoPath = resolvePublicAssetPath(emblemUrl);
  if (logoPath) {
    try {
      doc.image(logoPath, x + (width - logoSize) / 2, y + (headerH - logoSize) / 2, {
        fit: [logoSize, logoSize],
        align: 'center',
        valign: 'center',
      });
    } catch {
      // ignore image load errors cleanly
    }
  }

  let lY = y + 8;
  const leftX = x + 10;
  drawRtlTextAligned(doc, `العام الدراسي: ${academicYear}`, leftX, lY, sideW, 9, 'left', true, '#0B1F3A');
  lY += yrH + 7;
  drawRtlTextAligned(doc, title, leftX, lY, sideW, 9, 'left', true, '#1E4E8C');

  doc.restore();
  return y + headerH + 8;
}

function drawCell(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  w: number,
  h: number,
  text: string,
  opts: {
    bg?: string;
    border?: string;
    fontSize?: number;
    bold?: boolean;
    color?: string;
    align?: 'center' | 'right' | 'left';
    singleLine?: boolean;
  } = {}
): void {
  const {
    bg,
    border = '#475569',
    fontSize = 8.5,
    bold = false,
    color = '#0B1F3A',
    align = 'center',
    singleLine = false,
  } = opts;

  doc.save();
  if (bg) {
    doc.rect(x, y, w, h).fillAndStroke(bg, border);
  } else {
    doc.lineWidth(0.55).strokeColor(border).rect(x, y, w, h).stroke();
  }
  if (text !== '') {
    if (align === 'center') {
      drawRtlTextCentered(doc, text, x, y, w, h, fontSize, bold, color, singleLine);
    } else {
      const prepared = preparePdfText(text);
      if (prepared.text) {
        const innerW = Math.max(8, w - 8);
        selectFontAndOpts(doc, prepared.useRtlFont, bold, fontSize, color);
        const allowWrap = !singleLine && h >= fontSize * 2.4;
        const tOpts = pdfTextOpts(prepared.useRtlFont, innerW, align, allowWrap);
        const th = allowWrap ? doc.heightOfString(prepared.text, tOpts) : fontSize * 1.2;
        const isOneLine = !allowWrap || th <= fontSize * 2.4;
        const drawY = isOneLine
          ? computeSingleLineDrawY(y, h, fontSize, prepared.useRtlFont)
          : y + Math.max(0.5, (h - th) / 2);
        doc.text(prepared.text, x + 4, drawY, {
          ...tOpts,
          lineBreak: allowWrap,
        });
      }
    }
  }
  doc.restore();
}

function renderIraqiCardPage(doc: PDFKit.PDFDocument, card: AllPublishedReportCard): void {
  const pageW = doc.page.width;
  const pageH = doc.page.height;
  const margin = 24;
  const contentW = pageW - margin * 2;
  const isMin = Boolean(card.isMinisterial);

  let curY = drawOfficialHeader(doc, {
    republicHeader: card.republicHeader,
    ministryHeader: card.ministryHeader,
    directorate: card.directorate,
    schoolName: card.schoolName,
    academicYear: card.academicYear,
    title: isMin ? 'بطاقة درجات السادس الوزاري' : 'بطاقة الدرجات المدرسية الرسمية',
    emblemUrl: card.emblemUrl,
    x: margin,
    y: margin,
    width: contentW,
  });

  const infoH = 26;
  const infoCols = [
    { label: `الاسم: ${card.student.fullName}`, w: contentW * 0.40 },
    { label: `رقم الهوية: ${card.student.inquiryCode}`, w: contentW * 0.22 },
    { label: `الصف: ${card.student.className}`, w: contentW * 0.22 },
    { label: `الشعبة: ${card.student.sectionName}`, w: contentW * 0.16 },
  ];
  let infoX = margin + contentW;
  for (const c of infoCols) {
    infoX -= c.w;
    drawCell(doc, infoX, curY, c.w, infoH, c.label, {
      bg: '#F8FAFC',
      border: '#334155',
      fontSize: 8.8,
      bold: true,
    });
  }
  curY += infoH + 8;

  const cols: Array<{ key: string; label: string; w: number }> = isMin
    ? [
        { key: 'seq', label: 'ت', w: 26 },
        { key: 'subject', label: 'المادة الدراسية', w: 132 },
        { key: 's1m1', label: 'ف1 ش1', w: 48 },
        { key: 's1m2', label: 'ف1 ش2', w: 48 },
        { key: 's1avg', label: 'سعي ف1', w: 52 },
        { key: 'mid', label: 'نصف السنة', w: 60 },
        { key: 's2m1', label: 'ف2 ش1', w: 48 },
        { key: 's2m2', label: 'ف2 ش2', w: 48 },
        { key: 's2avg', label: 'سعي ف2', w: 52 },
        { key: 'annual', label: 'السعي السنوي', w: 64 },
        { key: 'qual', label: 'التأهيل الوزاري', w: 105 },
        { key: 'notes', label: 'الملاحظات', w: contentW - (26 + 132 + 48 * 4 + 52 * 2 + 60 + 64 + 105) },
      ]
    : [
        { key: 'seq', label: 'ت', w: 24 },
        { key: 'subject', label: 'المادة الدراسية', w: 132 },
        { key: 's1m1', label: 'ف1 ش1', w: 46 },
        { key: 's1m2', label: 'ف1 ش2', w: 46 },
        { key: 's1avg', label: 'سعي ف1', w: 48 },
        { key: 'mid', label: 'نصف السنة', w: 56 },
        { key: 's2m1', label: 'ف2 ش1', w: 46 },
        { key: 's2m2', label: 'ف2 ش2', w: 46 },
        { key: 's2avg', label: 'سعي ف2', w: 48 },
        { key: 'annual', label: 'السعي السنوي', w: 58 },
        { key: 'finalEx', label: 'النهائي / د2', w: 64 },
        { key: 'finalGr', label: 'الدرجة النهائية', w: 62 },
        { key: 'notes', label: 'الملاحظات', w: contentW - (24 + 132 + 46 * 4 + 48 * 2 + 56 + 58 + 64 + 62) },
      ];

  const hdrH = 26;
  let colX = margin + contentW;
  for (const col of cols) {
    colX -= col.w;
    drawCell(doc, colX, curY, col.w, hdrH, col.label, {
      bg: '#0B1F3A',
      border: '#0B1F3A',
      fontSize: 7.8,
      bold: true,
      color: '#FFFFFF',
    });
  }
  curY += hdrH;

  const rowH = Math.min(24, Math.max(19, Math.floor((pageH - curY - 90) / Math.max(card.iraqiRows.length + 1, 8))));
  const fmt = (v: number | null | undefined) => (v !== null && v !== undefined ? String(v) : '—');

  card.iraqiRows.forEach((r, idx) => {
    const isExempt = Boolean(r.isIndividualExempt || r.isGeneralExempt);
    const isSecRound = Boolean(r.isSecondRoundUpdated);
    const rowBg = isSecRound
      ? '#FEF3C7'
      : isExempt
        ? '#ECFDF5'
        : idx % 2 === 0
          ? '#FFFFFF'
          : '#F8FAFC';

    let finalExamText = fmt(r.finalExam);
    if (!isMin && isExempt) finalExamText = 'معفو';
    else if (!isMin && isSecRound && r.secondRoundScore !== null && r.secondRoundScore !== undefined) {
      finalExamText = `${r.secondRoundScore} د2`;
    }

    const qualText =
      r.ministerialQualification === 'qualified'
        ? 'مؤهل'
        : r.ministerialQualification === 'not_qualified'
          ? 'غير مؤهل'
          : '—';

    const noteParts = [
      r.notes,
      isSecRound ? 'محدث بالدور الثاني' : '',
      r.isGeneralExempt ? 'إعفاء عام' : r.isIndividualExempt ? 'إعفاء فردي' : '',
    ].filter(Boolean);

    const cellVals: Record<string, string> = {
      seq: String(r.sequence),
      subject: r.subjectName,
      s1m1: fmt(r.sem1Month1),
      s1m2: fmt(r.sem1Month2),
      s1avg: fmt(r.sem1Average),
      mid: fmt(r.midyear),
      s2m1: fmt(r.sem2Month1),
      s2m2: fmt(r.sem2Month2),
      s2avg: fmt(r.sem2Average),
      annual: fmt(r.annualEffort),
      qual: qualText,
      finalEx: finalExamText,
      finalGr: fmt(r.finalGrade),
      notes: noteParts.join(' - ') || '—',
    };

    let rx = margin + contentW;
    for (const col of cols) {
      rx -= col.w;
      const isFailing = col.key === 'finalGr' && r.finalGrade !== null && r.finalGrade < 50;
      const cellColor = isFailing
        ? '#B91C1C'
        : col.key === 'qual' && r.ministerialQualification === 'qualified'
          ? '#047857'
          : col.key === 'qual' && r.ministerialQualification === 'not_qualified'
            ? '#B91C1C'
            : '#0B1F3A';
      drawCell(doc, rx, curY, col.w, rowH, cellVals[col.key] ?? '—', {
        bg: rowBg,
        border: '#64748B',
        fontSize: col.key === 'notes' ? 7.5 : 8.5,
        bold: col.key === 'subject' || col.key === 'finalGr' || isExempt || isSecRound,
        color: cellColor,
        align: col.key === 'subject' || col.key === 'notes' ? 'right' : 'center',
      });
    }
    curY += rowH;
  });

  const sum = card.iraqiSummary;
  const avgVal = (c: { average: number } | null | undefined) => (c ? String(c.average) : '—');
  const sumVals: Record<string, string> = {
    seq: '—',
    subject: 'المعدل العام',
    s1m1: avgVal(sum.sem1Month1),
    s1m2: avgVal(sum.sem1Month2),
    s1avg: avgVal(sum.sem1Average),
    mid: avgVal(sum.midyear),
    s2m1: avgVal(sum.sem2Month1),
    s2m2: avgVal(sum.sem2Month2),
    s2avg: avgVal(sum.sem2Average),
    annual: avgVal(sum.annualEffort),
    qual: sum.ministerialResultText || '—',
    finalEx: sum.isGeneralExempt ? 'إعفاء عام' : avgVal(sum.finalExam),
    finalGr: avgVal(sum.finalGrade),
    notes: isMin ? sum.ministerialResultText || '—' : `النتيجة: ${sum.round1Result || sum.standing}`,
  };

  let sx = margin + contentW;
  const sumH = rowH + 6;
  for (const col of cols) {
    sx -= col.w;
    drawCell(doc, sx, curY, col.w, sumH, sumVals[col.key] ?? '—', {
      bg: '#E2E8F0',
      border: '#334155',
      fontSize: col.key === 'qual' ? 7.6 : 8.3,
      bold: true,
      color: '#0B1F3A',
      align: col.key === 'subject' || col.key === 'notes' ? 'right' : 'center',
    });
  }
  curY += sumH + 18;

  const footerY = Math.min(Math.max(curY, pageH - 54), pageH - 44);
  drawRtlTextAligned(
    doc,
    card.footerText || 'وثيقة درجات صادرة إلكترونياً من إدارة المدرسة.',
    margin + 195,
    footerY + 2,
    contentW - 205,
    8,
    'right',
    false,
    '#334155'
  );
  drawRtlTextAligned(doc, 'توقيع مدير المدرسة', margin, footerY - 3, 185, 8.6, 'center', true, '#0B1F3A');
  drawRtlTextAligned(doc, 'الأستاذ عدي عبدالكاظم', margin, footerY + 11, 185, 9, 'center', true, '#0B1F3A');
}

function renderSingleExamCardPage(doc: PDFKit.PDFDocument, card: PublicReportCard): void {
  const pageW = doc.page.width;
  const pageH = doc.page.height;
  const margin = 28;
  const contentW = pageW - margin * 2;

  let curY = drawOfficialHeader(doc, {
    republicHeader: card.republicHeader,
    ministryHeader: card.ministryHeader,
    directorate: card.directorate,
    schoolName: card.schoolName,
    academicYear: card.academicYear,
    title: `نتيجة امتحان: ${card.examName}`,
    emblemUrl: card.emblemUrl,
    x: margin,
    y: margin,
    width: contentW,
  });

  const infoH = 26;
  const infoCols = [
    { label: `الطالب: ${card.student.fullName}`, w: contentW * 0.40 },
    { label: `الهوية: ${card.student.inquiryCode}`, w: contentW * 0.22 },
    { label: `الصف: ${card.student.className}`, w: contentW * 0.22 },
    { label: `الشعبة: ${card.student.sectionName}`, w: contentW * 0.16 },
  ];
  let ix = margin + contentW;
  for (const c of infoCols) {
    ix -= c.w;
    drawCell(doc, ix, curY, c.w, infoH, c.label, { bg: '#F8FAFC', border: '#334155', fontSize: 8.8, bold: true });
  }
  curY += infoH + 10;

  const cols = card.hasNotesColumn
    ? [
        { key: 'seq', label: 'ت', w: 34 },
        { key: 'subject', label: 'المادة الدراسية', w: 185 },
        { key: 'score', label: 'الدرجة', w: 80 },
        { key: 'rating', label: 'التقدير', w: 90 },
        { key: 'notes', label: 'ملاحظات', w: contentW - (34 + 185 + 80 + 90) },
      ]
    : [
        { key: 'seq', label: 'ت', w: 40 },
        { key: 'subject', label: 'المادة الدراسية', w: 245 },
        { key: 'score', label: 'الدرجة', w: 110 },
        { key: 'rating', label: 'التقدير', w: contentW - (40 + 245 + 110) },
      ];

  const hdrH = 26;
  let hx = margin + contentW;
  for (const c of cols) {
    hx -= c.w;
    drawCell(doc, hx, curY, c.w, hdrH, c.label, {
      bg: '#0B1F3A',
      border: '#0B1F3A',
      fontSize: 9,
      bold: true,
      color: '#FFFFFF',
    });
  }
  curY += hdrH;

  const rowH = 24;
  card.rows.forEach((r, idx) => {
    const bg = idx % 2 === 0 ? '#FFFFFF' : '#F8FAFC';
    const vals: Record<string, string> = {
      seq: String(r.sequence),
      subject: r.subjectName,
      score: String(r.score),
      rating: r.rating,
      notes: r.notes || '—',
    };
    let rx = margin + contentW;
    for (const c of cols) {
      rx -= c.w;
      drawCell(doc, rx, curY, c.w, rowH, vals[c.key] ?? '—', {
        bg,
        border: '#64748B',
        fontSize: 8.8,
        bold: c.key === 'subject' || c.key === 'score',
        color: c.key === 'score' && r.score < 50 ? '#B91C1C' : '#0B1F3A',
        align: c.key === 'subject' || c.key === 'notes' ? 'right' : 'center',
      });
    }
    curY += rowH;
  });

  if (card.summary) {
    curY += 10;
    drawCell(
      doc,
      margin,
      curY,
      contentW,
      28,
      `المجموع: ${card.summary.totalScore}   -   المعدل: ${card.summary.average}   -   التقدير العام: ${card.summary.overallRating}`,
      { bg: '#E2E8F0', border: '#334155', fontSize: 9.5, bold: true }
    );
    curY += 36;
  } else {
    curY += 16;
  }

  const footerY = Math.min(Math.max(curY, pageH - 52), pageH - 42);
  drawRtlTextAligned(doc, card.footerText || '', margin + 195, footerY + 2, contentW - 205, 7.6, 'right', false, '#334155');
  drawRtlTextAligned(doc, 'توقيع مدير المدرسة', margin, footerY - 4, 185, 8.5, 'center', true, '#0B1F3A');
  drawRtlTextAligned(doc, 'الأستاذ عدي عبدالكاظم', margin, footerY + 10, 185, 8.8, 'center', true, '#0B1F3A');
}

export async function generateIraqiAllReportPdf(card: AllPublishedReportCard): Promise<Buffer> {
  const { doc, bufferPromise } = createPdfDoc({
    size: 'A4',
    layout: 'landscape',
    margins: { top: 24, bottom: 0, left: 24, right: 24 },
  });
  renderIraqiCardPage(doc, card);
  doc.end();
  return bufferPromise;
}

export async function generateMultipleIraqiReportCardsPdf(cards: AllPublishedReportCard[]): Promise<Buffer> {
  const { doc, bufferPromise } = createPdfDoc({
    size: 'A4',
    layout: 'landscape',
    margins: { top: 24, bottom: 0, left: 24, right: 24 },
  });
  cards.forEach((card, idx) => {
    if (idx > 0) {
      doc.addPage({ size: 'A4', layout: 'landscape', margins: { top: 24, bottom: 0, left: 24, right: 24 } });
    }
    renderIraqiCardPage(doc, card);
  });
  doc.end();
  return bufferPromise;
}

export async function generateSingleExamReportPdf(card: PublicReportCard): Promise<Buffer> {
  const { doc, bufferPromise } = createPdfDoc({
    size: 'A4',
    layout: 'portrait',
    margins: { top: 28, bottom: 0, left: 28, right: 28 },
  });
  renderSingleExamCardPage(doc, card);
  doc.end();
  return bufferPromise;
}

export async function generateMultipleSingleExamReportCardsPdf(cards: PublicReportCard[]): Promise<Buffer> {
  const { doc, bufferPromise } = createPdfDoc({
    size: 'A4',
    layout: 'portrait',
    margins: { top: 28, bottom: 0, left: 28, right: 28 },
  });
  cards.forEach((card, idx) => {
    if (idx > 0) {
      doc.addPage({ size: 'A4', layout: 'portrait', margins: { top: 28, bottom: 0, left: 28, right: 28 } });
    }
    renderSingleExamCardPage(doc, card);
  });
  doc.end();
  return bufferPromise;
}

export async function generateGroupRosterPdf(roster: GroupExamRoster): Promise<Buffer> {
  const { doc, bufferPromise } = createPdfDoc({
    size: 'A4',
    layout: 'landscape',
    margins: { top: 14, bottom: 0, left: 16, right: 16 },
  });

  const ROWS_PER_PAGE = 50;
  const pageW = doc.page.width;
  const pageH = doc.page.height;
  const margin = 16;
  const contentW = pageW - margin * 2;

  const chunks: GroupExamRoster['rows'][] = [];
  for (let i = 0; i < roster.rows.length; i += ROWS_PER_PAGE) {
    chunks.push(roster.rows.slice(i, i + ROWS_PER_PAGE));
  }
  if (chunks.length === 0) chunks.push([]);

  chunks.forEach((chunk, pageIdx) => {
    if (pageIdx > 0) {
      doc.addPage({
        size: 'A4',
        layout: 'landscape',
        margins: { top: 14, bottom: 0, left: 16, right: 16 },
      });
    }

    let curY = drawOfficialHeader(doc, {
      republicHeader: roster.republicHeader,
      ministryHeader: roster.ministryHeader,
      directorate: roster.directorate,
      schoolName: roster.schoolName,
      academicYear: roster.academicYear,
      title: `كشف درجات: ${roster.examName} - ${roster.className} - ${roster.sectionLabel}`,
      emblemUrl: roster.emblemUrl,
      x: margin,
      y: 14,
      width: contentW,
    });

    const includeSecCol = Boolean(roster.includeAllSections);
    const secColW = includeSecCol ? 34 : 0;
    const seqW = 20;
    const codeW = 60;
    const minNameW = 120;
    const subjCount = Math.max(1, roster.subjects.length);
    const subjW = Math.floor((contentW - (seqW + minNameW + codeW + secColW)) / subjCount);
    const actualFixedNameW = contentW - (seqW + codeW + secColW + subjW * roster.subjects.length);

    const cols = [
      { key: 'seq', label: 'ت', w: seqW },
      { key: 'name', label: 'اسم الطالب', w: actualFixedNameW },
      { key: 'code', label: 'رقم الهوية', w: codeW },
      ...(includeSecCol ? [{ key: 'sec', label: 'الشعبة', w: secColW }] : []),
      ...roster.subjects.map((s) => ({ key: `sub_${s.id}`, label: s.name, w: subjW })),
    ];

    const hdrH = roster.subjects.length > 8 ? 30 : roster.subjects.length > 5 ? 27 : 22;
    let hx = margin + contentW;
    for (const c of cols) {
      hx -= c.w;
      drawCell(doc, hx, curY, c.w, hdrH, c.label, {
        bg: '#0B1F3A',
        border: '#0B1F3A',
        fontSize: roster.subjects.length > 8 ? 6.1 : roster.subjects.length > 5 ? 6.8 : 7.8,
        bold: true,
        color: '#FFFFFF',
        singleLine: roster.subjects.length <= 5,
      });
    }
    curY += hdrH;

    const availH = pageH - curY - 24;
    const rowH = Math.max(8.3, Math.floor((availH / ROWS_PER_PAGE) * 10) / 10);

    for (let slot = 0; slot < ROWS_PER_PAGE; slot++) {
      const r = chunk[slot];
      const seqNum = pageIdx * ROWS_PER_PAGE + slot + 1;
      const bg = slot % 2 === 0 ? '#FFFFFF' : '#F8FAFC';

      let rx = margin + contentW;
      for (const c of cols) {
        rx -= c.w;
        let text = '';
        let color = '#0B1F3A';
        if (c.key === 'seq') text = String(seqNum);
        else if (r) {
          if (c.key === 'name') text = r.fullName;
          else if (c.key === 'code') text = r.inquiryCode;
          else if (c.key === 'sec') text = r.sectionName;
          else if (c.key.startsWith('sub_')) {
            const sid = Number(c.key.slice(4));
            const cell = r.scoresBySubject[sid];
            if (cell && cell.score !== null) {
              text = String(cell.score);
              if (cell.score < 50) color = '#B91C1C';
            }
          }
        }
        drawCell(doc, rx, curY, c.w, rowH, text, {
          bg,
          border: '#94A3B8',
          fontSize: 6.4,
          bold: c.key === 'name',
          color,
          align: c.key === 'name' ? 'right' : 'center',
          singleLine: true,
        });
      }
      curY += rowH;
    }

    const preparedFooter = preparePdfText(
      `صفحة ${pageIdx + 1} من ${chunks.length} - توقيع مدير المدرسة: الأستاذ عدي عبدالكاظم`
    );
    if (preparedFooter.text) {
      selectFontAndOpts(doc, preparedFooter.useRtlFont, true, 7.5, '#334155');
      doc.text(preparedFooter.text, margin, pageH - 21, {
        ...pdfTextOpts(preparedFooter.useRtlFont, contentW, 'center', false),
        lineBreak: false,
      });
    }
  });

  doc.end();
  return bufferPromise;
}

export async function generateControlQrCardsPdf(params: {
  settings: SchoolSettings;
  academicYear: string;
  className: string;
  sectionName: string;
  cards: Array<{
    studentId: number;
    fullName: string;
    inquiryCode: string;
    className: string;
    sectionName: string;
    qrDataUrl: string;
  }>;
}): Promise<Buffer> {
  const { doc, bufferPromise } = createPdfDoc({
    size: 'A4',
    layout: 'portrait',
    margin: 14,
  });

  const COLS = 4;
  const ROWS = 5;
  const PER_PAGE = COLS * ROWS;
  const pageW = doc.page.width;
  const pageH = doc.page.height;
  const margin = 14;
  const headerH = 26;
  const gap = 7;

  const gridW = pageW - margin * 2;
  const gridH = pageH - margin * 2 - headerH;
  const cardW = (gridW - gap * (COLS - 1)) / COLS;
  const cardH = (gridH - gap * (ROWS - 1)) / ROWS;

  const cleanSec = String(params.sectionName || '').replace(/_/g, ' ').trim();
  const secLabel = !cleanSec
    ? ''
    : cleanSec.includes('جميع') || cleanSec.includes('شعبة')
      ? cleanSec
      : `شعبة ${cleanSec}`;

  const totalPages = Math.max(1, Math.ceil(params.cards.length / PER_PAGE));

  for (let p = 0; p < totalPages; p++) {
    if (p > 0) doc.addPage({ size: 'A4', layout: 'portrait', margin: 14 });

    drawRtlTextAligned(
      doc,
      `${params.settings.schoolName} - بطاقات باركود الكونترول ${params.academicYear} - ${params.className}${secLabel ? ` - ${secLabel}` : ''} - صفحة ${p + 1} من ${totalPages}`,
      margin,
      margin - 2,
      gridW,
      9,
      'center',
      true,
      '#0B1F3A'
    );

    const slice = params.cards.slice(p * PER_PAGE, (p + 1) * PER_PAGE);
    slice.forEach((card, idx) => {
      const r = Math.floor(idx / COLS);
      const c = idx % COLS;
      const x = margin + (COLS - 1 - c) * (cardW + gap);
      const y = margin + headerH + r * (cardH + gap);

      doc.save();
      doc.lineWidth(0.85).strokeColor('#334155').roundedRect(x, y, cardW, cardH, 5).stroke();

      const qrSize = Math.min(cardW - 22, cardH - 58, 92);
      const qrX = x + (cardW - qrSize) / 2;
      const qrY = y + 6;
      try {
        doc.image(card.qrDataUrl, qrX, qrY, { width: qrSize, height: qrSize });
      } catch {
        // ignore malformed qr
      }

      const textStartY = qrY + qrSize + 4;
      drawRtlTextCentered(doc, card.fullName, x + 4, textStartY, cardW - 8, 21, 7.4, true, '#0B1F3A');
      drawRtlTextCentered(
        doc,
        `الهوية: ${card.inquiryCode}`,
        x + 4,
        textStartY + 22,
        cardW - 8,
        12,
        7.2,
        true,
        '#1E4E8C',
        true
      );
      drawRtlTextCentered(
        doc,
        `${card.className} - شعبة ${card.sectionName}`,
        x + 4,
        textStartY + 35,
        cardW - 8,
        12,
        6.6,
        false,
        '#475569',
        true
      );
      doc.restore();
    });
  }

  doc.end();
  return bufferPromise;
}
