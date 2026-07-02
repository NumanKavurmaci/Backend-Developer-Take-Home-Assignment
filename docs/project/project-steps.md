# SaatCMS Assignment - User Story Project Plan

Source: SaatCMS Backend Developer Take-Home Assignment.

---

## 1. Initial Assessment

### Description

Review the assignment requirements and identify the main business and technical problems that must be solved.

The project is focused on building a prototype of the SaatCMS Middleware Core Engines. The main areas are metadata inheritance, EPG overlap validation, playback entitlement, device rules, concurrency safety, testing, and documentation.

### Acceptance Criteria

- The assignment scope is clearly understood.
- Required endpoints are identified.
- Core business rules are listed.
- Main risks are identified, especially inheritance logic and EPG concurrency.
- The project is understood as more than a basic CRUD API.

---

## 3. Tech Stack Decision and Project Setup

### Description

Decide the technical stack that will be used for the assignment and initialize the backend project accordingly.

This step defines the foundation of the project before business logic implementation begins. The selected technologies should support the assignment requirements clearly, especially metadata inheritance, EPG overlap validation, concurrency safety, testing, and easy local review.

The tech stack decision should include:

- Programming language
- Backend framework
- Database or storage solution
- ORM or data access approach
- Testing framework
- API testing/documentation approach
- Local development and run strategy
- Seed data strategy

After the stack is selected, initialize the project structure and prepare the baseline configuration.

### Acceptance Criteria

- Final backend language is selected.
- Final backend framework is selected.
- Database or storage solution is selected.
- ORM or data access strategy is selected.
- Testing framework is selected.
- API demonstration approach is selected, such as cURL examples or Postman collection.
- Local run strategy is selected.
- Seed data strategy is selected.
- Project can be started locally.
- Basic folder or module structure exists.
- Environment configuration is prepared.
- A basic health check or startup verification exists.
- Initial README instructions are added.

### Selected Tech Stack

| Area                 | Selected Technology         | Reason                                                              |
| -------------------- | --------------------------- | ------------------------------------------------------------------- |
| Programming language | TypeScript                  | Strong typing, familiar ecosystem, faster development               |
| Backend framework    | Hono                        | Lightweight, simple routing, good for clean API implementation      |
| Database             | SQLite                      | Lightweight, easy local setup, no external database required        |
| ORM / data access    | Prisma                      | Clear schema modeling, migrations, seed support, type-safe queries  |
| Testing framework    | Vitest                      | Fast, TypeScript-friendly, simple setup                             |
| API testing          | cURL examples + docs folder | Easy for reviewer to run without importing tools                    |
| API documentation    | README.md + `/docs` folder  | Clear endpoint examples, request/response bodies, failure cases     |
| Local development    | npm scripts                 | Simple commands for install, migrate, seed, dev, test               |
| Seed data            | Prisma seed script          | Repeatable sample data for content hierarchy, EPG, geo/device cases |

---

## 4. Local Data Storage Setup

### Description

Prepare a lightweight local storage solution so the reviewer can run and test the project easily.

The assignment allows embedded or lightweight storage such as H2, SQLite, or PostgreSQL via Docker.

### Acceptance Criteria

- Application can connect to the selected local database.
- Database schema can be created locally.
- Database setup is repeatable.
- Reviewer does not need manual database preparation.
- Setup instructions are documented.

---

## 5. Seed Data Preparation

### Description

Create sample data that demonstrates all required assignment scenarios.

The seed data should allow the reviewer to test metadata inheritance, EPG scheduling, geo-blocking, and device-blocking without manually inserting records.

### Acceptance Criteria

- Seed data includes at least one Series.
- Seed data includes at least one Season under that Series.
- Seed data includes at least one Episode under that Season.
- Seed data includes at least one Live Channel.
- Seed data includes at least one existing EPG program.
- Seed data includes content that demonstrates metadata inheritance.
- Seed data includes content that demonstrates geo-blocking.
- Seed data includes content that demonstrates device restriction.

---

## 6. Content Hierarchy Model

### Description

Create the domain model needed to represent the OTT content hierarchy.

The hierarchy must support at least:

```text
Series -> Season -> Episode
```

### Acceptance Criteria

- Content can represent Series, Season, and Episode.
- A Season can belong to a Series.
- An Episode can belong to a Season.
- Parent-child relationships can be queried.
- Invalid hierarchy cases are prevented or handled safely.
- The model supports future extension if Movies or other content types are added later.

---

## 7. Inheritable Metadata Fields

### Description

Add metadata fields that can be defined at Series level and optionally overridden by Season or Episode.

Required examples from the assignment include:

- `parentalRating`
- `genre`
- `geoBlockCountries`

Additional fields may be added if needed for playback rules, such as:

- `quality`
- `premium`
- `playbackUrl`

### Acceptance Criteria

- Series can define default metadata values.
- Season can override selected metadata fields.
- Episode can override selected metadata fields.
- A lower-level content item can leave a field empty to inherit it from its parent.
- Each metadata field can be resolved independently.
- Metadata fields required by playback rules are available.

---

## 8. Metadata Inheritance Engine

### Description

Implement the logic that resolves final metadata by traversing the content hierarchy.

When an Episode is requested, missing fields should be inherited from Season first, then Series.

Resolution order:

```text
Episode value -> Season value -> Series value
```

### Acceptance Criteria

- Episode-level value has highest priority.
- Season-level value is used when Episode value is missing.
- Series-level value is used when both Episode and Season values are missing.
- Each field is resolved independently.
- The inheritance logic is centralized in a dedicated service or module.
- Missing content returns a proper not-found response.
- Invalid hierarchy does not produce incorrect metadata.

---

## 9. Content Metadata API

### Description

Create the middleware endpoint that returns resolved content metadata.

### Endpoint

```http
GET /api/v1/mw/content/{contentId}
```

### Acceptance Criteria

- Endpoint accepts a `contentId`.
- Endpoint returns resolved metadata for the requested content.
- Episode requests include inherited values from Season and Series where needed.
- Response includes the final resolved values, not only raw database values.
- Missing content returns `404 Not Found`.
- Response format is documented in README.

---

## 10. Metadata Inheritance Test Cases

### Description

Add automated tests that prove the inheritance engine works correctly.

These tests are important because metadata inheritance is one of the core evaluation areas of the assignment.

### Acceptance Criteria

Tests cover:

- Episode inherits all fields from Series.
- Episode inherits overridden fields from Season.
- Episode overrides Season and Series values.
- Mixed inheritance works across multiple fields.
- Missing content returns `404 Not Found`.
- Invalid or incomplete hierarchy is handled safely.
- Tests can be run by the reviewer.

---

## 11. Live Channel Model

### Description

Create the domain model for live TV channels.

EPG programs must belong to a specific channel, and overlap validation must be scoped per channel.

### Acceptance Criteria

- A Live Channel model exists.
- A channel can have multiple EPG programs.
- EPG programs are associated with exactly one channel.
- Schedules on one channel do not affect schedules on another channel.
- Seed data includes at least one channel.

---

## 12. EPG Program Model

### Description

Create the domain model for scheduled live programs.

Each EPG program must contain:

- `programName`
- `startTime`
- `endTime`
- `channelId`

### Acceptance Criteria

- EPG program stores program name.
- EPG program stores start time.
- EPG program stores end time.
- EPG program belongs to a channel.
- Time values are handled as UTC.
- Invalid time ranges can be rejected.

---

## 13. Create EPG Program API

### Description

Create the CMS endpoint that allows operators to schedule live programs on a channel.

### Endpoint

```http
POST /api/v1/cms/channels/{channelId}/epg
```

### Example Request

```json
{
  "programName": "Evening News",
  "startTime": "2026-07-02T18:00:00Z",
  "endTime": "2026-07-02T19:00:00Z"
}
```

### Acceptance Criteria

- Endpoint accepts `channelId`.
- Endpoint accepts `programName`, `startTime`, and `endTime`.
- Program can be created for an existing channel.
- Missing required fields return a client error.
- Non-existing channel returns `404 Not Found`.
- Successful response returns the created EPG program.
- Endpoint behavior is documented in README.

---

## 14. EPG Date-Time Validation

### Description

Validate the date-time values before creating an EPG program.

The assignment specifically mentions UTC handling, so the system must treat submitted schedule values consistently.

### Acceptance Criteria

- `startTime` is required.
- `endTime` is required.
- `startTime` must be before `endTime`.
- Invalid date-time format returns a client error.
- UTC values are handled consistently.
- Validation failure does not create an EPG record.

---

## 15. EPG Overlap Validation

### Description

Implement the strict validator that prevents overlapping programs on the same channel.

Overlap rule:

```text
newStart < existingEnd AND newEnd > existingStart
```

### Acceptance Criteria

- New program is rejected if it overlaps with an existing program on the same channel.
- Rejected overlap returns `400 Bad Request`.
- Error response clearly indicates an EPG overlap.
- Same time range is allowed on different channels.
- Validation is implemented in custom application logic.
- No external validation library is used for the overlap algorithm.

### Implementation Status

Implemented in `src/live-channel/epg-program/` and enforced before EPG persistence. Concurrency-safe scheduling remains a separate later step.

---

## 16. Back-to-Back EPG Scheduling

### Description

Ensure valid back-to-back programs are allowed.

A program that starts exactly when another ends should not be considered overlapping.

### Acceptance Criteria

This case is allowed:

```text
Program A: 10:00 - 11:00
Program B: 11:00 - 12:00
```

This case is allowed:

```text
Program A: 11:00 - 12:00
Program B: 10:00 - 11:00
```

This case is rejected:

```text
Program A: 10:00 - 11:00
Program B: 10:30 - 12:00
```

### Implementation Status

Implemented through the same strict overlap predicate used by Step 15:

```text
newStart < existingEnd AND newEnd > existingStart
```

Because both comparisons are strict, schedules that only touch at a boundary are accepted in either order. Repository coverage exists for both back-to-back directions, and partial overlaps remain rejected.

---

## 17. EPG Concurrency Safety

### Description

Make EPG creation safe under concurrent requests.

The assignment requires that two concurrent operator requests cannot accidentally create overlapping programs for the same channel.

### Acceptance Criteria

- Overlap check and program creation happen in a concurrency-safe flow.
- Two concurrent overlapping requests for the same channel cannot both succeed.
- At most one conflicting request is saved.
- The rejected request receives a clear error response.
- Final database state contains no overlapping programs.
- The concurrency strategy is documented in README.

---

## 18. Channel-Scoped Concurrency

### Description

Keep EPG concurrency protection scoped to the affected channel.

Scheduling on one channel should not unnecessarily block scheduling on another channel.

### Acceptance Criteria

- Concurrent EPG creation for the same channel is protected.
- Concurrent EPG creation for different channels can proceed independently where possible.
- The selected locking or transaction strategy is documented.
- Tests or documented reasoning explain why the solution is safe.

---

## 19. EPG Test Cases

### Description

Add automated tests for EPG scheduling and overlap behavior.

This validates both normal scheduling and edge cases.

### Acceptance Criteria

Tests cover:

- Program is created successfully when no overlap exists.
- Overlapping program is rejected.
- Program starting exactly when another ends is allowed.
- Program ending exactly when another starts is allowed.
- Invalid date range is rejected.
- Missing fields are rejected.
- Same time range on different channels is allowed.
- Non-existing channel returns `404 Not Found`.

---

## 20. EPG Concurrency Test

### Description

Add a test that simulates concurrent overlapping EPG creation requests.

This proves that race conditions cannot bypass the overlap validator.

### Acceptance Criteria

- Test sends two concurrent overlapping requests for the same channel.
- Only one request succeeds.
- The other request fails.
- Database contains no overlapping programs after both requests finish.
- Test result is repeatable.

---

## 21. Playback Request Headers

### Description

Create the required header handling for the playback endpoint.

The endpoint must accept:

- `X-User-Id`
- `X-User-Country`
- `X-Device-Type`

### Acceptance Criteria

- `X-User-Id` header is required.
- `X-User-Country` header is required.
- `X-Device-Type` header is required.
- Missing headers return a clear client error.
- Invalid device type returns a clear client error.
- Header requirements are documented in README.

---

## 22. Playback API

### Description

Create the middleware endpoint that returns playback details only after entitlement checks pass.

### Endpoint

```http
GET /api/v1/mw/playback/{contentId}
```

### Acceptance Criteria

- Endpoint accepts `contentId`.
- Endpoint reads required user and device headers.
- Endpoint resolves content metadata before authorization.
- Endpoint does not return playback details when entitlement checks fail.
- Missing content returns `404 Not Found`.
- Successful response includes playback details or asset details.

---

## 23. Geofencing Rule

### Description

Implement the geofencing authorization rule.

The playback endpoint must check whether the user’s country is blocked by the resolved metadata.

### Acceptance Criteria

- Playback uses resolved metadata from the inheritance engine.
- User country is checked against `geoBlockCountries`.
- If user country is blocked, response status is `403 Forbidden`.
- Response body contains:

```json
{
  "errorCode": "GEO_BLOCKED"
}
```

- Blocked users do not receive playback URL or asset details.

---

## 24. Device Restriction Rule

### Description

Implement the device authorization rule.

Certain premium assets, such as 4K content, must be blocked on Mobile and allowed only on SmartTV or Web.

### Acceptance Criteria

- Playback checks resolved content metadata.
- Premium 4K content is allowed on `SmartTV`.
- Premium 4K content is allowed on `Web`.
- Premium 4K content is blocked on `Mobile`.
- Blocked response status is `403 Forbidden`.
- Response body contains:

```json
{
  "errorCode": "DEVICE_NOT_SUPPORTED"
}
```

- Blocked users do not receive playback URL or asset details.

---

## 25. Playback Success Response

### Description

Return playback details when all entitlement and device checks pass.

### Acceptance Criteria

- Playback succeeds when user country is allowed.
- Playback succeeds when device type is allowed.
- Response includes `contentId`.
- Response includes `playbackUrl` or relevant asset details.
- Response may include resolved metadata relevant to playback.
- Response format is documented in README.

---

## 26. Playback Authorization Test Cases

### Description

Add automated tests for playback entitlement and device rules.

### Acceptance Criteria

Tests cover:

- Playback succeeds for allowed country and allowed device.
- Geo-blocked country returns `403 Forbidden`.
- Geo-blocked response contains `GEO_BLOCKED`.
- Mobile request for premium 4K content returns `403 Forbidden`.
- Device-blocked response contains `DEVICE_NOT_SUPPORTED`.
- Missing headers return client error.
- Invalid device type returns client error.
- Non-existing content returns `404 Not Found`.

---

## 27. Standard Error Handling

### Description

Create a consistent JSON error response format for expected failures.

This improves API clarity and makes the reviewer’s testing easier.

### Acceptance Criteria

The application handles:

- Content not found
- Channel not found
- Invalid request body
- Invalid date-time format
- Invalid time range
- EPG overlap
- Missing headers
- Invalid device type
- Geo-blocked playback
- Device-blocked playback
- Unexpected server errors

Example error format:

```json
{
  "errorCode": "EPG_OVERLAP",
  "message": "Program overlaps with an existing schedule on this channel."
}
```

---

## 28. API Demonstration Examples

### Description

Prepare cURL commands or a Postman collection so the reviewer can test the project quickly.

The assignment explicitly asks for Postman requests or cURL commands demonstrating success and specific failure cases.

### Acceptance Criteria

README includes examples for:

- Successful metadata resolution.
- Successful EPG creation.
- EPG overlap blocked.
- Successful playback request.
- Geo-blocked playback request.
- Device-blocked playback request.
- Example request headers are included.
- Example request bodies are included.
- Example responses are included.

---

## 29. README Documentation

### Description

Write a clear README explaining how to run, test, and evaluate the project.

Documentation is one of the assignment evaluation criteria.

### Acceptance Criteria

README includes:

- Project overview.
- Requirement summary.
- Selected tech stack.
- Setup instructions.
- Database setup instructions.
- Seed data explanation.
- How to run the project.
- How to run tests.
- API endpoint documentation.
- cURL or Postman examples.
- Metadata inheritance explanation.
- EPG overlap validation explanation.
- EPG concurrency strategy.
- Playback authorization explanation.
- Known limitations or trade-offs.

---

## 30. Final Review

### Description

Review the full project before submission to ensure the assignment requirements are fully covered.

### Acceptance Criteria

- Project runs locally from clean setup.
- Seed data loads correctly.
- All required endpoints work.
- Metadata inheritance works correctly.
- EPG overlap validation works correctly.
- EPG concurrency protection works correctly.
- Playback geofencing works correctly.
- Playback device restriction works correctly.
- Error responses are consistent.
- Tests pass.
- README is complete.
- cURL or Postman examples are included.
- No unnecessary local files are committed.

---

## 31. GitHub Submission

### Description

Prepare the repository for final delivery.

The assignment requires sharing a public or private GitHub repository link.

### Acceptance Criteria

- Source code is committed to GitHub.
- Repository contains the full project.
- README is available at the repository root.
- Tests are included.
- Seed data or seed scripts are included.
- Reviewer can run the project using README instructions.
- Repository link is ready before the deadline.
