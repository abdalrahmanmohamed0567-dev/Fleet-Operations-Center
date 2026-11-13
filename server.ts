import crypto from 'crypto';
import dotenv from 'dotenv';
import express, { type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import type { ImportPreviewResult, UserRole } from './src/types/fleet.js';
import { parseExcelBuffer, type ParsedWorkbookOutput } from './src/server/excelParser.js';
import { buildExcelReportBuffer, type ExportColumn } from './src/server/exportEngine.js';
import {
  batchCheckExisting,
  commitFirestoreWrites,
  extractAffectedDates,
  listFirestoreCollection,
  recomputeSummariesForDates,
  verifyUserFromToken,
  type VerifiedAuthUser,
  type WriteOperation,
} from './src/server/firestoreRest.js';

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

interface AuthedRequest extends Request {
  authUser?: VerifiedAuthUser;
  idToken?: string;
}

const IMPORT_ALLOWED_ROLES: UserRole[] = ['owner', 'admin', 'operations_manager'];

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

  // Preview uploaded local Excel files OR Google Drive Excel files
  app.post('/api/import/preview', requireAuth, upload.array('files', 10), async (req: AuthedRequest, res: Response) => {
    try {
      const user = req.authUser!;
      const idToken = req.idToken!;
      if (!IMPORT_ALLOWED_ROLES.includes(user.role)) {
        res.status(403).json({ error: 'صلاحياتك الحالية لا تسمح باستيراد التقارير.' });
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
        parsedList.push(parsed);

        // Compare against Firestore existing records for true idempotent preview
        const lookupKeys = parsed.records.map((r) => ({ collection: r.collection, docId: r.data.recordKey }));
        const existingMap = await batchCheckExisting(lookupKeys, idToken);

        let newCount = 0;
        let updatedCount = 0;
        let duplicateCount = 0;

        const sheetStatMap = new Map(parsed.sheetDiagnostics.map((s) => [s.sheetName, s]));
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

          if (previewRows.length < 40) {
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
      if (!IMPORT_ALLOWED_ROLES.includes(user.role)) {
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

  // Server-side Excel export (+ optional upload to Google Drive)
  app.post('/api/export/excel', requireAuth, async (req: AuthedRequest, res: Response) => {
    try {
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
      res.send(buffer);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'فشل تصدير ملف Excel.' });
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
