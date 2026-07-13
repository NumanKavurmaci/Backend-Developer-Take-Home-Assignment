# SaatCMS Post-Release Fixes Project Steps

Source: [SaatCMS Technical Improvement Recommendations](../reviews/SaatCMS_Technical_Improvement_Recommendations.md)

These steps convert the technical review findings into an actionable post-release project plan. Each step includes the implementation goal, acceptance criteria, and the tests or automated checks that should be added before the step is considered complete.

---

## Step 1. Secure Public Content Metadata Responses

### Description

Remove protected playback asset data from the public content metadata endpoint. The metadata inheritance engine may still resolve `playbackUrl` internally, but `GET /api/v1/mw/content/{contentId}` must return only public metadata. Playback URLs must be returned exclusively by `GET /api/v1/mw/playback/{contentId}` after geo and device checks pass.

### Acceptance Criteria

- Public content responses never include `playbackUrl` or nested playback asset details.
- Internal resolved metadata can still include `playbackUrl` for playback authorization.
- Playback responses include `playbackUrl` only after entitlement checks succeed.
- Geo-blocked requests do not expose `playbackUrl`.
- Device-blocked requests do not expose `playbackUrl`.
- API docs and Postman examples reflect the public content response shape.

### Tests to Implement

- Route regression test: `GET /api/v1/mw/content/{contentId}` does not contain `playbackUrl` for content with an inherited playback URL.
- Route regression test: public content response does not contain `playbackUrl` at any nested path.
- Playback success test: `GET /api/v1/mw/playback/{contentId}` returns `playbackUrl` for an allowed country and supported device.
- Playback geo-block test: blocked country returns `403` with `GEO_BLOCKED` and no `playbackUrl`.
- Playback device-block test: unsupported device returns `403` with `DEVICE_NOT_SUPPORTED` and no `playbackUrl`.
- Documentation example test or manual smoke check: README, API docs, and Postman examples show the corrected response contracts.

---

## Step 2. Isolate the Automated Test Database

### Description

Move automated tests away from the configured development SQLite database. Tests should run against a disposable database created for the suite and removed afterward. Add safety checks so a test run cannot accidentally clear seeded development data.

### Acceptance Criteria

- A dedicated test database URL is defined, for example in `.env.test`.
- Test setup creates a clean disposable database before the suite.
- Test teardown removes or resets the disposable database after the suite.
- Test helpers refuse to run destructive cleanup when `DATABASE_URL` points to the development database.
- Local and CI test commands use the test database by default.
- README explains the test database behavior.

### Tests to Implement

- Test setup guard: throws when destructive test cleanup targets the development database path.
- Test setup integration test: creates a fresh test database from migrations.
- Test teardown integration test: removes or resets test data without touching the development database.
- Suite isolation test: data created in one test does not leak into another test.
- Script smoke test: `npm test` runs successfully from a clean checkout without requiring seeded development data.

---

## Step 3. Strengthen EPG Concurrency Proof

### Description

Expand concurrency testing beyond a single shared Prisma client. The current per-channel transactional lock is a good assignment-level strategy, but stronger tests should prove behavior across independent database connections and request bursts.

### Acceptance Criteria

- Concurrent overlapping writes using independent Prisma clients cannot both succeed.
- A burst of overlapping writes to the same channel inserts exactly one row.
- Concurrent writes to different channels are isolated from each other.
- Back-to-back schedules remain valid under the concurrency path.
- The concurrency strategy and its SQLite/PostgreSQL limitations are documented.

### Tests to Implement

- Integration test: two independent `PrismaClient` instances submit overlapping programs for the same channel; exactly one succeeds.
- Integration test: 10 to 20 overlapping requests for the same channel run concurrently; exactly one succeeds and one row is inserted.
- Integration test: concurrent same-time requests for different channels succeed independently.
- Integration test: concurrent back-to-back requests on the same channel both succeed when their ranges only touch at the boundary.
- Failure-state test: after rejected concurrent writes, the database contains no overlapping EPG rows.
- Optional process-level test: two Node.js worker processes attempt the same overlapping insert; exactly one succeeds.

---

## Step 4. Add Database-Level Safeguards

### Description

Add database constraints for rules that should hold even when code paths bypass application validation. Application errors should remain friendly, but the database should reject impossible states such as invalid time ranges or unsupported enum-like values.

### Acceptance Criteria

- EPG rows cannot be saved with `startTime >= endTime`.
- Content type values are constrained to supported types.
- Quality values are constrained to supported values or `NULL`.
- Existing foreign keys, unique keys, and indexes remain intact.
- Migrations apply cleanly from an empty database.
- Application-level validation still returns clear API errors before database errors whenever possible.

### Tests to Implement

- Repository or migration test: direct insert with `startTime == endTime` fails at the database layer.
- Repository or migration test: direct insert with `startTime > endTime` fails at the database layer.
- Repository or migration test: unsupported content type fails at the database layer.
- Repository or migration test: unsupported quality value fails at the database layer.
- Positive migration test: valid nullable quality and valid supported quality values are accepted.
- Migration smoke test: reset an empty database and apply all migrations successfully.
- API regression test: invalid date ranges still return the expected client error response.

---

## Step 5. Tighten Playback Header Validation

### Description

Make header normalization and validation explicit at the HTTP boundary. Country codes should have a clear format contract, and device-type handling should be documented as either strict or case-insensitive.

### Acceptance Criteria

- `X-User-Country` is trimmed, normalized to uppercase, and validated as a two-letter country code.
- Invalid country values return `400` with a stable error code.
- Device-type behavior is explicitly chosen and documented.
- Missing, blank, and malformed headers return consistent client errors.
- API docs and Postman examples show valid and invalid header cases.

### Tests to Implement

- Route test: lowercase country code is normalized and accepted if normalization is the chosen behavior.
- Route test: country values with one, three, numeric, or symbol characters are rejected.
- Route test: blank country header is rejected.
- Route test: device header casing follows the documented behavior.
- Route test: unsupported device type returns the expected client error.
- Route test: missing `X-User-Id`, `X-User-Country`, and `X-Device-Type` each return the expected error.
- Documentation smoke check: API docs and Postman collection include valid, geo-blocked, device-blocked, and malformed-header examples.

---

## Step 6. Add a CI Quality Gate

### Description

Add a GitHub Actions workflow that proves each pushed commit and pull request can install dependencies, prepare the test database, typecheck, test, and build.

### Acceptance Criteria

- CI runs on `push` and `pull_request`.
- CI uses `npm ci`.
- CI prepares a disposable test database.
- CI runs type checking.
- CI runs the automated test suite.
- CI runs the production build.
- CI fails on test, migration, typecheck, or build failures.
- CI status is documented in the README.

### Tests and Checks to Implement

- Workflow check: `npm ci`.
- Workflow check: test database setup or migration reset.
- Workflow check: `npm run typecheck`.
- Workflow check: `npm test`.
- Workflow check: `npm run build`.
- Optional workflow check: coverage report upload.
- Optional local validation: run `actionlint` or an equivalent workflow syntax check before pushing.

---

## Step 7. Remove Documentation Drift and Project Folder Duplication

### Description

Keep the repository documentation consistent with the implemented code and use categorized subfolders beneath `docs/project`. Historical or assignment assets should live there, not in a second root-level `project` directory.

### Acceptance Criteria

- Root-level `project/` directory is removed.
- Assignment PDF lives under `docs/project/assignment`.
- README links to the assignment notes, assignment PDF, technical recommendations, original project steps, and post-release fixes.
- Stale standalone TODO documentation is removed or archived.
- Domain docs describe the current EPG concurrency implementation accurately.
- Historical implementation notes are archived or clearly labeled if kept.

### Tests and Checks to Implement

- Documentation structure check: root-level `project/` directory does not exist.
- Documentation structure check: required files exist in the appropriate `docs/project` subfolders.
- Markdown link check: README and docs links resolve.
- Documentation smoke check: cURL examples still match the current API response shape.
- Postman validation check: the collection contains the current success and failure examples.

---

## Step 8. Add Operational Observability

### Description

Add request correlation and production diagnostics. The service should accept or generate request IDs, include them in responses and logs, emit structured request logs, and expose a database-aware readiness endpoint.

### Acceptance Criteria

- Incoming `X-Request-Id` is accepted when present.
- A request ID is generated when the header is absent.
- Responses include the request ID.
- Structured logs include request ID, method, path, status, duration, and error code when applicable.
- `GET /health` remains a liveness endpoint.
- `GET /ready` checks database connectivity.
- Errors include enough context for diagnosis without leaking secrets or playback URLs.

### Tests to Implement

- Route test: request with `X-Request-Id` returns the same request ID.
- Route test: request without `X-Request-Id` returns a generated request ID.
- Middleware test: structured log entry includes method, path, status, duration, and request ID.
- Error-path test: structured log entry includes mapped error code.
- Readiness success test: `/ready` returns success when the database check passes.
- Readiness failure test: `/ready` returns a failure status when the database check fails.
- Regression test: error responses still omit protected playback URLs.

---

## Step 9. Prepare Durable Deployment Storage

### Description

Define the environment strategy for local development, tests, and shared deployments. SQLite can remain the local default, but shared demo or production environments should use PostgreSQL or another durable database.

### Acceptance Criteria

- Local development database strategy remains simple and documented.
- Automated tests use disposable SQLite.
- Shared demo or production environments use PostgreSQL or durable storage.
- Production startup fails fast when configured with an unsafe ephemeral database URL.
- Migrations are repeatable in fresh environments.
- Deployment documentation explains database setup and migration commands.

### Tests and Checks to Implement

- Configuration test: production mode rejects a SQLite file URL unless explicitly allowed for local-only runs.
- Configuration test: missing `DATABASE_URL` fails with a clear startup error.
- Migration smoke check: migrations apply cleanly to SQLite.
- PostgreSQL migration smoke check: migrations apply cleanly to PostgreSQL in CI or a documented local container.
- Repository integration test: EPG overlap and content metadata flows pass against the deployment database target.
- Startup smoke check: application boots with the documented deployment environment variables.

---

## Step 10. Enforce 90 Percent Line Coverage Across the Codebase

### Description

Make coverage a final release gate after the post-release fixes are implemented. The goal is at least 90 percent line coverage across the application codebase, excluding only generated files and build artifacts.

### Acceptance Criteria

- Coverage reporting is enabled in Vitest.
- A script such as `npm run test:coverage` exists.
- Global line coverage threshold is at least 90 percent.
- CI fails when global line coverage drops below 90 percent.
- Coverage includes all source files under `src`.
- Exclusions are limited to generated output, dependencies, and explicitly justified files.
- The README documents how to run coverage locally.

### Tests to Implement

- Gap-driven unit tests for low-coverage source files identified by the first coverage report.
- Domain tests for content hierarchy corruption, metadata fallback edge cases, and geo-block override behavior.
- Domain tests for EPG overlap boundaries, invalid ranges, and channel isolation.
- Service tests for content metadata, playback authorization, and CMS EPG creation success and failure paths.
- Route tests for all documented endpoints, including success, not found, validation, authorization, and unexpected error mapping.
- Shared HTTP tests for `ApiError`, domain-error mapping, and error-handler response format.
- Health and readiness route tests.
- Database setup and safety-guard tests from Step 2.
- Concurrency tests from Step 3.
- Database constraint tests from Step 4.
- Header validation tests from Step 5.
- Observability middleware tests from Step 8.
- Coverage gate test/check: `npm run test:coverage` fails below 90 percent line coverage and passes at or above the threshold.
