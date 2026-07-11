# ADR-001: PostgreSQL Migration Contract

- **Status:** Accepted
- **Decision date:** 2026-07-11
- **Backlog item:** PG-01
- **Applies to:** Local development, automated tests, CI, demo, staging, and production

## Context

The application currently uses SQLite through Prisma. Its migration history, setup scripts, test isolation, CI configuration, and parts of its EPG concurrency strategy are SQLite-specific. Prisma migration SQL is provider-specific, so one active migration history cannot safely manage both SQLite and PostgreSQL.

The application also needs a database-level guarantee that programs on one channel do not overlap. PostgreSQL supports the row-level locking and exclusion constraints planned for that invariant.

## Decision

PostgreSQL is the application's only active database provider after this migration. SQLite will not remain an alternative runtime or test provider.

PostgreSQL **18** is the supported major version. It is the latest stable major release at the decision date; prerelease versions such as PostgreSQL 19 beta are excluded. All version-controlled environments must pin the same major version (for example, the local Docker image and GitHub Actions service image will use `postgres:18`, not `postgres:latest`). Managed demo, staging, and production databases must run PostgreSQL 18. Patch releases may advance within major version 18 for security and maintenance updates.

Prisma remains on the repository's existing **5.22.x** major/minor line for this migration. A Prisma major-version upgrade, and unrelated ORM modernization, are explicitly out of scope.

## Environment Strategy

| Environment | Database strategy | Initialization and ownership |
| --- | --- | --- |
| Local development | PostgreSQL 18 in Docker Compose, with a named persistent volume | Developers use Prisma development migrations and explicitly run the seed script. |
| Automated tests | A dedicated PostgreSQL 18 test database or isolated test schema | Committed migrations build it; guarded test setup resets only test-owned data. It must never target a development or deployed database. |
| GitHub Actions | PostgreSQL 18 service container with test-only credentials | CI runs `prisma migrate deploy` before the test and coverage gates. Each job starts with an empty database. |
| Demo | Managed PostgreSQL 18 | Deployment runs `prisma migrate deploy`; deterministic demo data is seeded only through an explicit operation. |
| Staging | Managed PostgreSQL 18, isolated from production | Deployment runs `prisma migrate deploy`; representative or synthetic data is managed separately from production. |
| Production | Managed PostgreSQL 18 with provider backups and restricted credentials/network access | Deployment runs `prisma migrate deploy`. Application startup must not reset or seed the database. |

Every environment therefore exercises the same Prisma provider and PostgreSQL migration history. Environment-specific URLs, credentials, database names, and schemas remain configuration rather than schema differences.

## Compatibility Boundary

The provider switch must preserve all existing HTTP and domain contracts, including:

- routes, methods, request bodies, status codes, response shapes, and error codes;
- content hierarchy and per-field metadata inheritance behavior;
- playback authorization behavior;
- UTC timestamp behavior and the rule that back-to-back EPG programs are valid; and
- friendly application-level EPG validation, supplemented by PostgreSQL constraints.

Changing a public API contract requires a separate, explicit decision and is not authorized by this migration.

## Migration History

The existing files under `prisma/migrations/` are SQLite-specific. During PG-03 they will be moved to a clearly named archive outside the active Prisma migration directory (or remain available in Git history) and must not be applied to PostgreSQL.

PG-03 will create a new PostgreSQL initial migration from the preserved logical schema. From that point, the active migration history targets PostgreSQL only. Archived SQLite SQL is historical evidence, not a supported rollback path or deployable migration set.

## Data Preservation

The repository's current SQLite records are demo data, not a production system of record. They will **not** be copied row by row. The PostgreSQL schema will be created from committed migrations, and demo content, channels, schedule-lock rows, and EPG programs will be recreated from [`prisma/seed.ts`](../../prisma/seed.ts).

Production data extraction, transformation, or bulk copy is out of scope. No unresolved data-preservation decision remains for the known repository data. If real persistent data is identified before cutover, the cutover must pause and a separate, reviewed data-migration plan must define reconciliation, validation, backup, and rollback before that data is changed.

## Rollback Expectations

Rollback differs before and after the PostgreSQL cutover:

- **Before cutover:** discard or revert the incomplete PostgreSQL implementation and continue from the last working SQLite revision. No data synchronization is required because SQLite demo data is reproducible.
- **After a demo/staging cutover:** roll the application and schema forward when practical. If rollback is necessary, restore the pre-migration managed PostgreSQL backup and deploy the matching application revision. Reseed only disposable demo environments.
- **After a production cutover:** do not point the old SQLite application at PostgreSQL or attempt to reverse PostgreSQL migrations automatically. Stop writes, restore the verified pre-cutover backup to an isolated PostgreSQL instance, deploy the compatible application revision, validate it, and then redirect traffic. Provider-specific rollback commands will be detailed in the PG-08 runbook.

There is no automated PostgreSQL-to-SQLite rollback and no dual-write period. A production cutover cannot proceed until backup/restore has been rehearsed and the rollback owner and acceptable recovery window are recorded.

## Consequences

- PostgreSQL is required for local development and tests.
- SQLite tooling and `sql.js` become removable migration work rather than supported compatibility code.
- A fresh PostgreSQL migration history is required.
- CI and local tests more closely represent deployed database behavior.
- EPG integrity can be enforced with PostgreSQL transactions and database constraints in addition to application validation.

## PG-01 Review Checklist

The migration contract is approved for schema implementation when all entries below remain true:

- [x] PostgreSQL is the only active provider in every environment.
- [x] Local, test, CI, demo, staging, and production strategies are defined.
- [x] PostgreSQL major version 18 is selected and must be pinned consistently.
- [x] SQLite migrations are designated archived history, not PostgreSQL inputs.
- [x] Existing API and domain contracts are explicitly preserved.
- [x] Demo data is recreated from `prisma/seed.ts` rather than copied.
- [x] Persistent production data copy is out of scope unless real data is identified.
- [x] Rollback expectations and the cutover stop condition are defined.
- [x] Prisma upgrade work is excluded.
- [x] No decision about known data preservation remains open.

**Architecture review result:** Accepted. Each environment has one defined PostgreSQL strategy, and PG-02/PG-03 may proceed under this contract.
