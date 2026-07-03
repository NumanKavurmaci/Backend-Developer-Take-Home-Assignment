# Middleware Playback API

The middleware playback endpoint validates the request context, resolves content metadata, and returns playback details for existing content.

```http
GET /api/v1/mw/playback/{contentId}
```

At this stage, the endpoint performs content lookup and returns the resolved playback URL. Later assignment steps extend the same endpoint with geofencing and device entitlement blocking.

## Request

Path parameters:

| Parameter   | Required | Description                                                  |
| ----------- | -------- | ------------------------------------------------------------ |
| `contentId` | yes      | Content ID requested for playback, such as an Episode ID.    |

Required headers:

| Header           | Required | Example    | Description                                      |
| ---------------- | -------- | ---------- | ------------------------------------------------ |
| `X-User-Id`      | yes      | `user-123` | User identifier supplied by the calling system.  |
| `X-User-Country` | yes      | `TR`       | User country code used by later geofencing rules. |
| `X-Device-Type`  | yes      | `Web`      | Playback device type used by later device rules. |

Supported device types:

```text
Mobile
SmartTV
Web
```

Header values are trimmed before validation. Empty header values are treated as missing.

## Success Response

Example request:

```bash
curl -i http://localhost:3000/api/v1/mw/playback/episode-galactic-odyssey-s1e2 \
  -H "X-User-Id: user-123" \
  -H "X-User-Country: TR" \
  -H "X-Device-Type: Web"
```

Status:

```http
200 OK
```

Example response:

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

Geofencing and device restriction failures are added in later playback steps.

## Error Responses

All expected header validation failures use the shared JSON error shape:

```json
{
  "errorCode": "REQUEST_FAILED",
  "message": "Readable error message"
}
```

### Missing User ID

Example request:

```bash
curl -i http://localhost:3000/api/v1/mw/playback/episode-galactic-odyssey-s1e2 \
  -H "X-User-Country: TR" \
  -H "X-Device-Type: Web"
```

Status:

```http
400 Bad Request
```

Example response:

```json
{
  "errorCode": "REQUEST_FAILED",
  "message": "X-User-Id header is required"
}
```

### Missing User Country

Example response:

```json
{
  "errorCode": "REQUEST_FAILED",
  "message": "X-User-Country header is required"
}
```

### Missing Device Type

Example response:

```json
{
  "errorCode": "REQUEST_FAILED",
  "message": "X-Device-Type header is required"
}
```

### Invalid Device Type

Example request:

```bash
curl -i http://localhost:3000/api/v1/mw/playback/episode-galactic-odyssey-s1e2 \
  -H "X-User-Id: user-123" \
  -H "X-User-Country: TR" \
  -H "X-Device-Type: Console"
```

Status:

```http
400 Bad Request
```

Example response:

```json
{
  "errorCode": "REQUEST_FAILED",
  "message": "X-Device-Type must be one of: Mobile, SmartTV, Web"
}
```

### Missing Content

Example response:

```json
{
  "errorCode": "REQUEST_FAILED",
  "message": "Content not found"
}
```

## Implementation Map

| Layer      | File                                                   |
| ---------- | ------------------------------------------------------ |
| Module     | `src/modules/mw-playback/mw-playback.module.ts`        |
| Route      | `src/modules/mw-playback/mw-playback.route.ts`         |
| Controller | `src/modules/mw-playback/mw-playback.controller.ts`    |
| Service    | `src/modules/mw-playback/mw-playback.service.ts`       |
| Headers    | `src/modules/mw-playback/playback-request-headers.ts`  |

Request flow:

```text
HTTP request
  -> route matches GET /:contentId
  -> controller reads contentId and playback headers
  -> header helper validates required headers and device type
  -> service normalizes contentId
  -> metadata inheritance engine resolves content metadata
  -> controller returns playback URL and resolved metadata
```

## Current Scope

Implemented now:

- Required playback headers
- Missing-header errors
- Supported device-type validation
- `contentId` normalization at the service boundary
- Content lookup through the metadata inheritance engine
- Missing content returns `404 Not Found`
- Successful response includes playback URL and resolved metadata

Planned in later steps:

- Geofencing rule
- Device restriction rule
