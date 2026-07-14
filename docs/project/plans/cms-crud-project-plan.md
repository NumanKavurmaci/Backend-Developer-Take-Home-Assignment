# CMS CRUD API Project Plan

## Objective

Provide authenticated CMS APIs that can create, read, update, and delete the supported business entities without bypassing content hierarchy, metadata inheritance, EPG scheduling, or database integrity rules.

This is not a generic database-table editor. CRUD operations are implemented as explicit domain APIs for:

- Content: Series, Season, Episode, and Movie
- Live channels
- EPG programs
- Content geo-block countries, managed as part of Content rather than as an independent resource

`EpgScheduleLock` is internal infrastructure and will not have public CRUD endpoints.

## Implementation Status

**Complete.** The domain APIs, authentication and
roles, structured audit events, rate/body limits, optimistic concurrency,
rollback switch, automated tests, OpenAPI contract, and Postman requests are
implemented. Deployment still requires real CMS keys through the platform
secret store.

## Recommended API Scope

| Resource     | Create                                              | Read                                                 | List                                      | Update                                                 | Delete                                                  |
| ------------ | --------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------- |
| Content      | `POST /api/v1/cms/content`                          | `GET /api/v1/cms/content/:id`                        | `GET /api/v1/cms/content`                 | `PATCH /api/v1/cms/content/:id`                        | `DELETE /api/v1/cms/content/:id`                        |
| Live channel | `POST /api/v1/cms/channels`                         | `GET /api/v1/cms/channels/:id`                       | `GET /api/v1/cms/channels`                | `PATCH /api/v1/cms/channels/:id`                       | `DELETE /api/v1/cms/channels/:id`                       |
| EPG program  | Existing `POST /api/v1/cms/channels/:channelId/epg` | `GET /api/v1/cms/channels/:channelId/epg/:programId` | `GET /api/v1/cms/channels/:channelId/epg` | `PATCH /api/v1/cms/channels/:channelId/epg/:programId` | `DELETE /api/v1/cms/channels/:channelId/epg/:programId` |

`PATCH` is preferred because CMS clients normally edit only selected fields. IDs, `createdAt`, and `updatedAt` are server-controlled and cannot be changed.

## Safety and Behavior Decisions

- All request bodies use allowlisted fields; unknown fields return `400`.
- Empty PATCH bodies return `400`.
- Missing resources return `404`; uniqueness or state conflicts return `409`.
- Content type changes are rejected initially. Changing Series/Season/Episode type can invalidate the hierarchy and should use a future dedicated workflow.
- Content parent changes are permitted only after validating the resulting hierarchy and preventing cycles.
- A content item with children cannot be deleted in the first release. The API returns `409 CONTENT_HAS_CHILDREN`.
- Geo-block countries are replaced atomically when supplied in a content update.
- Live-channel deletion requires `?confirm=true` because the database cascades deletion to its EPG programs and schedule lock. The response should report the consequence before deletion through normal CMS UI/API confirmation flow.
- EPG create and update use the existing per-channel concurrency lock and PostgreSQL overlap constraint.
- EPG updates lock both the original and destination channel in stable ID order if moving a program between channels is ever supported. For the first release, channel movement is rejected; clients create a replacement instead.
- Deletes are hard deletes for this prototype. Before production use, audit history and soft-delete/archival requirements must be decided.
- Mutating endpoints require CMS authentication and role authorization before public deployment.

## Delivery Backlog

| Order | ID      | Story                                               | Estimate | Depends on |
| ----: | ------- | --------------------------------------------------- | -------: | ---------- |
|     1 | CRUD-01 | Define API and lifecycle contract                   |     2 SP | -          |
|     2 | CRUD-02 | Add shared mutation validation and errors           |     3 SP | CRUD-01    |
|     3 | CRUD-03 | Implement Content CRUD                              |     8 SP | CRUD-02    |
|     4 | CRUD-04 | Implement Live Channel CRUD                         |     5 SP | CRUD-02    |
|     5 | CRUD-05 | Complete EPG CRUD safely                            |     8 SP | CRUD-02    |
|     6 | CRUD-06 | Add authentication, authorization, and audit events |     8 SP | CRUD-03–05 |
|     7 | CRUD-07 | Documentation, Postman, observability, and release  |     5 SP | CRUD-03–06 |

Estimated total: **39 story points**, approximately 2–3 weeks for one developer including review and stabilization.

## CRUD-01 — API and Lifecycle Contract

Delivery status: **CRUD-01 through CRUD-07 are complete.**

Define request/response schemas, pagination, filters, status codes, error codes, deletion semantics, and authorization roles before implementation.

### Acceptance Criteria

- Every public resource and mutable field is documented.
- List endpoints use bounded cursor or page-based pagination and stable ordering.
- Content deletion, channel cascade deletion, and EPG update semantics are explicit.
- `PATCH` distinguishes omitted fields from explicit `null` values used to restore metadata inheritance.
- API responses never expose internal schedule-lock records.
- OpenAPI or equivalent machine-readable schemas are selected as the contract source.

## CRUD-02 — Shared Mutation Foundation

Add reusable request parsing, allowlist validation, pagination parsing, domain-error mapping, authorization hooks, and transaction helpers.

### Acceptance Criteria

- Invalid JSON, unknown fields, invalid field types, and empty patches return stable `400` errors.
- Prisma not-found, unique constraint, foreign key, and write-conflict errors have stable HTTP mappings.
- Mutation handlers use controller → service → repository boundaries already present in the project.
- Database transactions contain all related writes.
- Request logs include resource type, operation, result, actor ID, and correlation ID without logging sensitive payloads.

## CRUD-03 — Content CRUD

Create a CMS content module while reusing current hierarchy and metadata validation.

### Acceptance Criteria

- Operators can create, get, list, patch, and delete supported content types.
- Create/update validates content type, quality, parent type, country codes, and override rules.
- Reparenting cannot create a cycle or invalid Series → Season → Episode structure.
- Metadata fields accept `null` to restore inheritance.
- Updating geo-block configuration replaces related rows atomically.
- Deleting content with children returns `409` and changes nothing.
- Deleting leaf content cascades only its geo-block rows.
- List supports filters for type, parent ID, title, and bounded pagination.
- Existing middleware content and playback reads reflect successful changes immediately.

### Required Tests

- Route, service, repository, and PostgreSQL integration tests for every operation.
- Invalid hierarchy, cycle, invalid country, invalid quality, duplicate ID, not-found, and delete-with-children cases.
- Atomic rollback test for content plus geo-block updates.
- Metadata inheritance tests before and after setting and clearing overrides.
- Concurrent update test using an optimistic concurrency mechanism such as `updatedAt`/ETag preconditions.

## CRUD-04 — Live Channel CRUD

Expose channel management while preserving unique slugs and schedule-lock lifecycle.

### Acceptance Criteria

- Channel creation atomically creates its schedule-lock row.
- Names and slugs are trimmed and normalized consistently.
- Duplicate slugs return `409 LIVE_CHANNEL_SLUG_CONFLICT`.
- Updates cannot modify IDs or internal lock state.
- Deletion requires explicit confirmation and atomically cascades EPG programs and the lock row.
- Delete response is `204`; deleting an unknown channel returns `404`.
- List supports name/slug filtering and bounded pagination.

### Required Tests

- CRUD happy paths plus validation, duplicate slug, not-found, and cascade behavior.
- Transaction rollback if channel or lock creation fails.
- A concurrency test for competing slug changes.

## CRUD-05 — Complete EPG CRUD

Extend the existing create-only endpoint with read, list, update, and delete operations.

### Acceptance Criteria

- List supports an explicit UTC time window and bounded pagination.
- Updates validate `startTime < endTime` and exclude the edited program from its own overlap query.
- EPG create/update remains protected by the channel lock and database exclusion constraint.
- Back-to-back programs remain valid; overlapping programs return `400 EPG_OVERLAP`.
- Program/channel route mismatches return `404` without leaking cross-channel records.
- Delete is transactional and does not remove the channel lock.
- Channel movement is rejected in the first release.

### Required Tests

- CRUD happy paths, invalid times, overlap, boundary, not-found, and route ownership tests.
- Concurrent create-versus-update and update-versus-update overlap tests using independent Prisma clients.
- Database-level tests proving an overlap cannot be introduced by bypassing service validation.

## CRUD-06 — Authentication, Authorization, and Audit

Do not expose database mutations as anonymous public endpoints.

### Acceptance Criteria

- CMS routes require authenticated identities.
- Roles distinguish read-only operators from editors and administrators.
- Destructive channel deletion is administrator-only.
- Every successful and rejected mutation emits an audit event with actor, action, resource, timestamp, request ID, and outcome.
- Secrets and tokens are never written to logs.
- Rate limits and request-size limits protect mutation endpoints.

## CRUD-07 — Documentation and Release

### Acceptance Criteria

- API documentation includes all requests, responses, error codes, pagination, and destructive-operation warnings.
- Postman collection covers CRUD happy paths and representative failures.
- README includes authentication and local testing instructions.
- Metrics distinguish create, update, and delete rates and failures by resource.
- Migration, seed verification, typecheck, full tests, and deployment smoke tests pass in CI.
- A rollback plan can disable CMS mutation routes without affecting middleware reads.

## Implementation Sequence

1. Freeze contracts and lifecycle decisions.
2. Build shared validation/error/auth foundations.
3. Deliver Content CRUD behind a feature flag.
4. Deliver Live Channel CRUD behind the same flag.
5. Complete EPG CRUD and concurrency tests.
6. Enable authorization and audit logging.
7. Update docs/Postman, run load and regression tests, then enable in staging.
8. Promote to production only after cascade-delete and concurrency scenarios are verified against a production-like PostgreSQL instance.

## Definition of Done

- All three business resources support the approved CRUD operations.
- All mutation paths enforce domain validation and database constraints.
- No generic raw-table CRUD endpoint exists.
- Authorization and audit evidence exists for every mutation.
- Unit, route, PostgreSQL integration, constraint, and concurrency tests pass.
- API documentation and Postman examples match the implemented behavior.
- Existing middleware content/playback endpoints and EPG creation behavior remain backward-compatible.

## Decisions Applied

- CMS credentials use high-entropy bearer keys with `reader`, `editor`, and
  `admin` roles for this prototype. A managed identity provider remains the
  recommended production replacement.
- The prototype uses hard deletes. Content with children is protected; live
  channel cascade deletion requires an admin role and `confirm=true`.
- Audit events are structured, payload-free logs suitable for aggregation into
  operation/error metrics. Production retention should use a durable external
  collector or transactional outbox.
- Optimistic concurrency uses optional strong `ETag`/`If-Match` values derived
  from `updatedAt`.
- Public Content, Live Channel, and EPG IDs are server-generated.
- Lists use page-based pagination with defaults `page=1`, `pageSize=20`, and a
  maximum page size of `100`.
- `CMS_MUTATIONS_ENABLED=false` is the rollback control for stopping writes
  without disabling CMS reads or middleware APIs.
