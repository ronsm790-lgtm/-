import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  CheckCircle2,
  DatabaseBackup,
  Download,
  KeyRound,
  RotateCcw,
  Upload,
} from 'lucide-react';
import { apiDownload, apiFetch, setAdminSessionToken } from '../../lib/api.ts';
import type { AdminUser, SchoolSettings } from '../../types/school.ts';

interface SettingsAndUsersTabProps {
  currentAdmin: AdminUser;
  settings: SchoolSettings;
  onAdminUpdated?: (next: AdminUser) => void;
  onSettingsUpdated: (next: SchoolSettings) => void;
}

export function SettingsAndUsersTab({
  currentAdmin,
  settings,
  onAdminUpdated,
  onSettingsUpdated,
}: SettingsAndUsersTabProps) {
  const isOwner = currentAdmin.role === 'owner';
  const isTeacher = currentAdmin.role === 'teacher';
  const canEditSettings = isOwner || currentAdmin.permissions.manageSettings;

  // School settings form (auto-saved cleanly on edit)
  const [formSettings, setFormSettings] = useState<SchoolSettings>(settings);
  const [settingsAutoState, setSettingsAutoState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [uploadingEmblem, setUploadingEmblem] = useState(false);
  const lastSavedSettingsJsonRef = useRef<string>(JSON.stringify(settings));

  // Change own password
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [changingPw, setChangingPw] = useState(false);

  // Owner credentials update (username + optional password)
  const [ownerCurrentPw, setOwnerCurrentPw] = useState('');
  const [ownerNewUsername, setOwnerNewUsername] = useState(currentAdmin.username);
  const [ownerNewPw, setOwnerNewPw] = useState('');
  const [savingOwnerCreds, setSavingOwnerCreds] = useState(false);

  // Owner: SQLite backups
  const [backups, setBackups] = useState<
    Array<{ filename: string; sizeBytes: number; createdAt: string }>
  >([]);
  const [restoreConfirm, setRestoreConfirm] = useState<string | null>(null);
  const [downloadingBackup, setDownloadingBackup] = useState<string | null>(null);

  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const incomingJson = JSON.stringify(settings);
    if (incomingJson !== lastSavedSettingsJsonRef.current) {
      lastSavedSettingsJsonRef.current = incomingJson;
      setFormSettings(settings);
    }
  }, [settings]);

  const loadBackups = async () => {
    if (!isOwner) return;
    try {
      const bRes = await apiFetch<{
        backups: Array<{ filename: string; sizeBytes: number; createdAt: string }>;
      }>('/api/admin/backups');
      setBackups(bRes.backups);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    loadBackups();
  }, [isOwner]);

  useEffect(() => {
    if (isTeacher || !canEditSettings) return;
    const serialized = JSON.stringify(formSettings);
    if (serialized === lastSavedSettingsJsonRef.current) return;

    const timer = window.setTimeout(async () => {
      setSettingsAutoState('saving');
      setError(null);
      try {
        const res = await apiFetch<{ settings: SchoolSettings }>('/api/admin/settings', {
          method: 'PUT',
          body: serialized,
        });
        lastSavedSettingsJsonRef.current = JSON.stringify(res.settings);
        onSettingsUpdated(res.settings);
        setSettingsAutoState('saved');
      } catch (err: any) {
        setSettingsAutoState('error');
        setError(err?.message || 'تعذر الحفظ التلقائي لإعدادات المدرسة.');
      }
    }, 650);

    return () => window.clearTimeout(timer);
  }, [formSettings, isTeacher, canEditSettings, onSettingsUpdated]);

  const handleEmblemUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setMessage(null);
    setUploadingEmblem(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('تعذر قراءة ملف الصورة.'));
        reader.readAsDataURL(file);
      });
      const res = await apiFetch<{ url: string; settings: SchoolSettings }>(
        '/api/admin/upload-emblem',
        {
          method: 'POST',
          body: JSON.stringify({ dataUrl }),
        }
      );
      lastSavedSettingsJsonRef.current = JSON.stringify(res.settings);
      setFormSettings(res.settings);
      onSettingsUpdated(res.settings);
      setSettingsAutoState('saved');
      setMessage('تم رفع شعار المدرسة وتحديثه في الواجهة والكشوف بنجاح.');
    } catch (err: any) {
      setError(err?.message || 'تعذر رفع صورة الشعار.');
    } finally {
      setUploadingEmblem(false);
      e.target.value = '';
    }
  };

  const handleChangePassword = async (e: FormEvent) => {
    e.preventDefault();
    setChangingPw(true);
    setMessage(null);
    setError(null);
    try {
      await apiFetch('/api/admin/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setCurrentPassword('');
      setNewPassword('');
      setMessage('تم تغيير كلمة المرور الخاصة بك بنجاح.');
    } catch (err: any) {
      setError(err?.message || 'تعذر تغيير كلمة المرور.');
    } finally {
      setChangingPw(false);
    }
  };

  const handleUpdateOwnerCredentials = async (e: FormEvent) => {
    e.preventDefault();
    if (!isOwner) return;
    setSavingOwnerCreds(true);
    setMessage(null);
    setError(null);
    try {
      const res = await apiFetch<{
        ok: boolean;
        admin: AdminUser;
        sessionToken: string;
      }>('/api/admin/owner-credentials', {
        method: 'PUT',
        body: JSON.stringify({
          currentPassword: ownerCurrentPw,
          newUsername: ownerNewUsername.trim(),
          ...(ownerNewPw ? { newPassword: ownerNewPw } : {}),
        }),
      });
      if (res.sessionToken) {
        setAdminSessionToken(res.sessionToken);
      }
      if (res.admin && onAdminUpdated) {
        onAdminUpdated(res.admin);
      }
      setOwnerCurrentPw('');
      setOwnerNewPw('');
      setMessage('تم تحديث بيانات دخول المالك الأساسي وتحديث جلسة الأمان بنجاح.');
    } catch (err: any) {
      setError(err?.message || 'تعذر تحديث بيانات دخول المالك.');
    } finally {
      setSavingOwnerCreds(false);
    }
  };

  const handleCreateBackup = async () => {
    setMessage(null);
    setError(null);
    try {
      await apiFetch('/api/admin/backups', { method: 'POST' });
      setMessage('تم إنشاء نسخة احتياطية جديدة لقاعدة البيانات.');
      await loadBackups();
    } catch (err: any) {
      setError(err?.message || 'تعذر إنشاء النسخة الاحتياطية.');
    }
  };

  const handleDownloadBackup = async (filename: string) => {
    setError(null);
    setDownloadingBackup(filename);
    try {
      await apiDownload(`/api/admin/backups/${encodeURIComponent(filename)}`, filename);
    } catch (err: any) {
      setError(err?.message || 'تعذر تنزيل ملف النسخة الاحتياطية.');
    } finally {
      setDownloadingBackup(null);
    }
  };

  const handleRestoreBackup = async (filename: string) => {
    setMessage(null);
    setError(null);
    try {
      await apiFetch('/api/admin/backups/restore', {
        method: 'POST',
        body: JSON.stringify({ filename }),
      });
      setRestoreConfirm(null);
      setMessage(`تمت استعادة قاعدة البيانات من النسخة (${filename}) بنجاح.`);
    } catch (err: any) {
      setError(err?.message || 'تعذر استعادة النسخة الاحتياطية.');
    }
  };

  return (
    <div className="space-y-6">
      {message && (
        <div className="flex items-center gap-2 p-3.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-900 text-sm">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{message}</span>
        </div>
      )}
      {error && (
        <div role="alert" className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm">
          {error}
        </div>
      )}

      {/* School Settings (Hidden for Teachers) */}
      {!isTeacher && (
        <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-display text-base font-bold text-[#0B1F3A]">
              إعدادات المدرسة والهوية الرسمية والكشوف
            </h3>
            {canEditSettings && (
              <span
                role="status"
                className={`text-xs font-bold px-2.5 py-1 rounded-md ${
                  settingsAutoState === 'saving'
                    ? 'bg-slate-100 text-slate-700'
                    : settingsAutoState === 'error'
                      ? 'bg-red-50 text-red-700'
                      : 'bg-emerald-50 text-emerald-800'
                }`}
              >
                {settingsAutoState === 'saving'
                  ? 'جاري الحفظ تلقائياً...'
                  : settingsAutoState === 'error'
                    ? 'تعذر الحفظ التلقائي'
                    : 'يتم الحفظ تلقائياً'}
              </span>
            )}
          </div>
          <form onSubmit={(e) => e.preventDefault()} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">اسم المدرسة</label>
                <input
                  type="text"
                  disabled={!canEditSettings}
                  value={formSettings.schoolName}
                  onChange={(e) => setFormSettings({ ...formSettings, schoolName: e.target.value })}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">الترويسة العليا</label>
                <input
                  type="text"
                  disabled={!canEditSettings}
                  value={formSettings.republicHeader}
                  onChange={(e) =>
                    setFormSettings({ ...formSettings, republicHeader: e.target.value })
                  }
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">الوزارة</label>
                <input
                  type="text"
                  disabled={!canEditSettings}
                  value={formSettings.ministryHeader}
                  onChange={(e) =>
                    setFormSettings({ ...formSettings, ministryHeader: e.target.value })
                  }
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">المديرية العامة للتربية</label>
                <input
                  type="text"
                  disabled={!canEditSettings}
                  value={formSettings.directorate}
                  onChange={(e) => setFormSettings({ ...formSettings, directorate: e.target.value })}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">العام الدراسي</label>
                <input
                  type="text"
                  disabled={!canEditSettings}
                  value={formSettings.academicYear}
                  onChange={(e) => setFormSettings({ ...formSettings, academicYear: e.target.value })}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 tabular-nums"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">بيانات الاتصال</label>
                <input
                  type="text"
                  disabled={!canEditSettings}
                  value={formSettings.contactInfo}
                  onChange={(e) => setFormSettings({ ...formSettings, contactInfo: e.target.value })}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">شعار المدرسة (رابط أو رفع من الجهاز)</label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    dir="ltr"
                    disabled={!canEditSettings}
                    value={formSettings.emblemUrl}
                    onChange={(e) => setFormSettings({ ...formSettings, emblemUrl: e.target.value })}
                    className="flex-1 min-w-0 px-3 py-2 text-xs rounded-lg border border-slate-300 font-mono"
                  />
                  {canEditSettings && (
                    <label className="inline-flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 border border-slate-300 text-[#0B1F3A] text-xs font-bold rounded-lg cursor-pointer whitespace-nowrap shrink-0">
                      <Upload className="w-3.5 h-3.5 text-[#1E4E8C]" />
                      <span>{uploadingEmblem ? 'جاري الرفع...' : 'رفع صورة الشعار'}</span>
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/svg+xml"
                        onChange={handleEmblemUpload}
                        disabled={uploadingEmblem}
                        className="sr-only"
                      />
                    </label>
                  )}
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">إعدادات الطباعة</label>
                <input
                  type="text"
                  disabled={!canEditSettings}
                  value={formSettings.printNote}
                  onChange={(e) => setFormSettings({ ...formSettings, printNote: e.target.value })}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300"
                />
              </div>
              <div className="flex items-center gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">اللون الأساسي</label>
                  <input
                    type="color"
                    disabled={!canEditSettings}
                    value={formSettings.primaryColor}
                    onChange={(e) =>
                      setFormSettings({ ...formSettings, primaryColor: e.target.value })
                    }
                    className="w-14 h-9 rounded border border-slate-300 cursor-pointer"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">اللون الذهبي</label>
                  <input
                    type="color"
                    disabled={!canEditSettings}
                    value={formSettings.accentColor}
                    onChange={(e) =>
                      setFormSettings({ ...formSettings, accentColor: e.target.value })
                    }
                    className="w-14 h-9 rounded border border-slate-300 cursor-pointer"
                  />
                </div>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">تذييل كشوف النتائج</label>
              <textarea
                rows={2}
                disabled={!canEditSettings}
                value={formSettings.footerText}
                onChange={(e) => setFormSettings({ ...formSettings, footerText: e.target.value })}
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300"
              />
            </div>

          </form>
        </section>
      )}

      {/* Change Own Password */}
      <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-2">
          <KeyRound className="w-5 h-5 text-[#1E4E8C]" />
          <h3 className="font-display text-base font-bold text-[#0B1F3A]">تغيير كلمة المرور الخاصة بحسابك</h3>
        </div>
        <form onSubmit={handleChangePassword} className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">كلمة المرور الحالية</label>
            <input
              type="password"
              dir="ltr"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              كلمة المرور الجديدة (8+ أحرف)
            </label>
            <input
              type="password"
              dir="ltr"
              minLength={8}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300"
            />
          </div>
          <button
            type="submit"
            disabled={changingPw}
            className="px-4 py-2.5 bg-[#0B1F3A] hover:bg-[#1E4E8C] text-white text-xs font-bold rounded-lg cursor-pointer"
          >
            {changingPw ? 'جاري التحديث...' : 'تحديث كلمة المرور'}
          </button>
        </form>
      </section>

      {/* Owner Only: Update Owner Username & Password */}
      {isOwner && (
        <section className="bg-white border border-[#C59B27]/50 rounded-xl p-5 space-y-4">
          <div className="flex items-center gap-2">
            <KeyRound className="w-5 h-5 text-[#C59B27]" />
            <div>
              <h3 className="font-display text-base font-bold text-[#0B1F3A]">
                تعديل بيانات دخول المالك الأساسي (اسم المستخدم وكلمة المرور)
              </h3>
              <p className="text-xs text-slate-500">
                لا تُعرض بيانات الدخول السرية في أي موضع عام. يمكنك تغيير اسم المستخدم وكلمة المرور للمالك مباشرة من هنا.
              </p>
            </div>
          </div>
          <form onSubmit={handleUpdateOwnerCredentials} className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
            <div>
              <label htmlFor="owner-new-user" className="block text-xs font-bold text-slate-700 mb-1">
                اسم المستخدم الجديد (3+ أحرف)
              </label>
              <input
                id="owner-new-user"
                type="text"
                dir="ltr"
                minLength={3}
                value={ownerNewUsername}
                onChange={(e) => setOwnerNewUsername(e.target.value)}
                required
                className="min-h-[44px] w-full px-3 py-2 text-sm rounded-lg border border-slate-300 font-mono"
              />
            </div>
            <div>
              <label htmlFor="owner-curr-pw" className="block text-xs font-bold text-slate-700 mb-1">
                كلمة المرور الحالية للتحقق
              </label>
              <input
                id="owner-curr-pw"
                type="password"
                dir="ltr"
                value={ownerCurrentPw}
                onChange={(e) => setOwnerCurrentPw(e.target.value)}
                required
                className="min-h-[44px] w-full px-3 py-2 text-sm rounded-lg border border-slate-300"
              />
            </div>
            <div>
              <label htmlFor="owner-new-pw" className="block text-xs font-bold text-slate-700 mb-1">
                كلمة مرور جديدة (اختياري، 8+ أحرف)
              </label>
              <input
                id="owner-new-pw"
                type="password"
                dir="ltr"
                minLength={8}
                value={ownerNewPw}
                onChange={(e) => setOwnerNewPw(e.target.value)}
                placeholder="اتركه فارغاً للإبقاء على الحالية"
                className="min-h-[44px] w-full px-3 py-2 text-sm rounded-lg border border-slate-300"
              />
            </div>
            <button
              type="submit"
              disabled={savingOwnerCreds}
              className="min-h-[44px] px-4 py-2.5 bg-[#0B1F3A] hover:bg-[#1E4E8C] text-white text-xs font-bold rounded-lg cursor-pointer disabled:opacity-50"
            >
              {savingOwnerCreds ? 'جاري التحديث...' : 'حفظ بيانات المالك'}
            </button>
          </form>
        </section>
      )}

      {/* Owner Only: Database Backups & Restore */}
      {isOwner && (
        <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <DatabaseBackup className="w-5 h-5 text-[#1E4E8C]" />
              <div>
                <h3 className="font-display text-base font-bold text-[#0B1F3A]">
                  النسخ الاحتياطي التلقائي واليدوي والاستعادة (SQLite)
                </h3>
                <p className="text-xs text-slate-500">
                  يقوم النظام بأخذ نسخ احتياطية تلقائية عند حفظ الدرجات أو الإعدادات الحرجة وكل 6 ساعات.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleCreateBackup}
              className="min-h-[44px] px-4 py-2 bg-[#0B1F3A] hover:bg-[#1E4E8C] text-white text-xs font-bold rounded-lg cursor-pointer"
            >
              إنشاء نسخة احتياطية فورية
            </button>
          </div>

          {restoreConfirm && (
            <div className="p-4 rounded-lg bg-amber-50 border border-amber-300 space-y-2">
              <p className="text-sm font-bold text-amber-950">
                تأكيد استعادة قاعدة البيانات من ({restoreConfirm})؟ سيتم استبدال البيانات الحالية.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => handleRestoreBackup(restoreConfirm)}
                  className="px-4 py-1.5 bg-red-700 text-white text-xs font-bold rounded-md cursor-pointer"
                >
                  نعم، استعادة الآن
                </button>
                <button
                  type="button"
                  onClick={() => setRestoreConfirm(null)}
                  className="px-4 py-1.5 bg-white border border-slate-300 text-xs font-bold rounded-md cursor-pointer"
                >
                  إلغاء
                </button>
              </div>
            </div>
          )}

          {backups.length === 0 ? (
            <p className="text-xs text-slate-500">لا توجد نسخ احتياطية محفوظة بعد.</p>
          ) : (
            <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
              {backups.map((b) => {
                const isAuto = b.filename.startsWith('auto-backup-');
                return (
                  <div key={b.filename} className="px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono font-bold text-[#0B1F3A]">{b.filename}</span>
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                          isAuto
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                            : 'bg-slate-100 text-slate-700 border-slate-200'
                        }`}
                      >
                        {isAuto ? 'نسخ تلقائي' : 'نسخة يدوية'}
                      </span>
                      <span className="text-slate-500 tabular-nums">
                        {(b.sizeBytes / 1024).toFixed(1)} KB · {b.createdAt.slice(0, 19)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={downloadingBackup !== null}
                        onClick={() => handleDownloadBackup(b.filename)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 rounded-md font-bold text-[#0B1F3A] cursor-pointer disabled:opacity-50"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>{downloadingBackup === b.filename ? 'جاري التنزيل...' : 'تنزيل'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setRestoreConfirm(b.filename)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 bg-amber-100 hover:bg-amber-200 rounded-md font-bold text-amber-900 cursor-pointer"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>استعادة</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
