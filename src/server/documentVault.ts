import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';

const VAULT_ROOT = path.resolve(process.cwd(), process.env.PRIVATE_VAULT_DIR || '.private_vault');
const BRANDING_ROOT = path.resolve(VAULT_ROOT, 'branding');
const PUBLIC_BRANDING_FILE = path.resolve(BRANDING_ROOT, 'public_branding.json');

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
]);

const EXTENDED_FILE_MIMES = new Map<string, { mime: string; ext: string }>([
  ['.pdf', { mime: 'application/pdf', ext: '.pdf' }],
  ['.jpg', { mime: 'image/jpeg', ext: '.jpg' }],
  ['.jpeg', { mime: 'image/jpeg', ext: '.jpg' }],
  ['.png', { mime: 'image/png', ext: '.png' }],
  ['.webp', { mime: 'image/webp', ext: '.webp' }],
  ['.xlsx', { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: '.xlsx' }],
  ['.xls', { mime: 'application/vnd.ms-excel', ext: '.xls' }],
  ['.csv', { mime: 'text/csv', ext: '.csv' }],
  ['.docx', { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ext: '.docx' }],
  ['.doc', { mime: 'application/msword', ext: '.doc' }],
  ['.txt', { mime: 'text/plain', ext: '.txt' }],
]);

export function sanitizeStorageKey(rawKey: string): string {
  const clean = rawKey.replace(/[^a-zA-Z0-9._-]/g, '_');
  if (!clean || clean.includes('..') || clean.startsWith('.')) {
    throw new Error('مفتاح التخزين غير صالح.');
  }
  return clean;
}

export function validateVaultMimeType(
  mimeType: string,
  originalFileName: string,
  allowExtended = false
): { normalizedMime: string; ext: string } {
  const lowerMime = (mimeType || '').toLowerCase().trim();
  const rawExt = path.extname(originalFileName || '').toLowerCase();

  if (ALLOWED_MIME_TYPES.has(lowerMime)) {
    const normalized = lowerMime === 'image/jpg' ? 'image/jpeg' : lowerMime;
    const ext =
      normalized === 'application/pdf'
        ? '.pdf'
        : normalized === 'image/png'
          ? '.png'
          : normalized === 'image/webp'
            ? '.webp'
            : '.jpg';
    return { normalizedMime: normalized, ext };
  }
  if (rawExt === '.pdf') return { normalizedMime: 'application/pdf', ext: '.pdf' };
  if (rawExt === '.jpg' || rawExt === '.jpeg') return { normalizedMime: 'image/jpeg', ext: '.jpg' };
  if (rawExt === '.png') return { normalizedMime: 'image/png', ext: '.png' };
  if (rawExt === '.webp') return { normalizedMime: 'image/webp', ext: '.webp' };

  if (allowExtended) {
    const byExt = EXTENDED_FILE_MIMES.get(rawExt);
    if (byExt) return { normalizedMime: byExt.mime, ext: byExt.ext };
    for (const entry of EXTENDED_FILE_MIMES.values()) {
      if (entry.mime === lowerMime) return { normalizedMime: entry.mime, ext: entry.ext };
    }
  }

  throw new Error(
    allowExtended
      ? 'نوع الملف غير مسموح به. الأنواع المسموحة: PDF، الصور، Excel/CSV، Word، أو TXT.'
      : 'يُسمح فقط بملفات PDF والصور (JPG, PNG, WEBP) في الخزينة الخاصة.'
  );
}

export async function savePrivateVaultFile(params: {
  buffer: Buffer;
  docId: string;
  version: number;
  originalFileName: string;
  mimeType: string;
  allowExtended?: boolean;
}): Promise<{ storageKey: string; sha256: string; normalizedMime: string; sizeBytes: number }> {
  if (!params.buffer || params.buffer.length === 0) {
    throw new Error('الملف المرفوع فارغ.');
  }
  if (params.buffer.length > 15 * 1024 * 1024) {
    throw new Error('الحد الأقصى لحجم المستند هو 15 ميجابايت.');
  }

  const { normalizedMime, ext } = validateVaultMimeType(
    params.mimeType,
    params.originalFileName,
    Boolean(params.allowExtended)
  );
  const sha256 = crypto.createHash('sha256').update(params.buffer).digest('hex');

  const safeDocId = sanitizeStorageKey(params.docId);
  const rand = crypto.randomBytes(6).toString('hex');
  const storageKey = sanitizeStorageKey(`${safeDocId}_v${params.version}_${rand}${ext}`);

  await fs.mkdir(VAULT_ROOT, { recursive: true });
  const targetPath = path.resolve(VAULT_ROOT, storageKey);
  if (!targetPath.startsWith(VAULT_ROOT + path.sep)) {
    throw new Error('مسار التخزين غير مصرح به.');
  }
  await fs.writeFile(targetPath, params.buffer, { mode: 0o600 });

  return {
    storageKey,
    sha256,
    normalizedMime,
    sizeBytes: params.buffer.length,
  };
}

export async function readPrivateVaultFile(storageKey: string): Promise<Buffer> {
  const safeKey = sanitizeStorageKey(storageKey);
  const targetPath = path.resolve(VAULT_ROOT, safeKey);
  if (!targetPath.startsWith(VAULT_ROOT + path.sep)) {
    throw new Error('مسار القراءة غير مصرح به.');
  }
  try {
    return await fs.readFile(targetPath);
  } catch {
    throw new Error('تعذر العثور على ملف المستند في الخزينة الخاصة.');
  }
}

export async function deletePrivateVaultFile(storageKey: string): Promise<void> {
  try {
    const safeKey = sanitizeStorageKey(storageKey);
    const targetPath = path.resolve(VAULT_ROOT, safeKey);
    if (targetPath.startsWith(VAULT_ROOT + path.sep)) {
      await fs.unlink(targetPath);
    }
  } catch {
    // Ignore missing file on cleanup
  }
}

export async function saveBrandingLogoFile(params: {
  slot: 'primary' | 'alternate' | 'icon';
  buffer: Buffer;
  originalFileName: string;
  mimeType: string;
}): Promise<{ logoKey: string; mimeType: string; sizeBytes: number }> {
  if (!params.buffer || params.buffer.length === 0) {
    throw new Error('ملف الشعار فارغ.');
  }
  if (params.buffer.length > 5 * 1024 * 1024) {
    throw new Error('الحد الأقصى لحجم الشعار هو 5 ميجابايت.');
  }
  const { normalizedMime, ext } = validateVaultMimeType(params.mimeType, params.originalFileName, false);
  if (!normalizedMime.startsWith('image/')) {
    throw new Error('يجب أن يكون الشعار صورة (PNG, JPG, WEBP).');
  }
  await fs.mkdir(BRANDING_ROOT, { recursive: true });
  const logoKey = sanitizeStorageKey(`logo_${params.slot}_${Date.now()}${ext}`);
  const targetPath = path.resolve(BRANDING_ROOT, logoKey);
  if (!targetPath.startsWith(BRANDING_ROOT + path.sep)) {
    throw new Error('مسار الشعار غير مصرح به.');
  }
  await fs.writeFile(targetPath, params.buffer, { mode: 0o644 });
  return { logoKey, mimeType: normalizedMime, sizeBytes: params.buffer.length };
}

export async function readBrandingLogoFile(logoKey: string): Promise<{ buffer: Buffer; mimeType: string }> {
  const safeKey = sanitizeStorageKey(logoKey);
  const targetPath = path.resolve(BRANDING_ROOT, safeKey);
  if (!targetPath.startsWith(BRANDING_ROOT + path.sep)) {
    throw new Error('مسار الشعار غير مصرح به.');
  }
  const buffer = await fs.readFile(targetPath);
  const ext = path.extname(safeKey).toLowerCase();
  const mimeType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
  return { buffer, mimeType };
}

export async function saveBrandingPublicMetadata(payload: Record<string, unknown>): Promise<void> {
  await fs.mkdir(BRANDING_ROOT, { recursive: true });
  await fs.writeFile(PUBLIC_BRANDING_FILE, JSON.stringify(payload, null, 2), { mode: 0o644 });
}

export async function readBrandingPublicMetadata(): Promise<Record<string, unknown> | null> {
  try {
    const raw = await fs.readFile(PUBLIC_BRANDING_FILE, 'utf-8');
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function getPrivateVaultStats(): Promise<{ exists: boolean; fileCount: number; totalBytes: number }> {
  try {
    await fs.mkdir(VAULT_ROOT, { recursive: true });
    const entries = await fs.readdir(VAULT_ROOT, { withFileTypes: true });
    let fileCount = 0;
    let totalBytes = 0;
    for (const ent of entries) {
      if (ent.isFile()) {
        fileCount++;
        const st = await fs.stat(path.resolve(VAULT_ROOT, ent.name));
        totalBytes += st.size;
      }
    }
    return { exists: true, fileCount, totalBytes };
  } catch {
    return { exists: false, fileCount: 0, totalBytes: 0 };
  }
}

