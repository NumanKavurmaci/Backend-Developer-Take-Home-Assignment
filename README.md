# SaatCMS Middleware Core

Prototype backend for the SaatCMS OTT middleware assignment.

The project focuses on the core domain problems from the case study: content metadata inheritance, live-channel EPG scheduling validation, local persistence, repeatable seed data, and focused automated tests.

## What Is Implemented

| Area                        | Status                                                                         |
| --------------------------- | ------------------------------------------------------------------------------ |
| Project setup               | TypeScript, Hono, Prisma, SQLite, Vitest                                       |
| Local database              | Repeatable setup, migration, and seed scripts                                  |
| Health check                | `GET /health`                                                                  |
| Metadata inheritance        | `Series -> Season -> Episode` resolution                                       |
| Content metadata API        | `GET /api/v1/mw/content/{contentId}`                                           |
| Live channel and EPG models | Channel-scoped EPG program storage                                             |
| CMS EPG creation API        | `POST /api/v1/cms/channels/{channelId}/epg`                                    |
| EPG date-time validation    | Required fields, strict ISO date-time parsing, UTC normalization, range checks |
| EPG overlap validation      | Custom channel-scoped overlap checks before persistence                        |
| EPG concurrency safety      | Transactional per-channel schedule-lock flow                                   |
| Tests                       | Domain, service, and route coverage for the implemented scope                  |

Playback entitlement rules are tracked as later assignment steps in `docs/project/project-steps.md`.

## Tech Stack

| Concern        | Choice                                            |
| -------------- | ------------------------------------------------- |
| Language       | TypeScript                                        |
| HTTP framework | Hono                                              |
| Database       | SQLite                                            |
| ORM            | Prisma                                            |
| Testing        | Vitest                                            |
| API docs       | README examples plus detailed files under `docs/` |

This stack keeps the project lightweight for reviewers: no Docker or external service is required for the implemented APIs.

## Quick Start

Install dependencies:

```bash
npm install
```

Create and seed the local database:

```bash
npm run db:reset
npm run db:seed
```

Start the development server:

```bash
npm run dev
```

By default, the API runs on:

```text
http://localhost:3000
```

## Useful Commands

| Command             | Purpose                             |
| ------------------- | ----------------------------------- |
| `npm run dev`       | Start the Hono server in watch mode |
| `npm run db:reset`  | Recreate the local SQLite database  |
| `npm run db:seed`   | Insert repeatable sample data       |
| `npm run typecheck` | Run TypeScript checks               |
| `npm test`          | Run the automated test suite        |

## Health Check

```http
GET /health
```

Example:

```bash
curl http://localhost:3000/health
```

Response:

```json
{
  "status": "ok",
  "service": "saatcms-middleware-core"
}
```

## Content Metadata API

```http
GET /api/v1/mw/content/{contentId}
```

Returns the final resolved metadata for a content item. For inherited fields, the closest non-null value wins.

For an Episode, metadata is resolved in this order:

```text
Episode -> Season -> Series
```

Resolved fields:

- `parentalRating`
- `genre`
- `quality`
- `isPremium`
- `playbackUrl`
- `geoBlockCountries`

Geo-block countries use an explicit override flag:

- If `geoBlockCountriesOverride` is `false`, the resolver keeps looking at the parent.
- If `geoBlockCountriesOverride` is `true`, the resolver uses that content item's own country list, even when the list is empty.

That empty-list override matters because an Episode may intentionally clear a Series-level geo-block list.

### Resolved Episode Example

```bash
curl http://localhost:3000/api/v1/mw/content/episode-galactic-odyssey-s1e2
```

Response:

```json
{
  "contentId": "episode-galactic-odyssey-s1e2",
  "type": "EPISODE",
  "title": "Dark Side Relay",
  "parentalRating": "16+",
  "genre": "Space Adventure",
  "quality": "HD",
  "isPremium": false,
  "playbackUrl": "https://cdn.saatcms.test/galactic-odyssey/s1/e2.m3u8",
  "geoBlockCountries": ["IR", "SY"]
}
```

In this seeded example:

- `parentalRating` is overridden by the Episode.
- `genre` is inherited from the Season.
- `quality`, `isPremium`, and `geoBlockCountries` are inherited from the nearest parent that defines them.
- `playbackUrl` is overridden by the Episode.

### Empty Geo-block Override Example

```bash
curl http://localhost:3000/api/v1/mw/content/episode-galactic-odyssey-s1e3
```

This Episode overrides geo-block countries with an empty list, so it does not inherit the Series block list.

Expected important field:

```json
{
  "geoBlockCountries": []
}
```

### Missing Content Example

```bash
curl -i http://localhost:3000/api/v1/mw/content/numan
```

Response:

```http
HTTP/1.1 404 Not Found
```

```json
{
  "errorCode": "REQUEST_FAILED",
  "message": "Content not found"
}
```

## CMS EPG Program API

```http
POST /api/v1/cms/channels/{channelId}/epg
```

Creates a scheduled live program for an existing channel.

The API validates the schedule before writing anything to the database:

- `programName`, `startTime`, and `endTime` are required.
- `startTime` must be before `endTime`.
- `startTime` and `endTime` must include timezone information.
- Valid date-time values are normalized to UTC before range validation and persistence.
- New programs must not overlap existing programs on the same channel.
- Validation failures return a client error and do not create an EPG record.

### Concurrency Strategy

EPG creation uses a transaction plus the `EpgScheduleLock` row that belongs to the target channel.

The write flow is:

````text
start transaction
  -> update EpgScheduleLock for the requested channel
  -> check overlaps for that channel
  -> insert EpgProgram if no overlap exists
commit transaction

### Date-time Handling

The assignment calls out UTC handling, so the endpoint accepts only unambiguous ISO 8601 date-time values.

| Input                       | Result   | Reason                                                   |
| --------------------------- | -------- | -------------------------------------------------------- |
| `2026-07-02T18:00:00Z`      | Accepted | Explicit UTC time                                        |
| `2026-07-02T21:00:00+03:00` | Accepted | Explicit offset, normalized to UTC internally            |
| `2026-07-02T18:00:00`       | Rejected | No timezone, so server timezone could change the meaning |
| `2026-02-30T18:00:00Z`      | Rejected | Invalid calendar date                                    |

UTC `Z` values are preferred in examples. Explicit offsets are also accepted and compared as UTC instants.

These two ranges represent the same schedule:

```json
{
  "startTime": "2026-07-02T18:00:00Z",
  "endTime": "2026-07-02T19:00:00Z"
}
````

```json
{
  "startTime": "2026-07-02T21:00:00+03:00",
  "endTime": "2026-07-02T22:00:00+03:00"
}
```

### Overlap Validation

The endpoint rejects overlapping programs on the same channel using custom application logic:

```text
newStart < existingEnd AND newEnd > existingStart
```

Back-to-back programs are allowed, so a program ending at `11:00` and another starting at `11:00` do not overlap. The same time range is also allowed on different channels.

### Successful EPG Creation

```bash
curl -i -X POST http://localhost:3000/api/v1/cms/channels/channel-saat-news/epg \
  -H "Content-Type: application/json" \
  -d '{"programName":"Evening News","startTime":"2026-07-02T18:00:00Z","endTime":"2026-07-02T19:00:00Z"}'
```

Response:

```http
HTTP/1.1 201 Created
```

```json
{
  "id": "clx...",
  "channelId": "channel-saat-news",
  "programName": "Evening News",
  "startTime": "2026-07-02T18:00:00.000Z",
  "endTime": "2026-07-02T19:00:00.000Z",
  "createdAt": "2026-07-02T17:00:00.000Z",
  "updatedAt": "2026-07-02T17:00:00.000Z"
}
```

### Missing Required Field

Missing required fields return `400 Bad Request` before persistence.

```bash
curl -i -X POST http://localhost:3000/api/v1/cms/channels/channel-saat-news/epg \
  -H "Content-Type: application/json" \
  -d '{"startTime":"2026-07-02T18:00:00Z","endTime":"2026-07-02T19:00:00Z"}'
```

Response:

```json
{
  "errorCode": "REQUEST_FAILED",
  "message": "programName is required"
}
```

### Invalid Date-time Value

Invalid date-time values return `400 Bad Request` before persistence.

```bash
curl -i -X POST http://localhost:3000/api/v1/cms/channels/channel-saat-news/epg \
  -H "Content-Type: application/json" \
  -d '{"programName":"Evening News","startTime":"2026-07-02T18:00:00","endTime":"2026-07-02T19:00:00Z"}'
```

Response:

```json
{
  "errorCode": "REQUEST_FAILED",
  "message": "startTime must be an ISO 8601 date-time string with timezone"
}
```

### Missing Channel

Missing channels return `404 Not Found`.

```bash
curl -i -X POST http://localhost:3000/api/v1/cms/channels/missing-channel/epg \
  -H "Content-Type: application/json" \
  -d '{"programName":"Evening News","startTime":"2026-07-02T18:00:00Z","endTime":"2026-07-02T19:00:00Z"}'
```

Response:

```json
{
  "errorCode": "REQUEST_FAILED",
  "message": "Channel not found"
}
```

### EPG Overlap

Overlapping schedules on the same channel return `400 Bad Request`.

```bash
curl -i -X POST http://localhost:3000/api/v1/cms/channels/channel-saat-news/epg \
  -H "Content-Type: application/json" \
  -d '{"programName":"Overlapping News","startTime":"2026-07-02T18:30:00Z","endTime":"2026-07-02T19:30:00Z"}'
```

Response:

```json
{
  "errorCode": "REQUEST_FAILED",
  "message": "EPG program overlaps with an existing schedule on this channel."
}
```

## Error Shape

Expected failures use a consistent JSON shape:

```json
{
  "errorCode": "REQUEST_FAILED",
  "message": "Readable error message"
}
```

Unhandled server errors are returned as `INTERNAL_SERVER_ERROR` with a generic message.

## Project Structure

```text
src/
  content/                      Content hierarchy and metadata inheritance domain logic
  live-channel/                 Live channel and EPG program domain logic
  modules/
    cms-epg-program/            CMS EPG HTTP module
    mw-content/                 Middleware content metadata HTTP module
  shared/http/                  Shared HTTP error handling
  db/                           Prisma client and database checks
docs/                           API, domain, database, and project planning notes
prisma/                         Prisma schema, migrations, and seed data
```

## Additional Documentation

Detailed notes live under `docs/`:

- `docs/api/content-metadata-api.md`
- `docs/api/cms-epg-program-api.md`
- `docs/database-structure.md`
- `docs/domain/content-domain-index.md`
- `docs/domain/live-channel-domain-index.md`
- `docs/project/assignment.md`
- `docs/project/project-steps.md`

## Verification

Run the full validation set before reviewing changes:

```bash
npm run typecheck
npm test
```
