# CMS EPG Scheduling and Concurrency

This document explains the scheduling rules and concurrency controls behind
the CMS EPG endpoints. The authoritative route, authentication, request,
response, pagination, ETag, and error contracts are defined in the
[CMS CRUD API](cms-crud-api.md) and
[CMS OpenAPI contract](cms-crud-openapi.yaml).

## Scheduling Invariants

- Every program belongs to exactly one live channel.
- `startTime` and `endTime` must include timezone information and are persisted
  as timezone-aware PostgreSQL timestamps.
- `startTime` must be earlier than `endTime`.
- Programs on the same channel must not overlap.
- Programs on different channels may use the same time range.
- Time ranges are half-open: the start is included and the end is excluded.
  Adjacent `10:00-11:00` and `11:00-12:00` programs are therefore valid.

Offset date-times are accepted and normalized to UTC. For example,
`2026-07-02T21:00:00+03:00` represents the same instant as
`2026-07-02T18:00:00Z`. Date-times without a timezone are rejected because
their meaning would depend on the server timezone.

## Overlap Rule

The application uses the standard half-open interval predicate:

```text
newStart < existingEnd AND newEnd > existingStart
```

For an existing `10:00-11:00` program on the same channel:

| Candidate | Result | Reason |
| --- | --- | --- |
| `10:30-11:30` | Rejected | The ranges intersect |
| `09:30-10:30` | Rejected | The ranges intersect |
| `09:00-10:00` | Allowed | Candidate ends at the existing start |
| `11:00-12:00` | Allowed | Candidate starts at the existing end |

An update excludes the current program ID from the overlap query, then checks
the complete effective range produced by combining stored and patched values.

## Application-Level Serialization

Create, update, and delete operations run in a transaction and acquire the
channel's `EpgScheduleLock` row before reading or writing the schedule.

```text
start transaction
  -> acquire the requested channel's schedule lock
  -> load and validate the effective program state
  -> check same-channel overlap for create or update
  -> create, update, or delete the program
commit transaction
```

Concurrent writes for the same channel acquire the same row lock. The second
transaction therefore sees the first committed change before it validates its
own schedule. Different channels use different lock rows and do not serialize
through one global lock.

Updates perform the optional ETag comparison after acquiring the channel lock,
so a stale editor cannot overwrite a concurrent change. Deletes also acquire
the lock so they cannot race with a create or update validation on the same
schedule.

## Database Backstop

Application validation provides a readable `EPG_OVERLAP` response, but data
integrity does not depend on every writer using the service. PostgreSQL also
enforces `EpgProgram_no_overlap_excl`, a GiST exclusion constraint over:

```sql
"channelId" WITH =,
tstzrange("startTime", "endTime", '[)') WITH &&
```

This rejects a conflicting write even if it bypasses the application overlap
query. The repository maps the constraint violation back to the same stable
domain error used by application validation.

## Implementation Map

| Responsibility | File |
| --- | --- |
| HTTP validation and ETag parsing | `src/modules/cms-epg-program/cms-epg-program.service.ts` |
| Transaction, lock, and overlap query | `src/live-channel/epg-program/epg-program-repository.ts` |
| Time normalization and range validation | `src/live-channel/epg-program/epg-program.ts` |
| Schedule lock model | `prisma/schema.prisma` |
| Database exclusion constraint | `prisma/migrations/20260712000000_harden_epg_integrity/migration.sql` |

Concurrency tests use independent Prisma clients to verify that competing
writes cannot commit overlapping programs on the same channel.
