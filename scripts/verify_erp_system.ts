import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// Isolate Private Vault directory before dynamically importing documentVault.ts
const tempVaultDir = path.join(os.tmpdir(), `foc_vault_test_${Date.now()}`);
process.env.PRIVATE_VAULT_DIR = tempVaultDir;

import {
  BOOTSTRAPPED_OWNER_EMAIL_LOWER,
  DEFAULT_ROLE_TEMPLATES,
  getDefaultErpNavForUser,
  getMergedPlatformCatalog,
  hasPermission,
  isKeetaActive,
  isSuperAdminUser,
  matchesDataScope,
  resolveDataScope,
  resolveEffectivePermissions,
} from '../src/shared/rbacCore';
import {
  checkVehicleAssignmentOverlap,
  computeAllDocumentExpiries,
  evaluatePlatformAccountAutoLink,
  generateNextCompanyRiderId,
  generateNextVehicleId,
} from '../src/lib/erpHelpers';
import type { FleetDataset } from '../src/lib/fleetAnalytics';
import type {
  HungerDailyRecord,
  OperationalSettings,
  PlatformAccount,
  PlatformCatalogEntry,
  PrivateDocumentRecord,
  RiderMaster,
  UserProfile,
  VehicleAssignment,
  VehicleMaster,
} from '../src/types/fleet';

async function main() {
  // 1. RBAC Role Templates, Overrides, Super Admin, DataScope, Default Landing Route
  {
    assert.equal(DEFAULT_ROLE_TEMPLATES.length, 9);

    const ownerUser: UserProfile = {
      uid: 'u_owner',
      email: BOOTSTRAPPED_OWNER_EMAIL_LOWER,
      displayName: 'Owner',
      role: 'viewer', // Even if role field were downgraded, owner email retains full access
      active: true,
    };
    assert.equal(isSuperAdminUser(ownerUser), true);
    assert.equal(hasPermission(ownerUser, [], 'platforms', 'approve'), true);
    assert.equal(hasPermission(ownerUser, [], 'roles', 'delete'), true);
    assert.equal(getDefaultErpNavForUser(ownerUser, []), 'executive_admin');

    const hrEmp: UserProfile = {
      uid: 'u_hr_emp',
      email: 'hr.emp@company.com',
      displayName: 'HR Staff',
      role: 'hr_employee',
      active: true,
      assignedBranch: 'الرياض - الشمال',
      assignedCity: 'الرياض',
      allowedPlatforms: ['hungerstation'],
      permissionOverrides: {
        hr: { delete: true }, // explicit per-user override beyond hr_employee template
        documents: { export: false }, // explicit revocation override
      },
      dataScope: {
        allBranches: false,
        branches: ['الرياض - الشمال'],
        cities: ['الرياض'],
        platforms: ['hungerstation'],
        riderIds: [],
      },
    };
    const hrPerms = resolveEffectivePermissions(hrEmp, []);
    assert.equal(hrPerms.hr.view, true);
    assert.equal(hrPerms.hr.add, true);
    assert.equal(hrPerms.hr.delete, true); // granted via override
    assert.equal(hrPerms.documents.export, false); // revoked via override
    assert.equal(hrPerms.fleet.view, false);
    assert.equal(getDefaultErpNavForUser(hrEmp, []), 'hr_dashboard');

    const fleetMgr: UserProfile = {
      uid: 'u_fleet_mgr',
      email: 'fleet.mgr@company.com',
      displayName: 'Fleet Manager',
      role: 'fleet_manager',
      active: true,
    };
    assert.equal(getDefaultErpNavForUser(fleetMgr, []), 'fleet_dashboard');
    assert.equal(hasPermission(fleetMgr, [], 'fleet', 'approve'), true);
    assert.equal(hasPermission(fleetMgr, [], 'users', 'edit'), false);

    const accountant: UserProfile = {
      uid: 'u_acc',
      email: 'acc@company.com',
      displayName: 'Accountant',
      role: 'accountant',
      active: true,
    };
    assert.equal(getDefaultErpNavForUser(accountant, []), 'reports');

    // Inactive user receives empty matrix
    const inactiveUser: UserProfile = { ...fleetMgr, active: false };
    assert.equal(hasPermission(inactiveUser, [], 'fleet', 'view'), false);

    // DataScope row filtering
    const scope = resolveDataScope(hrEmp);
    assert.equal(
      matchesDataScope({ branch: 'الرياض - الشمال', city: 'الرياض', platform: 'hungerstation', riderId: 'EMP-0001' }, scope),
      true
    );
    assert.equal(
      matchesDataScope({ branch: 'جدة', city: 'الرياض', platform: 'hungerstation' }, scope),
      false
    );
    assert.equal(
      matchesDataScope({ branch: 'الرياض - الشمال', city: 'الرياض', platform: 'keeta' }, scope),
      false
    );
  }

  // 2. Sequential Internal IDs (preserving legacy IDs)
  {
    const existingRiders: RiderMaster[] = [
      { internalRiderId: 'LEGACY-99', fullName: 'Legacy Rider', status: 'active', createdByUid: 'u1', allowedUids: ['u1'] },
      { internalRiderId: 'EMP-0004', fullName: 'Rider 4', status: 'active', createdByUid: 'u1', allowedUids: ['u1'] },
      { internalRiderId: 'EMP-0012', fullName: 'Rider 12', status: 'onboarding', createdByUid: 'u1', allowedUids: ['u1'] },
    ];
    assert.equal(generateNextCompanyRiderId([]), 'EMP-0001');
    assert.equal(generateNextCompanyRiderId(existingRiders), 'EMP-0013');

    const existingVehicles: VehicleMaster[] = [
      {
        vehicleInternalId: 'VEH-0007',
        plateNumber: 'ABC 1234',
        vehicleType: 'سيارة سيدان',
        make: 'Toyota',
        model: 'Yaris',
        year: 2024,
        ownershipType: 'owned',
        status: 'available',
        createdByUid: 'u1',
        allowedUids: ['u1'],
      },
    ];
    assert.equal(generateNextVehicleId([]), 'VEH-0001');
    assert.equal(generateNextVehicleId(existingVehicles), 'VEH-0008');
  }

  // 3. Feature Flag Suppression for Keeta (reversible, zero deletion)
  {
    const defaultSettings: OperationalSettings = {
      settingsId: 'default',
      minDailyWorkingHours: 8,
      minDailyOrders: 12,
      maxOverdueRatePct: 8,
      maxCancellationRatePct: 5,
      minAcceptanceRatePct: 85,
      minCompletionRatePct: 92,
      minOnTimeRatePct: 88,
      minAttendanceRatePct: 90,
      minFacialPassRatePct: 90,
      minWalletBalance: 0,
      minDeliveryQualityScore: 80,
      keetaEnabled: false,
      keetaHidden: true,
      createdByUid: 'u1',
      allowedUids: ['u1'],
    };
    assert.equal(isKeetaActive(defaultSettings, []), false);

    const enabledCatalog: PlatformCatalogEntry[] = [
      {
        platformId: 'keeta',
        name: 'Keeta',
        nameAr: 'كيتا',
        enabled: true,
        hiddenFromUi: false,
        operationalImportEnabled: true,
        supportsExcelImport: true,
        isBuiltIn: true,
        createdByUid: 'u1',
        allowedUids: ['u1'],
      },
    ];
    assert.equal(isKeetaActive(defaultSettings, enabledCatalog), true);

    const merged = getMergedPlatformCatalog([], defaultSettings);
    const keetaEntry = merged.find((p) => p.platformId === 'keeta');
    const hsEntry = merged.find((p) => p.platformId === 'hungerstation');
    assert.equal(keetaEntry?.enabled, false);
    assert.equal(keetaEntry?.hiddenFromUi, true);
    assert.equal(hsEntry?.enabled, true);
  }

  // 4. Deterministic Auto-Linking Engine (strict ID match, zero name-guessing, conflict detection)
  {
    const hsRow: HungerDailyRecord = {
      recordKey: 'hs_H5501_2026-10-15',
      platform: 'hungerstation',
      riderId: 'H5501',
      date: '2026-10-15',
      month: '2026-10',
      city: 'الرياض',
      shifts: 1,
      plannedWorkingHours: 8,
      actualWorkingHours: 8,
      avgWorkingHoursPerDay: 8,
      attendanceRate: 100,
      breakHours: 0,
      lostHours: 0,
      acceptanceRate: 95,
      contactRate: 95,
      noShows: 0,
      noShowPct: 0,
      notifiedDeliveries: 15,
      completedDeliveries: 15,
      acceptedDeliveries: 15,
      stackedDeliveries: 0,
      declinedDeliveries: 0,
      cancelledDeliveries: 0,
      deductionDeliveries: 0,
      notAcceptedDeliveries: 0,
      manualUndispatched: 0,
      chatResponsePct: 100,
      sourceFile: 'hs.xlsx',
      sourceSheet: 'Hunger-Daily',
      sourceRowNumber: 2,
      importBatchId: 'b1',
      rowChecksum: 'c1',
      createdByUid: 'u1',
      allowedUids: ['u1'],
    };
    const dataset: FleetDataset = {
      hungerDaily: [hsRow],
      hungerDistanceDaily: [],
      hungerWalletSnapshots: [],
      hungerQualityMonthly: [],
      keetaDashboardDaily: [],
      keetaVdaDaily: [],
      keetaRankSnapshots: [],
      keetaFacialRecognitionDaily: [],
      riderMaster: [],
      riderMappings: [],
    };
    const existingAccounts: PlatformAccount[] = [
      {
        accountId: 'acc_1',
        platformId: 'hungerstation',
        platformName: 'HungerStation',
        platformRiderId: 'H9999',
        companyRiderId: 'EMP-0002',
        accountStatus: 'active',
        linkingStatus: 'linked',
        createdByUid: 'u1',
        allowedUids: ['u1'],
      },
    ];

    const linkedRes = evaluatePlatformAccountAutoLink({
      platformId: 'hungerstation',
      platformRiderId: 'H5501',
      companyRiderId: 'EMP-0001',
      existingAccounts,
      dataset,
    });
    assert.equal(linkedRes.linkingStatus, 'linked');
    assert.equal(linkedRes.historicalRecordsMatched, 1);

    const unlinkedRes = evaluatePlatformAccountAutoLink({
      platformId: 'hungerstation',
      platformRiderId: 'H_NONEXISTENT',
      companyRiderId: 'EMP-0001',
      existingAccounts,
      dataset,
    });
    assert.equal(unlinkedRes.linkingStatus, 'unlinked');
    assert.equal(unlinkedRes.historicalRecordsMatched, 0);

    const conflictRes = evaluatePlatformAccountAutoLink({
      platformId: 'hungerstation',
      platformRiderId: 'H9999',
      companyRiderId: 'EMP-0001', // belongs to EMP-0002!
      existingAccounts,
      dataset,
    });
    assert.equal(conflictRes.linkingStatus, 'conflict_review');
    assert.deepEqual(conflictRes.conflictCandidateRiderIds, ['EMP-0002']);
  }

  // 5. Vehicle Assignment Overlap Protection
  {
    const existingAssignments: VehicleAssignment[] = [
      {
        assignmentId: 'asg_1',
        vehicleInternalId: 'VEH-0001',
        plateNumber: 'KSA 1111',
        companyRiderId: 'EMP-0001',
        handoverDate: '2026-10-01',
        handoverOdometer: 10000,
        handoverCondition: 'ممتازة',
        handoverByUid: 'u1',
        handoverByEmail: 'fleet@company.com',
        returnDate: '2026-10-10',
        status: 'returned',
        createdByUid: 'u1',
        allowedUids: ['u1'],
      },
      {
        assignmentId: 'asg_2',
        vehicleInternalId: 'VEH-0002',
        plateNumber: 'KSA 2222',
        companyRiderId: 'EMP-0002',
        handoverDate: '2026-10-05',
        handoverOdometer: 12000,
        handoverCondition: 'ممتازة',
        handoverByUid: 'u1',
        handoverByEmail: 'fleet@company.com',
        status: 'active',
        createdByUid: 'u1',
        allowedUids: ['u1'],
      },
    ];

    // Overlapping past period on VEH-0001 -> blocked
    const overlap1 = checkVehicleAssignmentOverlap({
      vehicleInternalId: 'VEH-0001',
      handoverDate: '2026-10-08',
      returnDate: '2026-10-12',
      existingAssignments,
    });
    assert.equal(overlap1?.assignmentId, 'asg_1');

    // Sequential period after returnDate on VEH-0001 -> allowed
    const clean1 = checkVehicleAssignmentOverlap({
      vehicleInternalId: 'VEH-0001',
      handoverDate: '2026-10-11',
      existingAssignments,
    });
    assert.equal(clean1, null);

    // Assigning VEH-0002 while active -> blocked
    const overlap2 = checkVehicleAssignmentOverlap({
      vehicleInternalId: 'VEH-0002',
      handoverDate: '2026-10-20',
      existingAssignments,
    });
    assert.equal(overlap2?.assignmentId, 'asg_2');
  }

  // 6. Expiry Calculation Engine (90/60/30/7/0 + expired)
  {
    const refDate = '2026-11-01';
    const riders: RiderMaster[] = [
      {
        internalRiderId: 'EMP-0001',
        fullName: 'سالم العتيبي',
        status: 'active',
        iqamaExpiryDate: '2026-10-25', // -7 -> expired
        driverLicenseExpiryDate: '2026-11-01', // 0 -> due_today
        createdByUid: 'u1',
        allowedUids: ['u1'],
      },
      {
        internalRiderId: 'EMP-0002',
        fullName: 'فهد القحطاني',
        status: 'active',
        iqamaExpiryDate: '2026-11-06', // +5 -> within_7
        driverLicenseExpiryDate: '2027-06-01', // > 90 -> omitted from watch list
        createdByUid: 'u1',
        allowedUids: ['u1'],
      },
    ];
    const vehicles: VehicleMaster[] = [
      {
        vehicleInternalId: 'VEH-0001',
        plateNumber: 'Riyadh 900',
        vehicleType: 'سيارة سيدان',
        make: 'Hyundai',
        model: 'Accent',
        year: 2025,
        ownershipType: 'owned',
        status: 'assigned',
        istimaraExpiryDate: '2026-11-25', // +24 -> within_30
        insuranceExpiryDate: '2026-12-20', // +49 -> within_60
        periodicInspectionExpiryDate: '2027-01-15', // +75 -> within_90
        createdByUid: 'u1',
        allowedUids: ['u1'],
      },
    ];
    const privateDocs: PrivateDocumentRecord[] = [
      {
        docId: 'doc_1',
        entityType: 'rider',
        entityId: 'EMP-0001',
        entityLabel: 'سالم العتيبي',
        docTypeId: 'passport',
        docTypeName: 'جواز السفر',
        title: 'جواز سفر سالم',
        expiryDate: '2026-11-15', // +14 -> within_30
        currentVersion: 1,
        versions: [],
        createdByUid: 'u1',
        allowedUids: ['u1'],
      },
    ];

    const watch = computeAllDocumentExpiries({
      riders,
      vehicles,
      privateDocs,
      refDateIso: refDate,
    });

    const byId = new Map(watch.map((w) => [w.id, w]));
    assert.equal(byId.get('iqama_EMP-0001')?.urgency, 'expired');
    assert.equal(byId.get('lic_EMP-0001')?.urgency, 'due_today');
    assert.equal(byId.get('iqama_EMP-0002')?.urgency, 'within_7');
    assert.equal(byId.get('lic_EMP-0002'), undefined); // > 90 days
    assert.equal(byId.get('istimara_VEH-0001')?.urgency, 'within_30');
    assert.equal(byId.get('insurance_VEH-0001')?.urgency, 'within_60');
    assert.equal(byId.get('inspection_VEH-0001')?.urgency, 'within_90');
    assert.equal(byId.get('doc_doc_1')?.urgency, 'within_30');
  }

  // 7. Private Server-Side Document Vault (Save, Read, SHA-256, Traversal Guard, Cleanup)
  {
    const {
      deletePrivateVaultFile,
      readPrivateVaultFile,
      sanitizeStorageKey,
      savePrivateVaultFile,
      validateVaultMimeType,
    } = await import('../src/server/documentVault');

    const samplePdf = Buffer.from('%PDF-1.4\n%Enterprise Test Vault File\n', 'utf8');
    const expectedHash = crypto.createHash('sha256').update(samplePdf).digest('hex');

    const saved = await savePrivateVaultFile({
      buffer: samplePdf,
      docId: 'doc_test_1',
      version: 1,
      originalFileName: 'iqama_copy.pdf',
      mimeType: 'application/pdf',
    });
    assert.equal(saved.sha256, expectedHash);
    assert.equal(saved.normalizedMime, 'application/pdf');
    assert.ok(saved.storageKey.startsWith('doc_test_1_v1_'));

    const loaded = await readPrivateVaultFile(saved.storageKey);
    assert.deepEqual(loaded, samplePdf);

    // Path traversal / hidden file / disallowed MIME rejection
    assert.throws(() => sanitizeStorageKey('..'));
    assert.throws(() => sanitizeStorageKey('.env'));
    assert.throws(() => validateVaultMimeType('application/x-msdownload', 'malware.exe'));

    await deletePrivateVaultFile(saved.storageKey);
    await assert.rejects(() => readPrivateVaultFile(saved.storageKey));
    await fs.rm(tempVaultDir, { recursive: true, force: true });
  }

  console.log(
    '✅ Enterprise ERP verification passed (RBAC 13x6 + overrides + DataScope, sequential EMP/VEH IDs, Keeta Feature Flag, deterministic auto-link + conflicts, vehicle handover overlap, 90/60/30/7/0 expiry engine, Private Vault security).'
  );
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ ERP verification failed:', err);
  process.exit(1);
});
