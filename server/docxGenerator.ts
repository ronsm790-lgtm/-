import fs from 'node:fs';
import path from 'node:path';
import {
  AlignmentType,
  BorderStyle,
  Document,
  HeightRule,
  ImageRun,
  Packer,
  PageOrientation,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from 'docx';
import type {
  AllPublishedReportCard,
  GroupExamRoster,
  PublicReportCard,
} from '../src/types/school.ts';

// A4 Portrait printable width = 11906 - 540*2 = 10826 dxa
const PRINTABLE_PORTRAIT_DXA = 10826;
// A4 Landscape printable width = 16838 - 420*2 = 15998 dxa
const PRINTABLE_LANDSCAPE_DXA = 15998;

function resolveEmblemBytes(emblemUrl?: string | null): Buffer | null {
  try {
    const clean = String(emblemUrl ?? '').split('?')[0].trim();
    const candidates = [
      clean.startsWith('/assets/') ? path.resolve(process.cwd(), 'public', clean.slice(1)) : '',
      clean.startsWith('/uploads/') ? path.resolve(process.cwd(), 'data', clean.slice(1)) : '',
      clean.startsWith('/src/assets/') ? path.resolve(process.cwd(), clean.slice(1)) : '',
      path.resolve(process.cwd(), 'public/assets/aistudio/school_logo_original_f35f0f97.jpg'),
    ].filter(Boolean);
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        return fs.readFileSync(p);
      }
    }
  } catch {
    // ignore missing asset
  }
  return null;
}

/**
 * Splits mixed Arabic + ASCII numeric/Latin strings into directional TextRuns
 * so Word preserves right-to-left Arabic reading order while keeping numbers/years LTR.
 */
function buildMixedRtlRuns(
  text: string,
  opts: { bold?: boolean; size?: number; color?: string } = {}
): TextRun[] {
  const clean = String(text ?? '').trim();
  if (!clean) {
    return [
      new TextRun({
        text: ' ',
        bold: Boolean(opts.bold),
        size: opts.size ?? 14,
        color: opts.color ?? '0B1F3A',
        font: 'Arial',
        rightToLeft: true,
      }),
    ];
  }

  const parts = clean.split(/([A-Za-z0-9]+(?:[.\-/:][A-Za-z0-9]+)*)/g).filter(Boolean);
  return parts.map((part) => {
    const isLtrToken = /^[A-Za-z0-9]/.test(part);
    return new TextRun({
      text: part,
      bold: Boolean(opts.bold),
      size: opts.size ?? 14,
      color: opts.color ?? '0B1F3A',
      font: 'Arial',
      rightToLeft: !isLtrToken,
    });
  });
}

function rtlParagraph(
  text: string,
  opts: {
    bold?: boolean;
    size?: number;
    color?: string;
    align?: (typeof AlignmentType)[keyof typeof AlignmentType];
    spaceBefore?: number;
    spaceAfter?: number;
  } = {}
): Paragraph {
  return new Paragraph({
    bidirectional: true,
    alignment: opts.align ?? AlignmentType.CENTER,
    spacing: { before: opts.spaceBefore ?? 10, after: opts.spaceAfter ?? 10 },
    children: buildMixedRtlRuns(text, {
      bold: opts.bold,
      size: opts.size ?? 14,
      color: opts.color ?? '0B1F3A',
    }),
  });
}

function makeTableCell(
  text: string,
  opts: {
    widthDxa?: number;
    bg?: string;
    color?: string;
    bold?: boolean;
    size?: number;
    align?: (typeof AlignmentType)[keyof typeof AlignmentType];
    padV?: number;
    padH?: number;
    borderColor?: string;
    rowSpan?: number;
    columnSpan?: number;
  } = {}
): TableCell {
  const pv = opts.padV ?? 18;
  const ph = opts.padH ?? 40;
  const bColor = opts.borderColor ?? '64748B';
  return new TableCell({
    verticalAlign: VerticalAlign.CENTER,
    rowSpan: opts.rowSpan,
    columnSpan: opts.columnSpan,
    width: opts.widthDxa ? { size: opts.widthDxa, type: WidthType.DXA } : undefined,
    margins: { top: pv, bottom: pv, left: ph, right: ph },
    shading: opts.bg ? { fill: opts.bg, type: ShadingType.CLEAR, color: 'auto' } : undefined,
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: bColor },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: bColor },
      left: { style: BorderStyle.SINGLE, size: 4, color: bColor },
      right: { style: BorderStyle.SINGLE, size: 4, color: bColor },
    },
    children: [
      rtlParagraph(text, {
        bold: opts.bold,
        size: opts.size ?? 13,
        color: opts.color,
        align: opts.align ?? AlignmentType.CENTER,
        spaceBefore: 0,
        spaceAfter: 0,
      }),
    ],
  });
}

function buildOfficialHeaderTable(params: {
  republicHeader: string;
  ministryHeader: string;
  directorate: string;
  schoolName: string;
  academicYear: string;
  emblemUrl?: string;
  leftPrimaryLine: string;
  leftSecondaryLine?: string;
  printableWidth: number;
  compact?: boolean;
}): Table {
  const { printableWidth, compact } = params;
  const emblemBytes = resolveEmblemBytes(params.emblemUrl);
  const sideW = Math.floor(printableWidth * 0.4);
  const centerW = printableWidth - sideW * 2;

  const noBorder = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
  const bottomBorder = { style: BorderStyle.SINGLE, size: 12, color: '0B1F3A' };
  const cellBorders = {
    top: noBorder,
    left: noBorder,
    right: noBorder,
    bottom: bottomBorder,
  };

  const titleSz = compact ? 16 : 19;
  const subSz = compact ? 14 : 17;
  const logoPx = compact ? 42 : 54;

  return new Table({
    visuallyRightToLeft: true,
    layout: TableLayoutType.FIXED,
    width: { size: printableWidth, type: WidthType.DXA },
    columnWidths: [sideW, centerW, sideW],
    rows: [
      new TableRow({
        cantSplit: true,
        children: [
          new TableCell({
            width: { size: sideW, type: WidthType.DXA },
            verticalAlign: VerticalAlign.CENTER,
            margins: { top: 24, bottom: 40, left: 30, right: 30 },
            borders: cellBorders,
            children: [
              rtlParagraph(`${params.republicHeader} — ${params.ministryHeader}`, {
                bold: true,
                size: titleSz,
                color: '0B1F3A',
                align: AlignmentType.RIGHT,
                spaceBefore: 0,
                spaceAfter: 18,
              }),
              rtlParagraph(`${params.directorate} — ${params.schoolName}`, {
                bold: true,
                size: subSz,
                color: '1E4E8C',
                align: AlignmentType.RIGHT,
                spaceBefore: 0,
                spaceAfter: 0,
              }),
            ],
          }),
          new TableCell({
            width: { size: centerW, type: WidthType.DXA },
            verticalAlign: VerticalAlign.CENTER,
            margins: { top: 16, bottom: 32, left: 16, right: 16 },
            borders: cellBorders,
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { before: 0, after: 0 },
                children: emblemBytes
                  ? [
                      new ImageRun({
                        data: emblemBytes,
                        transformation: { width: logoPx, height: logoPx },
                      } as any),
                    ]
                  : buildMixedRtlRuns('❖', { bold: true, size: 20, color: 'C59B27' }),
              }),
            ],
          }),
          new TableCell({
            width: { size: sideW, type: WidthType.DXA },
            verticalAlign: VerticalAlign.CENTER,
            margins: { top: 24, bottom: 40, left: 30, right: 30 },
            borders: cellBorders,
            children: [
              rtlParagraph(`العام الدراسي: ${params.academicYear}`, {
                bold: true,
                size: titleSz,
                color: '0B1F3A',
                align: AlignmentType.LEFT,
                spaceBefore: 0,
                spaceAfter: 18,
              }),
              rtlParagraph(params.leftPrimaryLine, {
                bold: true,
                size: subSz,
                color: '1E4E8C',
                align: AlignmentType.LEFT,
                spaceBefore: 0,
                spaceAfter: params.leftSecondaryLine ? 12 : 0,
              }),
              ...(params.leftSecondaryLine
                ? [
                    rtlParagraph(params.leftSecondaryLine, {
                      bold: false,
                      size: subSz - 2,
                      color: '334155',
                      align: AlignmentType.LEFT,
                      spaceBefore: 0,
                      spaceAfter: 0,
                    }),
                  ]
                : []),
            ],
          }),
        ],
      }),
    ],
  });
}

function buildStudentMetaTable(
  student: { fullName: string; inquiryCode: string; className: string; sectionName: string },
  printableWidth: number
): Table {
  const wName = Math.floor(printableWidth * 0.4);
  const wCode = Math.floor(printableWidth * 0.22);
  const wCls = Math.floor(printableWidth * 0.22);
  const wSec = printableWidth - (wName + wCode + wCls);

  return new Table({
    visuallyRightToLeft: true,
    layout: TableLayoutType.FIXED,
    width: { size: printableWidth, type: WidthType.DXA },
    columnWidths: [wName, wCode, wCls, wSec],
    rows: [
      new TableRow({
        cantSplit: true,
        height: { value: 360, rule: HeightRule.ATLEAST },
        children: [
          makeTableCell(`اسم الطالب: ${student.fullName}`, {
            widthDxa: wName,
            bg: 'F8FAFC',
            bold: true,
            size: 16,
            align: AlignmentType.RIGHT,
            borderColor: '334155',
            padV: 35,
          }),
          makeTableCell(`الهوية: ${student.inquiryCode}`, {
            widthDxa: wCode,
            bg: 'F8FAFC',
            bold: true,
            size: 16,
            borderColor: '334155',
            padV: 35,
          }),
          makeTableCell(`الصف: ${student.className}`, {
            widthDxa: wCls,
            bg: 'F8FAFC',
            bold: true,
            size: 16,
            borderColor: '334155',
            padV: 35,
          }),
          makeTableCell(`الشعبة: ${student.sectionName}`, {
            widthDxa: wSec,
            bg: 'F8FAFC',
            bold: true,
            size: 16,
            borderColor: '334155',
            padV: 35,
          }),
        ],
      }),
    ],
  });
}

export async function generateGroupRosterDocx(roster: GroupExamRoster): Promise<Buffer> {
  const ROWS_PER_PAGE = 50;
  const chunks: GroupExamRoster['rows'][] = [];
  for (let i = 0; i < roster.rows.length; i += ROWS_PER_PAGE) {
    chunks.push(roster.rows.slice(i, i + ROWS_PER_PAGE));
  }
  if (chunks.length === 0) chunks.push([]);

  const includeSecCol = Boolean(roster.includeAllSections);
  const seqW = 520;
  const codeW = 1420;
  const secW = includeSecCol ? 780 : 0;
  const subjCount = Math.max(1, roster.subjects.length);
  const nameMinW = 2900;
  const rawSubjW = Math.floor((PRINTABLE_LANDSCAPE_DXA - (seqW + nameMinW + codeW + secW)) / subjCount);
  const subjW = Math.max(760, rawSubjW);
  const nameW = PRINTABLE_LANDSCAPE_DXA - (seqW + codeW + secW + subjW * roster.subjects.length);
  const colWidths = [
    seqW,
    nameW,
    codeW,
    ...(includeSecCol ? [secW] : []),
    ...roster.subjects.map(() => subjW),
  ];

  const sections = chunks.map((chunk, pageIdx) => {
    const headerRow = new TableRow({
      tableHeader: true,
      cantSplit: true,
      height: { value: 360, rule: HeightRule.ATLEAST },
      children: [
        makeTableCell('ت', {
          widthDxa: seqW,
          bg: '0B1F3A',
          color: 'FFFFFF',
          bold: true,
          size: 13,
          padV: 14,
          padH: 20,
        }),
        makeTableCell('اسم الطالب', {
          widthDxa: nameW,
          bg: '0B1F3A',
          color: 'FFFFFF',
          bold: true,
          size: 13,
          align: AlignmentType.RIGHT,
          padV: 14,
          padH: 28,
        }),
        makeTableCell('رقم الهوية', {
          widthDxa: codeW,
          bg: '0B1F3A',
          color: 'FFFFFF',
          bold: true,
          size: 13,
          padV: 14,
          padH: 20,
        }),
        ...(includeSecCol
          ? [
              makeTableCell('الشعبة', {
                widthDxa: secW,
                bg: '0B1F3A',
                color: 'FFFFFF',
                bold: true,
                size: 13,
                padV: 14,
                padH: 20,
              }),
            ]
          : []),
        ...roster.subjects.map((sub) =>
          makeTableCell(sub.name, {
            widthDxa: subjW,
            bg: '0B1F3A',
            color: 'FFFFFF',
            bold: true,
            size: roster.subjects.length > 8 ? 11 : roster.subjects.length > 5 ? 12 : 13,
            padV: 14,
            padH: 18,
          })
        ),
      ],
    });

    const dataRows: TableRow[] = [];
    for (let slot = 0; slot < ROWS_PER_PAGE; slot++) {
      const r = chunk[slot];
      const seqNum = pageIdx * ROWS_PER_PAGE + slot + 1;
      const bg = slot % 2 === 0 ? 'FFFFFF' : 'F8FAFC';

      dataRows.push(
        new TableRow({
          cantSplit: true,
          height: { value: 196, rule: HeightRule.ATLEAST },
          children: [
            makeTableCell(String(seqNum), {
              widthDxa: seqW,
              bg,
              size: 12,
              padV: 6,
              padH: 18,
            }),
            makeTableCell(r ? r.fullName : '', {
              widthDxa: nameW,
              bg,
              bold: Boolean(r),
              size: 12,
              align: AlignmentType.RIGHT,
              padV: 6,
              padH: 26,
            }),
            makeTableCell(r ? r.inquiryCode : '', {
              widthDxa: codeW,
              bg,
              size: 12,
              padV: 6,
              padH: 18,
            }),
            ...(includeSecCol
              ? [
                  makeTableCell(r ? r.sectionName : '', {
                    widthDxa: secW,
                    bg,
                    size: 12,
                    padV: 6,
                    padH: 18,
                  }),
                ]
              : []),
            ...roster.subjects.map((sub) => {
              const cell = r?.scoresBySubject[sub.id];
              const scoreText = cell && cell.score !== null ? String(cell.score) : '';
              const isFail = cell && cell.score !== null && cell.score < 50;
              return makeTableCell(scoreText, {
                widthDxa: subjW,
                bg,
                size: 12,
                color: isFail ? 'B91C1C' : '0B1F3A',
                bold: Boolean(scoreText),
                padV: 6,
                padH: 16,
              });
            }),
          ],
        })
      );
    }

    const table = new Table({
      visuallyRightToLeft: true,
      layout: TableLayoutType.FIXED,
      width: { size: PRINTABLE_LANDSCAPE_DXA, type: WidthType.DXA },
      columnWidths: colWidths,
      rows: [headerRow, ...dataRows],
    });

    return {
      properties: {
        page: {
          size: {
            orientation: PageOrientation.LANDSCAPE,
          },
          margin: { top: 260, right: 420, bottom: 240, left: 420 },
        },
      },
      children: [
        buildOfficialHeaderTable({
          republicHeader: roster.republicHeader,
          ministryHeader: roster.ministryHeader,
          directorate: roster.directorate,
          schoolName: roster.schoolName,
          academicYear: roster.academicYear,
          emblemUrl: roster.emblemUrl,
          leftPrimaryLine: `كشف ${roster.examName} — ${roster.className} (${roster.sectionLabel}) · صفحة ${pageIdx + 1} من ${chunks.length}`,
          printableWidth: PRINTABLE_LANDSCAPE_DXA,
          compact: true,
        }),
        new Paragraph({ spacing: { before: 20, after: 20 }, children: [] }),
        table,
        rtlParagraph('توقيع مدير المدرسة: الأستاذ عدي عبدالكاظم', {
          bold: true,
          size: 13,
          color: '0B1F3A',
          align: AlignmentType.LEFT,
          spaceBefore: 40,
          spaceAfter: 0,
        }),
      ],
    };
  });

  const doc = new Document({
    creator: 'إعدادية المنتظر للبنين',
    title: `كشف درجات ${roster.examName} - ${roster.className}`,
    sections,
  });

  return Buffer.from(await Packer.toBuffer(doc));
}

function buildSingleExamReportSection(card: PublicReportCard) {
  const hasNotes = Boolean(card.hasNotesColumn);
  const seqW = 720;
  const subW = hasNotes ? 3800 : 4800;
  const scoreW = hasNotes ? 1500 : 1900;
  const ratingW = hasNotes ? 1800 : PRINTABLE_PORTRAIT_DXA - (seqW + subW + scoreW);
  const notesW = hasNotes ? PRINTABLE_PORTRAIT_DXA - (seqW + subW + scoreW + ratingW) : 0;

  const colWidths = hasNotes
    ? [seqW, subW, scoreW, ratingW, notesW]
    : [seqW, subW, scoreW, ratingW];

  const headerRow = new TableRow({
    tableHeader: true,
    cantSplit: true,
    height: { value: 440, rule: HeightRule.ATLEAST },
    children: [
      makeTableCell('ت', { widthDxa: seqW, bg: '0B1F3A', color: 'FFFFFF', bold: true, size: 18 }),
      makeTableCell('المادة الدراسية', {
        widthDxa: subW,
        bg: '0B1F3A',
        color: 'FFFFFF',
        bold: true,
        size: 18,
      }),
      makeTableCell('الدرجة', {
        widthDxa: scoreW,
        bg: '0B1F3A',
        color: 'FFFFFF',
        bold: true,
        size: 18,
      }),
      makeTableCell('التقدير', {
        widthDxa: ratingW,
        bg: '0B1F3A',
        color: 'FFFFFF',
        bold: true,
        size: 18,
      }),
      ...(hasNotes
        ? [
            makeTableCell('الملاحظات', {
              widthDxa: notesW,
              bg: '0B1F3A',
              color: 'FFFFFF',
              bold: true,
              size: 18,
            }),
          ]
        : []),
    ],
  });

  const dataRows = card.rows.map((r, idx) => {
    const bg = idx % 2 === 0 ? 'FFFFFF' : 'F8FAFC';
    const isFail = r.score < 50;
    return new TableRow({
      cantSplit: true,
      height: { value: 380, rule: HeightRule.ATLEAST },
      children: [
        makeTableCell(String(r.sequence), { widthDxa: seqW, bg, size: 17, bold: true, padV: 36 }),
        makeTableCell(r.subjectName, {
          widthDxa: subW,
          bg,
          size: 17,
          bold: true,
          align: AlignmentType.RIGHT,
          padV: 36,
        }),
        makeTableCell(String(r.score), {
          widthDxa: scoreW,
          bg,
          size: 18,
          bold: true,
          color: isFail ? 'B91C1C' : '0B1F3A',
          padV: 36,
        }),
        makeTableCell(r.rating || '—', { widthDxa: ratingW, bg, size: 16, padV: 36 }),
        ...(hasNotes
          ? [
              makeTableCell(r.notes || '—', {
                widthDxa: notesW,
                bg,
                size: 15,
                align: AlignmentType.RIGHT,
                padV: 36,
              }),
            ]
          : []),
      ],
    });
  });

  const summaryRows: TableRow[] = card.summary
    ? [
        new TableRow({
          cantSplit: true,
          height: { value: 420, rule: HeightRule.ATLEAST },
          children: [
            makeTableCell(
              `المجموع: ${card.summary.totalScore}   |   المعدل: ${card.summary.average}   |   التقدير العام: ${card.summary.overallRating}`,
              {
                columnSpan: colWidths.length,
                bg: 'E2E8F0',
                bold: true,
                size: 18,
                borderColor: '0B1F3A',
                padV: 40,
              }
            ),
          ],
        }),
      ]
    : [];

  const gradesTable = new Table({
    visuallyRightToLeft: true,
    layout: TableLayoutType.FIXED,
    width: { size: PRINTABLE_PORTRAIT_DXA, type: WidthType.DXA },
    columnWidths: colWidths,
    rows: [headerRow, ...dataRows, ...summaryRows],
  });

  return {
    properties: {
      page: {
        size: { orientation: PageOrientation.PORTRAIT },
        margin: { top: 480, right: 540, bottom: 420, left: 540 },
      },
    },
    children: [
      buildOfficialHeaderTable({
        republicHeader: card.republicHeader,
        ministryHeader: card.ministryHeader,
        directorate: card.directorate,
        schoolName: card.schoolName,
        academicYear: card.academicYear,
        emblemUrl: card.emblemUrl,
        leftPrimaryLine: `كشف درجات: ${card.examName}`,
        leftSecondaryLine: card.issuedAt ? `تاريخ الإصدار: ${card.issuedAt.slice(0, 10)}` : undefined,
        printableWidth: PRINTABLE_PORTRAIT_DXA,
      }),
      new Paragraph({ spacing: { before: 70, after: 70 }, children: [] }),
      buildStudentMetaTable(card.student, PRINTABLE_PORTRAIT_DXA),
      new Paragraph({ spacing: { before: 70, after: 70 }, children: [] }),
      gradesTable,
      new Paragraph({ spacing: { before: 120, after: 40 }, children: [] }),
      rtlParagraph('مدير المدرسة: الأستاذ عدي عبدالكاظم', {
        bold: true,
        size: 18,
        color: '0B1F3A',
        align: AlignmentType.LEFT,
        spaceBefore: 80,
        spaceAfter: 60,
      }),
      ...(card.footerText
        ? [
            rtlParagraph(card.footerText, {
              bold: false,
              size: 14,
              color: '334155',
              align: AlignmentType.CENTER,
              spaceBefore: 40,
              spaceAfter: 0,
            }),
          ]
        : []),
    ],
  };
}

function buildIraqiAllReportSection(card: AllPublishedReportCard) {
  const isMin = Boolean(card.isMinisterial);
  const cols: Array<{ key: string; label: string; w: number }> = isMin
    ? [
        { key: 'seq', label: 'ت', w: 500 },
        { key: 'subject', label: 'المادة الدراسية', w: 2350 },
        { key: 's1m1', label: 'ف1 ش1', w: 940 },
        { key: 's1m2', label: 'ف1 ش2', w: 940 },
        { key: 's1avg', label: 'سعي ف1', w: 1020 },
        { key: 'mid', label: 'نصف السنة', w: 1120 },
        { key: 's2m1', label: 'ف2 ش1', w: 940 },
        { key: 's2m2', label: 'ف2 ش2', w: 940 },
        { key: 's2avg', label: 'سعي ف2', w: 1020 },
        { key: 'annual', label: 'السعي السنوي', w: 1180 },
        { key: 'qual', label: 'التأهيل الوزاري', w: 1750 },
        {
          key: 'notes',
          label: 'الملاحظات',
          w: PRINTABLE_LANDSCAPE_DXA - (500 + 2350 + 940 * 4 + 1020 * 2 + 1120 + 1180 + 1750),
        },
      ]
    : [
        { key: 'seq', label: 'ت', w: 460 },
        { key: 'subject', label: 'المادة الدراسية', w: 2300 },
        { key: 's1m1', label: 'ف1 ش1', w: 880 },
        { key: 's1m2', label: 'ف1 ش2', w: 880 },
        { key: 's1avg', label: 'سعي ف1', w: 950 },
        { key: 'mid', label: 'نصف السنة', w: 1080 },
        { key: 's2m1', label: 'ف2 ش1', w: 880 },
        { key: 's2m2', label: 'ف2 ش2', w: 880 },
        { key: 's2avg', label: 'سعي ف2', w: 950 },
        { key: 'annual', label: 'السعي السنوي', w: 1120 },
        { key: 'finalEx', label: 'النهائي / د2', w: 1220 },
        { key: 'finalGr', label: 'الدرجة النهائية', w: 1220 },
        {
          key: 'notes',
          label: 'الملاحظات',
          w: PRINTABLE_LANDSCAPE_DXA - (460 + 2300 + 880 * 4 + 950 * 2 + 1080 + 1120 + 1220 * 2),
        },
      ];

  const colWidths = cols.map((c) => c.w);
  const headerRow = new TableRow({
    tableHeader: true,
    cantSplit: true,
    height: { value: 420, rule: HeightRule.ATLEAST },
    children: cols.map((c) =>
      makeTableCell(c.label, {
        widthDxa: c.w,
        bg: '0B1F3A',
        color: 'FFFFFF',
        bold: true,
        size: 14,
        padV: 24,
        padH: 20,
      })
    ),
  });

  const fmt = (v: number | null | undefined) => (v !== null && v !== undefined ? String(v) : '—');
  const dataRows = card.iraqiRows.map((r, idx) => {
    const isExempt = Boolean(r.isIndividualExempt || r.isGeneralExempt);
    const isSecRound = Boolean(r.isSecondRoundUpdated);
    const rowBg = isSecRound
      ? 'FEF3C7'
      : isExempt
        ? 'ECFDF5'
        : idx % 2 === 0
          ? 'FFFFFF'
          : 'F8FAFC';

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

    return new TableRow({
      cantSplit: true,
      height: { value: 310, rule: HeightRule.ATLEAST },
      children: cols.map((c) => {
        const isFailing = c.key === 'finalGr' && r.finalGrade !== null && r.finalGrade < 50;
        const color = isFailing
          ? 'B91C1C'
          : c.key === 'qual' && r.ministerialQualification === 'qualified'
            ? '047857'
            : c.key === 'qual' && r.ministerialQualification === 'not_qualified'
              ? 'B91C1C'
              : '0B1F3A';
        return makeTableCell(cellVals[c.key] ?? '—', {
          widthDxa: c.w,
          bg: rowBg,
          color,
          bold: c.key === 'subject' || c.key === 'finalGr' || c.key === 'qual' || isExempt || isSecRound,
          size: c.key === 'notes' ? 13 : 15,
          align: c.key === 'subject' || c.key === 'notes' ? AlignmentType.RIGHT : AlignmentType.CENTER,
          padV: 22,
          padH: 20,
        });
      }),
    });
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

  const summaryRow = new TableRow({
    cantSplit: true,
    height: { value: 360, rule: HeightRule.ATLEAST },
    children: cols.map((c) =>
      makeTableCell(sumVals[c.key] ?? '—', {
        widthDxa: c.w,
        bg: 'E2E8F0',
        bold: true,
        size: c.key === 'qual' ? 13 : 15,
        align: c.key === 'subject' || c.key === 'notes' ? AlignmentType.RIGHT : AlignmentType.CENTER,
        borderColor: '334155',
        padV: 24,
        padH: 20,
      })
    ),
  });

  const matrixTable = new Table({
    visuallyRightToLeft: true,
    layout: TableLayoutType.FIXED,
    width: { size: PRINTABLE_LANDSCAPE_DXA, type: WidthType.DXA },
    columnWidths: colWidths,
    rows: [headerRow, ...dataRows, summaryRow],
  });

  const outcomeLine = isMin
    ? `النتيجة النهائية للتأهيل الوزاري: ${sum.ministerialResultText || 'قيد المتابعة'}`
    : `نتيجة الدور الأول: ${sum.isGeneralExempt ? 'ناجح (إعفاء عام)' : sum.round1Result || '—'}   |   نتيجة الدور الثاني: ${sum.hasSecondRoundUpdates ? sum.standing : '—'}`;

  return {
    properties: {
      page: {
        size: { orientation: PageOrientation.LANDSCAPE },
        margin: { top: 320, right: 420, bottom: 280, left: 420 },
      },
    },
    children: [
      buildOfficialHeaderTable({
        republicHeader: card.republicHeader,
        ministryHeader: card.ministryHeader,
        directorate: card.directorate,
        schoolName: card.schoolName,
        academicYear: card.academicYear,
        emblemUrl: card.emblemUrl,
        leftPrimaryLine: isMin ? 'بطاقة درجات السادس الوزاري' : 'بطاقة الدرجات المدرسية الرسمية',
        printableWidth: PRINTABLE_LANDSCAPE_DXA,
        compact: true,
      }),
      new Paragraph({ spacing: { before: 40, after: 40 }, children: [] }),
      buildStudentMetaTable(card.student, PRINTABLE_LANDSCAPE_DXA),
      new Paragraph({ spacing: { before: 40, after: 40 }, children: [] }),
      matrixTable,
      rtlParagraph(outcomeLine, {
        bold: true,
        size: 16,
        color: '0B1F3A',
        align: AlignmentType.CENTER,
        spaceBefore: 70,
        spaceAfter: 30,
      }),
      rtlParagraph('توقيع مدير المدرسة: الأستاذ عدي عبدالكاظم', {
        bold: true,
        size: 16,
        color: '0B1F3A',
        align: AlignmentType.LEFT,
        spaceBefore: 40,
        spaceAfter: 20,
      }),
      ...(card.footerText
        ? [
            rtlParagraph(card.footerText, {
              bold: false,
              size: 13,
              color: '334155',
              align: AlignmentType.CENTER,
              spaceBefore: 20,
              spaceAfter: 0,
            }),
          ]
        : []),
    ],
  };
}

export async function generateSingleExamReportDocx(card: PublicReportCard): Promise<Buffer> {
  const doc = new Document({
    creator: card.schoolName || 'إعدادية المنتظر للبنين',
    title: `نتيجة ${card.student.fullName} - ${card.examName}`,
    sections: [buildSingleExamReportSection(card)],
  });
  return Buffer.from(await Packer.toBuffer(doc));
}

export async function generateMultipleSingleExamReportCardsDocx(
  cards: PublicReportCard[]
): Promise<Buffer> {
  const doc = new Document({
    creator: cards[0]?.schoolName || 'إعدادية المنتظر للبنين',
    title: 'بطاقات نتائج الطلبة الجماعية',
    sections: cards.map((card) => buildSingleExamReportSection(card)),
  });
  return Buffer.from(await Packer.toBuffer(doc));
}

export async function generateIraqiAllReportDocx(card: AllPublishedReportCard): Promise<Buffer> {
  const doc = new Document({
    creator: card.schoolName || 'إعدادية المنتظر للبنين',
    title: `بطاقة الدرجات الشاملة - ${card.student.fullName}`,
    sections: [buildIraqiAllReportSection(card)],
  });
  return Buffer.from(await Packer.toBuffer(doc));
}

export async function generateMultipleIraqiReportCardsDocx(
  cards: AllPublishedReportCard[]
): Promise<Buffer> {
  const doc = new Document({
    creator: cards[0]?.schoolName || 'إعدادية المنتظر للبنين',
    title: 'بطاقات الدرجات المدرسية الجماعية',
    sections: cards.map((card) => buildIraqiAllReportSection(card)),
  });
  return Buffer.from(await Packer.toBuffer(doc));
}
