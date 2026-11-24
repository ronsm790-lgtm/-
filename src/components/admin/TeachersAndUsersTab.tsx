import { useEffect, useState, type FormEvent } from 'react';
import {
  BookOpenCheck,
  CheckCircle2,
  GraduationCap,
  Pencil,
  Plus,
  Shield,
  Trash2,
  UserCheck,
  UserPlus,
  UserX,
  X,
} from 'lucide-react';
import { apiFetch } from '../../lib/api.ts';
import type {
  AdminPermissions,
  AdminUser,
  SchoolClass,
  Section,
  Subject,
  TeacherAssignment,
} from '../../types/school.ts';

interface TeachersAndUsersTabProps {
  currentAdmin: AdminUser;
  classes: SchoolClass[];
  sections: Section[];
  subjects: Subject[];
  selectedYearId?: number | null;
}

const PERMISSION_LABELS: Record<keyof AdminPermissions, string> = {
  manageStudents: 'إدارة الطلاب',
  manageStructure: 'إدارة الصفوف والشعب والمواد',
  manageGrades: 'إدخال وتعديل الدرجات',
  publishGrades: 'نشر وسحب النتائج',
  manageImportExport: 'الاستيراد والتصدير',
  manageAnnouncements: 'إدارة الإعلانات',
  manageSettings: 'تعديل إعدادات المدرسة',
  manageNotes: 'إدارة المفكرة الإدارية',
};

interface AssignmentDraft {
  key: string;
  subjectId: string;
  classId: string;
  sectionId: string; // 'all' or numeric string
}

export function TeachersAndUsersTab({
  currentAdmin,
  classes,
  sections,
  subjects,
  selectedYearId = null,
}: TeachersAndUsersTabProps) {
  const isOwner = currentAdmin.role === 'owner';

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Teacher create/edit state
  const [editingTeacher, setEditingTeacher] = useState<AdminUser | null>(null);
  const [tUsername, setTUsername] = useState('');
  const [tFullName, setTFullName] = useState('');
  const [tPassword, setTPassword] = useState('');
  const [tIsActive, setTIsActive] = useState(true);
  const [tCanPublish, setTCanPublish] = useState(false);
  const [tAssignments, setTAssignments] = useState<AssignmentDraft[]>(() => [
    {
      key: 'init-0',
      subjectId: subjects[0] ? String(subjects[0].id) : '',
      classId: classes[0] ? String(classes[0].id) : '',
      sectionId: 'all',
    },
  ]);

  // Supervisor create state
  const [supUsername, setSupUsername] = useState('');
  const [supFullName, setSupFullName] = useState('');
  const [supPassword, setSupPassword] = useState('');
  const [supPerms, setSupPerms] = useState<AdminPermissions>({
    manageStudents: true,
    manageStructure: false,
    manageGrades: true,
    publishGrades: false,
    manageImportExport: true,
    manageAnnouncements: true,
    manageSettings: false,
    manageNotes: true,
  });

  // Ensure initial assignment defaults stay synced if structure loads after mount
  useEffect(() => {
    setTAssignments((prev) =>
      prev.map((row) => ({
        ...row,
        subjectId: row.subjectId || (subjects[0] ? String(subjects[0].id) : ''),
        classId: row.classId || (classes[0] ? String(classes[0].id) : ''),
      }))
    );
  }, [classes, subjects]);

  const loadUsers = async () => {
    if (!isOwner) return;
    setLoading(true);
    try {
      const qs = selectedYearId ? `?yearId=${selectedYearId}` : '';
      const res = await apiFetch<{ users: AdminUser[] }>(`/api/admin/users${qs}`);
      setUsers(res.users);
    } catch (err: any) {
      setError(err?.message || 'تعذر تحميل قائمة الحسابات.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, [isOwner, selectedYearId]);

  const resetTeacherForm = () => {
    setEditingTeacher(null);
    setTUsername('');
    setTFullName('');
    setTPassword('');
    setTIsActive(true);
    setTCanPublish(false);
    setTAssignments([
      {
        key: `row-${Date.now()}`,
        subjectId: subjects[0] ? String(subjects[0].id) : '',
        classId: classes[0] ? String(classes[0].id) : '',
        sectionId: 'all',
      },
    ]);
  };

  const startEditTeacher = (teacher: AdminUser) => {
    setError(null);
    setMessage(null);
    setEditingTeacher(teacher);
    setTUsername(teacher.username);
    setTFullName(teacher.fullName);
    setTPassword('');
    setTIsActive(teacher.isActive);
    setTCanPublish(Boolean(teacher.permissions.publishGrades));
    const mapped: AssignmentDraft[] = (teacher.assignments ?? []).map((a, idx) => ({
      key: `edit-${teacher.id}-${idx}-${Date.now()}`,
      subjectId: String(a.subjectId),
      classId: String(a.classId),
      sectionId: a.sectionId === null ? 'all' : String(a.sectionId),
    }));
    setTAssignments(
      mapped.length > 0
        ? mapped
        : [
            {
              key: `edit-empty-${Date.now()}`,
              subjectId: subjects[0] ? String(subjects[0].id) : '',
              classId: classes[0] ? String(classes[0].id) : '',
              sectionId: 'all',
            },
          ]
    );
  };

  const addAssignmentRow = () => {
    const defaultClassId = classes[0] ? String(classes[0].id) : '';
    const validSubs = subjects.filter(
      (s) => s.isActive && (!defaultClassId || s.classId === null || s.classId === Number(defaultClassId))
    );
    setTAssignments((prev) => [
      ...prev,
      {
        key: `row-${Date.now()}-${Math.random()}`,
        subjectId: validSubs[0] ? String(validSubs[0].id) : '',
        classId: defaultClassId,
        sectionId: 'all',
      },
    ]);
  };

  const updateAssignmentRow = (key: string, patch: Partial<AssignmentDraft>) => {
    setTAssignments((prev) =>
      prev.map((r) => {
        if (r.key !== key) return r;
        const nextRow = { ...r, ...patch };
        if (patch.classId !== undefined) {
          const validSubs = subjects.filter(
            (sub) => sub.isActive && (sub.classId === null || sub.classId === Number(patch.classId))
          );
          if (validSubs.length > 0 && !validSubs.some((s) => String(s.id) === nextRow.subjectId)) {
            nextRow.subjectId = String(validSubs[0].id);
          }
        }
        return nextRow;
      })
    );
  };

  const removeAssignmentRow = (key: string) => {
    setTAssignments((prev) => (prev.length > 1 ? prev.filter((r) => r.key !== key) : prev));
  };

  const handleSaveTeacher = async (e: FormEvent) => {
    e.preventDefault();
    setMessage(null);
    setError(null);

    const validAssignments = tAssignments
      .filter((a) => a.subjectId && a.classId)
      .map((a) => ({
        subjectId: Number(a.subjectId),
        classId: Number(a.classId),
        sectionId: a.sectionId === 'all' || !a.sectionId ? null : Number(a.sectionId),
      }));

    if (validAssignments.length === 0) {
      setError('يرجى إسناد مادة وصف وشعبة واحدة على الأقل للمدرس.');
      return;
    }

    if (!editingTeacher && tPassword.length < 6) {
      setError('كلمة مرور المدرس يجب ألا تقل عن 6 أحرف.');
      return;
    }
    if (editingTeacher && tPassword && tPassword.length < 6) {
      setError('كلمة المرور الجديدة يجب ألا تقل عن 6 أحرف.');
      return;
    }

    setSaving(true);
    try {
      if (editingTeacher) {
        await apiFetch(`/api/admin/users/${editingTeacher.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            ...(selectedYearId ? { yearId: selectedYearId } : {}),
            fullName: tFullName.trim(),
            isActive: tIsActive,
            ...(tPassword ? { password: tPassword } : {}),
            permissions: {
              ...editingTeacher.permissions,
              publishGrades: tCanPublish,
            },
            assignments: validAssignments,
          }),
        });
        setMessage(`تم تحديث حساب المدرس (${tFullName.trim()}) وإسناداته بنجاح.`);
      } else {
        await apiFetch('/api/admin/users', {
          method: 'POST',
          body: JSON.stringify({
            ...(selectedYearId ? { yearId: selectedYearId } : {}),
            username: tUsername.trim(),
            fullName: tFullName.trim(),
            password: tPassword,
            role: 'teacher',
            isActive: tIsActive,
            permissions: {
              publishGrades: tCanPublish,
            },
            assignments: validAssignments,
          }),
        });
        setMessage(`تم إنشاء حساب المدرس (${tFullName.trim()}) بنجاح.`);
      }
      resetTeacherForm();
      await loadUsers();
    } catch (err: any) {
      setError(err?.message || 'تعذر حفظ بيانات المدرس.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleUserActive = async (u: AdminUser) => {
    setError(null);
    setMessage(null);
    try {
      await apiFetch(`/api/admin/users/${u.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          ...(selectedYearId ? { yearId: selectedYearId } : {}),
          fullName: u.fullName,
          isActive: !u.isActive,
          permissions: u.permissions,
          ...(u.role === 'teacher' ? { assignments: u.assignments ?? [] } : {}),
        }),
      });
      setMessage(
        `${!u.isActive ? 'تم تنشيط' : 'تم تعطيل'} حساب ${u.role === 'teacher' ? 'المدرس' : 'المشرف'} (${u.fullName}).`
      );
      await loadUsers();
    } catch (err: any) {
      setError(err?.message || 'تعذر تحديث حالة الحساب.');
    }
  };

  const handleDeleteUser = async (u: AdminUser) => {
    setError(null);
    setMessage(null);
    try {
      await apiFetch(`/api/admin/users/${u.id}`, { method: 'DELETE' });
      if (editingTeacher?.id === u.id) {
        resetTeacherForm();
      }
      setMessage(`تم حذف الحساب (${u.fullName}).`);
      await loadUsers();
    } catch (err: any) {
      setError(err?.message || 'تعذر حذف الحساب.');
    }
  };

  const handleCreateSupervisor = async (e: FormEvent) => {
    e.preventDefault();
    setMessage(null);
    setError(null);
    try {
      await apiFetch('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify({
          username: supUsername.trim(),
          fullName: supFullName.trim(),
          password: supPassword,
          role: 'supervisor',
          permissions: supPerms,
        }),
      });
      setSupUsername('');
      setSupFullName('');
      setSupPassword('');
      setMessage('تم إنشاء حساب المشرف الإداري بنجاح.');
      await loadUsers();
    } catch (err: any) {
      setError(err?.message || 'تعذر إضافة المشرف.');
    }
  };

  if (!isOwner) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-600">
        إدارة حسابات المدرسين والمشرفين متاحة للمدير الأساسي فقط.
      </div>
    );
  }

  const teachers = users.filter((u) => u.role === 'teacher');
  const supervisorsAndOwner = users.filter((u) => u.role !== 'teacher');

  const formatAssignmentLabel = (a: TeacherAssignment) => {
    const subj = a.subjectName || subjects.find((s) => s.id === a.subjectId)?.name || 'مادة';
    const cls = a.className || classes.find((c) => c.id === a.classId)?.name || 'صف';
    const sec =
      a.sectionId === null
        ? 'كل الشعب'
        : `شعبة ${a.sectionName || sections.find((s) => s.id === a.sectionId)?.name || ''}`;
    return `${subj} · ${cls} (${sec})`;
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

      {/* ===================================================================== */}
      {/* TEACHERS SECTION                                                      */}
      {/* ===================================================================== */}
      <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-[#0B1F3A] text-[#C59B27] flex items-center justify-center shrink-0">
              <GraduationCap className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-display text-base font-bold text-[#0B1F3A]">
                إدارة حسابات المدرسين وتوزيع المواد والصفوف
              </h3>
              <p className="text-xs text-slate-500">
                كل مدرس يشاهد فقط المواد والصفوف والشعب الموكلة له ويرفع درجات طلبتها يدوياً أو عبر Excel.
              </p>
            </div>
          </div>
          <span className="text-xs font-bold text-slate-600 bg-slate-100 px-3 py-1.5 rounded-lg tabular-nums">
            عدد المدرسين: {teachers.length}
          </span>
        </div>

        <form
          onSubmit={handleSaveTeacher}
          className="border border-slate-200 rounded-xl p-4 sm:p-5 space-y-4 bg-slate-50/60"
        >
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-extrabold text-[#0B1F3A] flex items-center gap-2">
              <BookOpenCheck className="w-4 h-4 text-[#1E4E8C]" />
              <span>
                {editingTeacher
                  ? `تعديل المدرس: ${editingTeacher.fullName}`
                  : 'إضافة مدرس جديد وتحديد صفه ومادته'}
              </span>
            </h4>
            {editingTeacher && (
              <button
                type="button"
                onClick={resetTeacherForm}
                className="inline-flex items-center gap-1 text-xs font-bold text-slate-600 hover:text-slate-900 cursor-pointer"
              >
                <X className="w-4 h-4" />
                <span>إلغاء التعديل</span>
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label htmlFor="teacher-username" className="block text-xs font-bold text-slate-700 mb-1">
                اسم المستخدم للدخول
              </label>
              <input
                id="teacher-username"
                type="text"
                dir="ltr"
                disabled={Boolean(editingTeacher)}
                value={tUsername}
                onChange={(e) => setTUsername(e.target.value)}
                placeholder="مثال: bio_teacher"
                required
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white disabled:bg-slate-100"
              />
            </div>

            <div>
              <label htmlFor="teacher-fullname" className="block text-xs font-bold text-slate-700 mb-1">
                الاسم الكامل للمدرس
              </label>
              <input
                id="teacher-fullname"
                type="text"
                value={tFullName}
                onChange={(e) => setTFullName(e.target.value)}
                placeholder="مثال: الأستاذ علي حسن محمد"
                required
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white"
              />
            </div>

            <div>
              <label htmlFor="teacher-password" className="block text-xs font-bold text-slate-700 mb-1">
                {editingTeacher ? 'كلمة مرور جديدة (اتركها فارغة للإبقاء)' : 'كلمة المرور (6+ أحرف)'}
              </label>
              <input
                id="teacher-password"
                type="password"
                dir="ltr"
                minLength={editingTeacher ? undefined : 6}
                required={!editingTeacher}
                value={tPassword}
                onChange={(e) => setTPassword(e.target.value)}
                placeholder="••••••"
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white"
              />
            </div>
          </div>

          {/* Assignments Builder */}
          <div className="space-y-2.5 pt-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-bold text-[#0B1F3A]">
                المواد والصفوف والشعب الموكلة للمدرس:
              </span>
              <button
                type="button"
                onClick={addAssignmentRow}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold bg-white border border-slate-300 hover:bg-slate-100 text-[#0B1F3A] rounded-lg cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5 text-[#1E4E8C]" />
                <span>إضافة مادة / صف آخر</span>
              </button>
            </div>

            <p className="text-[11px] font-semibold text-[#1E4E8C] bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
              ملاحظة هامة: صلاحية المدرس تقتصر حصراً على امتحانات الفصلين الأول والثاني (الشهر الأول، الشهر الثاني، وسعي الفصلين الأول والثاني) لطلبته المكلف بهم فقط، ولا تشمل نصف السنة أو الامتحان النهائي أو الدور الثاني.
            </p>

            <div className="space-y-2">
              {tAssignments.map((row, idx) => {
                const classSections = sections.filter((s) => s.classId === Number(row.classId));
                const classSubjects = subjects.filter(
                  (sub) => sub.isActive && (sub.classId === null || sub.classId === Number(row.classId))
                );
                return (
                  <div
                    key={row.key}
                    className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center bg-white border border-slate-200 rounded-lg p-2.5"
                  >
                    <div className="sm:col-span-4">
                      <label className="block text-[11px] font-semibold text-slate-500 mb-0.5">
                        الصف الدراسي ({idx + 1})
                      </label>
                      <select
                        aria-label={`الصف الدراسي ${idx + 1}`}
                        value={row.classId}
                        onChange={(e) =>
                          updateAssignmentRow(row.key, {
                            classId: e.target.value,
                            sectionId: 'all',
                          })
                        }
                        className="w-full px-2.5 py-1.5 text-xs font-semibold rounded-md border border-slate-300 bg-white"
                      >
                        {classes.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="sm:col-span-4">
                      <label className="block text-[11px] font-semibold text-slate-500 mb-0.5">
                        المادة الدراسية للصف
                      </label>
                      <select
                        aria-label={`المادة الدراسية ${idx + 1}`}
                        value={row.subjectId}
                        onChange={(e) => updateAssignmentRow(row.key, { subjectId: e.target.value })}
                        className="w-full px-2.5 py-1.5 text-xs font-semibold rounded-md border border-slate-300 bg-white"
                      >
                        {classSubjects.map((sub) => (
                          <option key={sub.id} value={sub.id}>
                            {sub.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="sm:col-span-3">
                      <label className="block text-[11px] font-semibold text-slate-500 mb-0.5">
                        الشعبة
                      </label>
                      <select
                        aria-label={`الشعبة ${idx + 1}`}
                        value={row.sectionId}
                        onChange={(e) => updateAssignmentRow(row.key, { sectionId: e.target.value })}
                        className="w-full px-2.5 py-1.5 text-xs font-semibold rounded-md border border-slate-300 bg-white"
                      >
                        <option value="all">كل الشعب</option>
                        {classSections.map((sec) => (
                          <option key={sec.id} value={sec.id}>
                            شعبة {sec.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="sm:col-span-1 flex justify-end pt-3 sm:pt-4">
                      <button
                        type="button"
                        disabled={tAssignments.length <= 1}
                        onClick={() => removeAssignmentRow(row.key)}
                        aria-label={`إزالة الإسناد ${idx + 1}`}
                        className="p-1.5 text-red-600 hover:bg-red-50 rounded-md cursor-pointer disabled:opacity-30"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 pt-2 border-t border-slate-200">
            <div className="flex flex-wrap items-center gap-5 text-xs font-semibold text-slate-700">
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={tIsActive}
                  onChange={(e) => setTIsActive(e.target.checked)}
                />
                <span>حساب نشط (مسموح له بالدخول)</span>
              </label>

              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={tCanPublish}
                  onChange={(e) => setTCanPublish(e.target.checked)}
                />
                <span>السماح للمدرس بنشر الدرجات مباشرة للطلبة</span>
              </label>
            </div>

            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#0B1F3A] hover:bg-[#1E4E8C] text-white text-xs font-bold rounded-lg cursor-pointer disabled:opacity-50"
            >
              <UserPlus className="w-4 h-4 text-[#C59B27]" />
              <span>
                {saving
                  ? 'جاري الحفظ...'
                  : editingTeacher
                    ? 'حفظ تعديلات المدرس'
                    : 'إنشاء حساب المدرس'}
              </span>
            </button>
          </div>
        </form>

        {/* Teachers List */}
        {loading ? (
          <div className="p-6 text-center text-xs text-slate-500">جاري تحميل قائمة المدرسين...</div>
        ) : teachers.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-500 border border-dashed border-slate-200 rounded-lg">
            لا يوجد مدرسون مسجلون حتى الآن. يمكنك إضافة أول مدرس من النموذج أعلاه.
          </div>
        ) : (
          <div className="divide-y divide-slate-200 border border-slate-200 rounded-xl overflow-hidden">
            {teachers.map((t) => (
              <div
                key={t.id}
                className={`p-4 flex flex-wrap items-center justify-between gap-4 ${
                  t.isActive ? 'bg-white' : 'bg-slate-50/90'
                }`}
              >
                <div className="space-y-1.5 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold text-sm text-[#0B1F3A]">{t.fullName}</span>
                    <span
                      dir="ltr"
                      className="font-mono text-xs font-semibold text-[#1E4E8C] bg-slate-100 px-2 py-0.5 rounded"
                    >
                      {t.username}
                    </span>
                    <span
                      className={`text-[11px] font-bold px-2 py-0.5 rounded ${
                        t.isActive
                          ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                          : 'bg-red-50 text-red-700 border border-red-200'
                      }`}
                    >
                      {t.isActive ? 'نشط' : 'معطل'}
                    </span>
                    {t.permissions.publishGrades && (
                      <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-amber-50 text-amber-900 border border-amber-200">
                        نشر مباشر
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {(t.assignments ?? []).map((a, idx) => (
                      <span
                        key={`${t.id}-${idx}`}
                        className="inline-flex items-center px-2.5 py-1 rounded-md bg-slate-100 border border-slate-200 text-xs font-semibold text-[#0B1F3A]"
                      >
                        {formatAssignmentLabel(a)}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleToggleUserActive(t)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-md cursor-pointer border ${
                      t.isActive
                        ? 'bg-amber-50 hover:bg-amber-100 text-amber-900 border-amber-200'
                        : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-900 border-emerald-200'
                    }`}
                  >
                    {t.isActive ? <UserX className="w-3.5 h-3.5" /> : <UserCheck className="w-3.5 h-3.5" />}
                    <span>{t.isActive ? 'تعطيل' : 'تنشيط'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => startEditTeacher(t)}
                    aria-label={`تعديل المدرس ${t.fullName}`}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold bg-slate-100 hover:bg-slate-200 text-[#0B1F3A] rounded-md cursor-pointer"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    <span>تعديل</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleDeleteUser(t)}
                    aria-label={`حذف المدرس ${t.username}`}
                    className="p-1.5 text-red-600 hover:bg-red-50 rounded-md cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ===================================================================== */}
      {/* SUPERVISORS RBAC SECTION                                              */}
      {/* ===================================================================== */}
      <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-5">
        <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
          <Shield className="w-5 h-5 text-[#C59B27]" />
          <div>
            <h3 className="font-display text-base font-bold text-[#0B1F3A]">
              المشرفون الإداريون والصلاحيات
            </h3>
            <p className="text-xs text-slate-500">
              تخصيص صلاحيات الإداريين ومعاوني المدير لإدارة الطلاب والنتائج والإعدادات.
            </p>
          </div>
        </div>

        <form
          onSubmit={handleCreateSupervisor}
          className="border border-slate-200 rounded-lg p-4 space-y-4 bg-slate-50/50"
        >
          <h4 className="text-sm font-bold text-[#0B1F3A]">إضافة مشرف إداري جديد</h4>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <input
              type="text"
              dir="ltr"
              value={supUsername}
              onChange={(e) => setSupUsername(e.target.value)}
              placeholder="اسم المستخدم (مثال: supervisor1)"
              required
              className="px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white"
            />
            <input
              type="text"
              value={supFullName}
              onChange={(e) => setSupFullName(e.target.value)}
              placeholder="الاسم الكامل للمشرف"
              required
              className="px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white"
            />
            <input
              type="password"
              dir="ltr"
              minLength={6}
              value={supPassword}
              onChange={(e) => setSupPassword(e.target.value)}
              placeholder="كلمة مرور أولية (6+ أحرف)"
              required
              className="px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white"
            />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            {(Object.keys(PERMISSION_LABELS) as Array<keyof AdminPermissions>).map((key) => (
              <label key={key} className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={supPerms[key]}
                  onChange={(e) => setSupPerms({ ...supPerms, [key]: e.target.checked })}
                />
                <span>{PERMISSION_LABELS[key]}</span>
              </label>
            ))}
          </div>

          <button
            type="submit"
            className="inline-flex items-center gap-2 px-4 py-2 bg-[#0B1F3A] text-white text-xs font-bold rounded-lg hover:bg-[#1E4E8C] cursor-pointer"
          >
            <UserPlus className="w-4 h-4 text-[#C59B27]" />
            <span>إنشاء حساب المشرف</span>
          </button>
        </form>

        <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
          {supervisorsAndOwner.map((u) => (
            <div key={u.id} className="px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-sm">
              <div>
                <span className="font-bold text-[#0B1F3A]">{u.fullName}</span>
                <span dir="ltr" className="font-mono text-xs text-[#1E4E8C] mx-2 inline-block">
                  {u.username}
                </span>
                <span className="text-xs text-slate-500">
                  {u.role === 'owner' ? 'المالك الأساسي (المدير)' : 'مشرف إداري'} ·{' '}
                  {u.isActive ? 'نشط' : 'معطل'}
                </span>
              </div>
              {u.role !== 'owner' && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleToggleUserActive(u)}
                    className="px-3 py-1.5 text-xs font-bold bg-slate-100 hover:bg-slate-200 rounded-md cursor-pointer"
                  >
                    {u.isActive ? 'تعطيل' : 'تنشيط'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteUser(u)}
                    aria-label={`حذف المشرف ${u.username}`}
                    className="p-1.5 text-red-600 hover:bg-red-50 rounded-md cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
