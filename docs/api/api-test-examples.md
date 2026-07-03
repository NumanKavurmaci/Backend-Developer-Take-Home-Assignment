# API Test Examples

This document is a reviewer-friendly request guide for manually testing the project with cURL or Postman.

Run the project first:

```bash
cp .env.example .env
npm run db:reset
npm run db:seed
npm run dev
```

On Windows PowerShell, use `Copy-Item .env.example .env` instead of `cp .env.example .env`.

Base URL:

```text
http://localhost:3000
```

Seeded IDs used below:

| Purpose | ID |
| --- | --- |
| Episode with inherited metadata and geo-block list | `episode-galactic-odyssey-s1e2` |
| Premium 4K episode with empty geo-block override | `episode-galactic-odyssey-s1e3` |
| News channel | `channel-saat-news` |

## cURL Examples

### 1. Successful Metadata Resolution

Request headers:

```http
Accept: application/json
```

Request body: none.

```bash
curl -i http://localhost:3000/api/v1/mw/content/episode-galactic-odyssey-s1e2 \
  -H "Accept: application/json"
```

Example response:

```http
HTTP/1.1 200 OK
```

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

### 2. Successful EPG Creation

Request headers:

```http
Content-Type: application/json
Accept: application/json
```

Request body:

```json
{
  "programName": "Evening News",
  "startTime": "2026-07-02T18:00:00Z",
  "endTime": "2026-07-02T19:00:00Z"
}
```

```bash
curl -i -X POST http://localhost:3000/api/v1/cms/channels/channel-saat-news/epg \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{"programName":"Evening News","startTime":"2026-07-02T18:00:00Z","endTime":"2026-07-02T19:00:00Z"}'
```

Example response:

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

`id`, `createdAt`, and `updatedAt` are generated at runtime.

### 3. EPG Overlap Blocked

The seed data already includes `Morning Briefing` on `channel-saat-news` from `2026-07-02T08:00:00.000Z` to `2026-07-02T09:00:00.000Z`, so this failure case can be run independently.

Request headers:

```http
Content-Type: application/json
Accept: application/json
```

Request body:

```json
{
  "programName": "Overlapping News",
  "startTime": "2026-07-02T08:30:00Z",
  "endTime": "2026-07-02T09:30:00Z"
}
```

```bash
curl -i -X POST http://localhost:3000/api/v1/cms/channels/channel-saat-news/epg \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{"programName":"Overlapping News","startTime":"2026-07-02T08:30:00Z","endTime":"2026-07-02T09:30:00Z"}'
```

Example response:

```http
HTTP/1.1 400 Bad Request
```

```json
{
  "errorCode": "EPG_OVERLAP",
  "message": "EPG program overlaps with an existing schedule on this channel."
}
```

### 4. Successful Playback Request

Request headers:

```http
Accept: application/json
X-User-Id: user-123
X-User-Country: TR
X-Device-Type: Web
```

Request body: none.

```bash
curl -i http://localhost:3000/api/v1/mw/playback/episode-galactic-odyssey-s1e2 \
  -H "Accept: application/json" \
  -H "X-User-Id: user-123" \
  -H "X-User-Country: TR" \
  -H "X-Device-Type: Web"
```

Example response:

```http
HTTP/1.1 200 OK
```

```json
{
  "contentId": "episode-galactic-odyssey-s1e2",
  "requestContext": {
    "userId": "user-123",
    "userCountry": "TR",
    "deviceType": "Web"
  },
  "playback": {
    "playbackUrl": "https://cdn.saatcms.test/galactic-odyssey/s1/e2.m3u8"
  },
  "metadata": {
    "type": "EPISODE",
    "title": "Dark Side Relay",
    "parentalRating": "16+",
    "genre": "Space Adventure",
    "quality": "HD",
    "isPremium": false,
    "geoBlockCountries": ["IR", "SY"]
  }
}
```

### 5. Geo-blocked Playback Request

Request headers:

```http
Accept: application/json
X-User-Id: user-123
X-User-Country: IR
X-Device-Type: Web
```

Request body: none.

```bash
curl -i http://localhost:3000/api/v1/mw/playback/episode-galactic-odyssey-s1e2 \
  -H "Accept: application/json" \
  -H "X-User-Id: user-123" \
  -H "X-User-Country: IR" \
  -H "X-Device-Type: Web"
```

Example response:

```http
HTTP/1.1 403 Forbidden
```

```json
{
  "errorCode": "GEO_BLOCKED",
  "message": "Playback is not available in the user's country."
}
```

### 6. Device-blocked Playback Request

Request headers:

```http
Accept: application/json
X-User-Id: user-123
X-User-Country: TR
X-Device-Type: Mobile
```

Request body: none.

```bash
curl -i http://localhost:3000/api/v1/mw/playback/episode-galactic-odyssey-s1e3 \
  -H "Accept: application/json" \
  -H "X-User-Id: user-123" \
  -H "X-User-Country: TR" \
  -H "X-Device-Type: Mobile"
```

Example response:

```http
HTTP/1.1 403 Forbidden
```

```json
{
  "errorCode": "DEVICE_NOT_SUPPORTED",
  "message": "Playback is not available on this device type."
}
```

## Postman Requests

Create a Postman collection with this environment variable:

| Variable | Value |
| --- | --- |
| `baseUrl` | `http://localhost:3000` |

Then add these requests.

### Successful Metadata Resolution

| Field | Value |
| --- | --- |
| Method | `GET` |
| URL | `{{baseUrl}}/api/v1/mw/content/episode-galactic-odyssey-s1e2` |
| Headers | `Accept: application/json` |
| Body | None |
| Expected status | `200 OK` |

### Successful EPG Creation

| Field | Value |
| --- | --- |
| Method | `POST` |
| URL | `{{baseUrl}}/api/v1/cms/channels/channel-saat-news/epg` |
| Headers | `Content-Type: application/json`, `Accept: application/json` |
| Body mode | Raw JSON |
| Expected status | `201 Created` |

Body:

```json
{
  "programName": "Evening News",
  "startTime": "2026-07-02T18:00:00Z",
  "endTime": "2026-07-02T19:00:00Z"
}
```

### EPG Overlap Blocked

| Field | Value |
| --- | --- |
| Method | `POST` |
| URL | `{{baseUrl}}/api/v1/cms/channels/channel-saat-news/epg` |
| Headers | `Content-Type: application/json`, `Accept: application/json` |
| Body mode | Raw JSON |
| Expected status | `400 Bad Request` |

Body:

```json
{
  "programName": "Overlapping News",
  "startTime": "2026-07-02T08:30:00Z",
  "endTime": "2026-07-02T09:30:00Z"
}
```

### Successful Playback Request

| Field | Value |
| --- | --- |
| Method | `GET` |
| URL | `{{baseUrl}}/api/v1/mw/playback/episode-galactic-odyssey-s1e2` |
| Headers | `Accept: application/json`, `X-User-Id: user-123`, `X-User-Country: TR`, `X-Device-Type: Web` |
| Body | None |
| Expected status | `200 OK` |

### Geo-blocked Playback Request

| Field | Value |
| --- | --- |
| Method | `GET` |
| URL | `{{baseUrl}}/api/v1/mw/playback/episode-galactic-odyssey-s1e2` |
| Headers | `Accept: application/json`, `X-User-Id: user-123`, `X-User-Country: IR`, `X-Device-Type: Web` |
| Body | None |
| Expected status | `403 Forbidden` |

### Device-blocked Playback Request

| Field | Value |
| --- | --- |
| Method | `GET` |
| URL | `{{baseUrl}}/api/v1/mw/playback/episode-galactic-odyssey-s1e3` |
| Headers | `Accept: application/json`, `X-User-Id: user-123`, `X-User-Country: TR`, `X-Device-Type: Mobile` |
| Body | None |
| Expected status | `403 Forbidden` |

## Importable Postman Collection

An importable collection is available at [saatcms-api-tests.postman_collection.json](saatcms-api-tests.postman_collection.json).
