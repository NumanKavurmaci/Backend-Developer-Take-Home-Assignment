# CMS EPG Program API

The CMS EPG endpoint lets operators create scheduled live programs for a channel.

```http
POST /api/v1/cms/channels/{channelId}/epg
```

This endpoint creates programs and validates basic request shape, channel existence, date parsing, time range, and channel-scoped EPG overlap. Concurrency protection is planned in a later assignment step.

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

The API rejects a new program when it overlaps an existing program on the same channel:

```text
newStart < existingEnd AND newEnd > existingStart
```

Back-to-back programs are allowed because the overlap rule uses strict inequalities.

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

Request flow:

```text
HTTP request
  -> route matches POST /:channelId/epg
  -> controller reads route param and JSON body
  -> service validates request and checks channel existence
  -> domain validates and normalizes create input
  -> repository checks same-channel overlap
  -> repository writes EpgProgram through Prisma
  -> controller returns 201 with the created record
```

Date-time validation happens before the channel lookup and before repository writes, so invalid request values fail without creating an EPG record.
Overlap validation happens after channel existence is confirmed and before the repository insert.

## Current Limitations

- Duplicate exact schedules currently rely on the database unique constraint and are handled in later EPG validation work.
- Concurrency-safe scheduling is not part of this step.
