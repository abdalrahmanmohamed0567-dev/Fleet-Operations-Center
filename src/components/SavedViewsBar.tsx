import { Bookmark, Check, Plus, Trash2, Users } from 'lucide-react';
import { useState } from 'react';
import { deleteDoc, doc, serverTimestamp, setDoc } from 'firebase/firestore';
import type { SavedViewConfig, UserProfile } from '../types/fleet';
import { db } from '../lib/firebase';
import { Button, Input } from './ui/EnterpriseUI';

interface SavedViewsBarProps {
  scope: string;
  user: UserProfile;
  allowedUids: string[];
  savedViews: SavedViewConfig[];
  currentFilters: Record<string, unknown>;
  onApplyView: (filters: Record<string, unknown>) => void;
  onChanged?: () => void | Promise<void>;
}

export function SavedViewsBar({
  scope,
  user,
  allowedUids,
  savedViews,
  currentFilters,
  onApplyView,
  onChanged,
}: SavedViewsBarProps) {
  const [creating, setCreating] = useState(false);
  const [nameAr, setNameAr] = useState('');
  const [isShared, setIsShared] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activeViewId, setActiveViewId] = useState<string>('');

  const scopedViews = savedViews.filter(
    (v) => v.scope === scope && (v.isShared || v.ownerUid === user.uid)
  );

  const handleSave = async () => {
    if (!nameAr.trim()) return;
    setSaving(true);
    try {
      const viewId = `view_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const safeAllowed = isShared
        ? Array.from(new Set([user.uid, ...allowedUids].filter(Boolean))).slice(0, 20)
        : [user.uid];
      await setDoc(doc(db, 'savedViews', viewId), {
        viewId,
        scope,
        nameAr: nameAr.trim().slice(0, 120),
        filters: currentFilters,
        isShared,
        ownerUid: user.uid,
        ownerEmail: user.email,
        createdByUid: user.uid,
        allowedUids: safeAllowed,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setActiveViewId(viewId);
      setNameAr('');
      setCreating(false);
      await onChanged?.();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (view: SavedViewConfig) => {
    if (view.ownerUid !== user.uid && user.role !== 'owner' && user.role !== 'admin') return;
    await deleteDoc(doc(db, 'savedViews', view.viewId));
    if (activeViewId === view.viewId) setActiveViewId('');
    await onChanged?.();
  };

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/60 px-3 py-2">
      <div className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-600 dark:text-slate-300">
        <Bookmark className="h-3.5 w-3.5 text-blue-600" />
        <span>طرق العرض المحفوظة:</span>
      </div>

      {scopedViews.length === 0 && !creating && (
        <span className="text-[11px] text-slate-400">لا توجد عروض محفوظة بعد</span>
      )}

      {scopedViews.map((v) => {
        const isActive = activeViewId === v.viewId;
        const canRemove = v.ownerUid === user.uid || user.role === 'owner' || user.role === 'admin';
        return (
          <div
            key={v.viewId}
            className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-semibold transition-colors ${
              isActive
                ? 'border-blue-600 bg-blue-50 text-blue-800 dark:border-blue-500 dark:bg-blue-950/60 dark:text-blue-200'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'
            }`}
          >
            <button
              type="button"
              onClick={() => {
                setActiveViewId(v.viewId);
                onApplyView(v.filters || {});
              }}
              className="inline-flex items-center gap-1"
            >
              {isActive && <Check className="h-3 w-3" />}
              {v.isShared && <Users className="h-3 w-3 text-slate-400" />}
              <span>{v.nameAr}</span>
            </button>
            {canRemove && (
              <button
                type="button"
                onClick={() => void handleDelete(v)}
                className="text-slate-400 hover:text-red-600 mr-1"
                title="حذف العرض"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            )}
          </div>
        );
      })}

      {creating ? (
        <div className="flex flex-wrap items-center gap-2 mr-auto">
          <Input
            value={nameAr}
            onChange={(e) => setNameAr(e.target.value)}
            placeholder="اسم العرض (مثال: فرع الرياض - نشط)"
            className="h-7 w-48 text-xs"
          />
          <label className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
            <input
              type="checkbox"
              checked={isShared}
              onChange={(e) => setIsShared(e.target.checked)}
              className="rounded border-slate-300"
            />
            <span>مشاركة مع الفريق</span>
          </label>
          <Button size="sm" variant="accent" loading={saving} onClick={() => void handleSave()}>
            حفظ
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setCreating(false)}>
            إلغاء
          </Button>
        </div>
      ) : (
        <Button
          size="sm"
          variant="secondary"
          icon={<Plus className="h-3.5 w-3.5" />}
          onClick={() => setCreating(true)}
          className="mr-auto"
        >
          حفظ الفلاتر الحالية
        </Button>
      )}
    </div>
  );
}
