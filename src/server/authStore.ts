import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import type {
  CapabilityMap,
  DataScope,
  PermissionMatrix,
  Platform,
  RoleTemplate,
  UserProfile,
  UserRole,
} from '../types/fleet.js';
import {
  BOOTSTRAPPED_OWNER_EMAIL_LOWER,
  createFullCapabilities,
  createFullPermissionMatrix,
  mapTemplateToLegacyRole,
  resolveDataScope,
  resolveEffectiveCapabilities,
  resolveEffectivePermissions,
} from '../shared/rbacCore.js';
import { getLocalDoc, listLocalCollection, setLocalDoc } from './localStore.js';

const VAULT_ROOT = path.resolve(process.cwd(), process.env.PRIVATE_VAULT_DIR || '.private_vault');
const STORE_ROOT = path.resolve(VAULT_ROOT, 'store');
const AUTH_USERS_FILE = path.resolve(STORE_ROOT, 'auth_users.json');
const SESSION_SECRET_FILE = path.resolve(VAULT_ROOT, '.session_secret');

export const BOOTSTRAPPED_ADMIN_UID = 'owner_0559786939';
export const BOOTSTRAPPED_ADMIN_PHONE = '0559786939';
export const BOOTSTRAPPED_ADMIN_DEFAULT_PASSWORD = '0000';

export interface StoredAuthUser {
  uid: string;
  phone: string;
  email: string;
  displayName: string;
  passwordHash: string;
  role: UserRole;
  customRoleId: string;
  active: boolean;
  allowedPlatforms: Platform[];
  assignedBranch?: string;
  assignedCity?: string;
  dataScope?: DataScope;
  permissionOverrides?: UserProfile['permissionOverrides'];
  capabilityOverrides?: UserProfile['capabilityOverrides'];
  managedByAdminUids?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ServerVerifiedUser {
  uid: string;
  phone: string;
  email: string;
  emailVerified: boolean;
  role: UserRole;
  customRoleId?: string;
  active: boolean;
  allowedPlatforms: Platform[];
  permissions: PermissionMatrix;
  capabilities: CapabilityMap;
  dataScope: DataScope;
}

const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

export function normalizePhone(raw: string): string {
  let out = '';
  for (const ch of String(raw || '').trim()) {
    const arIdx = ARABIC_DIGITS.indexOf(ch);
    if (arIdx >= 0) {
      out += String(arIdx);
      continue;
    }
    const faIdx = PERSIAN_DIGITS.indexOf(ch);
    if (faIdx >= 0) {
      out += String(faIdx);
      continue;
    }
    if ((ch >= '0' && ch <= '9') || ch === '+') {
      out += ch;
    }
  }
  if (out.startsWith('+966')) out = '0' + out.slice(4);
  else if (out.startsWith('00966')) out = '0' + out.slice(5);
  else if (out.startsWith('9665') && out.length === 12) out = '0' + out.slice(3);
  else if (out.startsWith('+')) out = out.slice(1);
  return out.replace(/\D/g, '');
}

export function hashPassword(plain: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(plain, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(plain: string, stored: string): boolean {
  const parts = String(stored || '').split(':');
  if (parts.length !== 2) return false;
  const [salt, expectedHex] = parts;
  if (!salt || !expectedHex) return false;
  const derived = crypto.scryptSync(plain, salt, 64);
  const expected = Buffer.from(expectedHex, 'hex');
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

let cachedSecret: string | null = null;
async function getSessionSecret(): Promise<string> {
  if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 16) {
    return process.env.SESSION_SECRET;
  }
  if (cachedSecret) return cachedSecret;
  await fs.mkdir(VAULT_ROOT, { recursive: true });
  try {
    const existing = (await fs.readFile(SESSION_SECRET_FILE, 'utf-8')).trim();
    if (existing.length >= 32) {
      cachedSecret = existing;
      return existing;
    }
  } catch {
    // create fresh secret
  }
  const fresh = crypto.randomBytes(32).toString('hex');
  await fs.writeFile(SESSION_SECRET_FILE, fresh, { mode: 0o600 });
  cachedSecret = fresh;
  return fresh;
}

let authLock: Promise<unknown> = Promise.resolve();
function withAuthLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = authLock.then(fn, fn);
  authLock = next.catch(() => undefined);
  return next;
}

async function readAuthUsersUnsafe(): Promise<Record<string, StoredAuthUser>> {
  try {
    const raw = await fs.readFile(AUTH_USERS_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, StoredAuthUser>;
    }
  } catch {
    // file missing
  }
  return {};
}

async function writeAuthUsersUnsafe(map: Record<string, StoredAuthUser>): Promise<void> {
  await fs.mkdir(STORE_ROOT, { recursive: true });
  const tmp = `${AUTH_USERS_FILE}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(map, null, 2), { mode: 0o600 });
  await fs.rename(tmp, AUTH_USERS_FILE);
}

export function toPublicUserProfile(u: StoredAuthUser): UserProfile {
  return {
    uid: u.uid,
    phone: u.phone,
    email: u.email,
    displayName: u.displayName,
    role: u.role,
    customRoleId: u.customRoleId,
    active: u.active,
    allowedPlatforms: u.allowedPlatforms,
    assignedBranch: u.assignedBranch,
    assignedCity: u.assignedCity,
    dataScope: u.dataScope,
    permissionOverrides: u.permissionOverrides,
    capabilityOverrides: u.capabilityOverrides,
    managedByAdminUids: u.managedByAdminUids,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
  };
}

async function syncUserToLocalCollection(u: StoredAuthUser): Promise<void> {
  await setLocalDoc('users', u.uid, toPublicUserProfile(u) as unknown as Record<string, unknown>);
}

export async function ensureBootstrappedAdmin(forceResetDefaultPassword = false): Promise<StoredAuthUser> {
  return withAuthLock(async () => {
    const map = await readAuthUsersUnsafe();
    const nowIso = new Date().toISOString();
    const existing =
      map[BOOTSTRAPPED_ADMIN_UID] ||
      Object.values(map).find((u) => normalizePhone(u.phone) === BOOTSTRAPPED_ADMIN_PHONE);

    if (existing && !forceResetDefaultPassword) {
      const colDoc = await getLocalDoc('users', existing.uid);
      if (!colDoc) {
        await syncUserToLocalCollection(existing);
      }
      return existing;
    }

    const adminUser: StoredAuthUser = {
      uid: BOOTSTRAPPED_ADMIN_UID,
      phone: BOOTSTRAPPED_ADMIN_PHONE,
      email: BOOTSTRAPPED_OWNER_EMAIL_LOWER,
      displayName: 'المدير العام — عبدالرحمن محمد',
      passwordHash: hashPassword(BOOTSTRAPPED_ADMIN_DEFAULT_PASSWORD),
      role: 'owner',
      customRoleId: 'super_admin',
      active: true,
      allowedPlatforms: ['hungerstation', 'keeta'],
      dataScope: { allBranches: true, branches: [], cities: [], platforms: [], riderIds: [] },
      managedByAdminUids: [BOOTSTRAPPED_ADMIN_UID],
      createdAt: existing?.createdAt || nowIso,
      updatedAt: nowIso,
    };

    map[adminUser.uid] = adminUser;
    await writeAuthUsersUnsafe(map);
    await syncUserToLocalCollection(adminUser);
    return adminUser;
  });
}

export async function signSessionToken(user: StoredAuthUser): Promise<string> {
  const secret = await getSessionSecret();
  const exp = Date.now() + 30 * 24 * 60 * 60 * 1000;
  const payload = Buffer.from(
    JSON.stringify({ uid: user.uid, phone: user.phone, iat: Date.now(), exp }),
    'utf-8'
  ).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `foc_sess_${payload}.${sig}`;
}

export function isServerSessionToken(token: string): boolean {
  return typeof token === 'string' && token.startsWith('foc_sess_');
}

export async function authenticateByPhonePassword(
  rawPhone: string,
  rawPassword: string
): Promise<{ token: string; profile: UserProfile }> {
  await ensureBootstrappedAdmin(false);
  const phone = normalizePhone(rawPhone);
  const password = String(rawPassword || '');
  if (!phone || !password) {
    throw new Error('يرجى إدخال رقم الجوال وكلمة المرور.');
  }

  const map = await readAuthUsersUnsafe();
  const matched = Object.values(map).find((u) => normalizePhone(u.phone) === phone);
  if (!matched || !verifyPassword(password, matched.passwordHash)) {
    throw new Error('رقم الجوال أو كلمة المرور غير صحيحة.');
  }
  if (!matched.active) {
    throw new Error('هذا الحساب معلّق أو غير مفعّل. يرجى التواصل مع مدير النظام.');
  }

  const token = await signSessionToken(matched);
  return { token, profile: toPublicUserProfile(matched) };
}

export async function verifySessionTokenToUser(token: string): Promise<ServerVerifiedUser> {
  if (!isServerSessionToken(token)) {
    throw new Error('رمز الجلسة غير صالح.');
  }
  const body = token.slice('foc_sess_'.length);
  const dotIdx = body.indexOf('.');
  if (dotIdx <= 0) {
    throw new Error('تنسيق رمز الجلسة غير صالح.');
  }
  const payloadB64 = body.slice(0, dotIdx);
  const sigB64 = body.slice(dotIdx + 1);

  const secret = await getSessionSecret();
  const expectedSig = crypto.createHmac('sha256', secret).update(payloadB64).digest();
  const providedSig = Buffer.from(sigB64, 'base64url');
  if (expectedSig.length !== providedSig.length || !crypto.timingSafeEqual(expectedSig, providedSig)) {
    throw new Error('انتهت صلاحية الجلسة أو التوقيع غير صالح.');
  }

  const decoded = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8')) as {
    uid?: string;
    exp?: number;
  };
  if (!decoded.uid || !decoded.exp || Date.now() > decoded.exp) {
    throw new Error('انتهت صلاحية الجلسة. يرجى تسجيل الدخول مرة أخرى.');
  }

  await ensureBootstrappedAdmin(false);
  const map = await readAuthUsersUnsafe();
  const stored = map[decoded.uid];
  if (!stored) {
    throw new Error('المستخدم غير موجود أو تم حذفه.');
  }

  // Reconcile any live RBAC edits stored in the `users` collection
  const colDoc = (await getLocalDoc('users', stored.uid)) as Partial<UserProfile> | null;
  const mergedProfile: UserProfile = {
    ...toPublicUserProfile(stored),
    ...(colDoc || {}),
    uid: stored.uid,
    phone: stored.phone,
  };

  const isOwner =
    mergedProfile.role === 'owner' ||
    mergedProfile.uid === BOOTSTRAPPED_ADMIN_UID ||
    mergedProfile.email.trim().toLowerCase() === BOOTSTRAPPED_OWNER_EMAIL_LOWER;

  if (isOwner) {
    return {
      uid: mergedProfile.uid,
      phone: stored.phone,
      email: mergedProfile.email,
      emailVerified: true,
      role: 'owner',
      customRoleId: mergedProfile.customRoleId || 'super_admin',
      active: Boolean(mergedProfile.active),
      allowedPlatforms: ['hungerstation', 'keeta'],
      permissions: createFullPermissionMatrix(),
      capabilities: createFullCapabilities(),
      dataScope: { allBranches: true, branches: [], cities: [], platforms: [], riderIds: [] },
    };
  }

  const roleTemplates = await listLocalCollection<RoleTemplate>('roleTemplates');
  const permissions = resolveEffectivePermissions(mergedProfile, roleTemplates);
  const capabilities = resolveEffectiveCapabilities(mergedProfile, roleTemplates);
  const dataScope = resolveDataScope(mergedProfile);
  const allowedPlatforms: Platform[] =
    mergedProfile.role === 'admin'
      ? ['hungerstation', 'keeta']
      : Array.isArray(mergedProfile.allowedPlatforms) && mergedProfile.allowedPlatforms.length > 0
        ? mergedProfile.allowedPlatforms
        : ['hungerstation'];

  return {
    uid: mergedProfile.uid,
    phone: stored.phone,
    email: mergedProfile.email,
    emailVerified: true,
    role: mergedProfile.role,
    customRoleId: mergedProfile.customRoleId,
    active: Boolean(mergedProfile.active),
    allowedPlatforms,
    permissions,
    capabilities,
    dataScope,
  };
}

export async function getUserProfileByUid(uid: string): Promise<UserProfile | null> {
  const map = await readAuthUsersUnsafe();
  const stored = map[uid];
  if (!stored) return null;
  const colDoc = (await getLocalDoc('users', uid)) as Partial<UserProfile> | null;
  return {
    ...toPublicUserProfile(stored),
    ...(colDoc || {}),
    uid: stored.uid,
    phone: stored.phone,
  };
}

export async function createUserAccount(input: {
  displayName: string;
  phone: string;
  password: string;
  email?: string;
  customRoleId: string;
  active?: boolean;
  dataScope?: DataScope;
  allowedPlatforms?: Platform[];
  actorUid: string;
}): Promise<UserProfile> {
  const displayName = String(input.displayName || '').trim().slice(0, 120);
  const phone = normalizePhone(input.phone);
  const password = String(input.password || '');
  if (!displayName) throw new Error('الاسم الكامل للمستخدم مطلوب.');
  if (phone.length < 7 || phone.length > 15) throw new Error('رقم الجوال غير صالح (يجب أن يكون 7 إلى 15 رقمًا).');
  if (password.length < 4) throw new Error('كلمة المرور يجب ألا تقل عن 4 أحرف أو أرقام.');

  return withAuthLock(async () => {
    const map = await readAuthUsersUnsafe();
    const dup = Object.values(map).find((u) => normalizePhone(u.phone) === phone);
    if (dup) {
      throw new Error(`رقم الجوال ${phone} مسجل بالفعل لمستخدم آخر (${dup.displayName}).`);
    }

    const customRoleId = String(input.customRoleId || 'viewer').trim() || 'viewer';
    const legacyRole = mapTemplateToLegacyRole(customRoleId);
    const uid = `usr_${phone}_${crypto.randomBytes(3).toString('hex')}`;
    const nowIso = new Date().toISOString();
    const email = String(input.email || '').trim().slice(0, 200) || `${phone}@fleetops.local`;
    const scope: DataScope = input.dataScope || {
      allBranches: true,
      branches: [],
      cities: [],
      platforms: ['hungerstation'],
      riderIds: [],
    };
    const allowedPlatforms: Platform[] =
      input.allowedPlatforms && input.allowedPlatforms.length > 0
        ? input.allowedPlatforms
        : ['hungerstation'];

    const newUser: StoredAuthUser = {
      uid,
      phone,
      email,
      displayName,
      passwordHash: hashPassword(password),
      role: legacyRole,
      customRoleId,
      active: input.active ?? true,
      allowedPlatforms,
      assignedBranch: scope.branches[0] || '',
      assignedCity: scope.cities[0] || '',
      dataScope: scope,
      managedByAdminUids: Array.from(new Set([BOOTSTRAPPED_ADMIN_UID, input.actorUid].filter(Boolean))),
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    map[uid] = newUser;
    await writeAuthUsersUnsafe(map);
    await syncUserToLocalCollection(newUser);
    return toPublicUserProfile(newUser);
  });
}

export async function updateUserAccount(
  uid: string,
  patch: {
    displayName?: string;
    phone?: string;
    email?: string;
    password?: string;
    customRoleId?: string;
    role?: UserRole;
    active?: boolean;
    allowedPlatforms?: Platform[];
    dataScope?: DataScope;
    permissionOverrides?: UserProfile['permissionOverrides'];
    capabilityOverrides?: UserProfile['capabilityOverrides'];
  }
): Promise<UserProfile> {
  return withAuthLock(async () => {
    const map = await readAuthUsersUnsafe();
    const current = map[uid];
    if (!current) {
      throw new Error('المستخدم غير موجود.');
    }

    const isOwner =
      current.uid === BOOTSTRAPPED_ADMIN_UID ||
      current.email.trim().toLowerCase() === BOOTSTRAPPED_OWNER_EMAIL_LOWER;

    let nextPhone = current.phone;
    if (patch.phone !== undefined) {
      const normalized = normalizePhone(patch.phone);
      if (normalized.length < 7 || normalized.length > 15) {
        throw new Error('رقم الجوال غير صالح.');
      }
      const dup = Object.values(map).find((u) => u.uid !== uid && normalizePhone(u.phone) === normalized);
      if (dup) {
        throw new Error(`رقم الجوال ${normalized} مستخدم بالفعل لحساب آخر.`);
      }
      nextPhone = normalized;
    }

    let nextPasswordHash = current.passwordHash;
    if (patch.password && patch.password.trim().length > 0) {
      if (patch.password.trim().length < 4) {
        throw new Error('كلمة المرور يجب ألا تقل عن 4 أحرف أو أرقام.');
      }
      nextPasswordHash = hashPassword(patch.password.trim());
    }

    const nextCustomRoleId = isOwner
      ? 'super_admin'
      : patch.customRoleId ?? current.customRoleId;
    const nextRole: UserRole = isOwner
      ? 'owner'
      : patch.role ?? mapTemplateToLegacyRole(nextCustomRoleId);
    const nextScope = isOwner
      ? { allBranches: true, branches: [], cities: [], platforms: [], riderIds: [] }
      : patch.dataScope ?? current.dataScope;

    const updated: StoredAuthUser = {
      ...current,
      phone: nextPhone,
      displayName: patch.displayName ? patch.displayName.trim().slice(0, 120) : current.displayName,
      email: patch.email ? patch.email.trim().slice(0, 200) : current.email,
      passwordHash: nextPasswordHash,
      role: nextRole,
      customRoleId: nextCustomRoleId,
      active: isOwner ? true : patch.active ?? current.active,
      allowedPlatforms: patch.allowedPlatforms ?? current.allowedPlatforms,
      dataScope: nextScope,
      assignedBranch: nextScope?.branches?.[0] || '',
      assignedCity: nextScope?.cities?.[0] || '',
      permissionOverrides: isOwner ? {} : patch.permissionOverrides ?? current.permissionOverrides,
      capabilityOverrides: isOwner ? {} : patch.capabilityOverrides ?? current.capabilityOverrides,
      updatedAt: new Date().toISOString(),
    };

    map[uid] = updated;
    await writeAuthUsersUnsafe(map);
    await syncUserToLocalCollection(updated);
    return toPublicUserProfile(updated);
  });
}

export async function deleteUserAccount(uid: string, callerUid: string): Promise<void> {
  if (uid === callerUid) throw new Error('لا يمكنك حذف حسابك الحالي أثناء تسجيل الدخول.');
  if (uid === BOOTSTRAPPED_ADMIN_UID) throw new Error('لا يمكن حذف حساب مالك النظام الأساسي.');
  await withAuthLock(async () => {
    const map = await readAuthUsersUnsafe();
    if (!map[uid]) throw new Error('المستخدم غير موجود.');
    delete map[uid];
    await writeAuthUsersUnsafe(map);
  });
}

export async function changeOwnPassword(uid: string, currentPassword: string, newPassword: string): Promise<void> {
  if (!newPassword || newPassword.length < 4) {
    throw new Error('كلمة المرور الجديدة يجب ألا تقل عن 4 أحرف أو أرقام.');
  }
  await withAuthLock(async () => {
    const map = await readAuthUsersUnsafe();
    const user = map[uid];
    if (!user) throw new Error('المستخدم غير موجود.');
    if (!verifyPassword(currentPassword, user.passwordHash)) {
      throw new Error('كلمة المرور الحالية غير صحيحة.');
    }
    user.passwordHash = hashPassword(newPassword);
    user.updatedAt = new Date().toISOString();
    map[uid] = user;
    await writeAuthUsersUnsafe(map);
  });
}

export async function exportAuthUsersForBackup(): Promise<StoredAuthUser[]> {
  const map = await readAuthUsersUnsafe();
  return Object.values(map);
}

export async function importAuthUsersFromBackup(
  users: unknown,
  mode: 'replace' | 'merge' = 'replace'
): Promise<number> {
  return withAuthLock(async () => {
    const nextMap: Record<string, StoredAuthUser> =
      mode === 'merge' ? await readAuthUsersUnsafe() : {};

    if (Array.isArray(users)) {
      for (const raw of users) {
        if (!raw || typeof raw !== 'object') continue;
        const u = raw as Partial<StoredAuthUser>;
        if (!u.uid || !u.phone || !u.passwordHash) continue;
        nextMap[u.uid] = u as StoredAuthUser;
      }
    }

    await writeAuthUsersUnsafe(nextMap);
    for (const u of Object.values(nextMap)) {
      await syncUserToLocalCollection(u);
    }
    return Object.keys(nextMap).length;
  });
}

export async function resetAuthUsersToFactoryAdmin(): Promise<StoredAuthUser> {
  await withAuthLock(async () => {
    await writeAuthUsersUnsafe({});
  });
  return ensureBootstrappedAdmin(true);
}
