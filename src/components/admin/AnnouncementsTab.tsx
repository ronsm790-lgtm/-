import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Copy,
  Link2,
  MessageSquareWarning,
  Pencil,
  Plus,
  Send,
  Trash2,
  X,
} from 'lucide-react';
import { apiFetch } from '../../lib/api.ts';
import type {
  Announcement,
  Exam,
  GradeObjection,
  PublishLink,
  SchoolClass,
  Section,
  Subject,
} from '../../types/school.ts';

interface AnnouncementsTabProps {
  announcements: Announcement[];
  classes: SchoolClass[];
  sections: Section[];
  subjects: Subject[];
  exams: Exam[];
  selectedYearId: number | null;
  canManage: boolean;
  canPublish: boolean;
  onChanged: () => void;
}

const STATUS_AR: Record<Announcement['status'], string> = {
  published: 'منشور',
  draft: 'مسودة',
  archived: 'مؤرشف',
};

const OBJECTION_STATUS_AR: Record<GradeObjection['status'], string> = {
  pending: 'قيد المراجعة',
  matching: 'مطابقة (تم التدقيق)',
  mismatching: 'غير مطابقة (تم التعديل)',
};

export function AnnouncementsTab({
  announcements,
  classes,
  sections,
  subjects,
  exams,
  selectedYearId,
  canManage,
  canPublish,
  onChanged,
}: AnnouncementsTabProps) {
  const [editing, setEditing] = useState<Announcement | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [publishDate, setPublishDate] = useState(new Date().toISOString().slice(0, 10));
  const [status, setStatus] = useState<Announcement['status']>('published');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Manual Publish Link & Announcement Generator
  const [genClassId, setGenClassId] = useState<string>(classes[0] ? String(classes[0].id) : '');
  const [genSectionId, setGenSectionId] = useState<string>('all');
  const [genExamIds, setGenExamIds] = useState<number[]>(exams[0] ? [exams[0].id] : []);
  const [genSubjectIds, setGenSubjectIds] = useState<number[]>([]);
  const [genCustomTitle, setGenCustomTitle] = useState('');
  const [genCreateAnn, setGenCreateAnn] = useState(true);
  const [generatingLink, setGeneratingLink] = useState(false);
  const [generatedOutput, setGeneratedOutput] = useState<{
    link: PublishLink;
    title: string;
    announcementBody: string;
    publishedSubjects: string[];
    publishedStudentsCount: number;
  } | null>(null);
  const [publishLinks, setPublishLinks] = useState<PublishLink[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Grade Objections Management
  const [objections, setObjections] = useState<GradeObjection[]>([]);
  const [loadingObj, setLoadingObj] = useState(false);
  const [publishingObj, setPublishingObj] = useState(false);
  const [resolvingId, setResolvingId] = useState<number | null>(null);
  const [objDrafts, setObjDrafts] = useState<
    Record<
      number,
      {
        status: 'matching' | 'mismatching';
        correctedScore: string;
        adminNote: string;
      }
    >
  >({});

  useEffect(() => {
    if (!genClassId && classes[0]) setGenClassId(String(classes[0].id));
  }, [classes, genClassId]);

  useEffect(() => {
    if (genExamIds.length === 0 && exams[0]) setGenExamIds([exams[0].id]);
  }, [exams, genExamIds.length]);

  const classSections = useMemo(
    () => sections.filter((s) => s.classId === Number(genClassId)),
    [sections, genClassId]
  );

  const classSubjects = useMemo(
    () =>
      subjects.filter(
        (sub) => sub.isActive && (sub.classId === null || sub.classId === Number(genClassId))
      ),
    [subjects, genClassId]
  );

  const loadLinksAndObjections = async () => {
    const qs = selectedYearId ? `?yearId=${selectedYearId}` : '';
    try {
      const [linksRes, objRes] = await Promise.all([
        apiFetch<{ links: PublishLink[] }>(`/api/admin/publish-links${qs}`),
        apiFetch<{ objections: GradeObjection[] }>(`/api/admin/objections${qs}`),
      ]);
      setPublishLinks(linksRes.links ?? []);
      setObjections(objRes.objections ?? []);
      const drafts: Record<
        number,
        { status: 'matching' | 'mismatching'; correctedScore: string; adminNote: string }
      > = {};
      for (const ob of objRes.objections ?? []) {
        drafts[ob.id] = {
          status: ob.status === 'mismatching' ? 'mismatching' : 'matching',
          correctedScore:
            ob.correctedScore !== null && ob.correctedScore !== undefined
              ? String(ob.correctedScore)
              : '',
          adminNote: ob.adminNote || '',
        };
      }
      setObjDrafts(drafts);
    } catch {
      // ignore non-fatal
    }
  };

  useEffect(() => {
    loadLinksAndObjections();
  }, [selectedYearId]);

  const buildShareUrl = (slug: string) => `${window.location.origin}/?pub=${slug}`;

  const copyText = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(key);
      setTimeout(() => setCopiedId((cur) => (cur === key ? null : cur)), 2500);
    } catch {
      setError('تعذر النسخ التلقائي — يمكنك التظليل والنسخ يدوياً.');
    }
  };

  const handleGeneratePublishLink = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (!genClassId || genExamIds.length === 0) {
      setError('يرجى اختيار الصف الدراسي وامتحان واحد على الأقل.');
      return;
    }
    setGeneratingLink(true);
    try {
      const res = await apiFetch<{
        link: PublishLink;
        title: string;
        announcementBody: string;
        publishedSubjects: string[];
        publishedStudentsCount: number;
        announcementCreated: boolean;
      }>('/api/admin/publish-links/generate', {
        method: 'POST',
        body: JSON.stringify({
          ...(selectedYearId ? { yearId: selectedYearId } : {}),
          classId: Number(genClassId),
          sectionId: genSectionId || 'all',
          examIds: genExamIds,
          subjectIds: genSubjectIds,
          createAnnouncement: genCreateAnn,
          customTitle: genCustomTitle.trim() || undefined,
        }),
      });
      setGeneratedOutput(res);
      setNotice(
        res.announcementCreated
          ? 'تم توليد الرابط وإنشاء الإعلان ونشره تلقائياً بناءً على الدرجات المنشورة فقط.'
          : 'تم توليد رابط النشر والصياغة بنجاح (اعتماداً على الدرجات المنشورة فقط).'
      );
      await loadLinksAndObjections();
      if (res.announcementCreated) onChanged();
    } catch (err: any) {
      setError(err?.message || 'تعذر توليد الرابط.');
    } finally {
      setGeneratingLink(false);
    }
  };

  const handleDeletePublishLink = async (id: number) => {
    setError(null);
    try {
      await apiFetch(`/api/admin/publish-links/${id}`, { method: 'DELETE' });
      if (generatedOutput?.link?.id === id) setGeneratedOutput(null);
      await loadLinksAndObjections();
    } catch (err: any) {
      setError(err?.message || 'تعذر حذف الرابط.');
    }
  };

  const handleResolveObjection = async (ob: GradeObjection) => {
    const draft = objDrafts[ob.id] ?? { status: 'matching', correctedScore: '', adminNote: '' };
    setError(null);
    setNotice(null);
    setResolvingId(ob.id);
    try {
      await apiFetch(`/api/admin/objections/${ob.id}/resolve`, {
        method: 'PUT',
        body: JSON.stringify({
          status: draft.status,
          ...(draft.status === 'mismatching'
            ? { correctedScore: Number(draft.correctedScore) }
            : {}),
          adminNote: draft.adminNote.trim(),
        }),
      });
      setNotice(`تم حفظ مراجعة الاعتراض للطالب (${ob.studentName}) بنجاح.`);
      await loadLinksAndObjections();
      onChanged();
    } catch (err: any) {
      setError(err?.message || 'تعذر حفظ نتيجة مراجعة الاعتراض.');
    } finally {
      setResolvingId(null);
    }
  };

  const handlePublishAllObjections = async () => {
    setError(null);
    setNotice(null);
    setPublishingObj(true);
    try {
      const res = await apiFetch<{ ok: boolean; publishedCount: number }>(
        '/api/admin/objections/publish',
        {
          method: 'POST',
          body: JSON.stringify({
            ...(selectedYearId ? { yearId: selectedYearId } : {}),
          }),
        }
      );
      setNotice(`تم نشر نتائج (${res.publishedCount}) اعتراض ليظهر إشعارها في بوابة الطلبة.`);
      await loadLinksAndObjections();
      onChanged();
    } catch (err: any) {
      setError(err?.message || 'تعذر نشر نتائج الاعتراضات.');
    } finally {
      setPublishingObj(false);
    }
  };

  const resetForm = () => {
    setEditing(null);
    setTitle('');
    setBody('');
    setPublishDate(new Date().toISOString().slice(0, 10));
    setStatus('published');
  };

  const startEdit = (a: Announcement) => {
    setEditing(a);
    setTitle(a.title);
    setBody(a.body);
    setPublishDate(a.publishDate);
    setStatus(a.status);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const payload = { title: title.trim(), body: body.trim(), publishDate, status };
      if (editing) {
        await apiFetch(`/api/admin/announcements/${editing.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
      } else {
        await apiFetch('/api/admin/announcements', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }
      resetForm();
      onChanged();
    } catch (err: any) {
      setError(err?.message || 'تعذر حفظ الإعلان.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    setError(null);
    try {
      await apiFetch(`/api/admin/announcements/${id}`, { method: 'DELETE' });
      onChanged();
    } catch (err: any) {
      setError(err?.message || 'تعذر حذف الإعلان.');
    }
  };

  const pendingObjCount = objections.filter((o) => o.status === 'pending').length;
  const resolvedUnpublishedCount = objections.filter(
    (o) => o.status !== 'pending' && !o.isPublished
  ).length;

  return (
    <div className="space-y-6">
      {notice && (
        <div role="status" className="flex items-center gap-2 p-3.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-900 text-sm">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{notice}</span>
        </div>
      )}
      {error && (
        <div role="alert" className="flex items-center gap-2 p-3.5 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* ===================================================================== */}
      {/* 1) MANUAL PUBLISH LINK & ANNOUNCEMENT GENERATOR                       */}
      {/* ===================================================================== */}
      {canManage && (
        <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2">
              <Link2 className="w-5 h-5 text-[#C59B27]" />
              <div>
                <h3 className="font-display text-base font-bold text-[#0B1F3A]">
                  مولد الإعلان ورابط النشرة الخاص (يدوياً)
                </h3>
                <p className="text-xs text-slate-500">
                  يفحص الدرجات <strong>المنشورة فقط</strong> في النطاق المحدد ويولد رابطاً مباشراً وصيغة إعلان جاهزة للمشاركة.
                </p>
              </div>
            </div>
          </div>

          <form onSubmit={handleGeneratePublishLink} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">الصف الدراسي</label>
                <select
                  value={genClassId}
                  onChange={(e) => {
                    setGenClassId(e.target.value);
                    setGenSectionId('all');
                    setGenSubjectIds([]);
                  }}
                  className="min-h-[44px] w-full px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white"
                >
                  {classes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">الشعبة</label>
                <select
                  value={genSectionId}
                  onChange={(e) => setGenSectionId(e.target.value)}
                  className="min-h-[44px] w-full px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white"
                >
                  <option value="all">جميع الشعب</option>
                  {classSections.map((s) => (
                    <option key={s.id} value={s.id}>
                      شعبة {s.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  عنوان مخصص للإعلان (اختياري)
                </label>
                <input
                  type="text"
                  value={genCustomTitle}
                  onChange={(e) => setGenCustomTitle(e.target.value)}
                  placeholder="يُولّد تلقائياً إذا تُرك فارغاً..."
                  className="min-h-[44px] w-full px-3 py-2 text-sm rounded-lg border border-slate-300"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-2">
                <p className="text-xs font-bold text-[#0B1F3A]">الامتحانات المشمولة في النشرة:</p>
                <div className="flex flex-wrap gap-2">
                  {exams.map((ex) => {
                    const checked = genExamIds.includes(ex.id);
                    return (
                      <label
                        key={ex.id}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded border text-xs font-semibold cursor-pointer ${
                          checked
                            ? 'bg-[#0B1F3A] text-white border-[#0B1F3A]'
                            : 'bg-white text-slate-700 border-slate-300'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setGenExamIds((prev) => [...prev, ex.id]);
                            } else {
                              setGenExamIds((prev) => prev.filter((id) => id !== ex.id));
                            }
                          }}
                          className="sr-only"
                        />
                        <span>{ex.name}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold text-[#0B1F3A]">
                    المواد المنشورة (اترك الكل غير محدد لتضمين كل مادة منشورة):
                  </p>
                  {genSubjectIds.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setGenSubjectIds([])}
                      className="text-[11px] font-bold text-[#1E4E8C] hover:underline cursor-pointer"
                    >
                      كل المواد المنشورة
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {classSubjects.map((sub) => {
                    const checked = genSubjectIds.includes(sub.id);
                    return (
                      <label
                        key={sub.id}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded border text-xs font-semibold cursor-pointer ${
                          checked
                            ? 'bg-[#1E4E8C] text-white border-[#1E4E8C]'
                            : 'bg-white text-slate-700 border-slate-300'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setGenSubjectIds((prev) => [...prev, sub.id]);
                            } else {
                              setGenSubjectIds((prev) => prev.filter((id) => id !== sub.id));
                            }
                          }}
                          className="sr-only"
                        />
                        <span>{sub.name}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={genCreateAnn}
                  onChange={(e) => setGenCreateAnn(e.target.checked)}
                />
                <span>نشر هذا النص تلقائياً كإعلان عام في البوابة عند التوليد</span>
              </label>

              <button
                type="submit"
                disabled={generatingLink}
                className="min-h-[44px] inline-flex items-center gap-2 px-5 py-2.5 bg-[#0B1F3A] hover:bg-[#1E4E8C] text-white text-xs font-bold rounded-lg cursor-pointer disabled:opacity-50"
              >
                <Link2 className="w-4 h-4 text-[#C59B27]" />
                <span>{generatingLink ? 'جاري الفحص والتوليد...' : 'توليد الرابط وصياغة الإعلان'}</span>
              </button>
            </div>
          </form>

          {generatedOutput && (
            <div className="bg-[#0B1F3A] text-white border border-[#C59B27] rounded-xl p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="text-xs font-bold text-[#C59B27]">
                    النشرة جاهزة ({generatedOutput.publishedStudentsCount} طالب —{' '}
                    {generatedOutput.publishedSubjects.join('، ')})
                  </span>
                  <h4 className="font-display font-bold text-sm mt-0.5">{generatedOutput.title}</h4>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => copyText('gen-link', buildShareUrl(generatedOutput.link.slug))}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#C59B27] text-[#0B1F3A] text-xs font-extrabold rounded-md cursor-pointer"
                  >
                    {copiedId === 'gen-link' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedId === 'gen-link' ? 'تم نسخ الرابط' : 'نسخ الرابط'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      copyText(
                        'gen-text',
                        `${generatedOutput.title}\n\n${generatedOutput.announcementBody}\n\nالرابط المباشر:\n${buildShareUrl(generatedOutput.link.slug)}`
                      )
                    }
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white text-xs font-bold rounded-md cursor-pointer"
                  >
                    {copiedId === 'gen-text' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedId === 'gen-text' ? 'تم نسخ النص' : 'نسخ نص الإعلان والرابط'}</span>
                  </button>
                </div>
              </div>
              <p dir="ltr" className="font-mono text-xs text-amber-200 break-all text-right">
                {buildShareUrl(generatedOutput.link.slug)}
              </p>
              <p className="text-xs text-slate-200 whitespace-pre-line leading-relaxed bg-white/5 p-3 rounded-lg">
                {generatedOutput.announcementBody}
              </p>
            </div>
          )}

          {publishLinks.length > 0 && (
            <div className="border-t border-slate-100 pt-3 space-y-2">
              <p className="text-xs font-bold text-slate-600">
                الروابط النشطة المنشورة ({publishLinks.length}):
              </p>
              <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg max-h-60 overflow-y-auto">
                {publishLinks.map((lnk) => (
                  <div
                    key={lnk.id}
                    className="px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs"
                  >
                    <div className="min-w-0">
                      <p className="font-bold text-[#0B1F3A]">{lnk.title}</p>
                      <p dir="ltr" className="font-mono text-[11px] text-slate-500 break-all text-right">
                        {buildShareUrl(lnk.slug)}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => copyText(`lnk-${lnk.id}`, buildShareUrl(lnk.slug))}
                        className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-100 hover:bg-slate-200 rounded font-bold text-[#0B1F3A] cursor-pointer"
                      >
                        {copiedId === `lnk-${lnk.id}` ? (
                          <Check className="w-3.5 h-3.5 text-emerald-700" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                        <span>نسخ</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeletePublishLink(lnk.id)}
                        aria-label={`حذف رابط ${lnk.title}`}
                        className="p-1.5 text-red-600 hover:bg-red-50 rounded cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {/* ===================================================================== */}
      {/* 2) OBJECTIONS MANAGEMENT SECTION                                      */}
      {/* ===================================================================== */}
      <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2.5">
            <MessageSquareWarning className="w-5 h-5 text-amber-600" />
            <div>
              <h3 className="font-display text-base font-bold text-[#0B1F3A]">
                إدارة اعتراضات الطلبة على الدرجات ({objections.length})
              </h3>
              <p className="text-xs text-slate-500">
                قيد المراجعة: <strong className="text-amber-700">{pendingObjCount}</strong> · مدققة بانتظار النشر:{' '}
                <strong className="text-[#1E4E8C]">{resolvedUnpublishedCount}</strong>
              </p>
            </div>
          </div>

          {canPublish && (
            <button
              type="button"
              disabled={publishingObj || objections.every((o) => o.status === 'pending' || o.isPublished)}
              onClick={handlePublishAllObjections}
              className="min-h-[44px] inline-flex items-center gap-2 px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold rounded-lg cursor-pointer disabled:opacity-50"
            >
              <Send className="w-4 h-4" />
              <span>
                {publishingObj ? 'جاري النشر...' : 'نشر نتائج الاعتراضات المدققة للطلبة'}
              </span>
            </button>
          )}
        </div>

        {loadingObj ? (
          <p className="text-xs text-slate-500">جاري تحميل الاعتراضات...</p>
        ) : objections.length === 0 ? (
          <p className="text-sm text-slate-500 p-4 text-center bg-slate-50 rounded-lg border border-dashed border-slate-200">
            لا توجد اعتراضات مقدمة من الطلبة في هذا العام الدراسي.
          </p>
        ) : (
          <div className="space-y-3">
            {objections.map((ob) => {
              const draft = objDrafts[ob.id] ?? {
                status: ob.status === 'mismatching' ? 'mismatching' : 'matching',
                correctedScore:
                  ob.correctedScore !== null && ob.correctedScore !== undefined
                    ? String(ob.correctedScore)
                    : '',
                adminNote: ob.adminNote || '',
              };
              return (
                <div
                  key={ob.id}
                  className={`border rounded-xl p-4 space-y-3 ${
                    ob.status === 'pending'
                      ? 'bg-amber-50/40 border-amber-200'
                      : ob.status === 'mismatching'
                        ? 'bg-emerald-50/40 border-emerald-200'
                        : 'bg-slate-50/60 border-slate-200'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-sm text-[#0B1F3A]">{ob.studentName}</span>
                      <span className="font-mono text-[#1E4E8C] bg-white px-2 py-0.5 rounded border border-slate-200">
                        {ob.inquiryCode}
                      </span>
                      <span className="text-slate-600 font-semibold">
                        {ob.className} {ob.sectionName ? `· شعبة ${ob.sectionName}` : ''}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`px-2.5 py-1 rounded font-bold border ${
                          ob.status === 'pending'
                            ? 'bg-amber-100 text-amber-900 border-amber-300'
                            : ob.status === 'mismatching'
                              ? 'bg-emerald-100 text-emerald-900 border-emerald-300'
                              : 'bg-blue-100 text-[#0B1F3A] border-blue-200'
                        }`}
                      >
                        {OBJECTION_STATUS_AR[ob.status]}
                      </span>
                      {ob.isPublished && (
                        <span className="px-2 py-1 rounded bg-emerald-700 text-white font-bold">
                          منشور للطالب
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="text-xs text-slate-700 bg-white border border-slate-200 rounded-lg p-3 space-y-1">
                    <p>
                      <strong>المادة:</strong> {ob.subjectName} · <strong>الامتحان:</strong> {ob.examName} ·{' '}
                      <strong>الدرجة المرصودة:</strong>{' '}
                      <span className="font-mono font-bold text-[#0B1F3A]">
                        {ob.recordedScore ?? '—'}
                      </span>
                    </p>
                    <p>
                      <strong>سبب الاعتراض:</strong> {ob.reason}
                    </p>
                  </div>

                  {canManage && (
                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end">
                      <div className="sm:col-span-3">
                        <label className="block text-[11px] font-bold text-slate-600 mb-1">
                          نتيجة الفحص
                        </label>
                        <select
                          value={draft.status}
                          onChange={(e) =>
                            setObjDrafts((prev) => ({
                              ...prev,
                              [ob.id]: {
                                ...draft,
                                status: e.target.value === 'mismatching' ? 'mismatching' : 'matching',
                              },
                            }))
                          }
                          className="min-h-[40px] w-full px-2.5 py-1.5 text-xs font-bold rounded-lg border border-slate-300 bg-white"
                        >
                          <option value="matching">مطابقة (الدرجة صحيحة)</option>
                          <option value="mismatching">غير مطابقة (تعديل الدرجة)</option>
                        </select>
                      </div>

                      {draft.status === 'mismatching' && (
                        <div className="sm:col-span-2">
                          <label className="block text-[11px] font-bold text-slate-600 mb-1">
                            الدرجة الصحيحة
                          </label>
                          <input
                            type="number"
                            min={0}
                            max={100}
                            step="0.5"
                            value={draft.correctedScore}
                            onChange={(e) =>
                              setObjDrafts((prev) => ({
                                ...prev,
                                [ob.id]: { ...draft, correctedScore: e.target.value },
                              }))
                            }
                            placeholder="مثال: 85"
                            className="min-h-[40px] w-full px-2.5 py-1.5 text-xs font-bold text-center rounded-lg border border-emerald-400 bg-white tabular-nums"
                          />
                        </div>
                      )}

                      <div className={draft.status === 'mismatching' ? 'sm:col-span-5' : 'sm:col-span-7'}>
                        <label className="block text-[11px] font-bold text-slate-600 mb-1">
                          ملاحظة اللجنة الامتحانية للطالب (اختياري)
                        </label>
                        <input
                          type="text"
                          value={draft.adminNote}
                          onChange={(e) =>
                            setObjDrafts((prev) => ({
                              ...prev,
                              [ob.id]: { ...draft, adminNote: e.target.value },
                            }))
                          }
                          placeholder="توضيح قرار التدقيق..."
                          className="min-h-[40px] w-full px-3 py-1.5 text-xs rounded-lg border border-slate-300 bg-white"
                        />
                      </div>

                      <div className="sm:col-span-2 flex justify-end">
                        <button
                          type="button"
                          disabled={resolvingId === ob.id}
                          onClick={() => handleResolveObjection(ob)}
                          className="min-h-[40px] w-full px-3 py-1.5 bg-[#0B1F3A] hover:bg-[#1E4E8C] text-white text-xs font-bold rounded-lg cursor-pointer disabled:opacity-50"
                        >
                          {resolvingId === ob.id ? 'جاري الحفظ...' : 'اعتماد التدقيق'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ===================================================================== */}
      {/* 3) GENERAL ANNOUNCEMENTS FORM & LIST                                  */}
      {/* ===================================================================== */}
      {canManage && (
        <form
          onSubmit={handleSubmit}
          className="bg-white border border-slate-200 rounded-xl p-5 space-y-4"
        >
          <div className="flex items-center justify-between">
            <h3 className="font-display text-base font-bold text-[#0B1F3A]">
              {editing ? 'تعديل الإعلان' : 'نشر إعلان مدرسي عام جديد'}
            </h3>
            {editing && (
              <button
                type="button"
                onClick={resetForm}
                className="text-slate-500 hover:text-slate-800 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-1">
              <label className="block text-xs font-bold text-slate-700 mb-1">العنوان</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                className="min-h-[44px] w-full px-3 py-2 text-sm rounded-lg border border-slate-300"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">تاريخ النشر</label>
              <input
                type="date"
                value={publishDate}
                onChange={(e) => setPublishDate(e.target.value)}
                required
                className="min-h-[44px] w-full px-3 py-2 text-sm rounded-lg border border-slate-300 tabular-nums"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">الحالة</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as Announcement['status'])}
                className="min-h-[44px] w-full px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white"
              >
                <option value="published">منشور للطلاب</option>
                <option value="draft">مسودة</option>
                <option value="archived">مؤرشف</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">نص الإعلان</label>
            <textarea
              rows={3}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              required
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300"
            />
          </div>

          <button
            type="submit"
            disabled={saving}
            className="min-h-[44px] inline-flex items-center gap-2 px-5 py-2.5 bg-[#0B1F3A] hover:bg-[#1E4E8C] text-white text-xs font-bold rounded-lg cursor-pointer disabled:opacity-50"
          >
            <Plus className="w-4 h-4 text-[#C59B27]" />
            <span>{saving ? 'جاري الحفظ...' : editing ? 'تحديث الإعلان' : 'حفظ الإعلان'}</span>
          </button>
        </form>
      )}

      <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
        {announcements.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">لا توجد إعلانات مسجلة.</div>
        ) : (
          announcements.map((a) => (
            <div key={a.id} className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-xs text-slate-500 tabular-nums">
                  <span className="font-bold text-[#1E4E8C]">{STATUS_AR[a.status]}</span>
                  <span>·</span>
                  <span>{a.publishDate}</span>
                  <span>·</span>
                  <span>{a.createdBy}</span>
                </div>
                <h4 className="font-display font-bold text-base text-[#0B1F3A]">{a.title}</h4>
                <p className="text-sm text-slate-700 whitespace-pre-line">{a.body}</p>
              </div>
              {canManage && (
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => startEdit(a)}
                    aria-label={`تعديل ${a.title}`}
                    className="p-2 text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(a.id)}
                    aria-label={`حذف ${a.title}`}
                    className="p-2 text-red-600 hover:bg-red-50 rounded-lg cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
