# Security Specification — إعدادية المنتظر للبنين

## 1. Data Invariants
1. Public readers may only read `settings` and `announcements` where `status == 'published'`. Draft/archived announcements are readable only by verified admins.
2. `admins` documents contain PII (`email`) and RBAC roles (`owner` / `supervisor`). Non-admins cannot read or list other admin records; only the bootstrapped primary owner (`ronsm799@gmail.com` with `email_verified == true`) or an existing `owner` can write `/admins/{uid}`.
3. `adminNotes` are strictly owner-isolated (`resource.data.ownerUid == request.auth.uid`) on `get`, `list`, `create`, `update`, and `delete`.
4. All document IDs must match `^[a-zA-Z0-9_\-]+$` (`<= 128` chars), all strings enforce explicit `.size()` limits, and timestamps use `request.time`.

## 2. Dirty Dozen Attack Payloads (All Must Fail with PERMISSION_DENIED)
1. Unauthenticated create on `/announcements/a1` -> Denied.
2. Unauthenticated read on `/announcements/draft1` where `status == 'draft'` -> Denied.
3. Unauthenticated read on `/adminNotes/n1` -> Denied.
4. Non-admin authenticated user reading `/adminNotes/n1` owned by another UID -> Denied.
5. Non-admin authenticated user listing `/adminNotes` without owner constraint -> Denied.
6. Authenticated non-admin attempting self-promotion by writing `/admins/{uid}` with `role: 'owner'` -> Denied.
7. Admin with `email_verified: false` attempting write to `/settings/public` -> Denied.
8. Admin writing `/announcements/a1` with extra ghost field `isVerified: true` -> Denied (`hasOnly`).
9. Admin writing `/announcements/a1` with oversized `title` (`> 200` chars) -> Denied.
10. Admin writing `/announcements/bad!id$` with invalid path ID characters -> Denied (`isValidId`).
11. Admin updating `/adminNotes/n1` changing immutable `ownerUid` -> Denied.
12. Unauthenticated write to `/test/connection` -> Denied (only authenticated or read probe allowed).
