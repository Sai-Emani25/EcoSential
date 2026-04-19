# EcoSentinel Security Specification

## Data Invariants
1. A Site must have an `ownerId` matching the creator's `uid`.
2. An Audit must belong to a valid `siteId`.
3. Only the owner of a site can create audits for it.
4. Audits are immutable once created (except by admins).
5. User profiles are only writable by the owner.

## The "Dirty Dozen" Payloads (Test Cases)
1. Creating a Site with someone else's `ownerId`.
2. Updating a Site's `ownerId` to hijack it.
3. Creating an Audit for a Site you don't own.
4. Reading another user's private audit data (if restricted).
5. Deleting a Site that has audits without permission.
6. Injecting a 2MB string into `findings`.
7. Spoofing `createdAt` with a client-side timestamp.
8. Updating `isoCompliance` status on a finalized audit.
9. Creating a Site with an invalid ID (junk characters).
10. Reading a list of all sites without being authenticated.
11. Bypassing the terminal state locking of an audit.
12. Self-assigning an `admin` role in the `users` collection.

## Test Runner (Conceptual/Draft for Rules)
The security rules will be tested against these logic leaks.
