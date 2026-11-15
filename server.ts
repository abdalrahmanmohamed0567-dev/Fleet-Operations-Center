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
import { matchesDataScope } from './src/shared/rbacCore.js';

dotenv.config();

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
  const app = express();
  app.use(express.json({ limit: '15mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'fleet-operations-center' });
  });

  // Non-sensitive Corporate Branding for AuthGate Login & Pre-boot Shell
  app.get('/api/branding/public', async (_req, res) => {
    const cached = await readBrandingPublicMetadata();
    res.json({ branding: cached || null });
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
      const safePublic = {
        companyNameAr: String(body.companyNameAr || ''),
        companyNameEn: String(body.companyNameEn || ''),
        systemNameAr: String(body.systemNameAr || 'FLEET OPERATIONS CENTER'),
        systemNameEn: String(body.systemNameEn || 'Fleet Operations Center'),
        primaryLogoKey: String(body.primaryLogoKey || ''),
        alternateLogoKey: String(body.alternateLogoKey || ''),
        iconLogoKey: String(body.iconLogoKey || ''),
        primaryColor: String(body.primaryColor || '#0f1e36'),
        secondaryColor: String(body.secondaryColor || '#2563eb'),
        buttonColor: String(body.buttonColor || '#1d4ed8'),
        sidebarColor: String(body.sidebarColor || '#0c1628'),
        uiStyleMode: String(body.uiStyleMode || 'corporate'),
        defaultThemeMode: String(body.defaultThemeMode || 'light'),
        loginScreenStyle: String(body.loginScreenStyle || 'split'),
        loginHeadlineAr: String(body.loginHeadlineAr || ''),
        loginSubheadlineAr: String(body.loginSubheadlineAr || ''),
        developerName: String(body.developerName || 'م- عبدالرحمن محمد'),
        developerPhone: String(body.developerPhone || '0559786939'),
        version: String(body.version || 'v4.0 Enterprise'),
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
      try {
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
      } catch {
        firestoreOk = false;
        firestoreLatencyMs = Date.now() - startedAt;
      }
      const vault = await getPrivateVaultStats();
      const mem = process.memoryUsage();
      res.json({
        ok: firestoreOk && vault.exists,
        checkedAt: new Date().toISOString(),
        serverUptimeSeconds: Math.round(process.uptime()),
        memoryRssMb: Math.round(mem.rss / (1024 * 1024)),
        memoryHeapUsedMb: Math.round(mem.heapUsed / (1024 * 1024)),
        firestore: { ok: firestoreOk, latencyMs: firestoreLatencyMs },
        vault,
        imports: { recentBatchesCount, latestBatchAt },
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'فشل فحص صحة النظام.' });
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
  app.post('/api/documents/upload', requireAuth, docUpload.single('file'), async (req: AuthedRequest, res: Response) => {
    try {
      const user = req.authUser!;
      const idToken = req.idToken!;
      const existingDocId = String(req.body?.docId || '').trim();
      const isReplace = Boolean(existingDocId);

      if (isReplace ? !hasServerPermission(user, 'documents', 'edit') : !hasServerPermission(user, 'documents', 'add')) {
        res.status(403).json({ error: 'صلاحياتك الحالية لا تسمح برفع أو استبدال المستندات.' });
        return;
      }

      const uploadedFile = req.file;
      if (!uploadedFile) {
        res.status(400).json({ error: 'لم يتم إرفاق ملف المستند.' });
        return;
      }

      const entityType = String(req.body?.entityType || '').trim() as 'rider' | 'vehicle' | 'handover' | 'custom_field' | 'branding';
      const entityId = String(req.body?.entityId || '').trim();
      const entityLabel = String(req.body?.entityLabel || '').trim().slice(0, 180);
      const docTypeId = String(req.body?.docTypeId || '').trim();
      const docTypeName = String(req.body?.docTypeName || docTypeId).trim().slice(0, 120);
      const title = String(req.body?.title || docTypeName).trim().slice(0, 180);
      const issueDate = String(req.body?.issueDate || '').trim().slice(0, 10);
      const expiryDate = String(req.body?.expiryDate || '').trim().slice(0, 10);
      const notes = String(req.body?.notes || '').trim().slice(0, 600);
      const versionNote = String(req.body?.versionNote || '').trim().slice(0, 300);

      if (!['rider', 'vehicle', 'handover', 'custom_field', 'branding'].includes(entityType) || !entityId || !docTypeId) {
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
      if (!hasServerPermission(user, 'documents', 'view')) {
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
