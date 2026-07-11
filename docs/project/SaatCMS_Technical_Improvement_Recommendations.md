# SaatCMS Middleware Core

## Technical Improvement Recommendations

**Repository:** [NumanKavurmaci/Backend-Developer-Take-Home-Assignment](https://github.com/NumanKavurmaci/Backend-Developer-Take-Home-Assignment)  
**Review scope:** Architecture, domain logic, data integrity, concurrency, testing, documentation, and deployment readiness  
**Date:** 11 July 2026

---

## 1. Executive Summary

The project successfully implements the main assignment requirements and demonstrates strong backend engineering fundamentals, especially around metadata inheritance, EPG overlap validation, domain modeling, error handling, and automated testing.

The most important technical issue is that the content metadata endpoint can expose a `playbackUrl` before geo and device authorization checks are applied. Playback URLs should be treated as protected asset data and returned only by the playback endpoint after all entitlement checks succeed.

The second major improvement area is concurrency assurance. The existing transactional per-channel lock is a reasonable solution for the assignment, but the test evidence should be strengthened with independent database clients or processes. For a production-grade implementation, PostgreSQL row locking or range-based exclusion constraints would provide clearer multi-instance guarantees.

---

## 2. Prioritized Recommendations

| ID  | Priority | Area             | Finding                                                                                            | Recommended Action                                                                                            |
| --- | -------- | ---------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| R1  | Critical | API Security     | `playbackUrl` can be returned by the content metadata endpoint before entitlement checks.          | Separate internal metadata from the public response DTO and return the URL only after playback authorization. |
| R2  | High     | Concurrency      | Current tests do not fully prove behavior across independent connections or application instances. | Add multi-client or multi-process tests and consider PostgreSQL locking for production.                       |
| R3  | High     | Data Integrity   | Important rules are mainly enforced in application code.                                           | Add database constraints for invalid time ranges and unsupported values.                                      |
| R4  | High     | Testing          | Tests use and clear the configured SQLite database.                                                | Use a dedicated disposable test database.                                                                     |
| R5  | Medium   | CI               | No automated repository workflow proves that type checking, tests, and builds pass.                | Add a GitHub Actions quality gate.                                                                            |
| R6  | Medium   | Documentation    | Some documentation no longer matches the implemented code.                                         | Update stale status notes and TODO entries.                                                                   |
| R7  | Medium   | Input Validation | Header normalization and validation could be more explicit.                                        | Validate country codes and define device-type casing behavior.                                                |
| R8  | Medium   | Observability    | The project has limited request correlation and operational diagnostics.                           | Add structured logging, request IDs, and readiness checks.                                                    |
| R9  | Medium   | Deployment       | SQLite on ephemeral hosting may lose data and limits write scalability.                            | Use PostgreSQL or persistent storage for shared environments.                                                 |

---

## 3. Detailed Recommendations

### R1. Protect Playback URLs Behind the Gatekeeper

#### Problem

The content metadata endpoint returns resolved metadata directly, and the resolved model includes `playbackUrl`.

This allows a client to request:

```http
GET /api/v1/mw/content/{contentId}
```

without sending:

```text
X-User-Id
X-User-Country
X-Device-Type
```

As a result, a geo-blocked or unsupported device may obtain the playback URL without passing through the playback authorization pipeline.

#### Recommendation

Create separate internal and public models.

```text
InternalResolvedMetadata
  - title
  - genre
  - parentalRating
  - quality
  - isPremium
  - geoBlockCountries
  - playbackUrl

PublicContentResponse
  - title
  - genre
  - parentalRating
  - quality
  - isPremium

PlaybackResponse
  - playbackUrl
  - returned only after authorization succeeds
```

#### Required Test

Add a regression test that verifies:

- `GET /api/v1/mw/content/{contentId}` never contains `playbackUrl`.
- `GET /api/v1/mw/playback/{contentId}` returns `playbackUrl` only for an allowed country and supported device.
- Geo-blocked and device-blocked requests never expose the URL.

---

### R2. Strengthen Concurrency Guarantees

#### Current Strength

The project uses a per-channel lock row inside a transaction:

```text
start transaction
  -> update channel lock row
  -> check overlap
  -> insert EPG program
commit
```

This is a reasonable concurrency strategy for the assignment.

#### Limitation

A concurrency test using `Promise.allSettled` with one shared `PrismaClient` does not fully prove behavior under:

- Separate database connections
- Multiple Node.js processes
- Multiple application instances
- Horizontal scaling

#### Recommendation

Add stronger integration tests:

1. Create two independent `PrismaClient` instances.
2. Send overlapping writes simultaneously.
3. Verify that exactly one request succeeds.
4. Run a burst of 10–20 overlapping requests.
5. Verify that only one row is inserted.
6. Run concurrent writes on different channels and confirm channel isolation.

For production PostgreSQL, use one of these approaches:

- `SELECT ... FOR UPDATE` on the channel lock row
- PostgreSQL advisory locks
- PostgreSQL exclusion constraints

Example exclusion constraint:

```sql
EXCLUDE USING gist (
  channel_id WITH =,
  tstzrange(start_time, end_time, '[)') WITH &&
);
```

The `[)` range keeps back-to-back programs valid:

```text
10:00-11:00
11:00-12:00
```

---

### R3. Add Database-Level Safeguards

Application validation provides readable errors, but the database should also reject impossible states if another script or future service bypasses the domain layer.

Recommended constraints:

```sql
CHECK (start_time < end_time)
```

```sql
CHECK (type IN ('SERIES', 'SEASON', 'EPISODE', 'MOVIE'))
```

```sql
CHECK (
  quality IS NULL OR
  quality IN ('SD', 'HD', 'UHD_4K')
)
```

Keep the existing:

- Foreign keys
- Unique channel slug
- Channel-scoped indexes
- Composite keys for geo-block country rows

The complete `Series -> Season -> Episode` relationship is difficult to enforce with a simple database `CHECK`, so application-level hierarchy validation should remain.

---

### R4. Isolate Automated Tests

#### Problem

The test suite connects to the configured SQLite database and clears tables during setup. This can:

- Delete seeded development data
- Make test execution order-dependent
- Prevent safe parallel execution
- Surprise reviewers running tests locally

#### Recommendation

Use a dedicated test environment:

```env
# .env.test
DATABASE_URL="file:../data/test.db"
```

Recommended test lifecycle:

```text
1. Delete the old test database
2. Create a new test database
3. Apply committed migrations
4. Run tests
5. Remove the database after the suite
```

Add a safety guard that refuses to run tests when `DATABASE_URL` points to the development database.

---

### R5. Add a CI Quality Gate

A reviewer should be able to see that every commit passes the same checks.

Recommended GitHub Actions workflow:

```text
npm ci
create test environment
npm run db:reset
npm run typecheck
npm test
npm run build
```

The workflow should run on:

```yaml
on:
  push:
  pull_request:
```

Optional improvements:

- Upload test coverage
- Cache npm dependencies
- Add separate jobs for type checking and tests
- Add coverage thresholds for critical modules

Critical coverage areas:

- Metadata inheritance
- Corrupted hierarchy detection
- Geo-block override behavior
- EPG overlap boundaries
- Concurrent EPG writes
- Playback authorization

---

### R6. Remove Documentation Drift

The documentation is detailed and reviewer-friendly, but some status information no longer matches the code.

Examples of likely drift:

- Concurrency-safe EPG creation is implemented but may still be described as a future step.
- The TODO file mentions missing concurrency tests even though concurrency tests exist.

Recommended action:

- Update `docs/domain/live-channel-domain-index.md`.
- Update or remove stale entries in `TODOs.md`.
- Keep `README.md` as the concise project entry point.
- Move historical implementation notes into an archive if they are still useful.
- Add documentation review to the final pull request checklist.

---

### R7. Improve Header Validation

#### Country Header

Normalize and validate `X-User-Country` at the HTTP boundary:

```ts
const country = rawCountry.trim().toUpperCase();

if (!/^[A-Z]{2}$/.test(country)) {
  throw new ApiError(
    400,
    "INVALID_COUNTRY_CODE",
    "X-User-Country must be a two-letter country code",
  );
}
```

This does not guarantee that the country code is officially assigned, but it creates a clear API contract without requiring an external validation library.

#### Device Header

Choose one explicit strategy:

**Strict:**

```text
Mobile
SmartTV
Web
```

or **case-insensitive normalization:**

```text
mobile  -> Mobile
smarttv -> SmartTV
web     -> Web
```

Document the chosen behavior in the API documentation and Postman collection.

---

### R8. Add Operational Observability

The current health endpoint confirms that the process is responding, but production diagnostics require more visibility.

Recommended additions:

#### Request ID

Accept or generate a request ID:

```text
X-Request-Id
```

Return it in the response and include it in every log entry.

#### Structured Logging

Log fields such as:

```json
{
  "requestId": "req-123",
  "method": "POST",
  "path": "/api/v1/cms/channels/channel-saat-news/epg",
  "status": 400,
  "durationMs": 12,
  "errorCode": "EPG_OVERLAP",
  "channelId": "channel-saat-news"
}
```

#### Health and Readiness

Use separate endpoints:

```text
GET /health
```

Checks whether the process is alive.

```text
GET /ready
```

Checks whether the database is accessible.

#### Metrics

Useful metrics include:

- Request count
- Request latency
- Error count by `errorCode`
- EPG overlap rejection count
- Geo-block rejection count
- Device-block rejection count
- Database transaction failures

---

### R9. Improve Deployment Storage

SQLite is suitable for a local take-home assignment, but it has important limitations in shared hosting environments.

Risks include:

- Data loss on ephemeral filesystems
- Limited write concurrency
- Lock contention during concurrent writes
- Difficult horizontal scaling
- No shared database between multiple instances

Recommended environment strategy:

```text
Local development:
  SQLite

Automated tests:
  Disposable SQLite database

Shared demo / production:
  PostgreSQL
```

Keep migrations repeatable and avoid depending on local mutable files in deployed environments.

---

## 4. Recommended Implementation Order

| Phase | Changes                                                                      | Estimated Effort | Exit Criteria                                                |
| ----- | ---------------------------------------------------------------------------- | ---------------: | ------------------------------------------------------------ |
| 1     | Remove `playbackUrl` from public content responses and add regression tests. |          0.5 day | Asset URLs cannot bypass entitlement checks.                 |
| 2     | Add a dedicated disposable test database.                                    |        0.5–1 day | Tests never modify development data.                         |
| 3     | Strengthen concurrency tests with independent clients and burst scenarios.   |            1 day | Exactly one overlapping same-channel write succeeds.         |
| 4     | Add database constraints and GitHub Actions.                                 |            1 day | Every push proves migrations, type checks, tests, and build. |
| 5     | Update documentation and add basic observability.                            |            1 day | Documentation and runtime diagnostics are consistent.        |
| 6     | Introduce PostgreSQL for shared deployments.                                 |         1–2 days | Hosted data is durable and multi-instance safe.              |

---

## 5. Completion Checklist

- [ ] The content metadata endpoint does not expose `playbackUrl`.
- [ ] Playback URLs are returned only after geo and device checks pass.
- [ ] Concurrency tests use independent database connections or processes.
- [ ] Burst concurrency scenarios are covered.
- [ ] A dedicated test database is created and removed automatically.
- [ ] Database constraints reject invalid EPG time ranges.
- [ ] Database constraints reject unsupported content and quality values.
- [ ] GitHub Actions runs type checking, tests, and build.
- [ ] Documentation reflects the current implementation.
- [ ] Country and device headers have an explicit validation contract.
- [ ] Request IDs and structured logs are available.
- [ ] A database-aware readiness endpoint exists.
- [ ] Shared deployments use PostgreSQL or durable storage.

---

## 6. Files Most Relevant to These Recommendations

```text
README.md
TODOs.md
prisma/schema.prisma
prisma/seed.ts

src/content/content-repository.ts
src/content/metadata-inheritance.ts
src/content/content-hierarchy.test.ts

src/live-channel/epg-program/epg-program-repository.ts
src/live-channel/live-channel.test.ts

src/modules/cms-epg-program/cms-epg-program.service.ts
src/modules/mw-content/mw-content.service.ts
src/modules/mw-playback/mw-playback.service.ts
src/modules/mw-playback/mw-playback.route.test.ts

src/shared/http/error-handler.ts
src/shared/http/domain-error-mapper.ts

docs/api/api-test-examples.md
docs/domain/live-channel-domain-index.md
```
