import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import QRCode from 'qrcode';
import {
  Camera,
  CameraOff,
  CheckCircle2,
  Download,
  Printer,
  QrCode,
  RefreshCw,
  ScanLine,
  Save,
  Search,
  Upload,
} from 'lucide-react';
import { apiDownload, apiFetch } from '../../lib/api.ts';
import { getClassColorTheme } from '../../lib/classColors.ts';
import {
  isSubjectExcludedForClass,
  normalizeArabicIndicDigits,
  normalizeArabicText,
  validateScoreInput,
} from '../../lib/gradeRules.ts';
import { saveWithOfflineFallback } from '../../lib/offlineSync.ts';
import { useUndo } from '../../lib/undoManager.tsx';
import type { Exam, SchoolClass, Section, Student, Subject } from '../../types/school.ts';
import { ActionMenu } from '../ui/ActionMenu.tsx';

interface ControlTabProps {
  classes: SchoolClass[];
  sections: Section[];
  subjects: Subject[];
  exams: Exam[];
  selectedYearId: number | null;
  onChanged: () => void;
}

interface ControlStudentCard {
  studentId: number;
  fullName: string;
  inquiryCode: string;
  classId: number;
  className: string;
  sectionId: number;
  sectionName: string;
  payload: string;
  qrDataUrl?: string;
}

export function ControlTab({
  classes,
  sections,
  subjects,
  exams,
  selectedYearId,
  onChanged,
}: ControlTabProps) {
  const { pushUndo } = useUndo();
  const [subTab, setSubTab] = useState<'cards' | 'scanner'>('cards');
  const [classId, setClassId] = useState<string>(classes[0] ? String(classes[0].id) : '');
  const [sectionId, setSectionId] = useState<string>('all');

  // Cards state
  const [cards, setCards] = useState<ControlStudentCard[]>([]);
  const [loadingCards, setLoadingCards] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);

  // Scanner & live lookup state
  const [allYearStudents, setAllYearStudents] = useState<ControlStudentCard[]>([]);
  const [examId, setExamId] = useState<string>(() => {
    const mid = exams.find((e) => e.name.includes('نصف السنة'));
    return mid ? String(mid.id) : exams[0] ? String(exams[0].id) : '';
  });
  const [subjectId, setSubjectId] = useState<string>('');
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraStarting, setCameraStarting] = useState(false);
  const [availableCameras, setAvailableCameras] = useState<Array<{ id: string; label: string }>>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string>('');
  const [manualInput, setManualInput] = useState('');
  const [resolvingStudent, setResolvingStudent] = useState(false);
  const [resolvedStudent, setResolvedStudent] = useState<Student | null>(null);
  const [scoreInput, setScoreInput] = useState('');
  const [notesInput, setNotesInput] = useState('');
  const [savingScan, setSavingScan] = useState(false);
  const [recentScans, setRecentScans] = useState<
    Array<{
      id: string;
      fullName: string;
      inquiryCode: string;
      subjectName: string;
      examName: string;
      score: number;
      offlineQueued?: boolean;
      time: string;
    }>
  >([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const scannerRef = useRef<Html5Qrcode | null>(null);
  const scoreFieldRef = useRef<HTMLInputElement | null>(null);
  const manualInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const lastScanTimeRef = useRef<number>(0);
  const readerElementId = 'control-qr-reader';

  useEffect(() => {
    if (!classId && classes[0]) setClassId(String(classes[0].id));
  }, [classes, classId]);

  useEffect(() => {
    if (!examId && exams[0]) {
      const mid = exams.find((e) => e.name.includes('نصف السنة'));
      setExamId(mid ? String(mid.id) : String(exams[0].id));
    }
  }, [exams, examId]);

  const classSections = useMemo(
    () => sections.filter((s) => !classId || s.classId === Number(classId)),
    [sections, classId]
  );

  // Filter subjects cleanly for the resolved student's class (and exclude Grade 6 Computer)
  const targetClassForSubjects = resolvedStudent ? resolvedStudent.classId : Number(classId);
  const targetClassObj = useMemo(
    () => classes.find((c) => c.id === targetClassForSubjects) ?? null,
    [classes, targetClassForSubjects]
  );
  const scopedSubjects = useMemo(
    () =>
      subjects.filter(
        (s) =>
          s.isActive &&
          (!targetClassForSubjects || s.classId === null || s.classId === targetClassForSubjects) &&
          !isSubjectExcludedForClass(s.name, targetClassObj?.name, targetClassObj?.isMinisterial)
      ),
    [subjects, targetClassForSubjects, targetClassObj]
  );

  useEffect(() => {
    if (
      scopedSubjects.length > 0 &&
      !scopedSubjects.some((s) => String(s.id) === subjectId)
    ) {
      setSubjectId(String(scopedSubjects[0].id));
    }
  }, [scopedSubjects, subjectId]);

  const activeSubject = useMemo(
    () => scopedSubjects.find((s) => String(s.id) === subjectId) ?? null,
    [scopedSubjects, subjectId]
  );

  const loadAllYearStudents = useCallback(async () => {
    try {
      const qs = new URLSearchParams({
        ...(selectedYearId ? { yearId: String(selectedYearId) } : {}),
        sectionId: 'all',
      }).toString();
      const res = await apiFetch<{ students: ControlStudentCard[] }>(`/api/admin/control/students?${qs}`);
      setAllYearStudents(res.students ?? []);
    } catch {
      // handled gracefully via server resolve
    }
  }, [selectedYearId]);

  useEffect(() => {
    void loadAllYearStudents();
  }, [loadAllYearStudents]);

  const loadCards = async () => {
    setLoadingCards(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        ...(selectedYearId ? { yearId: String(selectedYearId) } : {}),
        ...(classId ? { classId } : {}),
        sectionId: sectionId || 'all',
      }).toString();
      const res = await apiFetch<{ students: ControlStudentCard[] }>(
        `/api/admin/control/students?${qs}`
      );
      const withQr = await Promise.all(
        (res.students ?? []).map(async (st) => ({
          ...st,
          qrDataUrl: await QRCode.toDataURL(st.payload, {
            margin: 1,
            width: 140,
            errorCorrectionLevel: 'M',
          }),
        }))
      );
      setCards(withQr);
    } catch (err: any) {
      setError(err?.message || 'تعذر تحميل بطاقات باركود الكونترول.');
    } finally {
      setLoadingCards(false);
    }
  };

  useEffect(() => {
    if (subTab === 'cards') {
      loadCards();
    }
  }, [subTab, classId, sectionId, selectedYearId]);

  // Cleanly stop camera when leaving scanner sub-tab or unmounting
  const stopCamera = async () => {
    const inst = scannerRef.current;
    scannerRef.current = null;
    setCameraActive(false);
    if (inst) {
      try {
        if (inst.isScanning) {
          await inst.stop();
        }
      } catch {
        // ignore stop errors
      }
      try {
        await Promise.resolve(inst.clear());
      } catch {
        // ignore clear errors
      }
    }
  };

  useEffect(() => {
    if (subTab !== 'scanner' && cameraActive) {
      stopCamera();
    }
  }, [subTab, cameraActive]);

  useEffect(() => {
    return () => {
      const inst = scannerRef.current;
      scannerRef.current = null;
      if (inst) {
        Promise.resolve()
          .then(async () => {
            if (inst.isScanning) {
              await inst.stop();
            }
          })
          .catch(() => {})
          .finally(() => {
            try {
              inst.clear();
            } catch {
              // ignore clear errors on unmount
            }
          });
      }
    };
  }, []);

  const liveMatchedStudents = useMemo(() => {
    const q = manualInput.trim();
    if (!q || q.startsWith('{')) return [];
    const normCodeQ = normalizeArabicIndicDigits(q).replace(/\s+/g, '');
    const normNameQ = normalizeArabicText(q);
    return allYearStudents
      .filter((st) => {
        const stCode = normalizeArabicIndicDigits(st.inquiryCode).replace(/\s+/g, '');
        const stName = normalizeArabicText(st.fullName);
        return (normCodeQ && stCode.includes(normCodeQ)) || (normNameQ && stName.includes(normNameQ));
      })
      .slice(0, 6);
  }, [manualInput, allYearStudents]);

  const resolvePayload = async (rawPayload: string) => {
    const clean = rawPayload.trim();
    if (!clean) return;
    setError(null);
    setNotice(null);
    setResolvingStudent(true);
    try {
      let queryToResolve = clean;
      if (!clean.startsWith('{') && liveMatchedStudents.length === 1 && !/^\d+$/.test(normalizeArabicIndicDigits(clean))) {
        queryToResolve = liveMatchedStudents[0].inquiryCode;
      }

      const res = await apiFetch<{
        student: Student;
        existingGrade?: { score: number | null; status: string; notes: string } | null;
      }>('/api/admin/control/resolve-student', {
        method: 'POST',
        body: JSON.stringify({
          ...(selectedYearId ? { yearId: selectedYearId } : {}),
          payload: queryToResolve,
          subjectId: subjectId ? Number(subjectId) : undefined,
          examId: examId ? Number(examId) : undefined,
        }),
      });
      setResolvedStudent(res.student);
      if (res.existingGrade && res.existingGrade.score !== null) {
        setScoreInput(String(res.existingGrade.score));
        setNotesInput(res.existingGrade.notes || '');
        setNotice(`تم تحديد الطالب (${res.student.fullName}) واسترجاع الدرجة المرصودة مسبقاً (${res.existingGrade.score}).`);
      } else {
        setScoreInput('');
        setNotesInput('');
        setNotice(`تم تحديد الطالب (${res.student.fullName}) بنجاح — أدخل الدرجة الآن.`);
      }
      setTimeout(() => scoreFieldRef.current?.focus(), 80);
    } catch (err: any) {
      setResolvedStudent(null);
      setError(err?.message || 'الباركود أو رقم الهوية غير مطابق لأي طالب نشط في هذا العام.');
    } finally {
      setResolvingStudent(false);
    }
  };

  const startCamera = async (overrideCameraId?: string) => {
    setError(null);
    setNotice(null);
    setCameraStarting(true);
    let html5Qr: Html5Qrcode | null = null;
    try {
      await stopCamera();
      setCameraActive(true);
      await new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 90)));

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('المتصفح الحالي أو نافذة المعاينة لا تدعم الوصول المباشر للكاميرا. استخدم زر «مسح صورة QR» أو البحث برقم الهوية أدناه.');
      }

      html5Qr = new Html5Qrcode(readerElementId);
      scannerRef.current = html5Qr;

      const qrConfig = {
        fps: 10,
        qrbox: (viewW: number, viewH: number) => {
          const edge = Math.max(150, Math.min(240, Math.floor(Math.min(viewW, viewH) * 0.7)));
          return { width: edge, height: edge };
        },
        aspectRatio: 1.3333,
      };
      const onScanSuccess = (decodedText: string) => {
        const now = Date.now();
        if (now - lastScanTimeRef.current < 1500) return;
        lastScanTimeRef.current = now;
        void resolvePayload(decodedText);
      };

      let cameras: Array<{ id: string; label: string }> = [];
      try {
        cameras = await Html5Qrcode.getCameras();
        if (cameras && cameras.length > 0) {
          setAvailableCameras(cameras);
        }
      } catch {
        // Fallback to media constraints below
      }

      const chosenId =
        overrideCameraId ||
        selectedCameraId ||
        cameras.find((c) => /back|rear|environment|خلفية/i.test(c.label))?.id ||
        cameras[0]?.id;

      if (chosenId) {
        setSelectedCameraId(chosenId);
        await html5Qr.start(chosenId, qrConfig, onScanSuccess, () => {});
      } else {
        try {
          await html5Qr.start({ facingMode: { ideal: 'environment' } }, qrConfig, onScanSuccess, () => {});
        } catch {
          await html5Qr.start({ facingMode: 'user' }, qrConfig, onScanSuccess, () => {});
        }
      }
    } catch (err: any) {
      if (html5Qr) {
        try {
          await Promise.resolve(html5Qr.clear());
        } catch {
          // ignore clear errors
        }
      }
      if (scannerRef.current === html5Qr) {
        scannerRef.current = null;
      }
      setCameraActive(false);
      const rawMsg = String(err?.message || err || '');
      let friendly =
        'تعذر تشغيل كاميرا الجهاز — يمكنك استخدام زر «مسح صورة QR» أو قارئ USB أو البحث برقم الهوية مباشرة.';
      if (/NotAllowed|Permission|denied/i.test(rawMsg)) {
        friendly =
          'تم رفض إذن الكاميرا من المتصفح أو النافذة. اسمح بالوصول للكاميرا من شريط العنوان ثم أعد المحاولة، أو استخدم «مسح صورة QR» أو البحث برقم الهوية أدناه.';
      } else if (/NotFound|Requested device not found|no camera/i.test(rawMsg)) {
        friendly =
          'لم يتم العثور على كاميرا متصلة بهذا الجهاز. يمكنك استخدام زر «مسح صورة QR» أو قارئ الباركود السلكي (USB) أو إدخال رقم الهوية مباشرة.';
      } else if (/NotReadable|TrackStartError|in use/i.test(rawMsg)) {
        friendly = 'الكاميرا مستخدمة حالياً من تطبيق آخر. أغلق التطبيق الآخر ثم أعد تشغيل الكاميرا.';
      } else if (rawMsg && /[\u0600-\u06FF]/.test(rawMsg)) {
        friendly = rawMsg;
      }
      setError(friendly);
    } finally {
      setCameraStarting(false);
    }
  };

  const handleScanQrFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setNotice(null);
    let tempScanner: Html5Qrcode | null = null;
    try {
      if (scannerRef.current) {
        const decoded = await scannerRef.current.scanFile(file, true);
        await resolvePayload(decoded);
      } else {
        tempScanner = new Html5Qrcode('qr-file-scratchpad');
        const decoded = await tempScanner.scanFile(file, true);
        await resolvePayload(decoded);
      }
    } catch {
      setError('تعذر قراءة رمز QR من الصورة المحددة. يرجى التأكد من وضوح الرمز وإعادة المحاولة.');
    } finally {
      if (tempScanner) {
        try {
          await Promise.resolve(tempScanner.clear());
        } catch {
          // ignore clear error
        }
      }
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleManualResolve = (e: FormEvent) => {
    e.preventDefault();
    void resolvePayload(manualInput);
  };

  const handleSaveScanGrade = async (e: FormEvent) => {
    e.preventDefault();
    if (!resolvedStudent || !subjectId || !examId) {
      setError('يرجى مسح باركود الطالب واختيار الامتحان والمادة أولاً.');
      return;
    }
    const maxScore = activeSubject?.maxScore ?? 100;
    const check = validateScoreInput(scoreInput, maxScore);
    if (!check.valid || check.score === null) {
      setError(check.error || 'يرجى إدخال درجة صالحة.');
      return;
    }

    setSavingScan(true);
    setError(null);
    setNotice(null);

    const payloadBody = {
      ...(selectedYearId ? { yearId: selectedYearId } : {}),
      studentId: resolvedStudent.id,
      subjectId: Number(subjectId),
      examId: Number(examId),
      score: check.score,
      notes: notesInput.trim(),
    };

    try {
      // Capture prior grade value for undo support
      let previousScore: number | null = null;
      let previousStatus = 'draft';
      try {
        const acad = await apiFetch<{ grades: Array<{ examId: number; subjectId?: number; subjectName: string; score: number | null; status: string }> }>(
          `/api/admin/students/${resolvedStudent.id}/academic`
        );
        const match = acad.grades?.find(
          (g) =>
            g.examId === Number(examId) &&
            (g.subjectId ? g.subjectId === Number(subjectId) : g.subjectName === activeSubject?.name)
        );
        if (match) {
          previousScore = match.score;
          previousStatus = match.status;
        }
      } catch {
        // offline or unavailable
      }

      const result = await saveWithOfflineFallback<{
        ok: boolean;
        saved?: {
          fullName: string;
          subjectName: string;
          examName: string;
          score: number;
        };
      }>('/api/admin/control/scan-grade', 'POST', payloadBody, `رصد كونترول: ${resolvedStudent.fullName}`);

      const examName = exams.find((ex) => String(ex.id) === examId)?.name || '';
      const subjectName = activeSubject?.name || '';

      pushUndo(
        `التراجع عن درجة الكونترول: ${resolvedStudent.fullName} (${subjectName})`,
        async () => {
          await apiFetch('/api/admin/grades/save', {
            method: 'POST',
            body: JSON.stringify({
              ...(selectedYearId ? { yearId: selectedYearId } : {}),
              subjectId: Number(subjectId),
              examId: Number(examId),
              entries: [
                {
                  studentId: resolvedStudent.id,
                  score: previousScore,
                  status: previousStatus,
                  notes: '',
                },
              ],
            }),
          });
          onChanged();
        }
      );

      setRecentScans((prev) => [
        {
          id: `${Date.now()}-${resolvedStudent.id}`,
          fullName: resolvedStudent.fullName,
          inquiryCode: resolvedStudent.inquiryCode,
          subjectName,
          examName,
          score: check.score!,
          offlineQueued: result.queued,
          time: new Date().toLocaleTimeString('ar-IQ', { hour: '2-digit', minute: '2-digit' }),
        },
        ...prev.slice(0, 14),
      ]);

      setNotice(
        result.queued
          ? `تم حفظ درجة (${resolvedStudent.fullName}) محلياً دون إنترنت وستتم مزامنتها تلقائياً عند عودة الاتصال.`
          : `تم رصد درجة (${resolvedStudent.fullName}: ${check.score}) في ${subjectName} بحالة «جاهزة للنشر».`
      );
      setResolvedStudent(null);
      setScoreInput('');
      setNotesInput('');
      setManualInput('');
      if (!result.queued) onChanged();
      setTimeout(() => manualInputRef.current?.focus(), 60);
    } catch (err: any) {
      setError(err?.message || 'تعذر حفظ درجة الكونترول.');
    } finally {
      setSavingScan(false);
    }
  };

  const handleDownloadQrCardsPdf = async () => {
    setDownloadingPdf(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        ...(selectedYearId ? { yearId: String(selectedYearId) } : {}),
        ...(classId ? { classId } : {}),
        sectionId: sectionId || 'all',
      }).toString();
      await apiDownload(
        `/api/admin/control/qr-cards.pdf?${qs}`,
        'بطاقات-باركود-الكونترول.pdf'
      );
    } catch (err: any) {
      setError(err?.message || 'تعذر تنزيل ملف PDF لبطاقات الباركود.');
    } finally {
      setDownloadingPdf(false);
    }
  };

  // Chunk into 20-card A4 sheets (4 columns × 5 rows)
  const cardPages = useMemo(() => {
    const pages: ControlStudentCard[][] = [];
    for (let i = 0; i < cards.length; i += 20) {
      pages.push(cards.slice(i, i + 20));
    }
    return pages;
  }, [cards]);

  return (
    <div className="space-y-5">
      <style media="print">{'@page { size: A4 portrait; margin: 6mm; }'}</style>

      {/* Sub-tab Switcher */}
      <div className="no-print bg-white border border-slate-200 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5 p-1 bg-slate-100 rounded-lg">
          <button
            type="button"
            onClick={() => setSubTab('cards')}
            className={`min-h-[44px] inline-flex items-center gap-2 px-4 py-2 text-xs sm:text-sm font-bold rounded-md cursor-pointer transition-colors ${
              subTab === 'cards'
                ? 'bg-[#0B1F3A] text-white shadow-xs'
                : 'text-slate-600 hover:text-[#0B1F3A]'
            }`}
          >
            <QrCode className="w-4 h-4 text-[#C59B27]" />
            <span>بطاقات باركود 4×5 للدفاتر</span>
          </button>
          <button
            type="button"
            onClick={() => setSubTab('scanner')}
            className={`min-h-[44px] inline-flex items-center gap-2 px-4 py-2 text-xs sm:text-sm font-bold rounded-md cursor-pointer transition-colors ${
              subTab === 'scanner'
                ? 'bg-[#0B1F3A] text-white shadow-xs'
                : 'text-slate-600 hover:text-[#0B1F3A]'
            }`}
          >
            <ScanLine className="w-4 h-4 text-[#C59B27]" />
            <span>الماسح الضوئي ورصد الدرجات</span>
          </button>
        </div>
        <span className="text-xs text-slate-500">
          {subTab === 'cards'
            ? 'بطاقات مرتبة 4×5 (20 بطاقة لكل صفحة A4) جاهزة للطباعة والقص'
            : 'قراءة رمز QR بالكاميرا أو الباركود اليدوي لفتح حقل الدرجة وحفظها بحالة «جاهزة للنشر» فوراً'}
        </span>
      </div>

      {error && (
        <div role="alert" className="no-print p-3.5 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm">
          {error}
        </div>
      )}
      {notice && (
        <div role="status" className="no-print flex items-center gap-2 p-3.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-900 text-sm">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      {/* ===================================================================== */}
      {/* SUB-TAB 1: 4x6 PRINTABLE QR CARDS                                     */}
      {/* ===================================================================== */}
      {subTab === 'cards' && (
        <div className="space-y-5">
          <div className="no-print bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-end justify-between gap-4">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label htmlFor="ctrl-class" className="block text-xs font-bold text-slate-600 mb-1">
                  الصف الدراسي
                </label>
                <select
                  id="ctrl-class"
                  value={classId}
                  onChange={(e) => {
                    setClassId(e.target.value);
                    setSectionId('all');
                  }}
                  className="min-h-[44px] px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white"
                >
                  <option value="">كل الصفوف</option>
                  {classes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="ctrl-section" className="block text-xs font-bold text-slate-600 mb-1">
                  الشعبة
                </label>
                <select
                  id="ctrl-section"
                  value={sectionId}
                  onChange={(e) => setSectionId(e.target.value)}
                  className="min-h-[44px] px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white"
                >
                  <option value="all">جميع الشعب</option>
                  {classSections.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.className} — شعبة {s.name}
                    </option>
                  ))}
                </select>
              </div>

              <ActionMenu
                label={downloadingPdf ? 'جاري تجهيز PDF...' : 'أوامر طباعة الباركود (4×5)'}
                icon={QrCode}
                variant="navy"
                items={[
                  {
                    id: 'pdf',
                    label: downloadingPdf ? 'جاري تجهيز PDF...' : 'تنزيل PDF للبطاقات (20 بطاقة / صفحة)',
                    description: 'شبكة 4×5 مرتبة جاهزة للطباعة والقص',
                    icon: Download,
                    disabled: cards.length === 0 || downloadingPdf,
                    onClick: handleDownloadQrCardsPdf,
                  },
                  {
                    id: 'print',
                    label: 'طباعة A4 مباشرة (20 بطاقة / صفحة)',
                    description: 'طباعة فورية من المتصفح بتنسيق 4×5',
                    icon: Printer,
                    disabled: cards.length === 0,
                    onClick: () => window.print(),
                  },
                  {
                    id: 'refresh',
                    label: 'تحديث قائمة البطاقات',
                    icon: RefreshCw,
                    dividerBefore: true,
                    onClick: loadCards,
                  },
                ]}
              />
            </div>

            <div className="no-print hidden" />
          </div>

          {loadingCards ? (
            <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-500">
              جاري توليد رموز الباركود لبطاقات الكونترول...
            </div>
          ) : cards.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-500">
              لا يوجد طلاب نشطون في هذا النطاق.
            </div>
          ) : (
            <div className="space-y-6 print:space-y-0">
              {cardPages.map((pageCards, pageIdx) => (
                <div
                  key={pageIdx}
                  className={`bg-white border border-slate-300 rounded-xl p-4 print:border-0 print:p-0 print:rounded-none ${
                    pageIdx < cardPages.length - 1 ? 'print-page-break print:break-after-page' : ''
                  }`}
                >
                  <div className="no-print flex items-center justify-between text-xs text-slate-500 mb-3 pb-2 border-b border-slate-100">
                    <span>
                      صفحة {pageIdx + 1} من {cardPages.length} — {pageCards.length} بطاقة باركود (شبكة 4×5 — 20 بطاقة/صفحة)
                    </span>
                    <span className="tabular-nums">إجمالي الطلبة: {cards.length}</span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 print:grid-cols-4 gap-3 print:gap-[3.5mm]">
                    {pageCards.map((card) => {
                      const theme = getClassColorTheme(card.className);
                      return (
                        <div
                          key={card.studentId}
                          className={`border border-dashed border-slate-400 rounded-lg p-2.5 print:p-[2mm] print:rounded-sm flex flex-col items-center justify-between text-center gap-1.5 print:gap-1 min-h-[170px] print:min-h-0 print:h-[51mm] print:border-black print:bg-white ${theme.cardBg}`}
                        >
                          <div className="w-full space-y-0.5">
                            <p className="text-[11px] print:text-[10px] font-extrabold text-[#0B1F3A] leading-tight line-clamp-2">
                              {card.fullName}
                            </p>
                            <p className="text-[10px] print:text-[9px] font-semibold text-slate-600">
                              {card.className} · شعبة {card.sectionName}
                            </p>
                          </div>
                          {card.qrDataUrl && (
                            <img
                              src={card.qrDataUrl}
                              alt={`رمز QR الطالب ${card.fullName}`}
                              className="w-24 h-24 print:w-[25mm] print:h-[25mm] object-contain bg-white p-1 print:p-0.5 rounded border border-slate-200"
                            />
                          )}
                          <span className="font-mono text-[11px] print:text-[10px] font-bold text-[#1E4E8C] tabular-nums">
                            {card.inquiryCode}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ===================================================================== */}
      {/* SUB-TAB 2: CAMERA QR SCANNER + SCORE ENTRY                            */}
      {/* ===================================================================== */}
      {subTab === 'scanner' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Left Column: Exam & Subject Scope + Camera/Barcode Reader */}
          <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <h3 className="font-display text-base font-bold text-[#0B1F3A]">
              1) تحديد الامتحان والمادة ومسح باركود الدفتر
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="scan-exam" className="block text-xs font-bold text-slate-600 mb-1">
                  الامتحان المستهدف
                </label>
                <select
                  id="scan-exam"
                  value={examId}
                  onChange={(e) => setExamId(e.target.value)}
                  className="min-h-[44px] w-full px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white"
                >
                  {exams.map((ex) => (
                    <option key={ex.id} value={ex.id}>
                      {ex.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="scan-subject" className="block text-xs font-bold text-slate-600 mb-1">
                  المادة الدراسية
                </label>
                <select
                  id="scan-subject"
                  value={subjectId}
                  onChange={(e) => setSubjectId(e.target.value)}
                  className="min-h-[44px] w-full px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white"
                >
                  {scopedSubjects.map((sub) => (
                    <option key={sub.id} value={sub.id}>
                      {sub.name} (من {sub.maxScore})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Camera Controls */}
            <div className="space-y-3 pt-2 border-t border-slate-100">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-bold text-slate-700">قارئ الكاميرا المباشر:</span>
                <div className="flex items-center gap-2">
                  <label
                    title="مسح رمز QR من صورة محفوظة على الجهاز"
                    className="min-h-[44px] inline-flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-300 text-xs font-bold rounded-lg cursor-pointer"
                  >
                    <Upload className="w-4 h-4 text-[#1E4E8C]" />
                    <span>مسح صورة QR</span>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleScanQrFile}
                      className="hidden"
                    />
                  </label>
                  {cameraActive ? (
                    <button
                      type="button"
                      onClick={stopCamera}
                      className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 py-2 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 text-xs font-bold rounded-lg cursor-pointer"
                    >
                      <CameraOff className="w-4 h-4" />
                      <span>إيقاف الكاميرا</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={cameraStarting}
                      onClick={() => void startCamera()}
                      className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#0B1F3A] hover:bg-[#1E4E8C] text-white text-xs font-bold rounded-lg cursor-pointer disabled:opacity-50"
                    >
                      <Camera className="w-4 h-4 text-[#C59B27]" />
                      <span>{cameraStarting ? 'جاري فتح الكاميرا...' : 'تشغيل الكاميرا للمسح'}</span>
                    </button>
                  )}
                </div>
              </div>

              {availableCameras.length > 1 && (
                <div className="flex items-center gap-2 text-xs">
                  <label htmlFor="ctrl-camera-select" className="font-bold text-slate-600 shrink-0">
                    العدسة:
                  </label>
                  <select
                    id="ctrl-camera-select"
                    value={selectedCameraId}
                    onChange={(e) => {
                      const nextId = e.target.value;
                      setSelectedCameraId(nextId);
                      if (cameraActive) {
                        void startCamera(nextId);
                      }
                    }}
                    className="flex-1 min-h-[38px] px-2.5 py-1 rounded-lg border border-slate-300 bg-white text-xs font-semibold"
                  >
                    {availableCameras.map((cam, idx) => (
                      <option key={cam.id} value={cam.id}>
                        {cam.label || `كاميرا ${idx + 1}`}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div id="qr-file-scratchpad" className="hidden" />

              <div
                className={`relative w-full rounded-xl overflow-hidden border border-slate-200 transition-colors ${
                  cameraActive || cameraStarting ? 'min-h-[260px] bg-slate-950' : 'min-h-[84px] bg-slate-50'
                }`}
              >
                {/* Keep Html5Qrcode mount node strictly empty of React children */}
                <div
                  id={readerElementId}
                  className={cameraActive || cameraStarting ? 'w-full min-h-[260px]' : 'w-full'}
                />
                {!cameraActive && !cameraStarting && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none px-4 text-center">
                    <span className="text-xs text-slate-500">
                      اضغط «تشغيل الكاميرا للمسح» أو ارفع صورة QR أو أدخل رقم الهوية أدناه
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Manual, Live Autocomplete, or USB Barcode Input */}
            <form onSubmit={handleManualResolve} className="space-y-2.5 pt-2 border-t border-slate-100">
              <label htmlFor="ctrl-manual-code" className="block text-xs font-bold text-slate-700">
                البحث برقم الهوية / الاسم أو قارئ الباركود (USB):
              </label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-slate-400 pointer-events-none absolute right-3 top-1/2 -translate-y-1/2" />
                  <input
                    id="ctrl-manual-code"
                    ref={manualInputRef}
                    type="text"
                    value={manualInput}
                    onChange={(e) => setManualInput(e.target.value)}
                    placeholder="اكتب رقم الهوية (مثل 2026101) أو اسم الطالب..."
                    className="min-h-[44px] w-full pr-9 pl-3 py-2 text-sm rounded-lg border border-slate-300 bg-white focus:border-[#1E4E8C] focus:outline-none"
                  />
                </div>
                <button
                  type="submit"
                  disabled={resolvingStudent || !manualInput.trim()}
                  className="min-h-[44px] px-4 py-2 bg-[#1E4E8C] hover:bg-[#0B1F3A] text-white text-xs font-bold rounded-lg cursor-pointer shrink-0 disabled:opacity-50"
                >
                  {resolvingStudent ? 'جاري البحث...' : 'تحديد الطالب'}
                </button>
              </div>

              {liveMatchedStudents.length > 0 && (
                <div className="border border-slate-200 rounded-lg bg-slate-50 divide-y divide-slate-200 overflow-hidden">
                  {liveMatchedStudents.map((st) => (
                    <button
                      key={st.studentId}
                      type="button"
                      onClick={() => {
                        setManualInput(st.inquiryCode);
                        void resolvePayload(st.inquiryCode);
                      }}
                      className="w-full px-3 py-2 text-right flex items-center justify-between gap-2 hover:bg-blue-50/70 transition-colors cursor-pointer text-xs"
                    >
                      <span className="font-bold text-[#0B1F3A] truncate">{st.fullName}</span>
                      <span className="text-[11px] text-slate-600 shrink-0 tabular-nums">
                        {st.className} · {st.sectionName} ·{' '}
                        <span className="font-mono font-bold text-[#1E4E8C]">{st.inquiryCode}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </form>
          </div>

          {/* Right Column: Focused Student Score Entry + Recent Log */}
          <div className="lg:col-span-7 space-y-5">
            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
              <h3 className="font-display text-base font-bold text-[#0B1F3A]">
                2) رصد الدرجة السريع (تُحفظ فوراً بحالة «جاهزة للنشر»)
              </h3>

              {!resolvedStudent ? (
                <div className="p-8 border border-dashed border-slate-200 rounded-xl text-center text-sm text-slate-500">
                  بانتظار مسح رمز QR للطالب أو إدخال رقم هويته الوطنية لفتح حقل رصد الدرجة...
                </div>
              ) : (
                <form onSubmit={handleSaveScanGrade} className="space-y-4">
                  <div
                    className={`p-4 rounded-xl border ${
                      getClassColorTheme(resolvedStudent.className || '').cardBg
                    } ${getClassColorTheme(resolvedStudent.className || '').cardBorder}`}
                  >
                    <p className="text-xs font-bold text-slate-600">بيانات الطالب المقروءة:</p>
                    <p className="font-display text-lg font-extrabold text-[#0B1F3A] mt-0.5">
                      {resolvedStudent.fullName}
                    </p>
                    <p className="text-xs font-semibold text-slate-700 mt-1">
                      {resolvedStudent.className} · شعبة {resolvedStudent.sectionName} · رقم الهوية{' '}
                      <span className="font-mono text-[#1E4E8C]">{resolvedStudent.inquiryCode}</span>
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="ctrl-score" className="block text-xs font-bold text-slate-700 mb-1">
                        الدرجة ({activeSubject?.name || 'المادة'} · من {activeSubject?.maxScore ?? 100})
                      </label>
                      <input
                        id="ctrl-score"
                        ref={scoreFieldRef}
                        type="number"
                        min={0}
                        max={activeSubject?.maxScore ?? 100}
                        step="0.5"
                        required
                        value={scoreInput}
                        onChange={(e) => setScoreInput(e.target.value)}
                        className="min-h-[48px] w-full px-3 py-2 text-lg font-extrabold text-center rounded-lg border-2 border-[#1E4E8C] tabular-nums"
                      />
                    </div>
                    <div>
                      <label htmlFor="ctrl-notes" className="block text-xs font-bold text-slate-700 mb-1">
                        ملاحظات الكونترول (اختياري)
                      </label>
                      <input
                        id="ctrl-notes"
                        type="text"
                        value={notesInput}
                        onChange={(e) => setNotesInput(e.target.value)}
                        placeholder="أي ملاحظة على الدفتر..."
                        className="min-h-[48px] w-full px-3 py-2 text-sm rounded-lg border border-slate-300"
                      />
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                    <span className="text-xs font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-lg">
                      الحالة عند الحفظ: جاهزة للنشر (بانتظار النشر الرسمي)
                    </span>
                    <button
                      type="submit"
                      disabled={savingScan}
                      className="min-h-[44px] inline-flex items-center gap-2 px-5 py-2.5 bg-[#0B1F3A] hover:bg-[#1E4E8C] text-white text-sm font-bold rounded-lg cursor-pointer disabled:opacity-50"
                    >
                      <Save className="w-4 h-4 text-[#C59B27]" />
                      <span>{savingScan ? 'جاري الرصد...' : 'حفظ الدرجة والانتقال للتالي'}</span>
                    </button>
                  </div>
                </form>
              )}
            </div>

            {recentScans.length > 0 && (
              <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
                <h4 className="font-display text-sm font-bold text-[#0B1F3A]">
                  آخر الدرجات المرصودة بالكونترول ({recentScans.length})
                </h4>
                <div className="divide-y divide-slate-100">
                  {recentScans.map((sc) => (
                    <div key={sc.id} className="py-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div>
                        <span className="font-bold text-[#0B1F3A]">{sc.fullName}</span>
                        <span className="text-slate-500 mx-2">
                          ({sc.subjectName} — {sc.examName})
                        </span>
                        {sc.offlineQueued && (
                          <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-900 font-bold">
                            محلياً بانتظار المزامنة
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 tabular-nums">
                        <span className="font-extrabold text-[#1E4E8C] text-sm">{sc.score}</span>
                        <span className="text-slate-400">{sc.time}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
