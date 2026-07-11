# Live Channel Domain Index

This document maps the current `src/live-channel/` domain files and the role each file plays in the SaatCMS live TV implementation.

Live channels represent linear TV channels. Each channel can own many EPG programs, and EPG validation must always be scoped to one `channelId` so schedules on another channel do not affect the current channel.

## Folder Overview

```text
src/live-channel/
  live-channel.ts
  live-channel-types.ts
  live-channel-repository.ts
  live-channel.test.ts
  epg-program/
    epg-program.ts
    epg-program-types.ts
    epg-program-repository.ts
    epg-program.test.ts
```

## Main Model

```text
LiveChannel
  -> EpgProgram[]
  -> EpgScheduleLock?
```

| Model             | Purpose                                                                             |
| ----------------- | ----------------------------------------------------------------------------------- |
| `LiveChannel`     | Stores the channel identity, display name, and unique slug.                         |
| `EpgProgram`      | Stores scheduled programs for exactly one channel.                                  |
| `EpgScheduleLock` | Stores the per-channel lock row used by the concurrency-safe EPG write flow. |

## File Responsibilities

| File                         | Responsibility                                                                                                               |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `live-channel.ts`            | Normalizes and validates live channel input before database writes.                                                          |
| `live-channel-types.ts`      | Defines live-channel input and read model TypeScript types.                                                                  |
| `live-channel-repository.ts` | Handles Prisma reads and writes for channels, programs, and schedule-lock lookup.                                            |
| `live-channel.test.ts`       | Covers live-channel normalization, validation, repository reads, schedule-lock creation, and channel-scoped program loading. |
| `epg-program/`               | Defines scheduled-program input validation, creation types, repository writes, invalid date checks, invalid time-range rejection, overlap checks, and per-channel concurrency-safe creation. |

## EPG Program Subdomain

EPG programs are stored under `src/live-channel/epg-program/` because they are scheduled inside a specific live channel. The channel boundary matters for overlap validation and concurrency protection.

### `epg-program-types.ts`

| Export                  | Purpose |
| ----------------------- | ------- |
| `EpgProgramRecord`      | Database/read shape returned after an EPG program has been saved. This aliases Prisma's generated `EpgProgram` type. |
| `CreateEpgProgramInput` | Create/write shape accepted before Prisma adds database-managed fields like `createdAt` and `updatedAt`. |

### `epg-program.ts`

| Export                             | Purpose |
| ---------------------------------- | ------- |
| `DomainError`                      | Domain validation error for invalid EPG input. API services map EPG codes to `400 Bad Request`. |
| `normalizeEpgProgramName`          | Trims operator-provided program names. |
| `normalizeEpgProgramChannelId`     | Trims channel IDs before validation and writes. |
| `assertValidEpgProgramTimeRange`   | Rejects invalid `Date` values and ranges where `startTime >= endTime`. |
| `assertValidEpgProgramInput`       | Validates required channel ID, required program name, and valid time range. |
| `prepareEpgProgramCreateInput`     | Runs validation and returns normalized create data for repository writes. |

### `epg-program-repository.ts`

| Export              | Purpose |
| ------------------- | ------- |
| `createEpgProgram`  | Validates and normalizes create input, checks same-channel overlap, then inserts an `EpgProgram` row through Prisma. |
| `createEpgProgramWithConcurrencyLock` | Runs EPG creation inside a transaction after touching the channel's `EpgScheduleLock` row, serializing same-channel writes so the second writer sees the first writer's program. |
| `assertNoOverlappingEpgProgram` | Checks for a same-channel row matching `newStart < existingEnd AND newEnd > existingStart` before writes. |

The repository intentionally calls `prepareEpgProgramCreateInput(...)` even when the CMS service has already validated input. This protects the persistence boundary if another future use case calls the repository directly.

## CMS EPG Program Module

The HTTP endpoint for creating EPG programs lives under `src/modules/cms-epg-program/`.

```http
POST /api/v1/cms/channels/{channelId}/epg
```

| File                                | Responsibility |
| ----------------------------------- | -------------- |
| `cms-epg-program.module.ts`         | Registers the CMS EPG routes on the Hono app. |
| `cms-epg-program.route.ts`          | Maps `POST /:channelId/epg` to the controller. |
| `cms-epg-program.controller.ts`     | Reads route params and JSON body, calls the service, and returns `201 Created`. |
| `cms-epg-program.service.ts`        | Builds validated create input, checks channel existence, maps expected domain errors to HTTP errors, and calls the repository. |
| `cms-epg-program.route.test.ts`     | Covers route-level success and error responses. |
| `cms-epg-program.service.test.ts`   | Covers service-level required-field validation. |

Request flow:

```text
HTTP request
  -> route
  -> controller
  -> service
  -> EPG domain validation
  -> channel-scoped overlap validation
  -> EPG repository
  -> Prisma EpgProgram insert
```

Current implementation status:

| Behavior | Status |
| -------- | ------ |
| Create program for an existing channel | implemented |
| Missing required fields return `400` | implemented |
| Missing channel returns `404` | implemented |
| Invalid date strings return `400` | implemented |
| Invalid time ranges return `400` | implemented |
| Overlap validation | implemented |
| Concurrency-safe creation | implemented with a transactional per-channel schedule-lock row |

## `live-channel.ts`

### `normalizeLiveChannelName(name)`

Trims the display name while preserving human-readable casing.

Example:

```ts
normalizeLiveChannelName("  Saat News  "); // "Saat News"
```

### `normalizeLiveChannelSlug(slug)`

Trims and lowercases the channel slug.

Example:

```ts
normalizeLiveChannelSlug("  Saat-News  "); // "saat-news"
```

### `assertValidLiveChannelInput(input)`

Validates that:

- `name` is present after trimming.
- `slug` is present after trimming.
- `slug` contains lowercase letters, numbers, and single hyphen separators.

Valid examples:

- `saat-news`
- `saat-sports-2`

Invalid examples:

- `saat_news`
- `-saat-news`
- `saat-news-`

### `prepareLiveChannelCreateInput(input)`

Runs validation and returns normalized data for repository writes.

## `live-channel-repository.ts`

### `createLiveChannel(prisma, input)`

Creates a channel and its related schedule-lock row in one Prisma write.

The lock row is used by the EPG creation endpoint:

```text
transaction
  -> touch channel lock row
  -> check overlaps for that channel
  -> insert program
  -> commit
```

## Concurrency Strategy

`createEpgProgramWithConcurrencyLock(...)` protects the overlap check and insert inside one database transaction. Before checking overlaps, it updates or creates the `EpgScheduleLock` row for the target channel. Same-channel writers contend on the same lock row, so they are serialized. Once the first transaction commits, the next transaction performs the overlap query against the updated schedule and rejects conflicting ranges.

The lock is channel-scoped. Requests for different channels use different lock rows, so they can proceed independently from the application's perspective.

SQLite note: SQLite is acceptable for this take-home assignment and local tests, but its write locking is database-level under concurrent writes. The per-channel lock proves the application-level invariant, but SQLite may still serialize broader write traffic internally. A shared production deployment should use PostgreSQL or another durable database.

PostgreSQL note: the same application flow can use row locking on the channel lock row. A production hardening pass can also add PostgreSQL exclusion constraints over `(channel_id, tstzrange(start_time, end_time, '[)'))` to enforce non-overlap at the database layer.

### `getLiveChannelById(prisma, channelId)`

Finds one channel by API identifier.

### `getLiveChannelBySlug(prisma, slug)`

Normalizes the provided slug and finds one channel by unique slug.

### `listLiveChannels(prisma)`

Lists channels ordered by display name.

### `getLiveChannelWithPrograms(prisma, channelId)`

Loads one channel with only that channel's EPG programs, ordered by `startTime`.

This supports channel-scoped EPG validation and prevents schedules from other channels from affecting the current channel.

### `getLiveChannelWithScheduleLock(prisma, channelId)`

Loads one channel with its lock row. The EPG write flow can use this to confirm the channel has a lock row before attempting concurrency-safe scheduling.

## Test Coverage

Current tests cover:

- Channel name and slug normalization.
- Required name and slug validation.
- URL-safe slug validation.
- Normalized create input.
- Channel creation with schedule-lock row.
- Lookup by ID and normalized slug.
- Stable channel listing order.
- EPG program loading scoped to a single channel.
- EPG program name and channel ID normalization.
- Invalid EPG date values.
- Invalid EPG time ranges where `startTime >= endTime`.
- EPG overlap rejection on the same channel.
- Back-to-back EPG programs.
- Same EPG time range on different channels.
- Concurrent overlapping same-channel writes with one shared Prisma client.
- Concurrent overlapping same-channel writes with independent Prisma clients.
- Burst concurrency where 12 overlapping requests insert exactly one program.
- Concurrent same-time writes on different channels with independent clients.
- Concurrent back-to-back same-channel writes with independent clients.
- Final database state checks proving rejected concurrent writes leave no overlapping programs.
