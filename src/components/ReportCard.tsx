import { useRef, useState, type ReactNode } from 'react';
import { FileText, ImageDown, Layers, Printer, RotateCcw } from 'lucide-react';
import { downloadBinaryFile } from '../lib/api.ts';
import { captureSheetToPng } from '../lib/exportImage.ts';
import type { AllPublishedReportCard, PublicReportCard } from '../types/school.ts';
import { ActionMenu, type ActionMenuItem } from './ui/ActionMenu.tsx';

function formatScoreCell(score: number | null) {
  if (score === null) {
    return <span className="text-neutral-400 font-normal">—</span>;
  }
  const isFailing = score < 50;
  return (
    <span
      className={`tabular-nums ${
        isFailing ? 'font-extrabold text-[#DC2626]' : 'font-bold text-black'
      }`}
    >
      {score}
    </span>
  );
}

export function PrincipalSignature({
  compact = false,
  density,
}: {
  compact?: boolean;
  density?: 'default' | 'compact' | 'roster';
}) {
  const mode = density ?? (compact ? 'compact' : 'default');
  return (
    <div
      className={`${
        mode === 'roster'
          ? 'pt-0.5 text-[10.5px] leading-tight'
          : mode === 'compact'
            ? 'pt-1 text-xs'
            : 'pt-2 text-xs sm:text-sm'
      } flex flex-col items-center justify-center text-center font-bold text-black`}
    >
      <p className="m-0">مدير المدرسة</p>
      <p className="m-0 mt-0.5 font-extrabold">الأستاذ عدي عبدالكاظم</p>
      <div
        className={`w-40 mx-auto border-b border-dashed border-black ${
          mode === 'roster' ? 'mt-2.5' : mode === 'compact' ? 'mt-4' : 'mt-6'
        }`}
      />
    </div>
  );
}

export interface OfficialSheetHeaderProps {
  republicHeader: string;
  ministryHeader: string;
  directorate: string;
  schoolName: string;
  emblemUrl: string;
  metaItems?: ReactNode[];
  metaLines?: ReactNode;
  compact?: boolean;
  density?: 'default' | 'compact' | 'roster';
}

export function OfficialSheetHeader({
  republicHeader,
  ministryHeader,
  directorate,
  schoolName,
  emblemUrl,
  metaItems,
  metaLines,
  compact = false,
  density,
}: OfficialSheetHeaderProps) {
  const mode = density ?? (compact ? 'compact' : 'default');
  const logoSizeClass =
    mode === 'roster'
      ? 'w-[66px] h-[66px]'
      : mode === 'compact'
        ? 'w-[78px] h-[78px]'
        : 'w-[88px] h-[88px]';
  const cellPadClass =
    mode === 'roster' ? 'pb-2 px-2' : mode === 'compact' ? 'pb-3 px-2' : 'pb-3.5 px-2';
  const rowPadClass = mode === 'roster' ? 'py-[1.5px]' : 'py-[2.5px]';
  const rightLineClass =
    mode === 'roster'
      ? 'text-[11px] leading-[1.45]'
      : mode === 'compact'
        ? 'text-xs leading-[1.55]'
        : 'text-[13px] sm:text-sm leading-[1.6]';
  const schoolTitleClass =
    mode === 'roster'
      ? 'text-xs font-extrabold leading-[1.45]'
      : mode === 'compact'
        ? 'text-sm font-extrabold leading-[1.55]'
        : 'text-[15px] sm:text-base font-extrabold leading-[1.6]';
  const leftTextClass =
    mode === 'roster'
      ? 'text-[10.5px] leading-[1.45]'
      : mode === 'compact'
        ? 'text-xs leading-[1.6]'
        : 'text-xs sm:text-[13px] leading-[1.65]';

  return (
    <header className="w-full border-b-2 border-black text-center">
      <table className="w-full table-fixed border-collapse">
        <tbody>
          <tr>
            <td className={`w-[39%] align-middle text-center ${cellPadClass}`}>
              <table className="w-full border-collapse font-display text-black">
                <tbody>
                  <tr>
                    <td className={`${rowPadClass} text-center align-middle`}>
                      <span className={`block ${rightLineClass} font-bold`}>{republicHeader}</span>
                    </td>
                  </tr>
                  <tr>
                    <td className={`${rowPadClass} text-center align-middle`}>
                      <span className={`block ${rightLineClass} font-bold`}>{ministryHeader}</span>
                    </td>
                  </tr>
                  <tr>
                    <td className={`${rowPadClass} text-center align-middle`}>
                      <span className={`block ${rightLineClass} font-semibold`}>{directorate}</span>
                    </td>
                  </tr>
                  <tr>
                    <td className={`${rowPadClass} pt-1 text-center align-middle`}>
                      <span className={`block ${schoolTitleClass}`}>{schoolName}</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </td>

            <td className={`w-[22%] align-middle text-center ${cellPadClass}`}>
              <div
                className={`${logoSizeClass} mx-auto rounded-full overflow-hidden border-[1.5px] border-black bg-white`}
              >
                <img
                  src={emblemUrl}
                  alt={`شعار ${schoolName}`}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover scale-[1.06] block"
                />
              </div>
            </td>

            <td className={`w-[39%] align-middle text-center ${cellPadClass}`}>
              {metaItems && metaItems.length > 0 ? (
                <table className={`w-full border-collapse text-black ${leftTextClass}`}>
                  <tbody>
                    {metaItems.map((item, idx) => (
                      <tr key={idx}>
                        <td className={`${rowPadClass} text-center align-middle`}>{item}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className={`space-y-1.5 ${leftTextClass} text-black`}>{metaLines}</div>
              )}
            </td>
          </tr>
        </tbody>
      </table>
    </header>
  );
}

interface StudentMetaStripProps {
  fullName: string;
  inquiryCode: string;
  className: string;
  sectionName: string;
}

function StudentMetaStrip({
  fullName,
  inquiryCode,
  className,
  sectionName,
}: StudentMetaStripProps) {
  return (
    <div dir="rtl" className="w-full border-y border-black/40 py-2.5 px-2">
      <table className="w-full table-fixed border-collapse text-center text-sm">
        <tbody>
          <tr>
            <td className="w-[38%] align-middle px-1.5">
              <div className="mb-1 text-[11px] font-semibold text-neutral-600 leading-normal">
                اسم الطالب
              </div>
              <div className="font-extrabold text-black leading-normal">{fullName}</div>
            </td>
            <td className="w-[22%] align-middle px-1.5">
              <div className="mb-1 text-[11px] font-semibold text-neutral-600 leading-normal">
                رقم الهوية الوطنية
              </div>
              <div className="font-mono font-bold text-black tabular-nums leading-normal">
                {inquiryCode}
              </div>
            </td>
            <td className="w-[25%] align-middle px-1.5">
              <div className="mb-1 text-[11px] font-semibold text-neutral-600 leading-normal">
                الصف الدراسي
              </div>
              <div className="font-bold text-black leading-normal">{className}</div>
            </td>
            <td className="w-[15%] align-middle px-1.5">
              <div className="mb-1 text-[11px] font-semibold text-neutral-600 leading-normal">
                الشعبة
              </div>
              <div className="font-bold text-black leading-normal">{sectionName}</div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export function SingleReportSheet({ report }: { report: PublicReportCard }) {
  return (
    <div
      dir="rtl"
      className="print-sheet a4-sheet mx-auto border-2 border-black p-5 print:p-3 shadow-md bg-white text-black flex flex-col"
    >
      <div className="border border-black p-6 print:p-4 flex-1 flex flex-col justify-between gap-6 print:gap-3">
        <div className="space-y-5 print:space-y-3">
          <OfficialSheetHeader
            republicHeader={report.republicHeader}
            ministryHeader={report.ministryHeader}
            directorate={report.directorate}
            schoolName={report.schoolName}
            emblemUrl={report.emblemUrl}
            metaItems={[
              <span key="year" className="font-semibold text-black">
                العام الدراسي:{' '}
                <span dir="ltr" className="font-bold text-black tabular-nums whitespace-nowrap">
                  {report.academicYear}
                </span>
              </span>,
              <span key="exam" className="font-semibold text-black">
                الامتحان: <span className="font-bold text-black">{report.examName}</span>
              </span>,
              ...(report.issuedAt
                ? [
                    <span key="date" className="font-semibold text-black">
                      التاريخ:{' '}
                      <span dir="ltr" className="font-bold text-black tabular-nums whitespace-nowrap">
                        {report.issuedAt.slice(0, 10)}
                      </span>
                    </span>,
                  ]
                : []),
            ]}
          />

          <div className="text-center py-2 bg-[#F3F4F6] border border-black">
            <h2 className="font-display text-lg sm:text-xl font-extrabold text-black text-center">
              كشف درجات الطالب — {report.examName}
            </h2>
          </div>

          <StudentMetaStrip
            fullName={report.student.fullName}
            inquiryCode={report.student.inquiryCode}
            className={report.student.className}
            sectionName={report.student.sectionName}
          />

          <table className="w-full border-collapse text-sm text-center">
            <thead>
              <tr className="bg-[#E5E7EB] text-black">
                <th className="border border-black px-2 py-2.5 text-center w-12 font-bold">ت</th>
                <th className="border border-black px-4 py-2.5 text-center font-bold">
                  المادة الدراسية
                </th>
                <th className="border border-black px-3 py-2.5 text-center w-28 font-bold">
                  الدرجة
                </th>
                {report.hasNotesColumn && (
                  <th className="border border-black px-3 py-2.5 text-center font-bold">
                    الملاحظات
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {report.rows.map((row, idx) => (
                <tr key={row.subjectId} className={idx % 2 === 0 ? 'bg-white' : 'bg-[#F9FAFB]'}>
                  <td className="border border-black px-2 py-2.5 text-center tabular-nums font-semibold">
                    {row.sequence}
                  </td>
                  <td className="border border-black px-4 py-2.5 text-center font-bold text-black">
                    {row.subjectName}
                  </td>
                  <td className="border border-black px-3 py-2.5 text-center text-base">
                    {formatScoreCell(row.score)}
                  </td>
                  {report.hasNotesColumn && (
                    <td className="border border-black px-3 py-2.5 text-center text-xs text-black">
                      {row.notes}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <footer className="pt-4 space-y-4 text-center">
          <PrincipalSignature />

          {report.footerText && (
            <div className="border-t border-black pt-3 text-center text-xs text-black leading-relaxed">
              {report.footerText}
            </div>
          )}
        </footer>
      </div>
    </div>
  );
}

export function AllResultsReportSheet({ allReport }: { allReport: AllPublishedReportCard }) {
  const { iraqiRows, iraqiSummary } = allReport;
  const isMinisterial = Boolean(allReport.isMinisterial);
  const r1Text = iraqiSummary.round1Result;
  const r1Tone =
    r1Text === 'ناجح'
      ? 'text-emerald-800'
      : r1Text === 'راسب'
        ? 'text-[#DC2626]'
        : 'text-black';

  const ministerialText = iraqiSummary.ministerialResultText || '';
  const ministerialTone =
    iraqiSummary.ministerialDecision === 'qualified'
      ? 'text-emerald-800'
      : iraqiSummary.ministerialDecision === 'not_qualified'
        ? 'text-[#DC2626]'
        : 'text-black';

  return (
    <div
      dir="rtl"
      className="print-sheet a4-landscape-sheet mx-auto border-2 border-black p-4 print:p-2 shadow-md bg-white text-black flex flex-col"
    >
      <div className="border-[1.5px] border-black p-4 print:p-2.5 flex-1 flex flex-col justify-between gap-3 print:gap-1.5 bg-white text-black">
        <div className="space-y-3 print:space-y-1.5">
          <OfficialSheetHeader
            compact
            republicHeader={allReport.republicHeader}
            ministryHeader={allReport.ministryHeader}
            directorate={allReport.directorate}
            schoolName={allReport.schoolName}
            emblemUrl={allReport.emblemUrl}
            metaItems={[
              <span key="year" className="font-semibold text-black">
                العام الدراسي:{' '}
                <span dir="ltr" className="font-bold text-black tabular-nums whitespace-nowrap">
                  {allReport.academicYear}
                </span>
              </span>,
              <span key="title" className="font-semibold text-black">
                بطاقة الدرجات المدرسية:{' '}
                <span className="font-bold text-black">
                  {isMinisterial ? 'السادس الإعدادي (وزاري)' : 'المرحلة الإعدادية'}
                </span>
              </span>,
            ]}
          />

          <StudentMetaStrip
            fullName={allReport.student.fullName}
            inquiryCode={allReport.student.inquiryCode}
            className={allReport.student.className}
            sectionName={allReport.student.sectionName}
          />

          <table className="w-full border-collapse text-xs leading-snug text-center">
            <thead>
              <tr className="bg-[#E5E7EB] text-black">
                <th rowSpan={2} className="border border-black px-1.5 py-1.5 text-center w-8 font-bold">
                  ت
                </th>
                <th
                  rowSpan={2}
                  className="border border-black px-2 py-1.5 text-center font-bold min-w-[130px]"
                >
                  المواد الدراسية
                </th>
                <th colSpan={3} className="border border-black px-1 py-1 text-center font-bold">
                  الفصل الأول
                </th>
                <th rowSpan={2} className="border border-black px-1.5 py-1.5 text-center font-bold w-16">
                  نصف السنة
                </th>
                <th colSpan={3} className="border border-black px-1 py-1 text-center font-bold">
                  الفصل الثاني
                </th>
                <th
                  rowSpan={2}
                  className="border border-black px-1.5 py-1.5 text-center font-bold w-16 bg-[#D1D5DB]"
                >
                  السعي السنوي
                </th>
                {isMinisterial ? (
                  <th
                    rowSpan={2}
                    className="border border-black px-2 py-1.5 text-center font-bold w-24 bg-[#D1D5DB]"
                  >
                    التأهيل
                  </th>
                ) : (
                  <>
                    <th rowSpan={2} className="border border-black px-1.5 py-1.5 text-center font-bold w-16">
                      الامتحان النهائي
                    </th>
                    <th
                      rowSpan={2}
                      className="border border-black px-1.5 py-1.5 text-center font-bold w-16 bg-[#D1D5DB]"
                    >
                      الدرجة النهائية
                    </th>
                  </>
                )}
                <th
                  rowSpan={2}
                  className="border border-black px-2 py-1.5 text-center font-bold min-w-[90px]"
                >
                  الملاحظات
                </th>
              </tr>
              <tr className="bg-[#F3F4F6] text-black text-[11px]">
                <th className="border border-black px-1 py-1 text-center font-bold w-14">
                  الشهر الأول
                </th>
                <th className="border border-black px-1 py-1 text-center font-bold w-14">
                  الشهر الثاني
                </th>
                <th className="border border-black px-1 py-1 text-center font-bold w-16 bg-[#E5E7EB]">
                  سعي الفصل الأول
                </th>
                <th className="border border-black px-1 py-1 text-center font-bold w-14">
                  الشهر الأول
                </th>
                <th className="border border-black px-1 py-1 text-center font-bold w-14">
                  الشهر الثاني
                </th>
                <th className="border border-black px-1 py-1 text-center font-bold w-16 bg-[#E5E7EB]">
                  سعي الفصل الثاني
                </th>
              </tr>
            </thead>
            <tbody>
              {iraqiRows.map((row, idx) => {
                const isExempt = Boolean(row.isIndividualExempt || row.isGeneralExempt);
                const isSecondRoundUpdated = Boolean(row.isSecondRoundUpdated);
                const rowBg = isSecondRoundUpdated
                  ? 'bg-amber-50/80'
                  : isExempt
                    ? 'bg-emerald-50/50'
                    : idx % 2 === 0
                      ? 'bg-white'
                      : 'bg-[#F9FAFB]';
                const qual = row.ministerialQualification;
                return (
                  <tr key={row.subjectId} className={rowBg}>
                    <td className="border border-black px-1.5 py-1.5 print:py-[3px] text-center tabular-nums font-semibold">
                      {row.sequence}
                    </td>
                    <td className="border border-black px-2 py-1.5 print:py-[3px] text-center font-bold text-black">
                      {row.subjectName}
                    </td>
                    <td className="border border-black px-1 py-1.5 print:py-[3px] text-center">
                      {formatScoreCell(row.sem1Month1)}
                    </td>
                    <td className="border border-black px-1 py-1.5 print:py-[3px] text-center">
                      {formatScoreCell(row.sem1Month2)}
                    </td>
                    <td className="border border-black px-1 py-1.5 print:py-[3px] text-center bg-[#F3F4F6]">
                      {formatScoreCell(row.sem1Average)}
                    </td>
                    <td className="border border-black px-1 py-1.5 print:py-[3px] text-center">
                      {formatScoreCell(row.midyear)}
                    </td>
                    <td className="border border-black px-1 py-1.5 print:py-[3px] text-center">
                      {formatScoreCell(row.sem2Month1)}
                    </td>
                    <td className="border border-black px-1 py-1.5 print:py-[3px] text-center">
                      {formatScoreCell(row.sem2Month2)}
                    </td>
                    <td className="border border-black px-1 py-1.5 print:py-[3px] text-center bg-[#F3F4F6]">
                      {formatScoreCell(row.sem2Average)}
                    </td>
                    <td className="border border-black px-1 py-1.5 print:py-[3px] text-center bg-[#F3F4F6]">
                      {formatScoreCell(row.annualEffort)}
                    </td>
                    {isMinisterial ? (
                      <td className="border border-black px-2 py-1.5 print:py-[3px] text-center bg-[#E5E7EB] whitespace-nowrap">
                        {qual === 'qualified' ? (
                          <span className="font-extrabold text-emerald-800">مؤهل</span>
                        ) : qual === 'not_qualified' ? (
                          <span className="font-extrabold text-[#DC2626]">غير مؤهل</span>
                        ) : (
                          <span className="text-neutral-400 font-normal">—</span>
                        )}
                      </td>
                    ) : (
                      <>
                        <td className="border border-black px-1 py-1.5 print:py-[3px] text-center">
                          {isExempt ? (
                            <span className="font-extrabold text-emerald-800">معفو</span>
                          ) : (
                            formatScoreCell(row.finalExam)
                          )}
                        </td>
                        <td
                          className={`border border-black px-1 py-1.5 print:py-[3px] text-center ${
                            isSecondRoundUpdated ? 'bg-amber-100/80' : 'bg-[#E5E7EB]'
                          }`}
                        >
                          {formatScoreCell(row.finalGrade)}
                        </td>
                      </>
                    )}
                    <td className="border border-black px-2 py-1.5 print:py-[3px] text-center text-[11px] text-black">
                      {[
                        row.isGeneralExempt
                          ? 'إعفاء عام'
                          : row.isIndividualExempt
                            ? 'إعفاء فردي'
                            : '',
                        row.isSecondRoundUpdated
                          ? `دور ثاني (${row.secondRoundScore ?? ''})`
                          : '',
                        row.notes,
                      ]
                        .filter(Boolean)
                        .join(' · ') || '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {isMinisterial ? (
            <div className="w-full pt-1 print:pt-0.5">
              <div className="w-full h-9 print:h-7 border border-black bg-[#F9FAFB] px-4 flex items-center justify-between text-xs sm:text-sm font-bold text-black">
                <span>النتيجة النهائية للتأهيل الوزاري:</span>
                <span className={`font-extrabold ${ministerialTone}`}>{ministerialText || ''}</span>
                <span className="w-16" />
              </div>
            </div>
          ) : (
            <div className="w-full space-y-1.5 print:space-y-1 pt-1 print:pt-0.5">
              <div className="w-full h-8 print:h-7 border border-black bg-[#F9FAFB] px-4 flex items-center justify-between text-xs sm:text-sm font-bold text-black">
                <span>نتيجة الدور الأول:</span>
                <span className={`font-extrabold ${r1Tone}`}>
                  {iraqiSummary.isGeneralExempt
                    ? 'ناجح (إعفاء عام)'
                    : r1Text || ''}
                </span>
                <span className="w-16" />
              </div>
              <div className="w-full h-8 print:h-7 border border-black bg-white px-4 flex items-center justify-between text-xs sm:text-sm font-bold text-black">
                <span>نتيجة الدور الثاني:</span>
                <span className="font-extrabold text-amber-900">
                  {iraqiSummary.hasSecondRoundUpdates ? iraqiSummary.standing : ''}
                </span>
                <span className="w-16" />
              </div>
            </div>
          )}
        </div>

        <footer className="pt-1 print:pt-0 space-y-2 print:space-y-1 text-center">
          <PrincipalSignature density="roster" />

          {allReport.footerText && (
            <div className="border-t border-black pt-2 print:pt-1 text-center text-[11px] print:text-[10px] text-black leading-relaxed">
              {allReport.footerText}
            </div>
          )}
        </footer>
      </div>
    </div>
  );
}

export interface ReportPdfRequestParams {
  inquiryCode: string;
  examId: string | number;
  yearId?: number | null;
  publishSlug?: string;
}

interface ReportCardProps {
  report: PublicReportCard;
  pdfParams?: ReportPdfRequestParams;
  onReset?: () => void;
  onShowAllResults?: () => void;
}

export function ReportCard({ report, pdfParams, onReset, onShowAllResults }: ReportCardProps) {
  const [exporting, setExporting] = useState(false);
  const [exportingImage, setExportingImage] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);

  const handlePrint = () => {
    window.print();
  };

  const handleDownloadPdf = async () => {
    setExporting(true);
    setExportError(null);
    try {
      await downloadBinaryFile(
        '/api/public/report-pdf',
        `نتيجة-${report.student.fullName}-${report.examName}.pdf`,
        {
          method: 'POST',
          body: JSON.stringify({
            inquiryCode: pdfParams?.inquiryCode ?? report.student.inquiryCode,
            examId: pdfParams?.examId ?? 'all',
            ...(pdfParams?.yearId ? { yearId: pdfParams.yearId } : {}),
            ...(pdfParams?.publishSlug ? { publishSlug: pdfParams.publishSlug } : {}),
          }),
        }
      );
    } catch (err: any) {
      setExportError(err?.message || 'تعذر تصدير ملف PDF الرسمي. يرجى المحاولة مجدداً.');
    } finally {
      setExporting(false);
    }
  };

  const handleDownloadImage = async () => {
    if (!sheetRef.current) return;
    setExportingImage(true);
    setExportError(null);
    try {
      const dataUrl = await captureSheetToPng(sheetRef.current, { pixelRatio: 2.2 });
      const link = document.createElement('a');
      link.href = dataUrl;
      link.download = `نتيجة-${report.student.fullName}-${report.examName}.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err: any) {
      setExportError(err?.message || 'تعذر حفظ النتيجة كصورة PNG. يرجى المحاولة مجدداً.');
    } finally {
      setExportingImage(false);
    }
  };

  return (
    <section aria-label="كشف الدرجات الرسمي" className="space-y-4">
      <style media="print">{'@page { size: A4 portrait; margin: 7mm; }'}</style>

      <div className="no-print flex flex-wrap items-center justify-between gap-3 bg-white border border-slate-200 rounded-xl px-4 sm:px-5 py-3.5 shadow-xs">
        <div className="text-sm font-semibold text-[#0B1F3A]">
          بطاقة الدرجات المعتمدة — <span className="text-[#1E4E8C]">{report.examName}</span>
        </div>
        <ActionMenu
          label={exporting ? 'جاري تصدير PDF...' : exportingImage ? 'جاري حفظ الصورة...' : 'أوامر الطباعة والحفظ'}
          icon={Printer}
          variant="navy"
          items={[
            {
              id: 'print',
              label: 'طباعة مباشرة (A4)',
              description: 'طباعة البطاقة بحجم A4 عمودي',
              icon: Printer,
              onClick: handlePrint,
            },
            {
              id: 'pdf',
              label: exporting ? 'جاري تصدير PDF...' : 'تنزيل ملف PDF رسمي',
              description: 'ملف PDF عالي الدقة قابل للمشاركة',
              icon: FileText,
              disabled: exporting || exportingImage,
              onClick: () => void handleDownloadPdf(),
            },
            {
              id: 'png',
              label: exportingImage ? 'جاري الحفظ...' : 'حفظ كصورة (PNG)',
              description: 'صورة عالية الوضوح للبطاقة',
              icon: ImageDown,
              disabled: exportingImage || exporting,
              onClick: () => void handleDownloadImage(),
            },
            ...(onShowAllResults
              ? [
                  {
                    id: 'show-all',
                    label: 'عرض البطاقة الشاملة (كل النتائج)',
                    icon: Layers,
                    tone: 'amber',
                    dividerBefore: true,
                    onClick: onShowAllResults,
                  } satisfies ActionMenuItem,
                ]
              : []),
            ...(onReset
              ? [
                  {
                    id: 'reset',
                    label: 'استعلام عن طالب آخر',
                    icon: RotateCcw,
                    dividerBefore: !onShowAllResults,
                    onClick: onReset,
                  } satisfies ActionMenuItem,
                ]
              : []),
          ]}
        />
      </div>

      {exportError && (
        <div className="no-print bg-red-50 border border-red-200 text-red-800 text-sm px-4 py-3 rounded-lg">
          {exportError}
        </div>
      )}

      <div className="print-sheet-wrapper overflow-x-auto pb-2">
        <div ref={sheetRef} className="w-fit mx-auto">
          <SingleReportSheet report={report} />
        </div>
      </div>
    </section>
  );
}

interface AllResultsReportCardProps {
  allReport: AllPublishedReportCard;
  pdfParams?: ReportPdfRequestParams;
  onReset?: () => void;
}

export function AllResultsReportCard({ allReport, pdfParams, onReset }: AllResultsReportCardProps) {
  const [exporting, setExporting] = useState(false);
  const [exportingImage, setExportingImage] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);

  const handlePrint = () => {
    window.print();
  };

  const handleDownloadPdf = async () => {
    setExporting(true);
    setExportError(null);
    try {
      await downloadBinaryFile(
        '/api/public/report-pdf',
        `بطاقة-الدرجات-${allReport.student.fullName}.pdf`,
        {
          method: 'POST',
          body: JSON.stringify({
            inquiryCode: pdfParams?.inquiryCode ?? allReport.student.inquiryCode,
            examId: 'all',
            ...(pdfParams?.yearId ? { yearId: pdfParams.yearId } : {}),
            ...(pdfParams?.publishSlug ? { publishSlug: pdfParams.publishSlug } : {}),
          }),
        }
      );
    } catch (err: any) {
      setExportError(err?.message || 'تعذر تصدير ملف PDF الرسمي. يرجى المحاولة مجدداً.');
    } finally {
      setExporting(false);
    }
  };

  const handleDownloadImage = async () => {
    if (!sheetRef.current) return;
    setExportingImage(true);
    setExportError(null);
    try {
      const dataUrl = await captureSheetToPng(sheetRef.current, { pixelRatio: 2.2 });
      const link = document.createElement('a');
      link.href = dataUrl;
      link.download = `بطاقة-الدرجات-${allReport.student.fullName}.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err: any) {
      setExportError(err?.message || 'تعذر حفظ البطاقة كصورة PNG. يرجى المحاولة مجدداً.');
    } finally {
      setExportingImage(false);
    }
  };

  return (
    <section aria-label="بطاقة الدرجات المدرسية الرسمية" className="space-y-4">
      <style media="print">{'@page { size: A4 landscape; margin: 7mm; }'}</style>

      <div className="no-print flex flex-wrap items-center justify-between gap-3 bg-white border border-slate-200 rounded-xl px-4 sm:px-5 py-3.5 shadow-xs">
        <div className="space-y-0.5">
          <div className="text-sm font-bold text-[#0B1F3A]">
            بطاقة الدرجات المدرسية الرسمية (A4 أفقي)
          </div>
          <div className="text-xs text-slate-500">
            {allReport.student.fullName} — {allReport.student.className} ({allReport.student.sectionName})
          </div>
        </div>

        <ActionMenu
          label={exporting ? 'جاري تصدير PDF...' : exportingImage ? 'جاري حفظ الصورة...' : 'أوامر الطباعة والحفظ'}
          icon={Printer}
          variant="navy"
          items={[
            {
              id: 'print',
              label: 'طباعة البطاقة (A4 أفقي)',
              description: 'تنسيق كامل الصفحة في ورقة واحدة',
              icon: Printer,
              onClick: handlePrint,
            },
            {
              id: 'pdf',
              label: exporting ? 'جاري تصدير PDF...' : 'تنزيل ملف PDF رسمي',
              description: 'بطاقة الدرجات الرسمية بصيغة PDF',
              icon: FileText,
              disabled: exporting || exportingImage,
              onClick: () => void handleDownloadPdf(),
            },
            {
              id: 'png',
              label: exportingImage ? 'جاري الحفظ...' : 'حفظ كصورة (PNG)',
              description: 'حفظ البطاقة كصورة جاهزة للمشاركة',
              icon: ImageDown,
              disabled: exportingImage || exporting,
              onClick: () => void handleDownloadImage(),
            },
            ...(onReset
              ? [
                  {
                    id: 'reset',
                    label: 'استعلام عن طالب آخر',
                    icon: RotateCcw,
                    dividerBefore: true,
                    onClick: onReset,
                  } satisfies ActionMenuItem,
                ]
              : []),
          ]}
        />
      </div>

      {exportError && (
        <div className="no-print bg-red-50 border border-red-200 text-red-800 text-sm px-4 py-3 rounded-lg">
          {exportError}
        </div>
      )}

      <div className="print-sheet-wrapper overflow-x-auto pb-2">
        <div ref={sheetRef} className="w-fit mx-auto">
          <AllResultsReportSheet allReport={allReport} />
        </div>
      </div>
    </section>
  );
}
