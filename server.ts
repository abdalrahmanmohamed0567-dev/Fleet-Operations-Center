import crypto from 'crypto';
import dotenv from 'dotenv';
import express, { type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import type {
  GranularCapability,
  ImportPreviewResult,
  PermissionAction,
  PermissionModule,
  PrivateDocumentRecord,
} from './src/types/fleet.js';
import {
  deletePrivateVaultFile,
  getPrivateVaultStats,
  readBrandingLogoFile,
  readBrandingPublicMetadata,
  readPrivateVaultFile,
  saveBrandingLogoFile,
  saveBrandingPublicMetadata,
  savePrivateVaultFile,
} from './src/server/documentVault.js';
import { parseExcelBuffer, type ParsedWorkbookOutput } from './src/server/excelParser.js';
import { buildExcelReportBuffer, type ExportColumn } from './src/server/exportEngine.js';
import {
  batchCheckExisting,
  commitFirestoreWrites,
  deleteFirestoreDoc,
  extractAffectedDates,
  getFirestoreDoc,
  isKeetaEnabledOnServer,
  listFirestoreCollection,
  recomputeSummariesForDates,
  verifyUserFromToken,
  type VerifiedAuthUser,
  type WriteOperation,
} from './src/server/firestoreRest.js';
import {
  isServerSessionToken,
  authenticateByPhonePassword,
  changeOwnPassword,
  createUserAccount,
  deleteUserAccount,
  ensureBootstrappedAdmin,
  getUserProfileByUid,
  signSessionToken,
  toPublicUserProfile,
  updateUserAccount,
} from './src/server/authStore.js';
import {
  buildFullSystemBackup,
  deleteSavedServerBackup,
  listSavedServerBackups,
  performFactorySystemReset,
  readSavedServerBackup,
  readSchedulerConfig,
  restoreFullSystemBackup,
  saveBackupToServer,
  startDailyBackupScheduler,
  writeSchedulerConfig,
} from './src/server/backupService.js';
import {
  commitLocalBatch,
  deleteLocalDoc,
  getCollectionCounts,
  getLocalDoc,
  isValidCollectionName,
  isValidDocId,
  queryLocalCollection,
  setLocalDoc,
  updateLocalDoc,
  type LocalBatchOp,
  type QueryFilterClause,
} from './src/server/localStore.js';
import { matchesDataScope } from './src/shared/rbacCore.js';
import {
  approvePendingReturnTransactional,
  attachDelegationToApprovalTransactional,
  cancelFleetApprovalTransactional,
  completeMaintenanceWorkOrderTransactional,
  createMaintenanceWorkOrderTransactional,
  createVehicleTransactional,
  decideAdminApprovalTransactional,
  decideOperationsApprovalTransactional,
  decideVehicleDocumentTransactional,
  executeVehicleHandoverTransactional,
  executeVehicleReturnTransactional,
  getFleetAvailabilityMatrix,
  getScopedFleetOverview,
  getVehicleProfile360,
  hasFleetPermOnUser,
  isVehicleInUserScope,
  markFleetNotificationsReadTransactional,
  requestVehicleAssignmentTransactional,
  runSafeFleetPhase1Migration,
  transferVehicleCustodyTransactional,
  transitionVehicleStatusTransactional,
  updateDamageClaimTransactional,
  updateFleetConfigTransactional,
  updateVehicleTransactional,
  upsertVehicleDocumentTransactional,
  type CreateMaintenanceInput,
  type CreateVehicleInput,
  type ExecuteHandoverInput,
  type ExecuteReturnInput,
  type RequestVehicleAssignmentInput,
} from './src/server/fleetService.js';

const SERVER_ONLY_IMMUTABLE_COLLECTIONS = new Set<string>([
  'vehicleStatusHistory',
  'vehicleMovementHistory',
  'idempotencyKeys',
]);

dotenv.config();

const SYSTEM_RESET_MASTER_PASSWORD = process.env.SYSTEM_RESET_PASSWORD || '4627257';

function verifySystemResetPassword(candidate: string): boolean {
  const expectedBuf = Buffer.from(SYSTEM_RESET_MASTER_PASSWORD, 'utf8');
  const providedBuf = Buffer.from(String(candidate || ''), 'utf8');
  if (expectedBuf.length !== providedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, providedBuf);
}

function checkDbCollectionPermission(
  user: VerifiedAuthUser,
  collection: string,
  mode: 'read' | 'write'
): boolean {
  if (user.role === 'owner' || user.role === 'admin' || user.customRoleId === 'super_admin') {
    return true;
  }

  if (mode === 'read') {
    if (
      [
        'roleTemplates',
        'operationalSettings',
        'platformCatalog',
        'companyBranding',
        'systemSections',
        'systemPages',
        'dynamicFields',
        'dynamicForms',
        'dynamicFormVersions',
        'notificationRules',
        'documentTypes',
        'savedViews',
        'userPreferences',
      ].includes(collection)
    ) {
      return true;
    }
    if (collection === 'users') {
      return hasServerPermission(user, 'users', 'view') || hasServerPermission(user, 'operations', 'view');
    }
    if (collection === 'auditLogs') {
      return hasServerPermission(user, 'audit', 'view') || hasServerPermission(user, 'executive', 'view');
    }
    if (collection === 'trashItems') {
      return hasServerPermission(user, 'trash', 'view') || hasServerCapability(user, 'restore');
    }
    if (collection === 'configSnapshots') {
      return hasServerPermission(user, 'builder', 'view') || hasServerCapability(user, 'manage_settings');
    }
    if (collection === 'customReportTemplates') {
      return hasServerPermission(user, 'reports', 'view');
    }
    if (collection === 'privateDocuments') {
      return (
        hasServerPermission(user, 'documents', 'view') ||
        hasServerPermission(user, 'hr', 'view') ||
        hasServerPermission(user, 'fleet', 'view') ||
        hasFleetPermOnUser(user, 'fleet.documents.view')
      );
    }
    if (
      [
        'vehicles',
        'vehicleAssignments',
        'vehicleMaintenance',
        'vehicleCustodies',
        'vehicleHandovers',
        'vehicleReturns',
        'vehicleStatusHistory',
        'vehicleMovementHistory',
        'fleetApprovalRequests',
        'vehicleDocuments',
        'vehicleDamageClaims',
        'fleetNotifications',
      ].includes(collection)
    ) {
      return (
        hasServerPermission(user, 'fleet', 'view') ||
        hasServerPermission(user, 'operations', 'view') ||
        hasFleetPermOnUser(user, 'fleet.view')
      );
    }
    if (collection === 'idempotencyKeys') {
      return false;
    }
    if (['riderMaster', 'riderIdentityMapping'].includes(collection)) {
      return (
        hasServerPermission(user, 'hr', 'view') ||
        hasServerPermission(user, 'operations', 'view') ||
        hasServerPermission(user, 'applications', 'view') ||
        hasServerPermission(user, 'fleet', 'view') ||
        hasServerPermission(user, 'executive', 'view')
      );
    }
    if (collection === 'platformAccounts') {
      return (
        hasServerPermission(user, 'applications', 'view') ||
        hasServerPermission(user, 'hr', 'view') ||
        hasServerPermission(user, 'operations', 'view')
      );
    }
    if (collection === 'customEntityRecords') {
      return hasServerPermission(user, 'operations', 'view') || hasServerPermission(user, 'builder', 'view');
    }
    return (
      hasServerPermission(user, 'operations', 'view') ||
      hasServerPermission(user, 'executive', 'view') ||
      hasServerPermission(user, 'reports', 'view') ||
      hasServerPermission(user, 'alerts', 'view') ||
      hasServerPermission(user, 'applications', 'view')
    );
  }

  // Write permissions
  switch (collection) {
    case 'users':
      return hasServerPermission(user, 'users', 'edit') || hasServerPermission(user, 'users', 'add');
    case 'roleTemplates':
      return hasServerPermission(user, 'roles', 'edit') || hasServerPermission(user, 'roles', 'add');
    case 'operationalSettings':
      return hasServerPermission(user, 'settings', 'edit') || hasServerCapability(user, 'manage_settings');
    case 'platformCatalog':
      return hasServerPermission(user, 'platforms', 'edit') || hasServerPermission(user, 'applications', 'edit');
    case 'companyBranding':
      return (
        hasServerPermission(user, 'branding', 'edit') ||
        hasServerPermission(user, 'company', 'edit') ||
        hasServerCapability(user, 'change_branding') ||
        hasServerCapability(user, 'manage_company')
      );
    case 'systemSections':
    case 'systemPages':
      return hasServerPermission(user, 'builder', 'edit') || hasServerCapability(user, 'manage_sections');
    case 'dynamicFields':
      return (
        hasServerPermission(user, 'builder', 'edit') ||
        hasServerCapability(user, 'create_fields') ||
        hasServerCapability(user, 'edit_fields')
      );
    case 'dynamicForms':
    case 'dynamicFormVersions':
      return hasServerPermission(user, 'builder', 'edit') || hasServerCapability(user, 'manage_forms');
    case 'notificationRules':
    case 'configSnapshots':
      return hasServerPermission(user, 'builder', 'edit') || hasServerCapability(user, 'manage_settings');
    case 'trashItems':
      return (
        hasServerPermission(user, 'trash', 'edit') ||
        hasServerPermission(user, 'trash', 'delete') ||
        hasServerCapability(user, 'restore') ||
        hasServerCapability(user, 'archive')
      );
    case 'savedViews':
    case 'userPreferences':
      return true;
    case 'auditLogs':
      return true;
    case 'customReportTemplates':
      return hasServerPermission(user, 'reports', 'add') || hasServerPermission(user, 'reports', 'edit');
    case 'documentTypes':
    case 'privateDocuments':
      return (
        hasServerPermission(user, 'documents', 'add') ||
        hasServerPermission(user, 'documents', 'edit') ||
        hasServerPermission(user, 'documents', 'delete') ||
        hasServerPermission(user, 'hr', 'edit')
      );
    case 'riderMaster':
    case 'riderIdentityMapping':
      return (
        hasServerPermission(user, 'hr', 'add') ||
        hasServerPermission(user, 'hr', 'edit') ||
        hasServerPermission(user, 'hr', 'delete') ||
        hasServerPermission(user, 'applications', 'edit') ||
        hasServerPermission(user, 'operations', 'edit')
      );
    case 'platformAccounts':
      return (
        hasServerPermission(user, 'applications', 'add') ||
        hasServerPermission(user, 'applications', 'edit') ||
        hasServerPermission(user, 'applications', 'delete')
      );
    case 'vehicles':
    case 'vehicleAssignments':
    case 'vehicleMaintenance':
      return (
        hasServerPermission(user, 'fleet', 'add') ||
        hasServerPermission(user, 'fleet', 'edit') ||
        hasServerPermission(user, 'fleet', 'delete') ||
        hasFleetPermOnUser(user, 'fleet.create') ||
        hasFleetPermOnUser(user, 'fleet.edit')
      );
    case 'vehicleCustodies':
    case 'vehicleHandovers':
      return hasFleetPermOnUser(user, 'fleet.handover.create') || hasFleetPermOnUser(user, 'fleet.handover.approve');
    case 'vehicleReturns':
      return hasFleetPermOnUser(user, 'fleet.return.create') || hasFleetPermOnUser(user, 'fleet.return.approve');
    case 'fleetApprovalRequests':
      return (
        hasFleetPermOnUser(user, 'fleet.assignment.request') ||
        hasFleetPermOnUser(user, 'fleet.assignment.operations_approve') ||
        hasFleetPermOnUser(user, 'fleet.assignment.admin_approve')
      );
    case 'vehicleDocuments':
      return hasFleetPermOnUser(user, 'fleet.documents.upload') || hasFleetPermOnUser(user, 'fleet.documents.approve');
    case 'vehicleDamageClaims':
      return hasFleetPermOnUser(user, 'fleet.maintenance.create') || hasFleetPermOnUser(user, 'fleet.maintenance.approve');
    case 'fleetNotifications':
      return hasFleetPermOnUser(user, 'fleet.view');
    case 'vehicleStatusHistory':
    case 'vehicleMovementHistory':
    case 'idempotencyKeys':
      return false;
    case 'entityNotesTasks':
    case 'operationalCases':
    case 'riderNotes':
    case 'customEntityRecords':
    case 'hungerErrorDictionary':
    case 'hungerRiderErrorCases':
      return (
        hasServerPermission(user, 'operations', 'add') ||
        hasServerPermission(user, 'operations', 'edit') ||
        hasServerPermission(user, 'operations', 'delete') ||
        hasServerPermission(user, 'executive', 'edit')
      );
    default:
      return hasServerPermission(user, 'operations', 'add') || hasServerPermission(user, 'operations', 'edit');
  }
}

interface CachedPreview {
  createdAtMs: number;
  uid: string;
  parsedList: ParsedWorkbookOutput[];
  previewResults: ImportPreviewResult[];
}

const previewCache = new Map<string, CachedPreview>();

function cleanupPreviewCache() {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [key, val] of previewCache.entries()) {
    if (val.createdAtMs < cutoff) {
      previewCache.delete(key);
    }
  }
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 35 * 1024 * 1024, files: 10 },
});

const docUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
});

interface AuthedRequest extends Request {
  authUser?: VerifiedAuthUser;
  idToken?: string;
}

function hasServerPermission(user: VerifiedAuthUser, module: PermissionModule, action: PermissionAction): boolean {
  return Boolean(user.permissions?.[module]?.[action]);
}

function hasServerCapability(user: VerifiedAuthUser, cap: GranularCapability): boolean {
  return Boolean(user.capabilities?.[cap]);
}

async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (!token) {
      res.status(401).json({ error: 'مطلوب تسجيل الدخول للوصول إلى هذه الخدمة.' });
      return;
    }
    const verified = await verifyUserFromToken(token);
    if (!verified.active) {
      res.status(403).json({ error: 'حسابك بانتظار التفعيل من قِبل مدير النظام.' });
      return;
    }
    req.authUser = verified;
    req.idToken = token;
    next();
  } catch (err) {
    res.status(401).json({ error: err instanceof Error ? err.message : 'فشل التحقق من الهوية.' });
  }
}

async function getTeamAllowedUids(callerUid: string, idToken: string): Promise<string[]> {
  try {
    const users = await listFirestoreCollection('users', idToken, 100);
    const activeUids = users
      .filter((u) => Boolean(u.active) && typeof u.uid === 'string')
      .map((u) => String(u.uid));
    const set = new Set<string>([callerUid, ...activeUids]);
    return Array.from(set).slice(0, 20);
  } catch {
    return [callerUid];
  }
}

async function startServer() {
  await ensureBootstrappedAdmin(false);
  await runSafeFleetPhase1Migration({
    actorUid: 'owner_0559786939',
    actorEmail: 'system@fleetops.local',
    createPreMigrationBackup: false,
  }).catch((err) => {
    console.warn('Initial fleet migration check failed:', err);
  });
  startDailyBackupScheduler();

  const app = express();
  app.use(express.json({ limit: '50mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'fleet-operations-center' });
  });

  // ==========================================
  // PHONE + PASSWORD AUTHENTICATION ROUTES
  // ==========================================
  app.post('/api/auth/login', async (req: Request, res: Response) => {
    try {
      const phone = String(req.body?.phone || '');
      const password = String(req.body?.password || '');
      const result = await authenticateByPhonePassword(phone, password);
      res.json({ ok: true, token: result.token, profile: result.profile });
    } catch (err) {
      res.status(401).json({ error: err instanceof Error ? err.message : 'فشل تسجيل الدخول.' });
    }
  });

  app.get('/api/auth/me', requireAuth, async (req: AuthedRequest, res: Response) => {
    try {
      const profile = await getUserProfileByUid(req.authUser!.uid);
      if (!profile) {
        res.status(404).json({ error: 'ملف المستخدم غير موجود.' });
        return;
      }
      res.json({ ok: true, profile });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'تعذر قراءة الجلسة.' });
    }
  });

  app.post('/api/auth/logout', (_req, res) => {
    res.json({ ok: true });
  });

  app.post('/api/auth/change-password', requireAuth, async (req: AuthedRequest, res: Response) => {
    try {
      const currentPassword = String(req.body?.currentPassword || '');
      const newPassword = String(req.body?.newPassword || '');
      await changeOwnPassword(req.authUser!.uid, currentPassword, newPassword);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'فشل تغيير كلمة المرور.' });
    }
  });

  // ==========================================
  // USER ACCOUNTS MANAGEMENT ROUTES
  // ==========================================
  app.post('/api/users', requireAuth, async (req: AuthedRequest, res: Response) => {
    try {
      const actor = req.authUser!;
      if (!hasServerPermission(actor, 'users', 'add') && actor.role !== 'owner' && actor.role !== 'admin') {
        res.status(403).json({ error: 'صلاحياتك لا تسمح بإضافة مستخدمين جدد.' });
        return;
      }
      const created = await createUserAccount({
        displayName: String(req.body?.displayName || ''),
        phone: String(req.body?.phone || ''),
        password: String(req.body?.password || ''),
        email: req.body?.email ? String(req.body.email) : undefined,
        customRoleId: String(req.body?.customRoleId || 'reports_viewer'),
        active: req.body?.active !== false,
        dataScope: req.body?.dataScope,
        allowedPlatforms: req.body?.allowedPlatforms,
        actorUid: actor.uid,
      });

      const logId = `log_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      await setLocalDoc('auditLogs', logId, {
        logId,
        action: 'USER_CREATED',
        targetCollection: 'users',
        targetId: created.uid,
        entityType: 'user',
        actorUid: actor.uid,
        actorEmail: actor.email,
        details: `إضافة مستخدم جديد: ${created.displayName} (جوال: ${created.phone}) بالدور ${created.customRoleId || created.role}`,
        newValue: created.customRoleId || created.role,
        source: 'API',
        allowedUids: [actor.uid],
        createdAt: new Date().toISOString(),
      }).catch(() => {});

      res.status(201).json({ ok: true, user: created });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'تعذر إنشاء المستخدم.' });
    }
  });

  app.patch('/api/users/:uid', requireAuth, async (req: AuthedRequest, res: Response) => {
    try {
      const actor = req.authUser!;
      if (!hasServerPermission(actor, 'users', 'edit') && actor.role !== 'owner' && actor.role !== 'admin') {
        res.status(403).json({ error: 'صلاحياتك لا تسمح بتعديل حسابات المستخدمين.' });
        return;
      }
      const uid = String(req.params.uid || '').trim();
      const updated = await updateUserAccount(uid, {
        displayName: req.body?.displayName,
        phone: req.body?.phone,
        email: req.body?.email,
        password: req.body?.password,
        customRoleId: req.body?.customRoleId,
        role: req.body?.role,
        active: req.body?.active,
        allowedPlatforms: req.body?.allowedPlatforms,
        dataScope: req.body?.dataScope,
        permissionOverrides: req.body?.permissionOverrides,
        capabilityOverrides: req.body?.capabilityOverrides,
        fleetPermissionOverrides: req.body?.fleetPermissionOverrides,
      });

      const logId = `log_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      await setLocalDoc('auditLogs', logId, {
        logId,
        action: 'USER_UPDATED',
        targetCollection: 'users',
        targetId: uid,
        entityType: 'user',
        actorUid: actor.uid,
        actorEmail: actor.email,
        details: `تحديث بيانات/صلاحيات المستخدم: ${updated.displayName} (${updated.phone || updated.email})`,
        source: 'API',
        allowedUids: [actor.uid],
        createdAt: new Date().toISOString(),
      }).catch(() => {});

      res.json({ ok: true, user: updated });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'تعذر تحديث المستخدم.' });
    }
  });

  app.delete('/api/users/:uid', requireAuth, async (req: AuthedRequest, res: Response) => {
    try {
      const actor = req.authUser!;
      if (!hasServerPermission(actor, 'users', 'delete') && actor.role !== 'owner' && actor.role !== 'admin') {
        res.status(403).json({ error: 'صلاحياتك لا تسمح بحذف المستخدمين.' });
        return;
      }
      const uid = String(req.params.uid || '').trim();
      const targetProfile = await getUserProfileByUid(uid);
      await deleteUserAccount(uid, actor.uid);
      await deleteLocalDoc('users', uid);

      const logId = `log_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      await setLocalDoc('auditLogs', logId, {
        logId,
        action: 'USER_DELETED',
        targetCollection: 'users',
        targetId: uid,
        entityType: 'user',
        actorUid: actor.uid,
        actorEmail: actor.email,
        details: `حذف حساب المستخدم: ${targetProfile?.displayName || uid} (${targetProfile?.phone || targetProfile?.email || '-'})`,
        source: 'API',
        allowedUids: [actor.uid],
        createdAt: new Date().toISOString(),
      }).catch(() => {});

      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'تعذر حذف المستخدم.' });
    }
  });

  // ==========================================
  // RBAC-CHECKED LOCAL STORE DATABASE APIs (/api/db/*)
  // ==========================================
  app.get('/api/db/doc/:collection/:docId', requireAuth, async (req: AuthedRequest, res: Response) => {
    try {
      const actor = req.authUser!;
      const col = String(req.params.collection || '');
      const docId = String(req.params.docId || '');
      if (!isValidCollectionName(col) || !isValidDocId(docId)) {
        res.status(400).json({ error: 'معرّف المجموعة أو السجل غير صالح.' });
        return;
      }
      const isSelfUserDoc = col === 'users' && docId === actor.uid;
      if (!isSelfUserDoc && !checkDbCollectionPermission(actor, col, 'read')) {
        res.status(403).json({ error: `صلاحياتك لا تسمح بقراءة سجلات ${col}.` });
        return;
      }
      const docData = await getLocalDoc(col, docId);
      res.json({ exists: Boolean(docData), id: docId, data: docData || null });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'تعذر قراءة السجل.' });
    }
  });

  app.post('/api/db/doc/:collection/:docId', requireAuth, async (req: AuthedRequest, res: Response) => {
    try {
      const actor = req.authUser!;
      const col = String(req.params.collection || '');
      const docId = String(req.params.docId || '');
      if (!isValidCollectionName(col) || !isValidDocId(docId)) {
        res.status(400).json({ error: 'معرّف المجموعة أو السجل غير صالح.' });
        return;
      }
      if (SERVER_ONLY_IMMUTABLE_COLLECTIONS.has(col)) {
        res.status(403).json({ error: `المجموعة (${col}) محمية وتُدار حصريًا من الخادم ولا يمكن الكتابة فيها مباشرة.` });
        return;
      }
      if (!checkDbCollectionPermission(actor, col, 'write')) {
        res.status(403).json({ error: `صلاحياتك لا تسمح بالكتابة في ${col}.` });
        return;
      }
      const payload =
        req.body && typeof req.body === 'object' && 'data' in req.body
          ? (req.body.data as Record<string, unknown>)
          : ((req.body || {}) as Record<string, unknown>);
      const merge = Boolean(req.body?.merge);

      if (col === 'users') {
        const existingAuth = await getUserProfileByUid(docId);
        if (existingAuth) {
          const updated = await updateUserAccount(docId, {
            displayName: typeof payload.displayName === 'string' ? payload.displayName : undefined,
            phone: typeof payload.phone === 'string' ? payload.phone : undefined,
            email: typeof payload.email === 'string' ? payload.email : undefined,
            customRoleId: typeof payload.customRoleId === 'string' ? payload.customRoleId : undefined,
            role: typeof payload.role === 'string' ? (payload.role as VerifiedAuthUser['role']) : undefined,
            active: typeof payload.active === 'boolean' ? payload.active : undefined,
            allowedPlatforms: Array.isArray(payload.allowedPlatforms) ? (payload.allowedPlatforms as VerifiedAuthUser['allowedPlatforms']) : undefined,
            dataScope: payload.dataScope as VerifiedAuthUser['dataScope'] | undefined,
            permissionOverrides: payload.permissionOverrides as Record<string, unknown> | undefined,
            capabilityOverrides: payload.capabilityOverrides as Record<string, unknown> | undefined,
            fleetPermissionOverrides: payload.fleetPermissionOverrides as Record<string, unknown> | undefined,
          });
          res.json({ ok: true, id: docId, data: updated });
          return;
        }
      }

      const saved = await setLocalDoc(col, docId, payload, { merge });
      res.json({ ok: true, id: docId, data: saved });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'تعذر حفظ السجل.' });
    }
  });

  app.patch('/api/db/doc/:collection/:docId', requireAuth, async (req: AuthedRequest, res: Response) => {
    try {
      const actor = req.authUser!;
      const col = String(req.params.collection || '');
      const docId = String(req.params.docId || '');
      if (!isValidCollectionName(col) || !isValidDocId(docId)) {
        res.status(400).json({ error: 'معرّف المجموعة أو السجل غير صالح.' });
        return;
      }
      if (SERVER_ONLY_IMMUTABLE_COLLECTIONS.has(col)) {
        res.status(403).json({ error: `المجموعة (${col}) محمية وتُدار حصريًا من الخادم.` });
        return;
      }
      if (!checkDbCollectionPermission(actor, col, 'write')) {
        res.status(403).json({ error: `صلاحياتك لا تسمح بتحديث ${col}.` });
        return;
      }
      const patch =
        req.body && typeof req.body === 'object' && 'data' in req.body
          ? (req.body.data as Record<string, unknown>)
          : ((req.body || {}) as Record<string, unknown>);

      if (col === 'users') {
        const updated = await updateUserAccount(docId, {
          displayName: typeof patch.displayName === 'string' ? patch.displayName : undefined,
          phone: typeof patch.phone === 'string' ? patch.phone : undefined,
          email: typeof patch.email === 'string' ? patch.email : undefined,
          customRoleId: typeof patch.customRoleId === 'string' ? patch.customRoleId : undefined,
          role: typeof patch.role === 'string' ? (patch.role as VerifiedAuthUser['role']) : undefined,
          active: typeof patch.active === 'boolean' ? patch.active : undefined,
          allowedPlatforms: Array.isArray(patch.allowedPlatforms) ? (patch.allowedPlatforms as VerifiedAuthUser['allowedPlatforms']) : undefined,
          dataScope: patch.dataScope as VerifiedAuthUser['dataScope'] | undefined,
          permissionOverrides: patch.permissionOverrides as Record<string, unknown> | undefined,
          capabilityOverrides: patch.capabilityOverrides as Record<string, unknown> | undefined,
          fleetPermissionOverrides: patch.fleetPermissionOverrides as Record<string, unknown> | undefined,
        });
        res.json({ ok: true, id: docId, data: updated });
        return;
      }

      const updated = await updateLocalDoc(col, docId, patch);
      res.json({ ok: true, id: docId, data: updated });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'تعذر تحديث السجل.' });
    }
  });

  app.delete('/api/db/doc/:collection/:docId', requireAuth, async (req: AuthedRequest, res: Response) => {
    try {
      const actor = req.authUser!;
      const col = String(req.params.collection || '');
      const docId = String(req.params.docId || '');
      if (!isValidCollectionName(col) || !isValidDocId(docId)) {
        res.status(400).json({ error: 'معرّف المجموعة أو السجل غير صالح.' });
        return;
      }
      if (SERVER_ONLY_IMMUTABLE_COLLECTIONS.has(col)) {
        res.status(403).json({ error: `لا يمكن حذف السجلات التاريخية المحمية (${col}).` });
        return;
      }
      if (!checkDbCollectionPermission(actor, col, 'write')) {
        res.status(403).json({ error: `صلاحياتك لا تسمح بحذف سجلات ${col}.` });
        return;
      }
      if (col === 'users') {
        await deleteUserAccount(docId, actor.uid);
      }
      await deleteLocalDoc(col, docId);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'تعذر حذف السجل.' });
    }
  });

  app.post('/api/db/query', requireAuth, async (req: AuthedRequest, res: Response) => {
    try {
      const actor = req.authUser!;
      const col = String(req.body?.collection || '');
      if (!isValidCollectionName(col)) {
        res.status(400).json({ error: 'مجموعة بيانات غير صالحة.' });
        return;
      }
      if (!checkDbCollectionPermission(actor, col, 'read')) {
        res.status(403).json({ error: `صلاحياتك لا تسمح بعرض سجلات ${col}.` });
        return;
      }
      const rawFilters = Array.isArray(req.body?.filters) ? (req.body.filters as QueryFilterClause[]) : [];
      const docs = await queryLocalCollection(col, rawFilters);
      res.json({ docs });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'فشل الاستعلام عن البيانات.' });
    }
  });

  app.post('/api/db/batch', requireAuth, async (req: AuthedRequest, res: Response) => {
    try {
      const actor = req.authUser!;
      const ops = Array.isArray(req.body?.ops) ? (req.body.ops as LocalBatchOp[]) : [];
      for (const op of ops) {
        if (!isValidCollectionName(op.collection) || !isValidDocId(op.docId)) {
          res.status(400).json({ error: `عملية غير صالحة في الدفعة (${op.collection}/${op.docId}).` });
          return;
        }
        if (SERVER_ONLY_IMMUTABLE_COLLECTIONS.has(op.collection)) {
          res.status(403).json({ error: `المجموعة (${op.collection}) محمية وتُدار عبر الخادم فقط.` });
          return;
        }
        if (!checkDbCollectionPermission(actor, op.collection, 'write')) {
          res.status(403).json({ error: `صلاحياتك لا تسمح بالكتابة في ${op.collection}.` });
          return;
        }
      }
      await commitLocalBatch(ops);
      res.json({ ok: true, count: ops.length });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'فشل تنفيذ الدفعة.' });
    }
  });

  // Non-sensitive Corporate Branding for AuthGate Login & Pre-boot Shell
  app.get('/api/branding/public', async (_req, res) => {
    const cached = await readBrandingPublicMetadata();
    res.json({ ...(cached || {}), branding: cached || null });
  });

  app.get('/api/branding/logo/:logoKey', async (req, res) => {
    try {
      const logoKey = String(req.params.logoKey || '').trim();
      if (!logoKey) {
        res.status(404).end();
        return;
      }
      const { buffer, mimeType } = await readBrandingLogoFile(logoKey);
      res.setHeader('Content-Type', mimeType);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'public, max-age=300');
      res.send(buffer);
    } catch {
      res.status(404).json({ error: 'تعذر العثور على الشعار.' });
    }
  });

  app.post('/api/branding/logo', requireAuth, docUpload.single('file'), async (req: AuthedRequest, res: Response) => {
    try {
      const user = req.authUser!;
      if (
        !hasServerPermission(user, 'branding', 'edit') &&
        !hasServerPermission(user, 'company', 'edit') &&
        !hasServerCapability(user, 'change_branding')
      ) {
        res.status(403).json({ error: 'صلاحياتك لا تسمح بتعديل شعارات الهوية المؤسسية.' });
        return;
      }
      const slotRaw = String(req.body?.slot || 'primary').trim();
      const slot = (slotRaw === 'alternate' || slotRaw === 'icon' ? slotRaw : 'primary') as 'primary' | 'alternate' | 'icon';
      const uploadedFile = req.file;
      if (!uploadedFile) {
        res.status(400).json({ error: 'لم يتم إرفاق ملف الشعار.' });
        return;
      }
      const originalFileName = Buffer.from(uploadedFile.originalname, 'latin1').toString('utf8');
      const saved = await saveBrandingLogoFile({
        slot,
        buffer: uploadedFile.buffer,
        originalFileName,
        mimeType: uploadedFile.mimetype,
      });
      res.json({ success: true, slot, logoKey: saved.logoKey, mimeType: saved.mimeType, sizeBytes: saved.sizeBytes });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'فشل رفع الشعار.' });
    }
  });

  app.post('/api/branding/sync-public', requireAuth, async (req: AuthedRequest, res: Response) => {
    try {
      const user = req.authUser!;
      if (
        !hasServerPermission(user, 'branding', 'edit') &&
        !hasServerPermission(user, 'company', 'edit') &&
        !hasServerCapability(user, 'change_branding') &&
        !hasServerCapability(user, 'manage_company')
      ) {
        res.status(403).json({ error: 'صلاحياتك لا تسمح بتحديث إعدادات الهوية الظاهرة.' });
        return;
      }
      const body = (req.body || {}) as Record<string, unknown>;
      const companyObj = (typeof body.company === 'object' && body.company !== null ? body.company : body) as Record<string, unknown>;
      const brandingObj = (typeof body.branding === 'object' && body.branding !== null ? body.branding : body) as Record<string, unknown>;
      const creditsObj = (typeof body.credits === 'object' && body.credits !== null ? body.credits : body) as Record<string, unknown>;
      const safePublic = {
        companyNameAr: String(companyObj.companyNameAr || ''),
        companyNameEn: String(companyObj.companyNameEn || ''),
        systemNameAr: String(brandingObj.systemNameAr || 'FLEET OPERATIONS CENTER'),
        systemNameEn: String(brandingObj.systemNameEn || 'Fleet Operations Center'),
        primaryLogoKey: String(brandingObj.primaryLogoKey || ''),
        alternateLogoKey: String(brandingObj.alternateLogoKey || ''),
        iconLogoKey: String(brandingObj.iconLogoKey || ''),
        primaryColor: String(brandingObj.primaryColor || '#0f1e36'),
        secondaryColor: String(brandingObj.secondaryColor || '#2563eb'),
        buttonColor: String(brandingObj.buttonColor || '#1d4ed8'),
        sidebarColor: String(brandingObj.sidebarColor || '#0c1628'),
        uiStyleMode: String(brandingObj.uiStyleMode || 'corporate'),
        defaultThemeMode: String(brandingObj.defaultThemeMode || 'light'),
        loginScreenStyle: String(brandingObj.loginScreenStyle || 'split'),
        loginHeadlineAr: String(brandingObj.loginHeadlineAr || ''),
        loginSubheadlineAr: String(brandingObj.loginSubheadlineAr || ''),
        developerName: String(creditsObj.developerName || creditsObj.developerNameAr || 'م- عبدالرحمن محمد'),
        developerPhone: String(creditsObj.developerPhone || '0559786939'),
        version: String(creditsObj.version || creditsObj.systemVersion || 'v4.0 Enterprise'),
        updatedAt: new Date().toISOString(),
      };
      await saveBrandingPublicMetadata(safePublic);
      res.json({ success: true });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'تعذر مزامنة الهوية العامة.' });
    }
  });

  app.get('/api/system/health', requireAuth, async (req: AuthedRequest, res: Response) => {
    try {
      const user = req.authUser!;
      const idToken = req.idToken!;
      if (!hasServerPermission(user, 'system_health', 'view') && user.role !== 'owner' && user.role !== 'admin') {
        res.status(403).json({ error: 'صلاحياتك لا تسمح بعرض مؤشرات صحة النظام.' });
        return;
      }
      const startedAt = Date.now();
      let firestoreOk = false;
      let firestoreLatencyMs = 0;
      let recentBatchesCount = 0;
      let latestBatchAt = '';
      let collections: Record<string, number> = {};
      try {
        if (isServerSessionToken(idToken)) {
          await getLocalDoc('operationalSettings', 'default');
          collections = await getCollectionCounts();
          recentBatchesCount = collections.importBatches || 0;
          firestoreOk = true;
          firestoreLatencyMs = Date.now() - startedAt;
        } else {
          await getFirestoreDoc('operationalSettings', 'default', idToken);
          firestoreOk = true;
          firestoreLatencyMs = Date.now() - startedAt;
          const batches = await listFirestoreCollection<{ createdAt?: string }>('importBatches', idToken, 50);
          recentBatchesCount = batches.length;
          const sorted = batches
            .map((b) => b.createdAt || '')
            .filter(Boolean)
            .sort()
            .reverse();
          latestBatchAt = sorted[0] || '';
        }
      } catch {
        firestoreOk = false;
        firestoreLatencyMs = Date.now() - startedAt;
      }
      const vault = await getPrivateVaultStats();
      const mem = process.memoryUsage();
      const rssMb = Math.round(mem.rss / (1024 * 1024));
      const heapMb = Math.round(mem.heapUsed / (1024 * 1024));
      const uptimeSeconds = Math.round(process.uptime());
      const nowIso = new Date().toISOString();

      res.json({
        ok: firestoreOk && vault.exists,
        status: firestoreOk ? 'healthy' : 'degraded',
        checkedAt: nowIso,
        timestamp: nowIso,
        uptimeSeconds,
        serverUptimeSeconds: uptimeSeconds,
        memoryRssMb: rssMb,
        memoryHeapUsedMb: heapMb,
        memoryMb: { rss: rssMb, heapUsed: heapMb },
        firestore: { ok: firestoreOk, latencyMs: firestoreLatencyMs },
        privateVault: {
          ok: vault.exists,
          fileCount: vault.fileCount,
          totalSizeMb: Number((vault.totalBytes / (1024 * 1024)).toFixed(2)),
        },
        vault,
        collections,
        recentImportBatchesCount: recentBatchesCount,
        imports: { recentBatchesCount, latestBatchAt },
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'فشل فحص صحة النظام.' });
    }
  });

  // ==========================================
  // FULL SYSTEM BACKUP, 1:00 AM AUTO SCHEDULER & FACTORY RESET
  // ==========================================
  const canManageBackupOrReset = (user: VerifiedAuthUser) =>
    user.role === 'owner' ||
    user.role === 'admin' ||
    hasServerCapability(user, 'manage_settings') ||
    hasServerPermission(user, 'settings', 'edit') ||
    hasServerPermission(user, 'system_health', 'view');

  app.get('/api/system/backups', requireAuth, async (req: AuthedRequest, res: Response) => {
    try {
      const actor = req.authUser!;
      if (!canManageBackupOrReset(actor)) {
        res.status(403).json({ error: 'صلاحياتك لا تسمح بإدارة النسخ الاحتياطي.' });
        return;
      }
      const [backups, scheduler] = await Promise.all([listSavedServerBackups(), readSchedulerConfig()]);
      res.json({ ok: true, backups, scheduler });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'تعذر قراءة النسخ الاحتياطية.' });
    }
  });

  app.post('/api/system/backups/create', requireAuth, async (req: AuthedRequest, res: Response) => {
    try {
      const actor = req.authUser!;
      if (!canManageBackupOrReset(actor)) {
        res.status(403).json({ error: 'صلاحياتك لا تسمح بإنشاء نسخة احتياطية.' });
        return;
      }
      const note = String(req.body?.note || '').trim().slice(0, 240);
      const doc = await buildFullSystemBackup({
        type: 'manual',
        createdBy: actor.email || actor.uid,
        note: note || 'نسخة احتياطية شاملة يدوية',
      });
      const summary = await saveBackupToServer(doc);

      const logId = `log_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      await setLocalDoc('auditLogs', logId, {
        logId,
        action: 'SYSTEM_FULL_BACKUP_CREATED',
        targetCollection: 'configSnapshots',
        targetId: summary.backupId,
        entityType: 'system_backup',
        actorUid: actor.uid,
        actorEmail: actor.email,
        details: `إنشاء وحفظ نسخة احتياطية كاملة على الخادم (${summary.fileName}) — ${summary.totalDocuments} سجل، ${summary.vaultFileCount} ملف`,
        source: 'API',
        allowedUids: [actor.uid],
        createdAt: new Date().toISOString(),
      }).catch(() => {});

      res.json({ ok: true, backup: summary });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'فشل إنشاء النسخة الاحتياطية.' });
    }
  });

  app.get('/api/system/backups/export', requireAuth, async (req: AuthedRequest, res: Response) => {
    try {
      const actor = req.authUser!;
      if (!canManageBackupOrReset(actor)) {
        res.status(403).json({ error: 'صلاحياتك لا تسمح بتصدير النسخة الاحتياطية الكاملة.' });
        return;
      }
      const backupDoc = await buildFullSystemBackup({
        type: 'manual',
        createdBy: actor.email || actor.uid,
        note: 'تصدير نسخة احتياطية شاملة كاملة بصيغة النظام',
      });
      const fileName = `fleet_ops_full_backup_${new Date().toISOString().slice(0, 10)}.json`;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
      res.send(JSON.stringify(backupDoc, null, 2));
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'فشل تصدير النسخة الاحتياطية.' });
    }
  });

  app.get('/api/system/backups/:backupId/download', requireAuth, async (req: AuthedRequest, res: Response) => {
    try {
      const actor = req.authUser!;
      if (!canManageBackupOrReset(actor)) {
        res.status(403).json({ error: 'صلاحياتك لا تسمح بتنزيل النسخ الاحتياطية.' });
        return;
      }
      const backupId = String(req.params.backupId || '').trim();
      const doc = await readSavedServerBackup(backupId);
      const fileName = `${backupId.replace(/[^a-zA-Z0-9._-]/g, '_')}.json`;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
      res.send(JSON.stringify(doc, null, 2));
    } catch (err) {
      res.status(404).json({ error: err instanceof Error ? err.message : 'النسخة الاحتياطية غير موجودة.' });
    }
  });

  app.post('/api/system/backups/import', requireAuth, async (req: AuthedRequest, res: Response) => {
    try {
      const actor = req.authUser!;
      if (actor.role !== 'owner' && actor.role !== 'admin' && !hasServerCapability(actor, 'manage_settings')) {
        res.status(403).json({ error: 'صلاحياتك لا تسمح باستيراد واستعادة النسخة الاحتياطية الكاملة.' });
        return;
      }
      const mode = req.body?.mode === 'merge' ? 'merge' : 'replace';
      const payload = req.body?.backup !== undefined ? req.body.backup : req.body;
      const result = await restoreFullSystemBackup({
        payload,
        mode,
        actorLabel: actor.email || actor.uid,
        actorUid: actor.uid,
      });
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'فشل استيراد النسخة الاحتياطية.' });
    }
  });

  app.post('/api/system/backups/:backupId/restore', requireAuth, async (req: AuthedRequest, res: Response) => {
    try {
      const actor = req.authUser!;
      if (actor.role !== 'owner' && actor.role !== 'admin' && !hasServerCapability(actor, 'manage_settings')) {
        res.status(403).json({ error: 'صلاحياتك لا تسمح باستعادة النسخ الاحتياطية.' });
        return;
      }
      const backupId = String(req.params.backupId || '').trim();
      const mode = req.body?.mode === 'merge' ? 'merge' : 'replace';
      const doc = await readSavedServerBackup(backupId);
      const result = await restoreFullSystemBackup({
        payload: doc,
        mode,
        actorLabel: actor.email || actor.uid,
        actorUid: actor.uid,
      });
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'تعذرت استعادة النسخة الاحتياطية.' });
    }
  });

  app.delete('/api/system/backups/:backupId', requireAuth, async (req: AuthedRequest, res: Response) => {
    try {
      const actor = req.authUser!;
      if (actor.role !== 'owner' && actor.role !== 'admin' && !hasServerCapability(actor, 'manage_settings')) {
        res.status(403).json({ error: 'صلاحياتك لا تسمح بحذف النسخ الاحتياطية.' });
        return;
      }
      const backupId = String(req.params.backupId || '').trim();
      await deleteSavedServerBackup(backupId);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'تعذر حذف النسخة الاحتياطية.' });
    }
  });

  app.patch('/api/system/backups/scheduler', requireAuth, async (req: AuthedRequest, res: Response) => {
    try {
      const actor = req.authUser!;
      if (!canManageBackupOrReset(actor)) {
        res.status(403).json({ error: 'صلاحياتك لا تسمح بتعديل جدول النسخ التلقائي.' });
        return;
      }
      const next = await writeSchedulerConfig({
        enabled: typeof req.body?.enabled === 'boolean' ? req.body.enabled : undefined,
        hour: typeof req.body?.hour === 'number' ? req.body.hour : undefined,
        minute: typeof req.body?.minute === 'number' ? req.body.minute : undefined,
        timezone: typeof req.body?.timezone === 'string' ? req.body.timezone : undefined,
        retentionDays: typeof req.body?.retentionDays === 'number' ? req.body.retentionDays : undefined,
      });
      res.json({ ok: true, scheduler: next });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'تعذر تحديث إعدادات الجدولة.' });
    }
  });

  app.post('/api/system/reset', requireAuth, async (req: AuthedRequest, res: Response) => {
    try {
      const actor = req.authUser!;
      if (actor.role !== 'owner' && actor.role !== 'admin') {
        res.status(403).json({ error: 'إعادة ضبط النظام الكامل متاحة لمدير النظام الأعلى أو المالك فقط.' });
        return;
      }
      const providedPassword = String(req.body?.password || '');
      if (!verifySystemResetPassword(providedPassword)) {
        res.status(403).json({ error: 'كلمة مرور إعادة ضبط النظام غير صحيحة. لم يتم مسح أي بيانات.' });
        return;
      }
      const resetRes = await performFactorySystemReset({
        actorLabel: actor.email || actor.uid,
      });
      const admin = await ensureBootstrappedAdmin(false);
      const token = await signSessionToken(admin);
      res.json({
        ok: true,
        token,
        profile: toPublicUserProfile(admin),
        clearedCollections: resetRes.clearedCollections,
        resetAt: resetRes.resetAt,
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'فشل تنفيذ إعادة ضبط النظام.' });
    }
  });

  // Preview uploaded local Excel files OR Google Drive Excel files
  app.post('/api/import/preview', requireAuth, upload.array('files', 10), async (req: AuthedRequest, res: Response) => {
    try {
      const user = req.authUser!;
      const idToken = req.idToken!;
      if (!hasServerPermission(user, 'applications', 'add') && !hasServerPermission(user, 'operations', 'add')) {
        res.status(403).json({ error: 'صلاحياتك الحالية لا تسمح باستيراد تقارير المنصات.' });
        return;
      }

      cleanupPreviewCache();
      const filesToProcess: Array<{ buffer: Buffer; fileName: string; sourceType: 'local' | 'google_drive'; driveFileId?: string }> = [];

      const uploadedFiles = (req.files as Express.Multer.File[] | undefined) || [];
      for (const f of uploadedFiles) {
        filesToProcess.push({
          buffer: f.buffer,
          fileName: Buffer.from(f.originalname, 'latin1').toString('utf8'),
          sourceType: 'local',
        });
      }

      // Check Google Drive file IDs if passed
      const driveFilesRaw = req.body?.driveFiles;
      if (driveFilesRaw) {
        const driveAccessToken = String(req.headers['x-drive-access-token'] || '').trim();
        if (!driveAccessToken) {
          res.status(401).json({ error: 'يلزم تفويض Google Drive لقراءة الملفات المحددة.' });
          return;
        }
        const driveList = typeof driveFilesRaw === 'string'
          ? (JSON.parse(driveFilesRaw) as Array<{ id: string; name: string }>)
          : (driveFilesRaw as Array<{ id: string; name: string }>);

        for (const df of driveList) {
          const driveRes = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(df.id)}?alt=media`, {
            headers: { Authorization: `Bearer ${driveAccessToken}` },
          });
          if (!driveRes.ok) {
            throw new Error(`تعذر تحميل الملف "${df.name}" من Google Drive.`);
          }
          const arrBuf = await driveRes.arrayBuffer();
          filesToProcess.push({
            buffer: Buffer.from(arrBuf),
            fileName: df.name,
            sourceType: 'google_drive',
            driveFileId: df.id,
          });
        }
      }

      if (filesToProcess.length === 0) {
        res.status(400).json({ error: 'لم يتم إرفاق أي ملف Excel للمعاينة.' });
        return;
      }

      const expectedPlatformRaw = String(req.body?.expectedPlatform || '').trim();
      const expectedPlatform =
        expectedPlatformRaw === 'hungerstation' || expectedPlatformRaw === 'keeta'
          ? expectedPlatformRaw
          : undefined;

      const allowedUids = await getTeamAllowedUids(user.uid, idToken);
      const parsedList: ParsedWorkbookOutput[] = [];
      const previewResults: ImportPreviewResult[] = [];
      const previewSessionId = crypto.randomUUID().replace(/-/g, '').slice(0, 20);

      for (const item of filesToProcess) {
        const batchId = `batch_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
        const parsed = await parseExcelBuffer({
          buffer: item.buffer,
          fileName: item.fileName,
          batchId,
          createdByUid: user.uid,
          allowedUids,
        });
        const keetaEnabled = parsed.platform === 'keeta' ? await isKeetaEnabledOnServer(idToken) : true;
        if (parsed.platform === 'keeta' && !keetaEnabled) {
          res.status(403).json({
            error: 'منصة Keeta مخفية وموقوفة تشغيليًا حاليًا من قِبل الإدارة. يمكن إعادة تفعيلها من إعدادات المنصات.',
          });
          return;
        }
        if (
          !user.allowedPlatforms.includes(parsed.platform) ||
          (user.dataScope.platforms.length > 0 && !user.dataScope.platforms.includes(parsed.platform))
        ) {
          const pName = parsed.platform === 'hungerstation' ? 'HungerStation' : 'Keeta';
          res.status(403).json({
            error: `صلاحيات حسابك لا تسمح باستيراد ملفات منصة ${pName} (${parsed.fileName}).`,
          });
          return;
        }
        if (expectedPlatform && parsed.platform !== expectedPlatform) {
          const expectedLabel = expectedPlatform === 'hungerstation' ? 'HungerStation' : 'Keeta';
          const detectedLabel = parsed.platform === 'hungerstation' ? 'HungerStation' : 'Keeta';
          res.status(400).json({
            error: `تم رفض الملف "${parsed.fileName}": أنت داخل مركز استيراد ${expectedLabel} بينما الملف ينتمي إلى منصة ${detectedLabel}. يرجى رفعه في مساحة العمل المخصصة له.`,
          });
          return;
        }
        parsedList.push(parsed);

        // Compare against Firestore existing records for true idempotent preview
        const lookupKeys = parsed.records.map((r) => ({ collection: r.collection, docId: r.data.recordKey }));
        const existingMap = await batchCheckExisting(lookupKeys, idToken);

        let newCount = 0;
        let updatedCount = 0;
        let duplicateCount = 0;

        const sheetStatMap = new Map(parsed.sheetDiagnostics.map((s) => [s.sheetName, s]));
        const previewQuotaBySheet = new Map<string, number>();
        const previewRows: ImportPreviewResult['previewRows'] = [];

        for (const rec of parsed.records) {
          const existing = existingMap.get(`${rec.collection}:${rec.data.recordKey}`);
          const diag = sheetStatMap.get(rec.data.sourceSheet);
          let changeStatus: 'new' | 'update' | 'duplicate' = 'new';

          if (!existing) {
            newCount++;
            if (diag) diag.newCount++;
          } else if (existing.rowChecksum === rec.data.rowChecksum) {
            changeStatus = 'duplicate';
            duplicateCount++;
            if (diag) diag.duplicateCount++;
          } else {
            changeStatus = 'update';
            updatedCount++;
            if (diag) diag.updatedCount++;
          }

          const sheetShown = previewQuotaBySheet.get(rec.data.sourceSheet) || 0;
          if (previewRows.length < 80 && sheetShown < 20) {
            previewQuotaBySheet.set(rec.data.sourceSheet, sheetShown + 1);
            const dateOrPeriod =
              'date' in rec.data
                ? rec.data.date
                : 'snapshotDate' in rec.data
                  ? rec.data.snapshotDate
                  : 'month' in rec.data
                    ? rec.data.month
                    : '-';
            previewRows.push({
              sheetName: rec.data.sourceSheet,
              recordKey: rec.data.recordKey,
              riderId: rec.data.riderId,
              dateOrPeriod,
              summaryText:
                rec.collection === 'hungerDaily'
                  ? `طلبات مكتملة: ${rec.data.completedDeliveries ?? 'غير متاح'} | ساعات: ${rec.data.actualWorkingHours ?? 'غير متاح'}`
                  : rec.collection === 'keetaDashboardDaily'
                    ? `مهام مسلمة: ${rec.data.deliveredTasks ?? 'غير متاح'} | ساعات: ${rec.data.shiftOnlineHours ?? 'غير متاح'}`
                    : rec.collection === 'hungerWalletSnapshots'
                      ? `الرصيد: ${rec.data.currentWallet}`
                      : rec.collection === 'hungerDistanceDaily'
                        ? `KM: ${rec.data.totalKm ?? 'غير متاح'} | مستحق: ${rec.data.payableKm ?? 'غير متاح'}`
                        : rec.collection === 'keetaVdaDaily'
                          ? `مسافة: ${rec.data.totalDeliveryDistance ?? 'غير متاح'} | شفتات صالحة: ${rec.data.sumValidShifts ?? 'غير متاح'}`
                          : rec.collection === 'hungerQualityMonthly'
                            ? `النتيجة: ${rec.data.finalDeliveryQualityScore ?? 'غير متاح'} | ${rec.data.segment || '-'}`
                            : rec.collection === 'keetaRankSnapshots'
                              ? `المستوى: ${rec.data.currentEstimatedLevel || '-'} | مكافأة: ${rec.data.estimatedRewardAmount ?? 'غير متاح'}`
                              : `النتيجة: ${rec.data.finalInspectionResult || '-'} | نسبة النجاح: ${rec.data.passRateMtd ?? 'غير متاح'}%`,
              changeStatus,
            });
          }
        }

        // Add any within-file duplicates to total duplicateCount
        const withinFileDupes = parsed.sheetDiagnostics.reduce((acc, s) => acc + Math.max(0, s.duplicateCount - 0), 0);
        const totalDupes = Math.max(duplicateCount, withinFileDupes);

        previewResults.push({
          previewId: previewSessionId,
          fileName: parsed.fileName,
          fileHash: parsed.fileHash,
          platform: parsed.platform,
          sourceType: item.sourceType,
          driveFileId: item.driveFileId,
          detectedPeriodStart: parsed.detectedPeriodStart,
          detectedPeriodEnd: parsed.detectedPeriodEnd,
          sheetsDetected: parsed.sheetsDetected,
          missingExpectedSheets: parsed.missingExpectedSheets,
          unknownColumns: parsed.unknownColumns,
          totalValid: parsed.records.length,
          newCount,
          updatedCount,
          duplicateCount: totalDupes,
          rejectedCount: parsed.rejectedRows.length,
          sheetDiagnostics: parsed.sheetDiagnostics,
          rejectedSample: parsed.rejectedRows.slice(0, 50),
          previewRows,
        });
      }

      previewCache.set(previewSessionId, {
        createdAtMs: Date.now(),
        uid: user.uid,
        parsedList,
        previewResults,
      });

      res.json({ previewId: previewSessionId, files: previewResults });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'فشل تحليل ملف Excel.' });
    }
  });

  // Commit previewed records idempotently into Firestore + recompute server summaries
  app.post('/api/import/commit', requireAuth, async (req: AuthedRequest, res: Response) => {
    try {
      const user = req.authUser!;
      const idToken = req.idToken!;
      if (!hasServerPermission(user, 'applications', 'add') && !hasServerPermission(user, 'operations', 'add')) {
        res.status(403).json({ error: 'صلاحياتك الحالية لا تسمح بتأكيد الاستيراد.' });
        return;
      }

      const previewId = String(req.body?.previewId || '').trim();
      const cached = previewCache.get(previewId);
      if (!cached || cached.uid !== user.uid) {
        res.status(404).json({ error: 'انتهت صلاحية جلسة المعاينة، يرجى إعادة معاينة الملف.' });
        return;
      }

      const allowedUids = await getTeamAllowedUids(user.uid, idToken);
      const committedBatches: Array<{ batchId: string; fileName: string; inserted: number; updated: number; skippedDuplicates: number }> = [];
      const allAffectedDates: Array<{ platform: 'hungerstation' | 'keeta'; date: string }> = [];

      for (let i = 0; i < cached.parsedList.length; i++) {
        const parsed = cached.parsedList[i];
        const previewMeta = cached.previewResults[i];

        const lookupKeys = parsed.records.map((r) => ({ collection: r.collection, docId: r.data.recordKey }));
        const existingMap = await batchCheckExisting(lookupKeys, idToken);

        const writes: WriteOperation[] = [];
        let inserted = 0;
        let updated = 0;
        let skippedDuplicates = 0;

        for (const rec of parsed.records) {
          const existing = existingMap.get(`${rec.collection}:${rec.data.recordKey}`);
          if (existing && existing.rowChecksum === rec.data.rowChecksum) {
            skippedDuplicates++;
            continue;
          }

          const { importedAt: _i, updatedAt: _u, ...cleanData } = rec.data as unknown as Record<string, unknown>;
          if (existing && existing.importedAt) {
            updated++;
            writes.push({
              collection: rec.collection,
              docId: rec.data.recordKey,
              data: {
                ...cleanData,
                createdByUid: existing.createdByUid || user.uid,
                allowedUids,
              },
              serverTimestampFields: ['updatedAt'],
              preserveTimestampFields: { importedAt: existing.importedAt },
            });
          } else {
            inserted++;
            writes.push({
              collection: rec.collection,
              docId: rec.data.recordKey,
              data: {
                ...cleanData,
                createdByUid: user.uid,
                allowedUids,
              },
              serverTimestampFields: ['importedAt', 'updatedAt'],
            });
          }
        }

        const batchId = parsed.records[0]?.data.importBatchId || `batch_${Date.now()}_${i}`;
        const batchDoc = {
          batchId,
          fileName: parsed.fileName,
          fileHash: parsed.fileHash,
          platform: parsed.platform,
          sourceType: previewMeta.sourceType,
          driveFileId: previewMeta.driveFileId || '',
          detectedPeriodStart: parsed.detectedPeriodStart || '',
          detectedPeriodEnd: parsed.detectedPeriodEnd || '',
          sheetsDetected: parsed.sheetsDetected.slice(0, 20),
          unknownColumns: parsed.unknownColumns.slice(0, 100),
          validCount: inserted + updated,
          duplicateCount: skippedDuplicates,
          rejectedCount: parsed.rejectedRows.length,
          updatedCount: updated,
          status: 'committed',
          importedByEmail: user.email,
          createdByUid: user.uid,
          allowedUids,
        };

        writes.push({
          collection: 'importBatches',
          docId: batchId,
          data: batchDoc,
          serverTimestampFields: ['createdAt'],
        });

        const logId = `log_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
        writes.push({
          collection: 'auditLogs',
          docId: logId,
          data: {
            logId,
            action: 'IMPORT_COMMITTED',
            targetCollection: 'importBatches',
            targetId: batchId,
            actorUid: user.uid,
            actorEmail: user.email,
            details: `ملف: ${parsed.fileName} | المنصة: ${parsed.platform} | جديد: ${inserted} | محدث: ${updated} | مكرر متجاهل: ${skippedDuplicates} | مرفوض: ${parsed.rejectedRows.length}`,
            allowedUids,
          },
          serverTimestampFields: ['createdAt'],
        });

        await commitFirestoreWrites(writes, idToken);
        allAffectedDates.push(...extractAffectedDates(parsed.records));
        committedBatches.push({ batchId, fileName: parsed.fileName, inserted, updated, skippedDuplicates });
      }

      const summaryStats = await recomputeSummariesForDates({
        affectedDates: allAffectedDates,
        createdByUid: user.uid,
        allowedUids,
        idToken,
      });

      previewCache.delete(previewId);

      res.json({
        success: true,
        batches: committedBatches,
        summariesUpdated: summaryStats,
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'فشل حفظ البيانات المستوردة.' });
    }
  });

  // Server-side Excel export (+ optional upload to Google Drive) with strict RBAC export check
  app.post('/api/export/excel', requireAuth, async (req: AuthedRequest, res: Response) => {
    try {
      const user = req.authUser!;
      const idToken = req.idToken!;
      if (!hasServerPermission(user, 'reports', 'export')) {
        res.status(403).json({ error: 'صلاحيات حسابك لا تسمح بتصدير التقارير.' });
        return;
      }
      const { title, sheetName, columns, rows, metadataLines, saveToDrive, fileName } = req.body as {
        title: string;
        sheetName: string;
        columns: ExportColumn[];
        rows: Array<Record<string, unknown>>;
        metadataLines?: string[];
        saveToDrive?: boolean;
        fileName?: string;
      };

      const buffer = await buildExcelReportBuffer({
        title: title || 'Fleet Operations Report',
        sheetName: sheetName || 'Report',
        columns: columns || [],
        rows: rows || [],
        metadataLines,
      });

      const safeName = (fileName || 'fleet_report.xlsx').replace(/[^a-zA-Z0-9._\-\u0600-\u06FF ]/g, '_');

      if (saveToDrive) {
        const driveAccessToken = String(req.headers['x-drive-access-token'] || '').trim();
        if (!driveAccessToken) {
          res.status(401).json({ error: 'يلزم تسجيل الدخول وتفويض Google Drive لحفظ الملف.' });
          return;
        }
        const boundary = `fleet_boundary_${Date.now()}`;
        const metadataPart = JSON.stringify({
          name: safeName.endsWith('.xlsx') ? safeName : `${safeName}.xlsx`,
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        });

        const multipartBody = Buffer.concat([
          Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadataPart}\r\n`),
          Buffer.from(`--${boundary}\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n`),
          buffer,
          Buffer.from(`\r\n--${boundary}--`),
        ]);

        const driveRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${driveAccessToken}`,
            'Content-Type': `multipart/related; boundary=${boundary}`,
          },
          body: multipartBody,
        });

        if (!driveRes.ok) {
          throw new Error(`فشل رفع التقرير إلى Google Drive: ${await driveRes.text()}`);
        }
        const created = (await driveRes.json()) as { id: string; name: string };
        res.json({ success: true, driveFile: created });
        return;
      }

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(safeName.endsWith('.xlsx') ? safeName : `${safeName}.xlsx`)}`);

      // Record export audit log asynchronously (best effort)
      const allowedUids = await getTeamAllowedUids(user.uid, idToken);
      const exportLogId = `log_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      void commitFirestoreWrites(
        [
          {
            collection: 'auditLogs',
            docId: exportLogId,
            data: {
              logId: exportLogId,
              action: 'REPORT_EXPORTED',
              targetCollection: 'reports',
              targetId: safeName.slice(0, 128),
              entityType: 'report',
              actorUid: user.uid,
              actorEmail: user.email,
              details: `تصدير تقرير Excel: ${title || safeName} (${rows?.length ?? 0} صف)`,
              source: 'API',
              allowedUids,
            },
            serverTimestampFields: ['createdAt'],
          },
        ],
        idToken
      ).catch(() => {});

      res.send(buffer);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'فشل تصدير ملف Excel.' });
    }
  });

  // ==========================================
  // PRIVATE SERVER-SIDE DOCUMENT VAULT APIs
  // ==========================================
  const ALLOWED_VAULT_ENTITY_TYPES = [
    'rider',
    'vehicle',
    'handover',
    'return',
    'maintenance',
    'delegation',
    'damage_claim',
    'vehicle_doc',
    'custom_field',
    'branding',
  ] as const;
  const FLEET_VAULT_ENTITY_TYPES = new Set<string>([
    'vehicle',
    'handover',
    'return',
    'maintenance',
    'delegation',
    'damage_claim',
    'vehicle_doc',
  ]);

  app.post('/api/documents/upload', requireAuth, docUpload.single('file'), async (req: AuthedRequest, res: Response) => {
    try {
      const user = req.authUser!;
      const idToken = req.idToken!;
      const existingDocId = String(req.body?.docId || '').trim();
      const isReplace = Boolean(existingDocId);

      const entityType = String(req.body?.entityType || '').trim() as PrivateDocumentRecord['entityType'];
      const isFleetEntity = FLEET_VAULT_ENTITY_TYPES.has(entityType);
      const hasDocPerm = isReplace
        ? hasServerPermission(user, 'documents', 'edit') || (isFleetEntity && hasFleetPermOnUser(user, 'fleet.documents.upload'))
        : hasServerPermission(user, 'documents', 'add') || (isFleetEntity && hasFleetPermOnUser(user, 'fleet.documents.upload'));

      if (!hasDocPerm) {
        res.status(403).json({ error: 'صلاحياتك الحالية لا تسمح برفع أو استبدال المستندات.' });
        return;
      }

      const uploadedFile = req.file;
      if (!uploadedFile) {
        res.status(400).json({ error: 'لم يتم إرفاق ملف المستند.' });
        return;
      }

      const entityId = String(req.body?.entityId || '').trim();
      const entityLabel = String(req.body?.entityLabel || '').trim().slice(0, 180);
      const docTypeId = String(req.body?.docTypeId || '').trim();
      const docTypeName = String(req.body?.docTypeName || docTypeId).trim().slice(0, 120);
      const title = String(req.body?.title || docTypeName).trim().slice(0, 180);
      const issueDate = String(req.body?.issueDate || '').trim().slice(0, 10);
      const expiryDate = String(req.body?.expiryDate || '').trim().slice(0, 10);
      const notes = String(req.body?.notes || '').trim().slice(0, 600);
      const versionNote = String(req.body?.versionNote || '').trim().slice(0, 300);

      if (!ALLOWED_VAULT_ENTITY_TYPES.includes(entityType) || !entityId || !docTypeId) {
        res.status(400).json({ error: 'بيانات ربط المستند بالكيان غير مكتملة.' });
        return;
      }

      // Check data scope when linked to a rider
      if (entityType === 'rider' && !user.dataScope.allBranches) {
        const riderDoc = await getFirestoreDoc('riderMaster', entityId, idToken).catch(() => null);
        if (
          riderDoc &&
          !matchesDataScope(
            {
              internalRiderId: entityId,
              branch: typeof riderDoc.branch === 'string' ? riderDoc.branch : undefined,
              city: typeof riderDoc.city === 'string' ? riderDoc.city : undefined,
            },
            user.dataScope
          )
        ) {
          res.status(403).json({ error: 'المندوب خارج نطاق صلاحيات الفروع/المدن الخاص بك.' });
          return;
        }
      }

      // Check data scope when linked to a vehicle/fleet entity
      if (isFleetEntity) {
        const vehicleDoc = await getFirestoreDoc('vehicles', entityId, idToken).catch(() => null);
        if (vehicleDoc && !isVehicleInUserScope(vehicleDoc as never, user)) {
          res.status(403).json({ error: 'المركبة خارج نطاق الفروع/المدن المصرح لك بها.' });
          return;
        }
      }

      const docId = existingDocId || `doc_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      const existingDoc = existingDocId
        ? ((await getFirestoreDoc('privateDocuments', docId, idToken)) as PrivateDocumentRecord | null)
        : null;

      if (existingDocId && !existingDoc) {
        res.status(404).json({ error: 'المستند المطلوب استبداله غير موجود.' });
        return;
      }

      const nextVersion = existingDoc ? (existingDoc.currentVersion || existingDoc.versions?.length || 1) + 1 : 1;
      const originalFileName = Buffer.from(uploadedFile.originalname, 'latin1').toString('utf8');

      const saved = await savePrivateVaultFile({
        buffer: uploadedFile.buffer,
        docId,
        version: nextVersion,
        originalFileName,
        mimeType: uploadedFile.mimetype,
        allowExtended: entityType === 'custom_field',
      });

      const nowIso = new Date().toISOString();
      const newVersionEntry = {
        version: nextVersion,
        storageKey: saved.storageKey,
        originalFileName: originalFileName.slice(0, 200),
        mimeType: saved.normalizedMime,
        sizeBytes: saved.sizeBytes,
        sha256: saved.sha256,
        uploadedByUid: user.uid,
        uploadedByEmail: user.email,
        uploadedAt: nowIso,
        note: versionNote || (nextVersion > 1 ? 'تحديث بنسخة جديدة' : 'رفع أولي'),
      };

      const versions = existingDoc && Array.isArray(existingDoc.versions)
        ? [...existingDoc.versions, newVersionEntry].slice(-20)
        : [newVersionEntry];

      const allowedUids = await getTeamAllowedUids(user.uid, idToken);
      const recordData: Record<string, unknown> = {
        docId,
        entityType: existingDoc?.entityType || entityType,
        entityId: existingDoc?.entityId || entityId,
        entityLabel: entityLabel || existingDoc?.entityLabel || entityId,
        docTypeId: existingDoc?.docTypeId || docTypeId,
        docTypeName: docTypeName || existingDoc?.docTypeName || docTypeId,
        title: title || existingDoc?.title || docTypeName,
        issueDate: issueDate || existingDoc?.issueDate || '',
        expiryDate: expiryDate || existingDoc?.expiryDate || '',
        notes: notes || existingDoc?.notes || '',
        currentVersion: nextVersion,
        versions,
        createdByUid: existingDoc?.createdByUid || user.uid,
        allowedUids,
      };

      const logId = `log_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      await commitFirestoreWrites(
        [
          {
            collection: 'privateDocuments',
            docId,
            data: recordData,
            serverTimestampFields: existingDoc ? ['updatedAt'] : ['createdAt', 'updatedAt'],
            preserveTimestampFields: existingDoc?.createdAt ? { createdAt: existingDoc.createdAt } : undefined,
          },
          {
            collection: 'auditLogs',
            docId: logId,
            data: {
              logId,
              action: existingDoc ? 'DOCUMENT_VERSION_REPLACED' : 'DOCUMENT_UPLOADED',
              targetCollection: 'privateDocuments',
              targetId: docId,
              entityType: 'document',
              actorUid: user.uid,
              actorEmail: user.email,
              details: `${existingDoc ? 'استبدال' : 'رفع'} مستند: ${recordData.title} (إصدار ${nextVersion}) للكيان ${entityType}:${entityId}`,
              oldValue: existingDoc ? `v${existingDoc.currentVersion}` : undefined,
              newValue: `v${nextVersion} (${originalFileName})`,
              source: 'API',
              allowedUids,
            },
            serverTimestampFields: ['createdAt'],
          },
        ],
        idToken
      );

      res.json({ success: true, document: { ...recordData, docId } });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'فشل رفع المستند في الخزينة الخاصة.' });
    }
  });

  app.get('/api/documents/:docId/file', requireAuth, async (req: AuthedRequest, res: Response) => {
    try {
      const user = req.authUser!;
      const idToken = req.idToken!;
      if (!hasServerPermission(user, 'documents', 'view') && !hasFleetPermOnUser(user, 'fleet.documents.view')) {
        res.status(403).json({ error: 'صلاحياتك لا تسمح بعرض أو تنزيل المستندات الخاصة.' });
        return;
      }

      const docId = String(req.params.docId || '').trim();
      const docRecord = (await getFirestoreDoc('privateDocuments', docId, idToken)) as PrivateDocumentRecord | null;
      if (!docRecord) {
        res.status(404).json({ error: 'المستند غير موجود.' });
        return;
      }

      if (docRecord.entityType === 'rider' && !user.dataScope.allBranches) {
        const riderDoc = await getFirestoreDoc('riderMaster', docRecord.entityId, idToken).catch(() => null);
        if (
          riderDoc &&
          !matchesDataScope(
            {
              internalRiderId: docRecord.entityId,
              branch: typeof riderDoc.branch === 'string' ? riderDoc.branch : undefined,
              city: typeof riderDoc.city === 'string' ? riderDoc.city : undefined,
            },
            user.dataScope
          )
        ) {
          res.status(403).json({ error: 'لا تملك صلاحية عرض مستندات مندوب خارج نطاق فرعك.' });
          return;
        }
      }

      if (FLEET_VAULT_ENTITY_TYPES.has(docRecord.entityType)) {
        const vehicleDoc = await getFirestoreDoc('vehicles', docRecord.entityId, idToken).catch(() => null);
        if (vehicleDoc && !isVehicleInUserScope(vehicleDoc as never, user)) {
          res.status(403).json({ error: 'لا تملك صلاحية عرض مستندات مركبة خارج نطاق فرعك.' });
          return;
        }
      }

      const reqVersion = req.query.version ? Number(req.query.version) : docRecord.currentVersion;
      const versionObj =
        docRecord.versions?.find((v) => v.version === reqVersion) ||
        docRecord.versions?.[docRecord.versions.length - 1];
      if (!versionObj) {
        res.status(404).json({ error: 'نسخة المستند غير متوفرة.' });
        return;
      }

      const fileBuf = await readPrivateVaultFile(versionObj.storageKey);
      const isDownload = req.query.download === '1' || req.query.download === 'true';
      const safeName = (versionObj.originalFileName || `${docId}.pdf`).replace(/[^a-zA-Z0-9._\-\u0600-\u06FF ]/g, '_');

      // Audit view/download access
      const accessLogId = `log_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      void setLocalDoc('auditLogs', accessLogId, {
        logId: accessLogId,
        action: isDownload ? 'DOCUMENT_DOWNLOADED' : 'DOCUMENT_VIEWED',
        targetCollection: 'privateDocuments',
        targetId: docId,
        entityType: 'document',
        actorUid: user.uid,
        actorEmail: user.email,
        details: `${isDownload ? 'تنزيل' : 'معاينة'} ملف: ${docRecord.title} (إصدار ${versionObj.version})`,
        source: 'API',
        allowedUids: [user.uid],
        createdAt: new Date().toISOString(),
      }).catch(() => {});

      res.setHeader('Content-Type', versionObj.mimeType || 'application/octet-stream');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'private, no-store, max-age=0');
      res.setHeader(
        'Content-Disposition',
        `${isDownload ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(safeName)}`
      );
      res.send(fileBuf);
    } catch (err) {
      res.status(404).json({ error: err instanceof Error ? err.message : 'تعذر قراءة ملف المستند.' });
    }
  });

  app.delete('/api/documents/:docId', requireAuth, async (req: AuthedRequest, res: Response) => {
    try {
      const user = req.authUser!;
      const idToken = req.idToken!;
      if (!hasServerPermission(user, 'documents', 'delete')) {
        res.status(403).json({ error: 'صلاحياتك لا تسمح بحذف المستندات.' });
        return;
      }
      const docId = String(req.params.docId || '').trim();
      const docRecord = (await getFirestoreDoc('privateDocuments', docId, idToken)) as PrivateDocumentRecord | null;
      if (!docRecord) {
        res.status(404).json({ error: 'المستند غير موجود.' });
        return;
      }

      for (const v of docRecord.versions || []) {
        await deletePrivateVaultFile(v.storageKey);
      }
      await deleteFirestoreDoc('privateDocuments', docId, idToken);

      const allowedUids = await getTeamAllowedUids(user.uid, idToken);
      const logId = `log_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      await commitFirestoreWrites(
        [
          {
            collection: 'auditLogs',
            docId: logId,
            data: {
              logId,
              action: 'DOCUMENT_DELETED',
              targetCollection: 'privateDocuments',
              targetId: docId,
              entityType: 'document',
              actorUid: user.uid,
              actorEmail: user.email,
              details: `حذف المستند: ${docRecord.title} (${docRecord.entityType}:${docRecord.entityId})`,
              oldValue: docRecord.title,
              source: 'API',
              allowedUids,
            },
            serverTimestampFields: ['createdAt'],
          },
        ],
        idToken
      );

      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'فشل حذف المستند.' });
    }
  });

  // ==========================================
  // ENTERPRISE FLEET MANAGEMENT APIs (PHASE 1 & 2)
  // ==========================================
  const handleFleetError = (res: Response, err: unknown, fallbackMsg: string) => {
    const status =
      typeof err === 'object' &&
      err !== null &&
      'statusCode' in err &&
      typeof (err as { statusCode?: number }).statusCode === 'number'
        ? (err as { statusCode: number }).statusCode
        : 400;
    res.status(status).json({ error: err instanceof Error ? err.message : fallbackMsg });
  };

  app.post('/api/fleet/migration/sync', requireAuth, async (req: AuthedRequest, res: Response) => {
    try {
      const user = req.authUser!;
      if (user.role !== 'owner' && user.role !== 'admin' && !hasFleetPermOnUser(user, 'fleet.settings.manage')) {
        res.status(403).json({ error: 'صلاحياتك لا تسمح بتشغيل مزامنة وترحيل بيانات الأسطول.' });
        return;
      }
      const createPreMigrationBackup = req.body?.createPreMigrationBackup !== false;
      const result = await runSafeFleetPhase1Migration({
        actorUid: user.uid,
        actorEmail: user.email,
        createPreMigrationBackup,
      });
      res.json(result);
    } catch (err) {
      handleFleetError(res, err, 'فشل تشغيل مزامنة بيانات الأسطول.');
    }
  });

  app.get('/api/fleet/overview', requireAuth, async (req: AuthedRequest, res: Response) => {
    try {
      const overview = await getScopedFleetOverview(req.authUser!);
      res.json({ ok: true, ...overview });
    } catch (err) {
      handleFleetError(res, err, 'تعذر تحميل نظرة الأسطول.');
    }
  });

  app.get('/api/fleet/availability', requireAuth, async (req: AuthedRequest, res: Response) => {
    try {
      const matrix = await getFleetAvailabilityMatrix(req.authUser!);
      res.json({ ok: true, ...matrix });
    } catch (err) {
      handleFleetError(res, err, 'تعذر تحميل مصفوفة جاهزية المركبات.');
    }
  });

  app.get('/api/fleet/vehicles/:vehicleId/profile360', requireAuth, async (req: AuthedRequest, res: Response) => {
    try {
      const vehicleId = String(req.params.vehicleId || '').trim();
      const profile = await getVehicleProfile360(req.authUser!, vehicleId);
      res.json({ ok: true, ...profile });
    } catch (err) {
      handleFleetError(res, err, 'تعذر تحميل ملف المركبة 360.');
    }
  });

  app.post('/api/fleet/vehicles', requireAuth, async (req: AuthedRequest, res: Response) => {
    try {
      const idempotencyKey = String(req.headers['idempotency-key'] || '').trim() || undefined;
      const result = await createVehicleTransactional(req.authUser!, (req.body || {}) as CreateVehicleInput, idempotencyKey);
      res.status(201).json({ ok: true, ...result });
    } catch (err) {
      handleFleetError(res, err, 'تعذر تسجيل المركبة الجديدة.');
    }
  });

  app.patch('/api/fleet/vehicles/:vehicleId', requireAuth, async (req: AuthedRequest, res: Response) => {
    try {
      const vehicleId = String(req.params.vehicleId || '').trim();
      const idempotencyKey = String(req.headers['idempotency-key'] || '').trim() || undefined;
      const result = await updateVehicleTransactional(req.authUser!, vehicleId, (req.body || {}) as Partial<CreateVehicleInput>, idempotencyKey);
      res.json({ ok: true, ...result });
    } catch (err) {
      handleFleetError(res, err, 'تعذر تحديث بيانات المركبة.');
    }
  });

  app.post('/api/fleet/vehicles/:vehicleId/status', requireAuth, async (req: AuthedRequest, res: Response) => {
    try {
      const vehicleId = String(req.params.vehicleId || '').trim();
      const idempotencyKey = String(req.headers['idempotency-key'] || '').trim() || undefined;
      const result = await transitionVehicleStatusTransactional(
        req.authUser!,
        vehicleId,
        {
          toStatus: req.body?.toStatus,
          reason: req.body?.reason,
        },
        idempotencyKey
      );
      res.json({ ok: true, ...result });
    } catch (err) {
      handleFleetError(res, err, 'تعذر تغيير حالة المركبة.');
    }
  });

  // Phase 3: Assignment Request, Dual-Stage Approvals & Delegation Management
  app.post('/api/fleet/assignments/request', requireAuth, async (req: AuthedRequest, res: Response) => {
    try {
      const idempotencyKey = String(req.headers['idempotency-key'] || '').trim() || undefined;
      const result = await requestVehicleAssignmentTransactional(
        req.authUser!,
        (req.body || {}) as RequestVehicleAssignmentInput,
        idempotencyKey
      );
      res.status(201).json({ ok: true, ...result });
    } catch (err) {
      handleFleetError(res, err, 'تعذر رفع طلب ربط وتفويض المركبة.');
    }
  });

  app.post('/api/fleet/approvals/:requestId/operations-decision', requireAuth, async (req: AuthedRequest, res: Response) => {
    try {
      const requestId = String(req.params.requestId || '').trim();
      const idempotencyKey = String(req.headers['idempotency-key'] || '').trim() || undefined;
      const result = await decideOperationsApprovalTransactional(
        req.authUser!,
        requestId,
        {
          decision: req.body?.decision,
          note: req.body?.note,
        },
        idempotencyKey
      );
      res.json({ ok: true, ...result });
    } catch (err) {
      handleFleetError(res, err, 'تعذر تنفيذ الاعتماد التشغيلي للطلب.');
    }
  });

  app.post('/api/fleet/approvals/:requestId/admin-decision', requireAuth, async (req: AuthedRequest, res: Response) => {
    try {
      const requestId = String(req.params.requestId || '').trim();
      const idempotencyKey = String(req.headers['idempotency-key'] || '').trim() || undefined;
      const result = await decideAdminApprovalTransactional(
        req.authUser!,
        requestId,
        {
          decision: req.body?.decision,
          note: req.body?.note,
        },
        idempotencyKey
      );
      res.json({ ok: true, ...result });
    } catch (err) {
      handleFleetError(res, err, 'تعذر تنفيذ الاعتماد الإداري النهائي للطلب.');
    }
  });

  app.post('/api/fleet/approvals/:requestId/delegation', requireAuth, async (req: AuthedRequest, res: Response) => {
    try {
      const requestId = String(req.params.requestId || '').trim();
      const idempotencyKey = String(req.headers['idempotency-key'] || '').trim() || undefined;
      const result = await attachDelegationToApprovalTransactional(
        req.authUser!,
        requestId,
        {
          delegationNumber: req.body?.delegationNumber,
          delegationStartDate: req.body?.delegationStartDate,
          delegationExpiryDate: req.body?.delegationExpiryDate,
          privateDocId: req.body?.privateDocId,
          issuerName: req.body?.issuerName,
          notes: req.body?.notes,
        },
        idempotencyKey
      );
      res.json({ ok: true, ...result });
    } catch (err) {
      handleFleetError(res, err, 'تعذر إرفاق وثيقة التفويض بالطلب.');
    }
  });

  app.post('/api/fleet/approvals/:requestId/cancel', requireAuth, async (req: AuthedRequest, res: Response) => {
    try {
      const requestId = String(req.params.requestId || '').trim();
      const idempotencyKey = String(req.headers['idempotency-key'] || '').trim() || undefined;
      const result = await cancelFleetApprovalTransactional(
        req.authUser!,
        requestId,
        req.body?.reason,
        idempotencyKey
      );
      res.json({ ok: true, ...result });
    } catch (err) {
      handleFleetError(res, err, 'تعذر إلغاء طلب الاعتماد.');
    }
  });

  // Phase 4: Enterprise Handover, Return Inspection & Custody Transfer
  app.post('/api/fleet/handovers', requireAuth, async (req: AuthedRequest, res: Response) => {
    try {
      const idempotencyKey = String(req.headers['idempotency-key'] || '').trim() || undefined;
      const result = await executeVehicleHandoverTransactional(
        req.authUser!,
        (req.body || {}) as ExecuteHandoverInput,
        idempotencyKey
      );
      res.status(201).json({ ok: true, ...result });
    } catch (err) {
      handleFleetError(res, err, 'تعذر تنفيذ محضر تسليم المركبة.');
    }
  });

  app.post('/api/fleet/returns', requireAuth, async (req: AuthedRequest, res: Response) => {
    try {
      const idempotencyKey = String(req.headers['idempotency-key'] || '').trim() || undefined;
      const result = await executeVehicleReturnTransactional(
        req.authUser!,
        (req.body || {}) as ExecuteReturnInput,
        idempotencyKey
      );
      res.status(201).json({ ok: true, ...result });
    } catch (err) {
      handleFleetError(res, err, 'تعذر تنفيذ محضر استلام وفحص المركبة.');
    }
  });

  app.post('/api/fleet/returns/:returnId/approve', requireAuth, async (req: AuthedRequest, res: Response) => {
    try {
      const returnId = String(req.params.returnId || '').trim();
      const idempotencyKey = String(req.headers['idempotency-key'] || '').trim() || undefined;
      const result = await approvePendingReturnTransactional(
        req.authUser!,
        returnId,
        {
          nextVehicleStatus: req.body?.nextVehicleStatus,
          note: req.body?.note,
        },
        idempotencyKey
      );
      res.json({ ok: true, ...result });
    } catch (err) {
      handleFleetError(res, err, 'تعذر اعتماد إغلاق محضر الاستلام.');
    }
  });

  app.post('/api/fleet/custodies/:custodyId/transfer', requireAuth, async (req: AuthedRequest, res: Response) => {
    try {
      const custodyId = String(req.params.custodyId || '').trim();
      const idempotencyKey = String(req.headers['idempotency-key'] || '').trim() || undefined;
      const result = await transferVehicleCustodyTransactional(
        req.authUser!,
        custodyId,
        {
          toRiderId: req.body?.toRiderId,
          transferDate: req.body?.transferDate,
          odometer: req.body?.odometer,
          fuelLevel: req.body?.fuelLevel,
          condition: req.body?.condition,
          notes: req.body?.notes,
        },
        idempotencyKey
      );
      res.json({ ok: true, ...result });
    } catch (err) {
      handleFleetError(res, err, 'تعذر نقل عهدة المركبة إلى المندوب الجديد.');
    }
  });

  // Phase 5: Maintenance Work Orders, Damage Claims & Structured Documents
  app.post('/api/fleet/maintenance', requireAuth, async (req: AuthedRequest, res: Response) => {
    try {
      const idempotencyKey = String(req.headers['idempotency-key'] || '').trim() || undefined;
      const result = await createMaintenanceWorkOrderTransactional(
        req.authUser!,
        (req.body || {}) as CreateMaintenanceInput,
        idempotencyKey
      );
      res.status(201).json({ ok: true, ...result });
    } catch (err) {
      handleFleetError(res, err, 'تعذر فتح أمر الصيانة.');
    }
  });

  app.post('/api/fleet/maintenance/:maintenanceId/complete', requireAuth, async (req: AuthedRequest, res: Response) => {
    try {
      const maintenanceId = String(req.params.maintenanceId || '').trim();
      const idempotencyKey = String(req.headers['idempotency-key'] || '').trim() || undefined;
      const result = await completeMaintenanceWorkOrderTransactional(
        req.authUser!,
        maintenanceId,
        {
          actualCost: req.body?.actualCost,
          completedOdometer: req.body?.completedOdometer,
          completedAt: req.body?.completedAt,
          invoiceDocId: req.body?.invoiceDocId,
          releaseVehicleToAvailable: req.body?.releaseVehicleToAvailable,
          details: req.body?.details,
        },
        idempotencyKey
      );
      res.json({ ok: true, ...result });
    } catch (err) {
      handleFleetError(res, err, 'تعذر إغلاق واعتماد أمر الصيانة.');
    }
  });

  app.patch('/api/fleet/damage-claims/:claimId', requireAuth, async (req: AuthedRequest, res: Response) => {
    try {
      const claimId = String(req.params.claimId || '').trim();
      const idempotencyKey = String(req.headers['idempotency-key'] || '').trim() || undefined;
      const result = await updateDamageClaimTransactional(
        req.authUser!,
        claimId,
        {
          liability: req.body?.liability,
          status: req.body?.status,
          actualRepairCost: req.body?.actualRepairCost,
          notes: req.body?.notes,
        },
        idempotencyKey
      );
      res.json({ ok: true, ...result });
    } catch (err) {
      handleFleetError(res, err, 'تعذر تحديث مطالبة الضرر.');
    }
  });

  app.post('/api/fleet/documents', requireAuth, async (req: AuthedRequest, res: Response) => {
    try {
      const idempotencyKey = String(req.headers['idempotency-key'] || '').trim() || undefined;
      const result = await upsertVehicleDocumentTransactional(
        req.authUser!,
        {
          vehicleDocId: req.body?.vehicleDocId,
          vehicleInternalId: req.body?.vehicleInternalId,
          docCategory: req.body?.docCategory,
          titleAr: req.body?.titleAr,
          documentNumber: req.body?.documentNumber,
          issuerName: req.body?.issuerName,
          issueDate: req.body?.issueDate,
          expiryDate: req.body?.expiryDate,
          privateDocId: req.body?.privateDocId,
          notes: req.body?.notes,
        },
        idempotencyKey
      );
      res.json({ ok: true, ...result });
    } catch (err) {
      handleFleetError(res, err, 'تعذر حفظ وثيقة المركبة.');
    }
  });

  app.post('/api/fleet/documents/:vehicleDocId/decision', requireAuth, async (req: AuthedRequest, res: Response) => {
    try {
      const vehicleDocId = String(req.params.vehicleDocId || '').trim();
      const idempotencyKey = String(req.headers['idempotency-key'] || '').trim() || undefined;
      const result = await decideVehicleDocumentTransactional(
        req.authUser!,
        vehicleDocId,
        {
          decision: req.body?.decision,
          rejectionReason: req.body?.rejectionReason,
        },
        idempotencyKey
      );
      res.json({ ok: true, ...result });
    } catch (err) {
      handleFleetError(res, err, 'تعذر اعتماد أو رفض وثيقة المركبة.');
    }
  });

  // Phase 7: Fleet Settings & Notification Read Endpoints
  app.patch('/api/fleet/settings', requireAuth, async (req: AuthedRequest, res: Response) => {
    try {
      const idempotencyKey = String(req.headers['idempotency-key'] || '').trim() || undefined;
      const result = await updateFleetConfigTransactional(
        req.authUser!,
        (req.body || {}) as Record<string, unknown>,
        idempotencyKey
      );
      res.json({ ok: true, ...result });
    } catch (err) {
      handleFleetError(res, err, 'تعذر تحديث إعدادات وسياسات الأسطول.');
    }
  });

  app.post('/api/fleet/notifications/read', requireAuth, async (req: AuthedRequest, res: Response) => {
    try {
      const result = await markFleetNotificationsReadTransactional(req.authUser!, {
        notificationIds: Array.isArray(req.body?.notificationIds) ? req.body.notificationIds : undefined,
        markAll: Boolean(req.body?.markAll),
      });
      res.json({ ok: true, ...result });
    } catch (err) {
      handleFleetError(res, err, 'تعذر تحديث حالة قراءة إشعارات الأسطول.');
    }
  });

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'نقطة النهاية المطلوبة غير موجودة.' });
  });

  app.use('/api', (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status =
      typeof err === 'object' &&
      err !== null &&
      'status' in err &&
      typeof (err as { status?: number }).status === 'number'
        ? (err as { status: number }).status
        : 400;
    const message = err instanceof Error ? err.message : 'حدث خطأ في خادم المعالجة.';
    res.status(status).json({ error: message });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const PORT = Number(process.env.PORT) || 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Fleet Operations Center server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
