# CMS EPG Program API

The CMS EPG endpoint lets operators create scheduled live programs for a channel.

```http
POST /api/v1/cms/channels/{channelId}/epg
```

This endpoint validates request shape, channel existence, date parsing, time range, channel-scoped overlap, and concurrency-safe scheduling before saving an EPG program.

## Request

Path parameters:

| Parameter   | Required | Description                                             |
| ----------- | -------- | ------------------------------------------------------- |
| `channelId` | yes      | Existing live channel ID. Example: `channel-saat-news`. |

JSON body:

| Field         | Required | Type   | Description                                                                  |
| ------------- | -------- | ------ | ---------------------------------------------------------------------------- |
| `programName` | yes      | string | Human-readable program title.                                                |
| `startTime`   | yes      | string | ISO 8601 date-time string with timezone. UTC strings with `Z` are preferred. |
| `endTime`     | yes      | string | ISO 8601 date-time string with timezone. Must be after `startTime`.          |

Example:

```json
{
  "programName": "Evening News",
  "startTime": "2026-07-02T18:00:00Z",
  "endTime": "2026-07-02T19:00:00Z"
}
```

Offset date-time values are accepted and normalized to UTC before validation and persistence:

```json
{
  "programName": "Evening News",
  "startTime": "2026-07-02T21:00:00+03:00",
  "endTime": "2026-07-02T22:00:00+03:00"
}
```

Date-time values without timezone information are rejected because their meaning depends on the server timezone:

```json
{
  "programName": "Evening News",
  "startTime": "2026-07-02T18:00:00",
  "endTime": "2026-07-02T19:00:00"
}
```

## Scheduling Rules

Overlap validation uses this predicate:

```text
newStart < existingEnd AND newEnd > existingStart
```

A new program is rejected only when that predicate is true for an existing program on the same channel.

Back-to-back programs are allowed because the comparisons are strict:

```text
10:00-11:00
11:00-12:00
```

The same time range is allowed on different channels because overlap validation is scoped by `channelId`.

## Concurrency Strategy

EPG creation uses a transaction and the `EpgScheduleLock` row for the requested channel.

```text
start transaction
  -> touch EpgScheduleLock for the requested channel
  -> check overlaps for that channel
  -> insert EpgProgram if no overlap exists
commit transaction
```

Concurrent writes for the same channel touch the same schedule-lock row. That makes the critical flow run one after another, so the second request sees the first request's inserted program before it can save a conflicting schedule.

Different channels use different schedule-lock rows. This keeps the application strategy channel-scoped instead of using one global EPG lock. SQLite may still serialize writes broadly internally, but the model expresses the intended per-channel strategy clearly.

## Success Response

Example request:

```bash
curl -i -X POST http://localhost:3000/api/v1/cms/channels/channel-saat-news/epg \
  -H "Content-Type: application/json" \
  -d '{"programName":"Evening News","startTime":"2026-07-02T18:00:00Z","endTime":"2026-07-02T19:00:00Z"}'
```

Status:

```http
201 Created
```

Example response:

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

## Error Responses

All expected errors use the shared JSON error shape:

```json
{
  "errorCode": "REQUEST_FAILED",
  "message": "Readable error message"
}
```

### Missing Required Field

Example request:

```bash
curl -i -X POST http://localhost:3000/api/v1/cms/channels/channel-saat-news/epg \
  -H "Content-Type: application/json" \
  -d '{"startTime":"2026-07-02T18:00:00Z","endTime":"2026-07-02T19:00:00Z"}'
```

Status:

```http
400 Bad Request
```

Example response:

```json
{
  "errorCode": "REQUEST_FAILED",
  "message": "programName is required"
}
```

### Invalid Date-Time String

Example response:

```json
{
  "errorCode": "REQUEST_FAILED",
  "message": "startTime must be an ISO 8601 date-time string with timezone"
}
```

### Invalid Time Range

The API rejects ranges where `startTime >= endTime`.

Example response:

```json
{
  "errorCode": "REQUEST_FAILED",
  "message": "EPG program startTime must be before endTime."
}
```

### EPG Overlap

Example response:

```json
{
  "errorCode": "REQUEST_FAILED",
  "message": "EPG program overlaps with an existing schedule on this channel."
}
```

### Missing Channel

Example request:

```bash
curl -i -X POST http://localhost:3000/api/v1/cms/channels/missing-channel/epg \
  -H "Content-Type: application/json" \
  -d '{"programName":"Evening News","startTime":"2026-07-02T18:00:00Z","endTime":"2026-07-02T19:00:00Z"}'
```

Status:

```http
404 Not Found
```

Example response:

```json
{
  "errorCode": "REQUEST_FAILED",
  "message": "Channel not found"
}
```

### Invalid JSON

Example response:

```json
{
  "errorCode": "REQUEST_FAILED",
  "message": "Request body must be valid JSON"
}
```

## Implementation Map

| Layer      | File                                                        |
| ---------- | ----------------------------------------------------------- |
| Module     | `src/modules/cms-epg-program/cms-epg-program.module.ts`     |
| Route      | `src/modules/cms-epg-program/cms-epg-program.route.ts`      |
| Controller | `src/modules/cms-epg-program/cms-epg-program.controller.ts` |
| Service    | `src/modules/cms-epg-program/cms-epg-program.service.ts`    |
| Domain     | `src/live-channel/epg-program/epg-program.ts`               |
| Repository | `src/live-channel/epg-program/epg-program-repository.ts`    |
| Lock model | `EpgScheduleLock` in `prisma/schema.prisma`                 |

Request flow:

```text
HTTP request
  -> route matches POST /:channelId/epg
  -> controller reads route param and JSON body
  -> service validates request and checks channel existence
  -> domain validates and normalizes create input
  -> repository starts transaction
  -> repository touches channel schedule-lock row
  -> repository checks same-channel overlap
  -> repository writes EpgProgram through Prisma
  -> controller returns 201 with the created record
```

Date-time validation happens before the channel lookup and before repository writes, so invalid request values fail without creating an EPG record.

Overlap validation happens after channel existence is confirmed and inside the schedule-lock transaction.
