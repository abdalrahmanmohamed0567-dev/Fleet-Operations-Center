# Fleet Operations Center Security Specification (Phase 0)

## 1. Data Invariants
1. **Verified Identity Only**: Every read or write requires `request.auth != null` and `request.auth.token.email_verified == true`.
2. **No Self-Privilege Escalation**: Only the bootstrapped owner (`abdalrahmanmohamed0567@gmail.com`) can self-register as `owner`. Any other user registering creates a `viewer` account with `active: false` pending admin approval, and cannot mutate their own `role` or `active` status.
3. **PII Isolation**: User records in `/users/{userId}` contain email addresses and are strictly restricted on `get` to the record owner (`request.auth.uid == userId`) or `owner`/`admin` roles, and `list` is restricted to `owner`/`admin`.
4. **Immutable Audit Trail**: `/auditLogs/{logId}` documents can only be created with `actorUid == request.auth.uid` and `createdAt == request.time`. Updates and deletes are unconditionally denied.
5. **Path-ID Hardening & Bounded Strings**: All single-document operations enforce `isValidId(id)` (`^[a-zA-Z0-9_-]+$`, `<= 128` chars) and explicit `.size()` bounds on strings and arrays (`allowedUids.size() <= 20`).
6. **Zero `get()`/`exists()` in `allow list`**: Every `allow list` rule evaluates `isBootstrappedOwner()` or `resource.data` directly against `request.auth.uid` without `get()`/`exists()` calls.
7. **Deterministic Keys & Timestamp Integrity**: `createdAt`/`importedAt`/`updatedAt` timestamps are validated against `request.time`.
8. **Error Dictionary & Case Governance**: `/hungerErrorDictionary/{codeKey}` and `/hungerRiderErrorCases/{caseId}` enforce deterministic path-matching IDs (`codeKey == docId`, `caseId == docId`), bounded field lengths, enum checks on `severity`/`verifiedStatus`/`status`, and `supervisor` or higher RBAC on writes (`admin` or `owner` only for deletion).
9. **Enterprise Operations Cases & Rider Notes**: `/operationalCases/{caseId}` enforces strict status enums (`new`, `under_review`, `in_progress`, `resolved`, `closed`), prevents non-admin/non-ops-manager users from reopening a `closed` case, and `/riderNotes/{noteId}` locks `createdByUid`/`riderKey`/`platform`/`riderId` immutability while restricting edits to the author or admins.

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Unverified Email Spoofing**: `{ email: "abdalrahmanmohamed0567@gmail.com", role: "owner" }` with `email_verified: false` -> `PERMISSION_DENIED`.
2. **Self-Role Escalation on Create**: Non-owner user writing `/users/{uid}` with `{ role: "admin", active: true }` -> `PERMISSION_DENIED`.
3. **Self-Role Escalation on Update**: Viewer updating `/users/{uid}` with `{ role: "owner" }` -> `PERMISSION_DENIED`.
4. **Shadow Field Injection**: Writing `/operationalSettings/default` with extra ghost field `{ isBypassed: true }` -> `PERMISSION_DENIED`.
5. **ID Poisoning**: Creating `/riderMaster/<1500-char-id>` or invalid characters `$bad/id` -> `PERMISSION_DENIED`.
6. **Audit Log Tampering**: Updating or deleting `/auditLogs/{logId}` as any user -> `PERMISSION_DENIED`.
7. **Audit Log Impersonation**: Creating `/auditLogs/{logId}` with `actorUid != request.auth.uid` -> `PERMISSION_DENIED`.
8. **Blanket Collection Scraping**: Unassigned external user listing `/hungerDaily` or `/hungerErrorDictionary` -> `PERMISSION_DENIED`.
9. **PII Cross-Read**: Viewer user calling `get` on `/users/{otherUid}` -> `PERMISSION_DENIED`.
10. **Viewer Mutating Settings or Error Dictionary**: User with `role: "viewer"` updating `/operationalSettings/default` or `/hungerErrorDictionary/{codeKey}` -> `PERMISSION_DENIED`.
11. **Array Exhaustion**: Writing `allowedUids` with 25 UIDs (`> 20` limit) -> `PERMISSION_DENIED`.
12. **Client Timestamp Forgery**: Writing `createdAt` in `/auditLogs` or `/hungerRiderErrorCases` not equal to `request.time` -> `PERMISSION_DENIED`.

