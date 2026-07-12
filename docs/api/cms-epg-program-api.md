# CMS EPG Program API

The authenticated CMS EPG API lets operators create, read, list, update, and
delete scheduled live programs for a channel.

| Method | Route |
| --- | --- |
| `POST` | `/api/v1/cms/channels/{channelId}/epg` |
| `GET` | `/api/v1/cms/channels/{channelId}/epg?windowStart=...&windowEnd=...` |
| `GET` | `/api/v1/cms/channels/{channelId}/epg/{programId}` |
| `PATCH` | `/api/v1/cms/channels/{channelId}/epg/{programId}` |
| `DELETE` | `/api/v1/cms/channels/{channelId}/epg/{programId}` |

Every request requires a CMS bearer credential. Readers can get/list;
editors and admins can create, patch, and delete:

```http
Authorization: Bearer <CMS API key>
```

Create and update validate request shape, channel ownership, date parsing,
time range, channel-scoped overlap, and concurrency-safe scheduling before a
write commits. See the complete shared contract in
[CMS CRUD API](cms-crud-api.md).

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

## Read, List, Update, and Delete

List requires `windowStart` and `windowEnd` ISO 8601 query values with a
timezone. It returns every program intersecting that half-open window and uses
`page`/`pageSize` pagination with defaults `1`/`20` and maximum `100`.

```bash
curl -i "http://localhost:3000/api/v1/cms/channels/channel-saat-news/epg?windowStart=2026-07-02T00%3A00%3A00Z&windowEnd=2026-07-03T00%3A00%3A00Z" \
  -H "Authorization: Bearer $CMS_READER_KEY"
```

Get and PATCH routes are channel scoped: a program requested through a
different channel returns `404 EPG_PROGRAM_NOT_FOUND`. PATCH accepts any
non-empty subset of `programName`, `startTime`, and `endTime`; `channelId` is
route-owned and cannot be changed.

Single-resource responses include a strong `ETag`. Supplying it as `If-Match`
on PATCH prevents a stale edit from overwriting a newer version:

```bash
curl -i -X PATCH http://localhost:3000/api/v1/cms/channels/channel-saat-news/epg/PROGRAM_ID \
  -H "Authorization: Bearer $CMS_EDITOR_KEY" \
  -H 'If-Match: "2026-07-12T12:00:00.000Z"' \
  -H "Content-Type: application/json" \
  -d '{"programName":"Updated News"}'
```

A stale value returns `409 EPG_WRITE_CONFLICT`. DELETE returns `204` and
removes only the requested program; it preserves the channel and schedule lock.

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

EPG create, update, and delete use a transaction and the `EpgScheduleLock` row
for the requested channel.

```text
start transaction
  -> touch EpgScheduleLock for the requested channel
  -> check overlaps for that channel
  -> create, update, or delete the EpgProgram
commit transaction
```

Concurrent writes for the same channel touch the same schedule-lock row. That makes the critical flow run one after another, so the second request sees the first request's inserted program before it can save a conflicting schedule.

Different channels use different schedule-lock rows. This keeps the application strategy channel-scoped instead of using one global EPG lock, allowing unrelated channel schedules to proceed independently.

## Success Response

Example request:

```bash
curl -i -X POST http://localhost:3000/api/v1/cms/channels/channel-saat-news/epg \
  -H "Authorization: Bearer $CMS_EDITOR_KEY" \
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
  "errorCode": "ERROR_CODE",
  "message": "Readable error message"
}
```

### Missing Required Field

Example request:

```bash
curl -i -X POST http://localhost:3000/api/v1/cms/channels/channel-saat-news/epg \
  -H "Authorization: Bearer $CMS_EDITOR_KEY" \
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
  "errorCode": "INVALID_REQUEST_BODY",
  "message": "programName is required"
}
```

### Invalid Date-Time String

Example response:

```json
{
  "errorCode": "INVALID_DATE_TIME_FORMAT",
  "message": "startTime must be an ISO 8601 date-time string with timezone"
}
```

### Invalid Time Range

The API rejects ranges where `startTime >= endTime`.

Example response:

```json
{
  "errorCode": "INVALID_TIME_RANGE",
  "message": "EPG program startTime must be before endTime."
}
```

### EPG Overlap

Example response:

```json
{
  "errorCode": "EPG_OVERLAP",
  "message": "EPG program overlaps with an existing schedule on this channel."
}
```

### Missing Channel

Example request:

```bash
curl -i -X POST http://localhost:3000/api/v1/cms/channels/missing-channel/epg \
  -H "Authorization: Bearer $CMS_EDITOR_KEY" \
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
  "errorCode": "CHANNEL_NOT_FOUND",
  "message": "Channel not found"
}
```

### Invalid JSON

Example response:

```json
{
  "errorCode": "INVALID_REQUEST_BODY",
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
  -> bearer authentication and role authorization
  -> CRUD route and controller
  -> strict request/query validation
  -> channel-scoped repository read or transaction
  -> write operations touch the channel schedule-lock row
  -> create/update operations check same-channel overlap
  -> Prisma read/write
  -> controller returns the documented status and optional ETag
```

Date-time validation happens before the channel lookup and before repository writes, so invalid request values fail without creating an EPG record.

Overlap validation happens after channel existence is confirmed and inside the schedule-lock transaction.
