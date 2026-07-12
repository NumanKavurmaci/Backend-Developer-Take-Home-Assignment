# SQLite to PostgreSQL Migration Project Plan

## Recommended Migration Strategy

The migration should be a complete provider switch:

```text
Local development -> PostgreSQL
Automated tests   -> PostgreSQL
GitHub Actions    -> PostgreSQL
Demo/production   -> Managed PostgreSQL
```

Do not keep SQLite locally while using PostgreSQL only in production. Prisma migration SQL is provider-specific, so the existing SQLite migration history cannot also manage PostgreSQL.

This is particularly important because the repository currently contains several SQLite-specific components:

- `schema.prisma` uses `provider = "sqlite"`.
- Database setup builds a SQLite file using `sql.js`.
- Test infrastructure requires a `file:` URL and hardcodes `data/test.db`.
- CI currently runs against a SQLite file.
- EPG concurrency currently relies on touching a per-channel lock row inside a transaction.

The assignment explicitly evaluates database integrity and concurrent EPG writes, while the current database design already contains `EpgScheduleLock` for that purpose.

## Scope Decisions

- Preserve all existing HTTP contracts and domain behavior.
- Do not combine the migration with a Prisma major-version upgrade.
- Treat the existing SQLite database as demo data and recreate it through migrations and seed data.
- Keep application-level overlap validation for friendly errors.
- Add PostgreSQL-level constraints as the final integrity guarantee.
- Archive the SQLite migration history rather than treating it as compatible with PostgreSQL.

## Backlog Overview

| Order | ID    | Story                                 | Estimate | Depends on   |
| ----: | ----- | ------------------------------------- | -------: | ------------ |
|     1 | PG-01 | Define PostgreSQL migration contract  |     1 SP | -            |
|     2 | PG-02 | Provide local PostgreSQL environment  |     3 SP | PG-01        |
|     3 | PG-03 | Rebuild Prisma schema and migrations  |     5 SP | PG-02        |
|     4 | PG-04 | Harden EPG integrity and concurrency  |     5 SP | PG-03        |
|     5 | PG-05 | Replace SQLite database tooling       |     3 SP | PG-03        |
|     6 | PG-06 | Move automated tests to PostgreSQL    |     5 SP | PG-04, PG-05 |
|     7 | PG-07 | Run PostgreSQL in CI                  |     3 SP | PG-06        |
|     8 | PG-08 | Cut over deployment and documentation |     3 SP | PG-07        |

**Estimated total: 28 story points.**

---

# PG-01 - Define PostgreSQL Migration Contract

**Status:** Complete — see [ADR-001: PostgreSQL Migration Contract](adr-001-postgresql-migration-contract.md).

## Description

Document the migration boundaries before implementation.

The project will use PostgreSQL in development, tests, CI, and deployed environments. SQLite will no longer be an active runtime database.

The decision document should also define whether existing SQLite records need to be copied. For this repository, the recommended approach is **schema migration plus reseeding**, because the current seed script already creates deterministic sample content, channels, locks, and EPG programs.

## Acceptance Criteria

- An ADR or migration document defines PostgreSQL as the only active database provider.
- Local, test, CI, staging, and production environment strategies are listed.
- The supported PostgreSQL major version is selected and pinned consistently.
- Existing SQLite migration files are marked as archived history.
- The migration explicitly preserves existing API contracts.
- Demo data will be recreated from `prisma/seed.ts`.
- Production data-copy requirements are marked as out of scope unless real persistent data is identified.
- Rollback expectations are documented.
- Prisma upgrading is excluded from this migration scope.

## Tests Required

- Architecture review confirms that every environment has a defined database strategy.
- Manual review confirms that no unresolved decision remains around data preservation.
- Migration checklist is approved before schema implementation begins.

---

# PG-02 - Provide Local PostgreSQL Environment

**Status:** Complete — PostgreSQL startup, migration, seed, connectivity, and `/ready` smoke tests pass.

## Description

Add a repeatable local PostgreSQL environment, preferably through Docker Compose.

A developer should be able to start PostgreSQL, create the database, run migrations, seed data, and start the API without manually installing or configuring PostgreSQL.

## Acceptance Criteria

- A Docker Compose configuration provides PostgreSQL locally.
- The database service has a health check.
- Database version, database name, user, password, and port are explicitly configured.
- `.env.example` contains a PostgreSQL connection URL instead of a SQLite file URL.
- `.env.test` points to a separate PostgreSQL test database or schema.
- Secrets and real credentials are not committed.
- The application fails with a clear error when `DATABASE_URL` is missing or malformed.
- Local PostgreSQL data is stored in a named Docker volume.
- One documented command starts the database.
- One documented command stops and removes the local database when a full reset is required.

## Tests Required

- Clean-checkout smoke test:
  1. Start Docker Compose.
  2. Install dependencies.
  3. Run migrations.
  4. Seed the database.
  5. Start the API.
  6. Verify `/ready`.
- Configuration test for a missing `DATABASE_URL`.
- Configuration test for an unreachable PostgreSQL server.
- Readiness test confirms that `/ready` fails when PostgreSQL is unavailable.

---

# PG-03 - Rebuild Prisma Schema and Migration History for PostgreSQL

**Status:** Complete — the empty-database migration, seed, and PostgreSQL test suite pass.

## Description

Switch Prisma from SQLite to PostgreSQL and create a fresh PostgreSQL migration history.

The existing migration history cannot simply be reused because Prisma migrations contain provider-specific SQL.

The current models and relationships must remain intact:

```text
Content
ContentGeoBlockCountry
LiveChannel
EpgProgram
EpgScheduleLock
```

The current schema contains self-referencing content relationships, cascade/restrict behavior, compound keys, unique channel slugs, and channel-scoped EPG indexes that must be preserved.

## Acceptance Criteria

- Prisma datasource provider is changed to `postgresql`.
- Existing SQLite migrations are moved to an archive location or preserved through Git history.
- A new PostgreSQL initial migration is created from the current schema.
- Foreign keys retain their current `CASCADE` and `RESTRICT` behavior.
- Composite primary key on `(contentId, countryCode)` remains.
- Unique constraint on `LiveChannel.slug` remains.
- Existing EPG indexes remain or are replaced with PostgreSQL-appropriate equivalents.
- `startTime` and `endTime` use PostgreSQL timezone-aware timestamp columns.
- UTC application behavior remains unchanged.
- Created and updated timestamps behave consistently.
- `prisma validate` succeeds.
- Prisma Client generation succeeds.
- A completely empty PostgreSQL database can be built using only committed migrations.

## Tests Required

- Migration smoke test against an empty PostgreSQL database.
- Prisma schema validation test.
- Prisma Client generation test.
- Foreign-key behavior tests for content and channel deletion.
- Composite-key uniqueness test for geo-block countries.
- Unique channel-slug test.
- Timestamp round-trip test using explicit UTC values and timezone-offset inputs.
- Seed script test against the newly migrated database.

---

# PG-04 - Harden EPG Integrity and Concurrency

## Description

Adapt the current EPG transaction to PostgreSQL and add database-level protection against overlapping schedules.

The current implementation updates or creates an `EpgScheduleLock` row before checking for overlaps and inserting the program. This should remain the application-level serialization mechanism, but PostgreSQL should additionally enforce non-overlap at the database layer.

The migration should add:

```sql
CHECK (start_time < end_time)
```

and a channel-scoped exclusion constraint conceptually equivalent to:

```sql
EXCLUDE USING gist (
  channel_id WITH =,
  tstzrange(start_time, end_time, '[)') WITH &&
)
```

The `btree_gist` extension may be required so a scalar channel identifier can be combined with the timestamp range.

The `[)` boundary permits one program to start exactly when another ends.

## Acceptance Criteria

- EPG creation runs inside one PostgreSQL transaction.
- The channel lock row is locked or updated before overlap validation.
- Same-channel requests serialize on the same lock row.
- Different-channel requests use different lock rows.
- Application-level overlap validation remains in place.
- PostgreSQL rejects an overlap even if application validation is bypassed.
- PostgreSQL rejects `startTime >= endTime`.
- Back-to-back schedules remain valid.
- Identical schedules on different channels remain valid.
- Named PostgreSQL constraints are used so failures can be identified reliably.
- Database overlap failures are mapped to `400 EPG_OVERLAP`.
- Database constraint failures do not appear as generic `500` responses.
- The final database state cannot contain overlapping programs for one channel.

## Tests Required

- Two independent Prisma clients submit overlapping writes to the same channel; exactly one succeeds.
- A burst of at least 12 overlapping writes inserts exactly one program.
- Concurrent same-time writes on different channels both succeed.
- Concurrent back-to-back writes on one channel both succeed.
- Direct database insert with `startTime == endTime` fails.
- Direct database insert with `startTime > endTime` fails.
- Direct database insert bypassing the service cannot create an overlap.
- API test confirms that the database exclusion violation returns `400 EPG_OVERLAP`.
- Final-state query verifies that no overlapping rows exist after concurrency tests.

---

# PG-05 - Replace SQLite-Specific Database Tooling

## Description

Remove scripts and dependencies that construct or manage SQLite files.

The current setup and test tooling read migration SQL into `sql.js`, create files through Node filesystem APIs, and reject non-`file:` database URLs.

Replace this with standard Prisma commands operating against PostgreSQL.

Suggested command responsibilities:

```text
db:generate        prisma generate
db:migrate         prisma migrate dev
db:migrate:deploy  prisma migrate deploy
db:reset           prisma migrate reset
db:seed            seed sample data
db:check           verify PostgreSQL connectivity
```

Production and CI should use `prisma migrate deploy`, while `migrate dev` remains a development-only command.

## Acceptance Criteria

- `sql.js` and its type package are removed.
- SQLite path-resolution code is removed.
- Migration SQL concatenation code is removed.
- Database setup uses Prisma Migrate.
- A `db:migrate:deploy` command exists.
- `db:reset` is clearly marked as destructive and local/test only.
- `db:check` works against PostgreSQL.
- Seed execution is separated from production migrations.
- Production startup never automatically runs destructive reset or seed operations.
- Existing command names are preserved where practical to minimize reviewer confusion.
- No active source code assumes that `DATABASE_URL` begins with `file:`.

## Tests Required

- Every database npm command is run against a clean local PostgreSQL instance.
- `db:migrate` applies migrations successfully.
- `db:migrate:deploy` applies pending migrations without resetting data.
- `db:reset` recreates the local development database and runs the expected seed behavior.
- `db:check` succeeds with a valid connection and fails with an invalid connection.
- Dependency audit confirms that `sql.js` is no longer installed.
- Repository search confirms that active source files contain no SQLite file-path assumptions.

---

# PG-06 - Move Automated Tests to PostgreSQL

## Description

Replace the disposable SQLite test database with isolated PostgreSQL test infrastructure.

The existing helper creates and deletes `data/test.db`, validates an exact SQLite path, and clears tables through Prisma.

Tests should instead use a dedicated PostgreSQL database or isolated schema. Cleanup must never target development or production databases.

## Acceptance Criteria

- `.env.test` uses a PostgreSQL URL.
- Test setup creates or resets a dedicated test database or schema.
- Committed PostgreSQL migrations are applied before tests.
- Test teardown removes test data without touching development data.
- Safety checks validate the database name, host, and/or schema before destructive cleanup.
- Tests refuse to run destructive cleanup against non-test environments.
- Existing domain, repository, service, route, and database tests pass against PostgreSQL.
- Test order does not affect outcomes.
- Multiple Prisma clients can be used in concurrency tests.
- Test connections are disconnected after the suite.
- Coverage remains at or above the existing 90% line threshold.

## Tests Required

- Safety-guard test against a development database URL.
- Safety-guard test against a production-like database URL.
- Fresh migration test before the suite.
- Table cleanup test.
- Cross-test isolation test.
- Independent-client concurrency tests.
- Full `npm test` execution against PostgreSQL.
- Full `npm run test:coverage` execution against PostgreSQL.
- Open-handle check confirms the test runner exits normally after disconnecting clients.

---

# PG-07 - Run PostgreSQL in GitHub Actions

## Description

Update CI so every push and pull request validates the project against PostgreSQL.

The current workflow provides a SQLite file URL and runs the quality gate without a database service.

The updated workflow should launch a PostgreSQL service container, wait for it to become healthy, apply migrations, and then execute the existing quality checks.

## Acceptance Criteria

- GitHub Actions starts a pinned PostgreSQL service.
- The PostgreSQL service has a health check.
- CI uses test-only credentials.
- CI does not use a `file:` database URL.
- Prisma Client is generated.
- `prisma migrate deploy` runs against a fresh CI database.
- Database integration tests run against PostgreSQL.
- Type checking runs.
- Unit and integration tests run.
- Coverage gate runs.
- Production build runs.
- Migration failures block the workflow.
- Database constraint and concurrency tests are part of the required quality gate.
- CI credentials are not production credentials.

## Tests Required

- Pull-request workflow succeeds on a valid branch.
- An intentionally invalid migration causes CI to fail.
- A failing integration test causes CI to fail.
- A coverage result below 90% causes CI to fail.
- CI logs prove that PostgreSQL, rather than SQLite, was used.
- Re-running the workflow from a clean database produces the same result.

---

# PG-08 - Cut Over Deployment and Update Documentation

## Description

Provision managed PostgreSQL for the shared deployment, apply migrations, initialize sample data, verify the service, and remove SQLite deployment assumptions.

The README currently describes SQLite commands and a disposable SQLite test database. These instructions and the database architecture document must be updated.

## Acceptance Criteria

- A managed PostgreSQL database is provisioned for the deployed service.
- Database credentials are stored as deployment secrets.
- Network access is restricted to required services where supported.
- A backup or restore mechanism is enabled before cutover.
- `prisma migrate deploy` runs during the deployment process.
- Seed data runs only when explicitly requested for the demo environment.
- Application startup does not depend on a local database file.
- `/ready` reports PostgreSQL connectivity.
- All three assignment endpoints work after cutover.
- EPG overlap and concurrency behavior work in the deployed environment.
- No production configuration references SQLite.
- README setup commands are updated.
- `docs/database-structure.md` describes PostgreSQL types and constraints.
- EPG concurrency documentation describes both the lock row and exclusion constraint.
- CI and deployment migration responsibilities are documented.
- A rollback runbook is included.

## Tests Required

- Staging cutover rehearsal.
- Empty-database migration test in the deployment environment.
- Seed verification using expected record counts.
- Smoke tests for:
  - `/health`
  - `/ready`
  - inherited content metadata
  - allowed playback
  - geo-blocked playback
  - device-blocked playback
  - successful EPG creation
  - rejected EPG overlap
- Concurrent deployed EPG test using independent requests.
- Restart test confirms data remains available.
- Backup/restore smoke test.
- Documentation command check from a clean checkout.

---

## Recommended Delivery Order

```text
PG-01
  |
PG-02
  |
PG-03
  |-- PG-04
  |-- PG-05
         |
       PG-06
         |
       PG-07
         |
       PG-08
```

## Final Definition of Done

The migration is complete when:

- PostgreSQL is the only active Prisma provider.
- A clean database can be created solely from committed PostgreSQL migrations.
- SQLite and `sql.js` are absent from active runtime and test tooling.
- Existing API contracts remain unchanged.
- Seed scenarios still work.
- All tests and the 90% coverage gate pass against PostgreSQL.
- Concurrent same-channel EPG writes cannot create overlaps.
- Database-level constraints protect the EPG invariant.
- CI and deployment use `prisma migrate deploy`.
- The deployed database survives application restart and redeployment.
- README, database documentation, and operational instructions match the implementation.
