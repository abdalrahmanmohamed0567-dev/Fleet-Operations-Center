import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import type { BackupSchedulerConfig, SystemBackupSummary } from '../types/fleet.js';
import {
  ensureBootstrappedAdmin,
  exportAuthUsersForBackup,
  importAuthUsersFromBackup,
  type StoredAuthUser,
} from './authStore.js';
import {
  clearAllVaultAndBrandingFiles,
  exportVaultFilesBase64,
  restoreVaultFilesBase64,
  type VaultBackupFilesPayload,
} from './documentVault.js';
import {
  clearAllLocalCollections,
  exportAllLocalCollections,
  importAllLocalCollections,
  setLocalDoc,
} from './localStore.js';

const VAULT_ROOT = path.resolve(process.cwd(), process.env.PRIVATE_VAULT_DIR || '.private_vault');
const BACKUPS_ROOT = path.resolve(VAULT_ROOT, 'backups');
const SCHEDULER_STATE_FILE = path.resolve(BACKUPS_ROOT, 'scheduler_state.json');

export const FULL_BACKUP_FORMAT = 'fleet_ops_full_backup_v1';

export interface FullSystemBackupDocument {
  format: typeof FULL_BACKUP_FORMAT;
  version: '1.0';
  backupId: string;
  type: 'manual' | 'auto_daily' | 'pre_reset';
  exportedAt: string;
  createdBy: string;
  note?: string;
  collections: Record<string, Record<string, Record<string, unknown>>>;
  authUsers: StoredAuthUser[];
  vault: VaultBackupFilesPayload;
  checksum: string;
}

const DEFAULT_SCHEDULER_STATE: BackupSchedulerConfig = {
  enabled: true,
  hour: 1,
  minute: 0,
  timezone: 'Asia/Riyadh',
  retentionDays: 30,
  lastRunDate: '',
  lastRunAt: '',
  lastBackupId: '',
  lastStatus: 'مجدول تلقائيًا يوميًا الساعة 01:00 صباحًا',
};

function computeBackupChecksum(body: {
  collections: unknown;
  authUsers: unknown;
  vault: unknown;
}): string {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({ collections: body.collections, authUsers: body.authUsers, vault: body.vault }))
    .digest('hex');
}

function sanitizeBackupFileName(id: string): string {
  const clean = String(id || '').replace(/[^a-zA-Z0-9._-]/g, '_');
  if (!clean || clean.includes('..') || clean.startsWith('.')) {
    throw new Error('معرّف النسخة الاحتياطية غير صالح.');
  }
  return clean.endsWith('.json') ? clean : `${clean}.json`;
}

export async function readSchedulerConfig(): Promise<BackupSchedulerConfig> {
  await fs.mkdir(BACKUPS_ROOT, { recursive: true });
  try {
    const raw = await fs.readFile(SCHEDULER_STATE_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<BackupSchedulerConfig>;
    return { ...DEFAULT_SCHEDULER_STATE, ...parsed };
  } catch {
    return { ...DEFAULT_SCHEDULER_STATE };
  }
}

export async function writeSchedulerConfig(
  patch: Partial<BackupSchedulerConfig>
): Promise<BackupSchedulerConfig> {
  await fs.mkdir(BACKUPS_ROOT, { recursive: true });
  const current = await readSchedulerConfig();
  const next: BackupSchedulerConfig = {
    ...current,
    ...patch,
    hour: typeof patch.hour === 'number' ? Math.max(0, Math.min(23, Math.floor(patch.hour))) : current.hour,
    minute: typeof patch.minute === 'number' ? Math.max(0, Math.min(59, Math.floor(patch.minute))) : current.minute,
    retentionDays:
      typeof patch.retentionDays === 'number'
        ? Math.max(1, Math.min(365, Math.floor(patch.retentionDays)))
        : current.retentionDays,
  };
  await fs.writeFile(SCHEDULER_STATE_FILE, JSON.stringify(next, null, 2), { mode: 0o600 });
  return next;
}

export async function buildFullSystemBackup(params: {
  type: 'manual' | 'auto_daily' | 'pre_reset';
  createdBy: string;
  note?: string;
}): Promise<FullSystemBackupDocument> {
  await ensureBootstrappedAdmin(false);
  const [collections, authUsers, vault] = await Promise.all([
    exportAllLocalCollections(),
    exportAuthUsersForBackup(),
    exportVaultFilesBase64(),
  ]);
  const exportedAt = new Date().toISOString();
  const datePart = exportedAt.slice(0, 10);
  const rand = crypto.randomBytes(3).toString('hex');
  const backupId = `backup_${params.type}_${datePart}_${Date.now().toString(36)}_${rand}`;
  const checksum = computeBackupChecksum({ collections, authUsers, vault });

  return {
    format: FULL_BACKUP_FORMAT,
    version: '1.0',
    backupId,
    type: params.type,
    exportedAt,
    createdBy: params.createdBy,
    note: params.note,
    collections,
    authUsers,
    vault,
    checksum,
  };
}

export async function saveBackupToServer(doc: FullSystemBackupDocument): Promise<SystemBackupSummary> {
  await fs.mkdir(BACKUPS_ROOT, { recursive: true });
  const fileName = sanitizeBackupFileName(doc.backupId);
  const target = path.resolve(BACKUPS_ROOT, fileName);
  if (!target.startsWith(BACKUPS_ROOT + path.sep)) {
    throw new Error('مسار حفظ النسخة غير مصرح به.');
  }
  const serialized = JSON.stringify(doc, null, 2);
  await fs.writeFile(target, serialized, { mode: 0o600 });

  let totalDocuments = 0;
  for (const colMap of Object.values(doc.collections)) {
    totalDocuments += Object.keys(colMap || {}).length;
  }
  const vaultFileCount =
    Object.keys(doc.vault?.vaultFiles || {}).length + Object.keys(doc.vault?.brandingFiles || {}).length;

  return {
    backupId: doc.backupId,
    fileName,
    type: doc.type,
    createdAt: doc.exportedAt,
    createdBy: doc.createdBy,
    sizeBytes: Buffer.byteLength(serialized, 'utf-8'),
    totalDocuments,
    vaultFileCount,
    checksum: doc.checksum,
    note: doc.note,
  };
}

export async function listSavedServerBackups(): Promise<SystemBackupSummary[]> {
  await fs.mkdir(BACKUPS_ROOT, { recursive: true });
  const entries = await fs.readdir(BACKUPS_ROOT, { withFileTypes: true });
  const summaries: SystemBackupSummary[] = [];

  for (const ent of entries) {
    if (!ent.isFile() || !ent.name.endsWith('.json') || ent.name === 'scheduler_state.json') continue;
    const fullPath = path.resolve(BACKUPS_ROOT, ent.name);
    try {
      const stat = await fs.stat(fullPath);
      const raw = await fs.readFile(fullPath, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<FullSystemBackupDocument>;
      if (parsed.format !== FULL_BACKUP_FORMAT || !parsed.backupId) continue;
      let totalDocuments = 0;
      for (const colMap of Object.values(parsed.collections || {})) {
        totalDocuments += Object.keys(colMap || {}).length;
      }
      const vaultFileCount =
        Object.keys(parsed.vault?.vaultFiles || {}).length + Object.keys(parsed.vault?.brandingFiles || {}).length;
      summaries.push({
        backupId: parsed.backupId,
        fileName: ent.name,
        type: parsed.type || 'manual',
        createdAt: parsed.exportedAt || stat.mtime.toISOString(),
        createdBy: parsed.createdBy || 'system',
        sizeBytes: stat.size,
        totalDocuments,
        vaultFileCount,
        checksum: parsed.checksum || '',
        note: parsed.note,
      });
    } catch {
      // skip invalid file
    }
  }

  return summaries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function readSavedServerBackup(backupId: string): Promise<FullSystemBackupDocument> {
  const fileName = sanitizeBackupFileName(backupId);
  const target = path.resolve(BACKUPS_ROOT, fileName);
  if (!target.startsWith(BACKUPS_ROOT + path.sep)) {
    throw new Error('مسار النسخة الاحتياطية غير مصرح به.');
  }
  const raw = await fs.readFile(target, 'utf-8');
  return JSON.parse(raw) as FullSystemBackupDocument;
}

export async function deleteSavedServerBackup(backupId: string): Promise<void> {
  const fileName = sanitizeBackupFileName(backupId);
  const target = path.resolve(BACKUPS_ROOT, fileName);
  if (!target.startsWith(BACKUPS_ROOT + path.sep)) {
    throw new Error('مسار الحذف غير مصرح به.');
  }
  await fs.unlink(target);
}

export async function restoreFullSystemBackup(params: {
  payload: unknown;
  mode?: 'replace' | 'merge';
  actorLabel: string;
  actorUid: string;
}): Promise<{
  restoredCounts: Record<string, number>;
  restoredUsersCount: number;
  vaultFileCount: number;
  brandingFileCount: number;
}> {
  const raw = params.payload;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('ملف النسخة الاحتياطية غير صالح أو فارغ.');
  }

  const candidate = raw as Partial<FullSystemBackupDocument> & Record<string, unknown>;
  const mode = params.mode === 'merge' ? 'merge' : 'replace';

  if (candidate.format === FULL_BACKUP_FORMAT) {
    if (!candidate.collections || typeof candidate.collections !== 'object') {
      throw new Error('ملف النسخة الاحتياطية لا يحتوي على بيانات المجموعات.');
    }
    if (candidate.checksum) {
      const expected = computeBackupChecksum({
        collections: candidate.collections,
        authUsers: candidate.authUsers || [],
        vault: candidate.vault || { vaultFiles: {}, brandingFiles: {}, publicBranding: null },
      });
      if (expected !== candidate.checksum) {
        throw new Error('فشل التحقق من سلامة ملف النسخة الاحتياطية (Checksum mismatch). قد يكون الملف تالفًا أو معدّلًا.');
      }
    }

    const restoredCounts = await importAllLocalCollections(candidate.collections, mode);
    const restoredUsersCount = await importAuthUsersFromBackup(candidate.authUsers || [], mode);
    await ensureBootstrappedAdmin(false);

    const vaultRes = await restoreVaultFilesBase64(candidate.vault || {}, mode === 'replace');

    const logId = `log_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    await setLocalDoc('auditLogs', logId, {
      logId,
      action: 'SYSTEM_FULL_BACKUP_RESTORED',
      targetCollection: 'configSnapshots',
      targetId: candidate.backupId || 'uploaded_json',
      entityType: 'system_backup',
      actorUid: params.actorUid,
      actorEmail: params.actorLabel,
      details: `استعادة نسخة احتياطية كاملة (${candidate.backupId || 'ملف مستورد'}) بنمط ${mode === 'replace' ? 'استبدال مطابق' : 'دمج'}`,
      source: 'API',
      allowedUids: [params.actorUid],
      createdAt: new Date().toISOString(),
    });

    return {
      restoredCounts,
      restoredUsersCount,
      vaultFileCount: vaultRes.vaultCount,
      brandingFileCount: vaultRes.brandingCount,
    };
  }

  // Fallback compatibility for legacy config-only bundles
  const legacyCollections: Record<string, unknown> = {};
  const legacyKeys = [
    'systemSections',
    'systemPages',
    'dynamicFields',
    'dynamicForms',
    'notificationRules',
    'customReportTemplates',
    'roleTemplates',
  ];
  let foundLegacy = false;
  for (const k of legacyKeys) {
    if (Array.isArray(candidate[k])) {
      legacyCollections[k] = candidate[k];
      foundLegacy = true;
    }
  }
  if (!foundLegacy) {
    throw new Error('صيغة ملف النسخة الاحتياطية غير معروفة. يرجى استخدام ملف نسخة احتياطية صادر عن النظام.');
  }
  const restoredCounts = await importAllLocalCollections(legacyCollections, 'merge');
  return {
    restoredCounts,
    restoredUsersCount: 0,
    vaultFileCount: 0,
    brandingFileCount: 0,
  };
}

export async function performFactorySystemReset(params: {
  actorLabel: string;
}): Promise<{ clearedCollections: string[]; resetAt: string; adminPhone: string }> {
  const clearedCollections = await clearAllLocalCollections();
  await clearAllVaultAndBrandingFiles();
  const { resetAuthUsersToFactoryAdmin } = await import('./authStore.js');
  const admin = await resetAuthUsersToFactoryAdmin();

  const resetAt = new Date().toISOString();
  const logId = `log_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  await setLocalDoc('auditLogs', logId, {
    logId,
    action: 'SYSTEM_FACTORY_RESET',
    targetCollection: 'operationalSettings',
    targetId: 'factory_reset',
    entityType: 'system',
    actorUid: admin.uid,
    actorEmail: params.actorLabel,
    details: 'تنفيذ إعادة ضبط كامل للنظام ومسح جميع البيانات وإعادة تهيئة حساب المدير العام فقط',
    source: 'API',
    allowedUids: [admin.uid],
    createdAt: resetAt,
  });

  return {
    clearedCollections,
    resetAt,
    adminPhone: admin.phone,
  };
}

function getZonedTimeParts(date: Date, timeZone: string): { dateStr: string; hour: number; minute: number } {
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const parts = fmt.formatToParts(date);
    const get = (type: string) => parts.find((p) => p.type === type)?.value || '00';
    const year = get('year');
    const month = get('month');
    const day = get('day');
    const hourRaw = Number(get('hour'));
    const hour = hourRaw === 24 ? 0 : hourRaw;
    const minute = Number(get('minute'));
    return { dateStr: `${year}-${month}-${day}`, hour, minute };
  } catch {
    return {
      dateStr: date.toISOString().slice(0, 10),
      hour: date.getUTCHours(),
      minute: date.getUTCMinutes(),
    };
  }
}

async function pruneExpiredAutoBackups(retentionDays: number): Promise<void> {
  const cutoffMs = Date.now() - retentionDays * 86400000;
  const list = await listSavedServerBackups();
  for (const item of list) {
    if (item.type !== 'auto_daily') continue;
    const ts = Date.parse(item.createdAt);
    if (!Number.isNaN(ts) && ts < cutoffMs) {
      await deleteSavedServerBackup(item.backupId).catch(() => {});
    }
  }
}

let schedulerTimer: NodeJS.Timeout | null = null;
let schedulerRunning = false;

export function startDailyBackupScheduler(): void {
  if (schedulerTimer) return;

  const tick = async () => {
    if (schedulerRunning) return;
    schedulerRunning = true;
    try {
      const cfg = await readSchedulerConfig();
      if (!cfg.enabled) return;

      const now = new Date();
      const { dateStr, hour, minute } = getZonedTimeParts(now, cfg.timezone || 'Asia/Riyadh');

      // Trigger once per day during the configured 01:00 AM window (hour === 1 && minute >= cfg.minute)
      if (hour === cfg.hour && minute >= cfg.minute && cfg.lastRunDate !== dateStr) {
        const backupDoc = await buildFullSystemBackup({
          type: 'auto_daily',
          createdBy: 'auto_scheduler_01am',
          note: `نسخة احتياطية يومية تلقائية (${dateStr} · 01:00 صباحًا)`,
        });
        const summary = await saveBackupToServer(backupDoc);

        const logId = `log_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
        await setLocalDoc('auditLogs', logId, {
          logId,
          action: 'SYSTEM_AUTO_DAILY_BACKUP',
          targetCollection: 'configSnapshots',
          targetId: summary.backupId,
          entityType: 'system_backup',
          actorUid: 'owner_0559786939',
          actorEmail: 'auto_scheduler@system',
          details: `حفظ النسخة الاحتياطية اليومية التلقائية (${summary.fileName}) — ${summary.totalDocuments} سجل`,
          source: 'System',
          allowedUids: ['owner_0559786939'],
          createdAt: new Date().toISOString(),
        });

        await writeSchedulerConfig({
          lastRunDate: dateStr,
          lastRunAt: new Date().toISOString(),
          lastBackupId: summary.backupId,
          lastStatus: `نجح آخر نسخ تلقائي بتاريخ ${dateStr} (${summary.totalDocuments} سجل)`,
        });

        await pruneExpiredAutoBackups(cfg.retentionDays || 30);
      }
    } catch (err) {
      await writeSchedulerConfig({
        lastStatus: `فشل النسخ التلقائي: ${err instanceof Error ? err.message : 'خطأ غير متوقع'}`,
      }).catch(() => {});
    } finally {
      schedulerRunning = false;
    }
  };

  // Run initial check shortly after boot, then every 30s
  setTimeout(() => {
    void tick();
  }, 4000);
  schedulerTimer = setInterval(() => {
    void tick();
  }, 30000);
  schedulerTimer.unref();
}
