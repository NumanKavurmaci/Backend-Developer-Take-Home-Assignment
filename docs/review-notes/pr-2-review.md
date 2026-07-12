# PR #2 Senior Engineering Review

Pull request: [NumanKavurmaci/Backend-Developer-Take-Home-Assignment#2](https://github.com/NumanKavurmaci/Backend-Developer-Take-Home-Assignment/pull/2)

Review scope: PostgreSQL migration, database integrity and concurrency, application error handling, test infrastructure, CI, deployment configuration, operational safety, and documentation.

## Verdict

**Request changes.**

The pull request establishes a solid PostgreSQL foundation, and its current CI run is green. However, the Render deployment is not deployable as configured, destructive database operations are not sufficiently guarded, and several deployment and reliability checks can report misleading results.

No P0 issues were found. The review identified two P1 merge blockers, six P2 reliability problems, and two P3 lower-priority problems.

## Findings and Low-Level Solution Plans

### 1. P1 — Render omits the build toolchain

Locations:

- `render.yaml:7,13-14`
- `package.json:10,19,23,39-45`

The Render blueprint sets `NODE_ENV=production` and then runs `npm ci`. Under this environment, npm omits development dependencies. The commands that immediately follow require `prisma` and `typescript`, while the pre-deploy command also requires the Prisma CLI. `prisma`, `typescript`, and `tsx` are currently development dependencies.

A clean deployment therefore fails at `npm run db:generate` because the Prisma executable is unavailable. Even if the build passed through another mechanism, `npm run db:migrate:deploy` would not have the Prisma CLI during pre-deploy.

Supporting documentation:

- [Render environment variables are available at build and runtime](https://render.com/docs/your-first-deploy)
- [npm ci omits development dependencies when NODE_ENV is production](https://docs.npmjs.com/cli/commands/npm-ci/)

#### Solution plan

1. Change the Render build command to explicitly install build dependencies:

   ```yaml
   buildCommand: npm ci --include=dev && npm run db:generate && npm run build
   ```

2. Ensure the Prisma CLI remains installed through the pre-deploy phase.
3. If production dependencies are pruned after compilation, move `prisma` to `dependencies` because it is required by `db:migrate:deploy`.
4. Either retain `tsx` in the deployed artifact or compile the documented seed, verification, and database-check commands to JavaScript before pruning dependencies.
5. Add a CI deployment-build job that executes the exact Render build and pre-deploy commands with `NODE_ENV=production` in a clean installation.

### 2. P1 — Destructive database commands fail open

Locations:

- `prisma/seed.ts:3-15,56-64,206-210`
- `package.json:20,25`
- `README.md:85,99-102`

The demo seed guard treats a missing `DEPLOYMENT_ENV` as `local`. The package script always supplies the required `--demo` argument, and the guard ignores `NODE_ENV=production`. A production or staging shell that has a production `DATABASE_URL` but no project-specific `DEPLOYMENT_ENV` therefore passes the guard and proceeds to delete application data.

This was reproduced with `NODE_ENV=production`, no `DEPLOYMENT_ENV`, and an unreachable production-like database URL. The seed reached `clearExistingData()` and failed with Prisma `P1001`, proving the safety check had allowed the destructive path.

The `db:reset` script separately invokes raw `prisma migrate reset`. Supplying `--force` allows it to reset whichever database `DATABASE_URL` references without checking the environment, hostname, database name, or schema. This contradicts the README statement that reset is restricted to local or disposable test databases.

#### Solution plan

1. Remove the `?? "local"` fallback and require an explicit deployment environment.
2. Extract a centralized destructive-operation guard shared by seed and reset tooling.
3. Reject missing, unknown, production, and staging environments before constructing or using a Prisma client.
4. For `local` and `test`, require a loopback host and exact database/schema allowlists.
5. For a production-mode demo environment, require a second explicit confirmation value tied to the expected demo database identity.
6. Query `current_database()` and `current_schema()` and compare the live connection with the guarded target before deleting data.
7. Replace `db:reset` with a guarded wrapper such as `tsx scripts/reset-database.ts`; do not expose the raw reset command through normal package scripts.
8. Add tests for missing, mistyped, production, remote-local, valid-local, valid-test, and valid-demo configurations. Rejected cases must prove that no database connection or write was attempted.

### 3. P2 — Readiness accepts an unmigrated or incompatible database

Locations:

- `render.yaml:8-10`
- `src/modules/health/health.controller.ts:7-9,21-40`

Render uses `/ready` as its deployment health gate, but the endpoint only executes `SELECT 1`. This proves connectivity, not schema compatibility.

The behavior was reproduced against a reachable empty PostgreSQL schema: `/ready` returned HTTP 200 while a content API request returned HTTP 500 because the required tables did not exist. A wrong database, incomplete restore, missing migration, or misleading migration history can therefore become healthy and receive traffic.

#### Solution plan

1. Change the pre-deploy command to run both migration deployment and a schema-aware check:

   ```yaml
   preDeployCommand: npm run db:migrate:deploy && npm run db:check
   ```

2. Make readiness verify the presence of required relations and the latest expected completed migration.
3. Reject unfinished, failed, or rolled-back migration records.
4. Use lightweight queries such as `to_regclass` checks or bounded reads from required tables.
5. Apply a short database query timeout so the health endpoint cannot hang indefinitely.
6. Add integration tests for:
   - reachable but unmigrated database → HTTP 503;
   - partially migrated database → HTTP 503;
   - fully migrated database → HTTP 200.

### 4. P2 — Deployment smoke testing is not repeatable

Locations:

- `scripts/deployment-smoke.ts:50-100,152-155`
- `docs/deployment-runbook.md:56-70`

The smoke script inserts a one-hour EPG interval at `Date.now() + 366 days`. It does not remove that record. If the script runs again a few minutes later, the new interval is shifted by only a few minutes and overlaps the first run's interval. The second run receives HTTP 400 where it expects HTTP 201.

The deployment runbook explicitly instructs the operator to restart the staging service and immediately run the smoke suite again. Persistence—the behavior this step intends to verify—causes the verification to fail. Each successful run also leaves two permanent EPG records: the initial successful program and one successful concurrent program.

The HTTP requests also have no timeout, so an endpoint that accepts a connection but never responds can hang the operator indefinitely.

#### Solution plan

1. Keep production deployment smoke checks read-only.
2. Move EPG write and concurrency checks to a disposable staging database or a dedicated smoke-test fixture.
3. If write checks must remain, use a dedicated test channel and delete every created row in a `finally` block through an authenticated cleanup mechanism.
4. Add `AbortSignal.timeout(...)` to every request and report timeout errors with the check name and URL.
5. Add an automated regression test that runs the smoke suite twice against the same database.
6. Assert that both runs pass and no residual smoke rows remain afterward.

### 5. P2 — Destructive reseeding is not atomic

Locations:

- `prisma/seed.ts:56-65,67-204,206-216`

`clearExistingData()` commits its deletion transaction before content and channel insertion begins. The subsequent seed operations run as separate database operations. A network error, constraint error, process termination, or deployment interruption after deletion leaves the previous data gone and the database empty or partially seeded.

The verification command can report the damage but cannot restore the previous state.

#### Solution plan

1. Refactor the clear and seed helpers to accept a `Prisma.TransactionClient`.
2. Execute deletion, all content inserts, all channel/EPG inserts, and verification inside one interactive transaction.
3. Configure a bounded but sufficient transaction timeout for the known seed size.
4. Commit only after the expected record counts and key relationships have been verified.
5. Add a fault-injection integration test that throws after deletion and proves the pre-seed records remain after rollback.

### 6. P2 — Tests and Compose resources are shared across runs

Locations:

- `.env.test:2`
- `src/test/test-database.ts:31-47,163-182`
- `compose.yaml:1,6,12,26`

Every test process resets and clears the fixed `saatcms_test` database in the `public` schema. `fileParallelism: false` only serializes files within one Vitest process; it does not isolate two terminals, worktrees, or automation processes.

A single `npm test` invocation passed 225 tests. When two `npm test` processes ran concurrently, both failed three tests because each process deleted or replaced the other process's fixtures. A subsequent isolated run passed again.

Compose also fixes the project name, container name, volume name, and host port. Two checkouts on the same machine therefore operate on the same PostgreSQL container and volume. Running `db:destroy` from one checkout can delete the other checkout's database.

#### Solution plan

1. Add a test-run wrapper that derives a unique database name such as `saatcms_test_<run-id>_<uuid>`.
2. Create that database through a maintenance connection before starting Vitest.
3. Spawn migrations and Vitest with the unique `DATABASE_URL`.
4. Drop the database in `finally`, guarded by a strict generated-name prefix and identifier validation.
5. Preserve the current live database/schema verification checks.
6. Remove `container_name` and the explicit volume `name` from Compose.
7. Make the Compose project name and published PostgreSQL port checkout-configurable.
8. Add a regression check that starts two lightweight Vitest invocations concurrently and requires both to exit successfully.
9. Verify that two differently named Compose projects can start, stop, and destroy their databases independently.

### 7. P2 — Schedule-lock foreign-key errors bypass domain mapping

Locations:

- `src/live-channel/epg-program/epg-program-repository.ts:19-31,45-60`
- `src/live-channel/epg-program/epg-program-error-mapper.ts:36-41`

The service checks channel existence before opening the transaction. If the channel disappears between that check and `epgScheduleLock.upsert`, or if the exported repository function is called with a missing channel, the lock-row insertion violates `EpgScheduleLock_channelId_fkey`.

Only `epgProgram.create` is inside the current error-mapping catch block. The schedule-lock failure therefore escapes as Prisma `P2003` and becomes HTTP 500 instead of the documented `404 CHANNEL_NOT_FOUND` response.

This was reproduced against PostgreSQL. Passing the resulting error to the mapper manually returned `CHANNEL_NOT_FOUND`, proving the mapper can represent the failure but is positioned outside the failing operation.

#### Solution plan

1. Wrap the complete `$transaction` call in `try/catch`, not only `epgProgram.create`.
2. Rethrow `toEpgProgramDomainError(error) ?? error` from the outer catch.
3. Add `EpgScheduleLock_channelId_fkey` as an explicit mapping.
4. Parse and normalize Prisma `meta.field_name`, including removal of the ` (index)` suffix.
5. Move the channel existence/locking decision into the same transaction to eliminate the service-level time-of-check/time-of-use window.
6. Add a PostgreSQL integration test that calls the locked repository with a nonexistent channel and expects `DomainError { errorCode: "CHANNEL_NOT_FOUND" }`.

### 8. P2 — Production Node.js differs from CI

Locations:

- `package.json:31-33`
- `.github/workflows/ci.yml:37-41`

CI pins Node.js 24, but the package engine is the unbounded range `>=24`. Render documents that an unbounded range resolves to the latest Node.js release. At the time of review, that is Node.js 26 Current rather than the Node.js 24 LTS major tested by CI.

Production can therefore move to a new major automatically while CI remains on Node.js 24.

Supporting documentation:

- [Render Node.js version resolution](https://render.com/docs/node-version)
- [Node.js release status](https://nodejs.org/en/about/previous-releases)

#### Solution plan

1. Commit a `.node-version` file containing the selected Node.js 24 LTS patch.
2. Configure `actions/setup-node` with `node-version-file: .node-version`.
3. Bound `engines.node` to the tested major, for example `>=24 <25`.
4. Add a CI assertion that reports and verifies `node --version`.
5. Upgrade the Render runtime, package engine, local version file, and CI version together through a dedicated dependency/runtime change.

### 9. P3 — Primary-key collisions are reported as schedule overlap

Locations:

- `src/db/database-error.ts:28-32`
- `src/live-channel/epg-program/epg-program-error-mapper.ts:23-27,53-61`

Every Prisma `P2002` is converted to SQLSTATE `23505`. The EPG mapper treats that SQLSTATE alone as evidence that the composite schedule constraint failed.

A caller that supplies an existing `EpgProgram.id` with a non-overlapping time violates `EpgProgram_pkey`, but the repository returns `EPG_OVERLAP`. A real PostgreSQL reproduction produced `meta.target=["id"]`, yet the mapper returned the overlap error. The public HTTP endpoint currently generates IDs, so the direct impact is limited to repository callers and extremely unlikely generated-ID collisions.

#### Solution plan

1. Extend `DatabaseConstraintFailure` to retain Prisma `modelName` and normalized `targetFields`.
2. Map a uniqueness failure to `EPG_OVERLAP` only when:
   - the named constraint is `EpgProgram_channelId_startTime_endTime_key`; or
   - the target fields exactly match `channelId`, `startTime`, and `endTime`.
3. Do not use bare SQLSTATE `23505` as sufficient evidence when the table has multiple unique constraints.
4. Leave primary-key collisions as internal failures or introduce a separate conflict code if repository-supplied IDs are supported.
5. Replace the unit test that treats every bare `P2002` as overlap.
6. Add real database tests for a composite schedule duplicate and an ID duplicate at a non-overlapping time.

### 10. P3 — CI repeats the same work

Locations:

- `.github/workflows/ci.yml:3-5,55-65`

A push to an open pull request triggers both `push` and `pull_request` workflows. Within each workflow, `db:test` runs a subset of tests, `npm test` runs the complete suite, and `test:coverage` runs the complete suite again. PostgreSQL is repeatedly reset and the same tests execute multiple times.

This increases feedback time and CI consumption without adding independent coverage.

#### Solution plan

1. Restrict `push` to the default branch and use `pull_request` for feature branches.
2. Add a workflow concurrency group and enable `cancel-in-progress: true`.
3. Use the coverage command as the single complete test-suite execution.
4. Retain a separate database command only for migration or constraint checks not already included in the full suite.
5. Keep typecheck and production build as independent gates.

## Suggested Implementation Order

1. Fix the Render dependency installation and add an exact deployment-path CI job.
2. Centralize and enforce destructive database target guards.
3. Harden readiness and make the deployment smoke suite repeatable.
4. Make seeding atomic.
5. Isolate test databases and Compose resources per process or checkout.
6. Correct transaction-level EPG error handling and constraint classification.
7. Pin the production Node.js major to the version tested in CI.
8. Remove duplicated CI execution.

## Validation Evidence

The following checks were completed against PR head `f1307e7eff9c3f61d0e62db5eb5573ac588433c0`:

- GitHub Actions PR workflow run completed successfully.
- Full test suite: 19 files passed, 225 tests passed.
- PostgreSQL-focused schema, constraint, error-mapping, concurrency, and content tests: 118 tests passed.
- Coverage suite: 225 tests passed.
- Line coverage: 97.88%.
- Statement coverage: 97.69%.
- Branch coverage: 93.33%.
- Function coverage: 99.21%.
- TypeScript typecheck passed.
- TypeScript production build passed.
- Prisma schema validation passed with a PostgreSQL URL.
- The working tree remained clean throughout the review.

Passing tests and CI do not cover the production Render dependency-install path, empty-schema readiness behavior, concurrent independent test processes, destructive command targeting, or repeated deployment smoke execution described above.
