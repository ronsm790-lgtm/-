import { useEffect, useState, type FormEvent } from 'react';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import {
  CheckCircle2,
  CloudUpload,
  ExternalLink,
  FileSpreadsheet,
  Info,
  LogOut,
  Plus,
  StickyNote,
  Trash2,
} from 'lucide-react';
import { apiFetch, getAdminSessionToken } from '../../lib/api.ts';
import {
  auth,
  db,
  getGoogleWorkspaceToken,
  googleDriveBackupSignIn,
  googleWorkspaceSignIn,
  googleWorkspaceSignOut,
  handleFirestoreError,
  initGoogleWorkspaceAuth,
  OperationType,
  uploadBackupToGoogleDrive,
} from '../../lib/firebase.ts';
import type { AdminNote, Exam, SchoolClass, Student } from '../../types/school.ts';

interface GoogleIntegrationsTabProps {
  students: Student[];
  classes: SchoolClass[];
  exams: Exam[];
}

export function GoogleIntegrationsTab({
  students,
  classes,
}: GoogleIntegrationsTabProps) {
  const [googleEmail, setGoogleEmail] = useState<string | null>(
    auth.currentUser?.email ?? null
  );
  const [accessToken, setAccessToken] = useState<string | null>(getGoogleWorkspaceToken());
  const [signingIn, setSigningIn] = useState(false);

  // Google Sheets state
  const [sheetTitle, setSheetTitle] = useState('كشف طلبة إعدادية المنتظر للبنين');
  const [spreadsheetIdInput, setSpreadsheetIdInput] = useState('');
  const [sheetRange, setSheetRange] = useState('A1:E50');
  const [createdSheetUrl, setCreatedSheetUrl] = useState<string | null>(null);
  const [sheetRowsPreview, setSheetRowsPreview] = useState<string[][]>([]);
  const [confirmTarget, setConfirmTarget] = useState<{
    action: 'overwrite_sheet';
    spreadsheetId: string;
    rowCount: number;
  } | null>(null);

  // Admin Notes (SQLite + Firestore sync)
  const [notes, setNotes] = useState<AdminNote[]>([]);
  const [noteTitle, setNoteTitle] = useState('');
  const [noteContent, setNoteContent] = useState('');
  const [notePinned, setNotePinned] = useState(false);

  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [backingUpDrive, setBackingUpDrive] = useState(false);

  const loadNotes = async () => {
    try {
      const data = await apiFetch<{ notes: AdminNote[] }>('/api/admin/notes');
      setNotes(data.notes);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    loadNotes();
    const unsub = initGoogleWorkspaceAuth(
      (user, tok) => {
        setGoogleEmail(user.email);
        setAccessToken(tok);
      },
      () => {
        setAccessToken(getGoogleWorkspaceToken());
      }
    );
    return () => unsub();
  }, []);

  const handleGoogleSignIn = async () => {
    setSigningIn(true);
    setError(null);
    try {
      const res = await googleWorkspaceSignIn();
      setGoogleEmail(res.user.email);
      setAccessToken(res.accessToken);
      setStatusMsg(`تم ربط حساب Google (${res.user.email}) بنجاح.`);
    } catch (err: any) {
      setError(err?.message || 'تعذر تسجيل الدخول عبر Google.');
    } finally {
      setSigningIn(false);
    }
  };

  const handleGoogleSignOut = async () => {
    await googleWorkspaceSignOut();
    setGoogleEmail(null);
    setAccessToken(null);
  };

  const buildStudentValuesMatrix = () => {
    const header = ['ت', 'اسم الطالب', 'رقم الهوية الوطنية', 'الصف', 'الشعبة'];
    const body = students.map((s, idx) => [
      String(idx + 1),
      s.fullName,
      s.inquiryCode,
      s.className || classes.find((c) => c.id === s.classId)?.name || '',
      s.sectionName || '',
    ]);
    return [header, ...body];
  };

  const handleCreateGoogleSheet = async () => {
    if (!accessToken) return;
    setBusy(true);
    setError(null);
    setStatusMsg(null);
    try {
      const createRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          properties: { title: sheetTitle.trim() || 'إعدادية المنتظر للبنين' },
          sheets: [{ properties: { title: 'الطلاب', gridProperties: { rowCount: 500, columnCount: 8 } } }],
        }),
      });
      const created = await createRes.json();
      if (!createRes.ok) {
        throw new Error(created?.error?.message || 'فشل إنشاء جدول Google Sheets.');
      }

      const sid = created.spreadsheetId;
      const values = buildStudentValuesMatrix();
      const firstSheetTitle = created.sheets?.[0]?.properties?.title || 'الطلاب';

      const updateRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${sid}/values/${encodeURIComponent(
          `${firstSheetTitle}!A1`
        )}?valueInputOption=USER_ENTERED`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ values }),
        }
      );
      if (!updateRes.ok) {
        const errBody = await updateRes.json();
        throw new Error(errBody?.error?.message || 'تم إنشاء الجدول ولكن تعذر تعبئة الصفوف.');
      }

      setSpreadsheetIdInput(sid);
      setCreatedSheetUrl(created.spreadsheetUrl);
      setStatusMsg(`تم إنشاء جدول Google Sheets وتصدير ${students.length} طالب بنجاح.`);
    } catch (err: any) {
      setError(err?.message || 'تعذر الاتصال بواجهة Google Sheets.');
    } finally {
      setBusy(false);
    }
  };

  const handleReadGoogleSheet = async () => {
    if (!accessToken || !spreadsheetIdInput.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const sid = spreadsheetIdInput.trim();
      const metaRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sid}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const meta = await metaRes.json();
      if (!metaRes.ok) throw new Error(meta?.error?.message || 'تعذر قراءة بيانات الجدول.');

      const firstTab = meta.sheets?.[0]?.properties?.title || 'Sheet1';
      const fullRange = sheetRange.includes('!') ? sheetRange : `${firstTab}!${sheetRange}`;
      const valRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${sid}/values/${encodeURIComponent(fullRange)}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      const valData = await valRes.json();
      if (!valRes.ok) throw new Error(valData?.error?.message || 'تعذر جلب القيم.');

      setSheetRowsPreview(valData.values ?? []);
      setStatusMsg(`تمت قراءة ${(valData.values ?? []).length} صف من الورقة "${firstTab}".`);
    } catch (err: any) {
      setError(err?.message || 'تعذر قراءة جدول Google Sheets.');
    } finally {
      setBusy(false);
    }
  };

  const executeConfirmedOverwrite = async () => {
    if (!confirmTarget || !accessToken) return;
    setBusy(true);
    setError(null);
    try {
      const sid = confirmTarget.spreadsheetId;
      const metaRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sid}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const meta = await metaRes.json();
      if (!metaRes.ok) throw new Error(meta?.error?.message || 'تعذر فتح الجدول المستهدف.');

      const firstTab = meta.sheets?.[0]?.properties?.title || 'Sheet1';
      const values = buildStudentValuesMatrix();
      const putRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${sid}/values/${encodeURIComponent(
          `${firstTab}!A1`
        )}?valueInputOption=USER_ENTERED`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ values }),
        }
      );
      if (!putRes.ok) {
        const e = await putRes.json();
        throw new Error(e?.error?.message || 'تعذر تحديث الجدول.');
      }
      setStatusMsg(`تم تحديث الجدول (${sid}) بـ ${students.length} سجل بنجاح.`);
    } catch (err: any) {
      setError(err?.message || 'فشل تحديث Google Sheet.');
    } finally {
      setConfirmTarget(null);
      setBusy(false);
    }
  };

  const handleAddNote = async (e: FormEvent) => {
    e.preventDefault();
    if (!noteTitle.trim()) return;
    setError(null);
    try {
      await apiFetch('/api/admin/notes', {
        method: 'POST',
        body: JSON.stringify({
          title: noteTitle.trim(),
          content: noteContent.trim(),
          pinned: notePinned,
          color: 'gold',
        }),
      });
      // Sync to Firestore if signed in with Google
      if (auth.currentUser) {
        try {
          await addDoc(collection(db, 'adminNotes'), {
            title: noteTitle.trim(),
            content: noteContent.trim(),
            pinned: notePinned,
            ownerUid: auth.currentUser.uid,
            updatedAt: serverTimestamp(),
          });
        } catch (fsErr) {
          handleFirestoreError(fsErr, OperationType.CREATE, 'adminNotes');
        }
      }
      setNoteTitle('');
      setNoteContent('');
      setNotePinned(false);
      await loadNotes();
    } catch (err: any) {
      setError(err?.message || 'تعذر حفظ الملاحظة.');
    }
  };

  const handleDeleteNote = async (id: number) => {
    await apiFetch(`/api/admin/notes/${id}`, { method: 'DELETE' });
    await loadNotes();
  };

  const handleSyncBackupToDrive = async () => {
    setBackingUpDrive(true);
    setError(null);
    setStatusMsg(null);
    try {
      const { accessToken: driveToken, user } = await googleDriveBackupSignIn();
      // Ensure fresh backup snapshot exists and download it
      await apiFetch('/api/admin/backups', { method: 'POST' });
      const bRes = await apiFetch<{ backups: Array<{ filename: string }> }>('/api/admin/backups');
      const latestFilename = bRes.backups?.[0]?.filename;
      if (!latestFilename) {
        throw new Error('لم يتم العثور على ملف نسخة احتياطية.');
      }

      const token = getAdminSessionToken();
      const dlRes = await fetch(`/api/admin/backups/${encodeURIComponent(latestFilename)}`, {
        credentials: 'include',
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!dlRes.ok) {
        throw new Error('تعذر جلب ملف النسخة الاحتياطية من الخادم.');
      }
      const blob = await dlRes.blob();
      const uploaded = await uploadBackupToGoogleDrive(driveToken, latestFilename, blob);
      setStatusMsg(
        `تم رفع النسخة الاحتياطية (${uploaded.name}) إلى Google Drive لحساب (${user.email}) بنجاح.`
      );
    } catch (err: any) {
      setError(
        err?.message ||
          'تعذر مزامنة النسخة الاحتياطية مع Google Drive (تتطلب صلاحية المالك الأساسي وحساب Google).'
      );
    } finally {
      setBackingUpDrive(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Google Workspace Authentication Card */}
      <section className="bg-white border border-slate-200 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <h3 className="font-display text-base font-bold text-[#0B1F3A]">
            ربط حساب Google للمزامنة مع Google Sheets
          </h3>
          <p className="text-xs text-slate-600">
            {accessToken && googleEmail
              ? `متصل حالياً بالحساب: ${googleEmail}`
              : 'سجل الدخول بحساب Google لمنح صلاحية إنشاء ومزامنة جداول البيانات.'}
          </p>
        </div>

        {accessToken ? (
          <button
            type="button"
            onClick={handleGoogleSignOut}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            <span>فصل حساب Google</span>
          </button>
        ) : (
          <button
            type="button"
            disabled={signingIn}
            onClick={handleGoogleSignIn}
            className="inline-flex items-center gap-3 px-4 py-2.5 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg text-sm font-semibold text-slate-800 shadow-xs cursor-pointer"
          >
            <svg className="w-4 h-4" viewBox="0 0 48 48" aria-hidden="true">
              <path
                fill="#EA4335"
                d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
              />
              <path
                fill="#4285F4"
                d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
              />
              <path
                fill="#FBBC05"
                d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
              />
              <path
                fill="#34A853"
                d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
              />
            </svg>
            <span>{signingIn ? 'جاري الربط...' : 'Sign in with Google'}</span>
          </button>
        )}
      </section>

      {error && (
        <div className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm">
          {error}
        </div>
      )}
      {statusMsg && (
        <div className="flex items-center gap-2 p-3.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-900 text-sm">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{statusMsg}</span>
        </div>
      )}

      {/* Confirmation Dialog for Overwriting Spreadsheet */}
      {confirmTarget && (
        <div className="bg-amber-50 border border-amber-300 rounded-xl p-5 space-y-3">
          <h4 className="font-display text-sm font-bold text-amber-950">
            تأكيد تعديل جدول Google Sheets
          </h4>
          <p className="text-xs sm:text-sm text-amber-900">
            هل تريد بالتأكيد تحديث محتويات الجدول ({confirmTarget.spreadsheetId}) بـ{' '}
            {confirmTarget.rowCount} سجل؟ سيؤدي هذا إلى استبدال الخلايا بدءاً من A1.
          </p>
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={busy}
              onClick={executeConfirmedOverwrite}
              className="px-4 py-2 bg-[#0B1F3A] text-white text-xs font-bold rounded-lg cursor-pointer"
            >
              تأكيد التحديث
            </button>
            <button
              type="button"
              onClick={() => setConfirmTarget(null)}
              className="px-4 py-2 bg-white border border-slate-300 text-slate-700 text-xs font-bold rounded-lg cursor-pointer"
            >
              إلغاء
            </button>
          </div>
        </div>
      )}

      {/* Google Sheets Sync Operations */}
      <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-2">
          <FileSpreadsheet className="w-5 h-5 text-emerald-700" />
          <h3 className="font-display text-base font-bold text-[#0B1F3A]">
            مزامنة Google Sheets
          </h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="space-y-3 border border-slate-200 rounded-lg p-4">
            <h4 className="text-sm font-bold text-[#0B1F3A]">إنشاء جدول جديد وتصدير الطلبة</h4>
            <input
              type="text"
              value={sheetTitle}
              onChange={(e) => setSheetTitle(e.target.value)}
              placeholder="عنوان جدول البيانات..."
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300"
            />
            <button
              type="button"
              disabled={!accessToken || busy}
              onClick={handleCreateGoogleSheet}
              className="px-4 py-2 bg-[#0B1F3A] hover:bg-[#1E4E8C] text-white text-xs font-bold rounded-lg cursor-pointer disabled:opacity-50"
            >
              إنشاء وتصدير إلى Google Sheets
            </button>
            {createdSheetUrl && (
              <a
                href={createdSheetUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-bold text-[#1E4E8C] hover:underline mr-3"
              >
                <span>فتح الجدول</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
          </div>

          <div className="space-y-3 border border-slate-200 rounded-lg p-4">
            <h4 className="text-sm font-bold text-[#0B1F3A]">قراءة أو تحديث جدول موجود</h4>
            <input
              type="text"
              dir="ltr"
              value={spreadsheetIdInput}
              onChange={(e) => setSpreadsheetIdInput(e.target.value)}
              placeholder="Spreadsheet ID"
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 font-mono"
            />
            <div className="flex flex-wrap gap-2">
              <input
                type="text"
                dir="ltr"
                value={sheetRange}
                onChange={(e) => setSheetRange(e.target.value)}
                placeholder="A1:E50"
                className="w-28 px-3 py-2 text-xs rounded-lg border border-slate-300 font-mono"
              />
              <button
                type="button"
                disabled={!accessToken || !spreadsheetIdInput.trim() || busy}
                onClick={handleReadGoogleSheet}
                className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-[#0B1F3A] text-xs font-bold rounded-lg cursor-pointer disabled:opacity-50"
              >
                قراءة البيانات
              </button>
              <button
                type="button"
                disabled={!accessToken || !spreadsheetIdInput.trim() || busy}
                onClick={() =>
                  setConfirmTarget({
                    action: 'overwrite_sheet',
                    spreadsheetId: spreadsheetIdInput.trim(),
                    rowCount: students.length,
                  })
                }
                className="px-3.5 py-2 bg-[#1E4E8C] hover:bg-[#0B1F3A] text-white text-xs font-bold rounded-lg cursor-pointer disabled:opacity-50"
              >
                تحديث الجدول بالطلبة
              </button>
            </div>
          </div>
        </div>

        {sheetRowsPreview.length > 0 && (
          <div className="max-h-56 overflow-auto border border-slate-200 rounded-lg">
            <table className="w-full text-xs border-collapse">
              <tbody>
                {sheetRowsPreview.map((row, rIdx) => (
                  <tr key={rIdx} className={rIdx === 0 ? 'bg-slate-100 font-bold' : 'border-t border-slate-100'}>
                    {row.map((cell, cIdx) => (
                      <td key={cIdx} className="px-3 py-2">
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Google Keep Enterprise Constraint Notice + Integrated Admin Notes Board */}
      <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-2">
          <StickyNote className="w-5 h-5 text-[#C59B27]" />
          <h3 className="font-display text-base font-bold text-[#0B1F3A]">
            مفكرة اللجنة الامتحانية والملاحظات الإدارية (مزامنة محلية وسحابية)
          </h3>
        </div>

        <div className="flex items-start gap-3 p-3.5 rounded-lg bg-blue-50 border border-blue-200 text-xs sm:text-sm text-[#0B1F3A]">
          <Info className="w-4 h-4 text-[#1E4E8C] shrink-0 mt-0.5" />
          <p className="leading-relaxed">
            ملاحظة تقنية: واجهة Google Keep API الرسمية مخصصة حصراً لحسابات Google Workspace المؤسسية (Enterprise) بتفويض نطاقي، ولا تدعم حسابات <code>@gmail.com</code> الشخصية؛ لذا تم توفير مفكرة إدارية متكاملة تحفظ ملاحظات اللجنة في قاعدة البيانات المحلية وتزامنها مع Firestore عند تسجيل الدخول.
          </p>
        </div>

        <form onSubmit={handleAddNote} className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <input
            type="text"
            value={noteTitle}
            onChange={(e) => setNoteTitle(e.target.value)}
            placeholder="عنوان الملاحظة أو التذكير..."
            required
            className="px-3 py-2 text-sm rounded-lg border border-slate-300"
          />
          <input
            type="text"
            value={noteContent}
            onChange={(e) => setNoteContent(e.target.value)}
            placeholder="تفاصيل الملاحظة..."
            className="px-3 py-2 text-sm rounded-lg border border-slate-300"
          />
          <div className="flex items-center justify-between gap-2">
            <label className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={notePinned}
                onChange={(e) => setNotePinned(e.target.checked)}
              />
              <span>تثبيت</span>
            </label>
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#0B1F3A] text-white text-xs font-bold rounded-lg hover:bg-[#1E4E8C] cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>حفظ الملاحظة</span>
            </button>
          </div>
        </form>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {notes.map((n) => (
            <div
              key={n.id}
              className={`border rounded-xl p-4 space-y-2 ${
                n.pinned ? 'border-[#C59B27] bg-amber-50/40' : 'border-slate-200 bg-slate-50/50'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <h4 className="font-bold text-sm text-[#0B1F3A]">{n.title}</h4>
                <button
                  type="button"
                  onClick={() => handleDeleteNote(n.id)}
                  aria-label={`حذف ملاحظة ${n.title}`}
                  className="text-red-600 hover:bg-red-50 p-1 rounded cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              {n.content && <p className="text-xs text-slate-700 leading-relaxed">{n.content}</p>}
              <p className="text-[11px] text-slate-500">
                {n.updatedBy} · <span className="font-mono">{n.updatedAt.slice(0, 16)}</span>
              </p>
            </div>
          ))}
        </div>
      </section>
      {/* Google Drive Backup Sync Section */}
      <section className="bg-white border border-slate-200 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <CloudUpload className="w-5 h-5 text-[#1E4E8C]" />
            <h3 className="font-display text-base font-bold text-[#0B1F3A]">
              نسخة احتياطية سحابية إلى Google Drive (اختياري)
            </h3>
          </div>
          <p className="text-xs text-slate-600">
            ارفع نسخة فورية من قاعدة بيانات المدرسة (SQLite) مباشرة إلى حساب Google Drive الخاص بمدير المدرسة.
          </p>
        </div>
        <button
          type="button"
          disabled={backingUpDrive}
          onClick={handleSyncBackupToDrive}
          className="min-h-[44px] inline-flex items-center gap-2 px-4 py-2.5 bg-[#0B1F3A] hover:bg-[#1E4E8C] text-white text-xs font-bold rounded-lg cursor-pointer disabled:opacity-50"
        >
          <CloudUpload className="w-4 h-4 text-[#C59B27]" />
          <span>{backingUpDrive ? 'جاري الرفع إلى Drive...' : 'حفظ نسخة احتياطية إلى Google Drive'}</span>
        </button>
      </section>
    </div>
  );
}
