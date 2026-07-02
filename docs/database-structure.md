# Database Structure

The project uses SQLite with Prisma.

The local database file is created here:

```text
data/dev.db
```

The database URL is defined in `.env`:

```env
DATABASE_URL="file:../data/dev.db"
```

Prisma resolves this path from the `prisma/` folder.

## What The Database Needs To Support

The assignment has three main data problems:

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

Ancestor path queries are loaded with one recursive SQLite query instead of one query per hierarchy level. This avoids N+1-style parent lookups while still detecting corrupted cyclic hierarchy data.

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

SQLite stores `type` and `quality` as strings. The application code validates the allowed values before saving data.

The assignment calls this field `premium`; the code stores it as `isPremium` so the boolean meaning is clear.

Playback rules can use:

| Field               | Why Playback Needs It                        |
| ------------------- | -------------------------------------------- |
| `geoBlockCountries` | blocks playback for selected countries       |
| `quality`           | identifies premium 4K assets                 |
| `isPremium`         | marks assets that need stricter device rules |
| `playbackUrl`       | returned only after entitlement checks pass  |

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

### `EpgProgram`

Stores scheduled programs for a live channel.

Important fields:

| Field         | Purpose                       |
| ------------- | ----------------------------- |
| `channelId`   | channel that owns the program |
| `programName` | program title                 |
| `startTime`   | UTC start time                |
| `endTime`     | UTC end time                  |

Invalid ranges must be rejected:

```text
startTime >= endTime
```

Overlap is checked with this rule:

```text
newStart < existingEnd AND newEnd > existingStart
```

This means back-to-back programs are allowed:

```text
10:00-11:00
11:00-12:00
```

Indexes on `channelId`, `startTime`, and `endTime` make the overlap check fast for one channel.

### `EpgScheduleLock`

Stores one lock row per live channel.

This table is used later when creating EPG programs safely under concurrent requests.

The intended flow:

1. Start a transaction.
2. Update the channel's lock row.
3. Check for overlapping programs.
4. Insert the new program if no overlap exists.
5. Commit the transaction.

This makes overlapping requests for the same channel wait on the same lock row before they can write schedule data.

## Local Commands

Install dependencies:

```bash
npm install
```

Create the local database:

```bash
npm run db:setup
```

Load sample data:

```bash
npm run db:seed
```

Check the database connection:

```bash
npm run db:check
```

Reset the database:

```bash
npm run db:reset
```

Open Prisma Studio:

```bash
npm run db:studio
```

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
