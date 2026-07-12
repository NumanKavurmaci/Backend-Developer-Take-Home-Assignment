# Database Structure

The project uses PostgreSQL through Prisma. The local Docker Compose setup
provides the development database `saatcms` and the disposable test database
`saatcms_test`.

## What The Database Needs To Support

The assignment has four main data problems:

- Content can be nested as `Series -> Season -> Episode`.
- Some metadata can be inherited from a parent item.
- Live TV programs must not overlap on the same channel.
- Playback rules need country, quality, premium, and device-related metadata.

The schema is built around those needs.

## Schema At A Glance

```text
Content
  |-- Content children
  |-- ContentGeoBlockCountry rows

LiveChannel
  |-- EpgProgram rows
  |-- EpgScheduleLock row
```

The database has two main areas:

| Area             | Tables                                         | Purpose                                                                        |
| ---------------- | ---------------------------------------------- | ------------------------------------------------------------------------------ |
| Content metadata | `Content`, `ContentGeoBlockCountry`            | Stores the content tree and inherited playback metadata.                       |
| Live scheduling  | `LiveChannel`, `EpgProgram`, `EpgScheduleLock` | Stores channels, schedules, and the per-channel lock used for safe EPG writes. |

## PostgreSQL Column Types

| Prisma field                                     | PostgreSQL representation | Why                                                |
| ------------------------------------------------ | ------------------------- | -------------------------------------------------- |
| IDs, names, slugs, and URLs                      | `TEXT`                    | Variable-length identifiers and text values        |
| `isPremium`, `geoBlockCountriesOverride`         | `BOOLEAN`                 | Native true/false values                           |
| `version`                                        | `INTEGER`                 | Lock-row update counter                            |
| `createdAt`, `updatedAt`, `startTime`, `endTime` | `TIMESTAMPTZ(3)`          | Millisecond timestamps stored as absolute instants |

Primary keys, composite keys, indexes, foreign keys, and checks are created by
the committed Prisma SQL migrations. Parent content uses `ON DELETE RESTRICT`;
geo-block rows, EPG programs, and schedule-lock rows use `ON DELETE CASCADE`.

## Relationships

| From                               | To               | Relationship                                    |
| ---------------------------------- | ---------------- | ----------------------------------------------- |
| `Content.parentId`                 | `Content.id`     | A content item can have child content.          |
| `ContentGeoBlockCountry.contentId` | `Content.id`     | A content item can have many blocked countries. |
| `EpgProgram.channelId`             | `LiveChannel.id` | A channel can have many scheduled programs.     |
| `EpgScheduleLock.channelId`        | `LiveChannel.id` | A channel has one schedule lock row.            |

## Table Summary

| Table                    | Key Fields                                               | Notes                                                         |
| ------------------------ | -------------------------------------------------------- | ------------------------------------------------------------- |
| `Content`                | `id`, `type`, `title`, `parentId`                        | Main content table for Series, Seasons, Episodes, and Movies. |
| `ContentGeoBlockCountry` | `contentId`, `countryCode`                               | Stores blocked countries as rows instead of JSON.             |
| `LiveChannel`            | `id`, `name`, `slug`                                     | Stores live TV channels.                                      |
| `EpgProgram`             | `id`, `channelId`, `programName`, `startTime`, `endTime` | Stores scheduled programs for a channel.                      |
| `EpgScheduleLock`        | `channelId`, `version`                                   | Used to make EPG creation safe under concurrent requests.     |

## Tables

### `Content`

Stores on-demand content.

Allowed `type` values:

- `SERIES`
- `SEASON`
- `EPISODE`
- `MOVIE`

The required hierarchy is:

```text
Series -> Season -> Episode
```

The `parentId` column links one content item to its parent:

| Type      | Parent   |
| --------- | -------- |
| `SERIES`  | none     |
| `SEASON`  | `SERIES` |
| `EPISODE` | `SEASON` |
| `MOVIE`   | none     |

`MOVIE` is included because the playback requirement mentions premium 4K movies.

The database stores the parent relationship. The application code will validate that the parent type is correct.

Hierarchy validation lives in the content domain layer:

| Content Type | Valid Parent |
| ------------ | ------------ |
| `SERIES`     | none         |
| `SEASON`     | `SERIES`     |
| `EPISODE`    | `SEASON`     |
| `MOVIE`      | none         |

Invalid combinations are rejected before writing to the database. For example, an `EPISODE` cannot be created directly under a `SERIES`.

Ancestor path queries are loaded with one recursive PostgreSQL query instead of one query per hierarchy level. This avoids N+1-style parent lookups while still detecting corrupted cyclic hierarchy data.

### Inherited Metadata

These `Content` fields can be inherited:

- `parentalRating`
- `genre`
- `quality`
- `isPremium`
- `playbackUrl`
- `geoBlockCountries`

The rule is simple:

- `NULL` means "use the parent value".
- A real value means "override the parent value".
- Each field is resolved separately.

For an Episode, the lookup order is:

```text
Episode -> Season -> Series
```

Allowed `quality` values:

- `SD`
- `HD`
- `UHD_4K`

PostgreSQL stores `type` and `quality` as strings. The application code validates the allowed values before saving data, and the database also has `CHECK` constraints so unsupported values are rejected if another script bypasses the domain layer.

The assignment calls this field `premium`; the code stores it as `isPremium` so the boolean meaning is clear.

Playback rules can use:

| Field               | Why Playback Needs It                        |
| ------------------- | -------------------------------------------- |
| `geoBlockCountries` | blocks playback for selected countries       |
| `quality`           | identifies premium 4K assets                 |
| `isPremium`         | marks assets that need stricter device rules |
| `playbackUrl`       | returned only after entitlement checks pass  |

## Metadata Inheritance

Resolved metadata is calculated in one centralized content service.

For scalar fields, the closest non-empty value wins:

```text
Episode -> Season -> Series
```

This rule is applied independently to each field. For example, an Episode can use its own `quality`, inherit `genre` from Season, and inherit `isPremium` from Series.

Geo-block countries use the same closest-owner idea, but through the explicit `geoBlockCountriesOverride` flag:

| Flag    | Meaning                                                           |
| ------- | ----------------------------------------------------------------- |
| `false` | keep looking at the parent                                        |
| `true`  | use this content item's country rows, even when the list is empty |

The inheritance service validates the loaded hierarchy before resolving metadata. Corrupted data, such as an Episode directly under a Series, is rejected instead of producing a misleading result.

### `ContentGeoBlockCountry`

Stores blocked countries for a content item.

Example country codes:

- `TR`
- `US`
- `DE`

The primary key is:

```text
(contentId, countryCode)
```

Geo-block inheritance needs one extra flag on `Content`:

```text
geoBlockCountriesOverride
```

How it works:

| Value   | Meaning                                          |
| ------- | ------------------------------------------------ |
| `false` | inherit blocked countries from the parent        |
| `true`  | use this content item's own blocked country list |

This lets the system tell the difference between:

- "inherit the parent list"
- "override with an empty list"

That difference matters for playback authorization.

### `LiveChannel`

Stores live TV channels.

Important fields:

| Field  | Purpose                                         |
| ------ | ----------------------------------------------- |
| `id`   | internal API identifier                         |
| `name` | display name                                    |
| `slug` | unique readable key for seed data and debugging |

EPG validation is always scoped to one channel.

### EPG integrity and concurrency

`EpgProgram` stores scheduled programs for a live channel. `EpgScheduleLock`
stores one lock row for each channel. Together, application logic and
PostgreSQL protect the schedule.

Important fields:

| Field         | Purpose                       |
| ------------- | ----------------------------- |
| `channelId`   | channel that owns the program |
| `programName` | program title                 |
| `startTime`   | UTC start time                |
| `endTime`     | UTC end time                  |

Seeded EPG schedules use explicit ISO UTC strings ending in `Z`. The seed script validates this convention before converting values to `Date` objects, so sample data cannot accidentally depend on the server's local timezone.

Two simple rules define a valid schedule:

- A program must start before it ends.
- Programs on the same channel must not overlap.

Back-to-back programs such as `10:00–11:00` and `11:00–12:00` are valid. The
same time range is also valid on different channels.

The first concurrency layer is the application transaction. When the API
creates a program, it uses this sequence:

1. Update the target channel's lock row.
2. Check for an overlapping program on that channel.
3. Insert the program.
4. Commit.

Requests for the same channel update the same lock row and therefore run one
after another. Requests for different channels use different lock rows.

The second concurrency layer is PostgreSQL itself. It is the final safety net
if application validation is bypassed or independent application instances
race:

| Constraint                    | Protection                                           | API result               |
| ----------------------------- | ---------------------------------------------------- | ------------------------ |
| `EpgProgram_time_range_check` | Rejects `startTime >= endTime`.                      | `400 INVALID_TIME_RANGE` |
| `EpgProgram_no_overlap_excl`  | Rejects overlapping time ranges on the same channel. | `400 EPG_OVERLAP`        |

The overlap constraint treats the end time as outside the program's range,
which is why a program may begin exactly when the previous one ends. The
`btree_gist` PostgreSQL extension allows the constraint to consider both the
channel ID and time range.

The lock row gives friendly, channel-scoped serialization during normal API
writes. The exclusion constraint independently guarantees that overlapping
rows cannot commit, including writes from another process or direct SQL. Both
layers are required.

Indexes on `channelId`, `startTime`, and `endTime` make the overlap check fast for one channel.

## Local Commands

Install dependencies:

```bash
npm install
```

Start PostgreSQL and apply migrations:

```bash
npm run db:start
npm run db:migrate
```

Load sample data:

```bash
npm run db:seed
```

Check the database connection:

```bash
npm run db:check
```

Fully reset the local PostgreSQL databases and reapply migrations:

```bash
npm run db:destroy
npm run db:start
npm run db:migrate
```

This deletes local development and test data.

Open Prisma Studio:

```bash
npm run db:studio
```

## Migration Ownership

- Developers use `prisma migrate dev` only to create migrations locally.
- CI applies every committed migration to a fresh PostgreSQL database with
  `prisma migrate deploy` before running tests.
- The deployment platform runs `prisma migrate deploy` as a pre-deploy step.
  A migration failure blocks the new release.
- The server process only starts the application. It never migrates, resets,
  seeds, or relies on a database file.
- Demo seed data is loaded only by the separate guarded `npm run db:seed`
  command. Production seeding is refused.

Operational cutover, backup/restore, and rollback steps are documented in the
[deployment runbook](../ci-cd/deployment-runbook.md).

## Seed Data

The seed script creates data for the main assignment scenarios.

| Scenario              | Seed Data                                                                                                          |
| --------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Series hierarchy      | `series-galactic-odyssey` -> `season-galactic-odyssey-s1` -> episode records                                       |
| Metadata inheritance  | `episode-galactic-odyssey-s1e1` inherits from its Season and Series                                                |
| Season override       | `season-galactic-odyssey-s1` overrides the Series genre                                                            |
| Episode override      | `episode-galactic-odyssey-s1e2` overrides parental rating and playback URL                                         |
| Geo-block inheritance | `series-galactic-odyssey` blocks `IR` and `SY`; `season-galactic-odyssey-s1`, `s1e1`, and `s1e2` inherit that list |
| Geo-block override    | `episode-galactic-odyssey-s1e3` overrides with an empty country list, so it does not inherit the Series block list |
| Geo-blocking          | `movie-crystal-frontier` blocks `TR` and `DE`                                                                      |
| Device restriction    | `episode-galactic-odyssey-s1e3` and `movie-crystal-frontier` are premium `UHD_4K` assets                           |
| EPG scheduling        | `channel-saat-news` has existing back-to-back programs                                                             |
| Channel-scoped EPG    | `channel-saat-sports` has a program at the same time as the news channel                                           |
