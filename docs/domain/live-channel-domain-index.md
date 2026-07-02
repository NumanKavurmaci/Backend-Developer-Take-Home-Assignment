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
| `EpgScheduleLock` | Stores the per-channel lock row used by the future concurrency-safe EPG write flow. |

## File Responsibilities

| File                         | Responsibility                                                                                                               |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `live-channel.ts`            | Normalizes and validates live channel input before database writes.                                                          |
| `live-channel-types.ts`      | Defines live-channel input and read model TypeScript types.                                                                  |
| `live-channel-repository.ts` | Handles Prisma reads and writes for channels, programs, and schedule-lock lookup.                                            |
| `live-channel.test.ts`       | Covers live-channel normalization, validation, repository reads, schedule-lock creation, and channel-scoped program loading. |

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

The lock row is important for the future EPG creation endpoint:

```text
transaction
  -> touch channel lock row
  -> check overlaps for that channel
  -> insert program
  -> commit
```

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

The EPG overlap endpoint and concurrency tests are planned separately in the project plan.
