# Middleware Playback API

The middleware playback endpoint validates the request context, resolves content metadata, checks geofencing and device restrictions, and returns playback details for allowed content.

```http
GET /api/v1/mw/playback/{contentId}
```

At this stage, the endpoint performs content lookup, blocks geo-restricted requests, blocks unsupported devices for premium 4K content, and returns the resolved playback URL.

## Request

Path parameters:

| Parameter   | Required | Description                                                  |
| ----------- | -------- | ------------------------------------------------------------ |
| `contentId` | yes      | Content ID requested for playback, such as an Episode ID.    |

Required headers:

| Header           | Required | Example    | Description                                      |
| ---------------- | -------- | ---------- | ------------------------------------------------ |
| `X-User-Id`      | yes      | `user-123` | User identifier supplied by the calling system.  |
| `X-User-Country` | yes      | `TR`       | User country code checked against resolved geo-block metadata. |
| `X-Device-Type`  | yes      | `Web`      | Playback device type checked against resolved playback metadata. |

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

### Geo-blocked Playback

Example response:

```json
{
  "errorCode": "GEO_BLOCKED"
}
```

Status:

```http
403 Forbidden
```

Geo-blocked responses do not include `playbackUrl` or asset details.

### Unsupported Device

Premium 4K content is allowed on `SmartTV` and `Web`, but blocked on `Mobile`.

Example response:

```json
{
  "errorCode": "DEVICE_NOT_SUPPORTED"
}
```

Status:

```http
403 Forbidden
```

Device-blocked responses do not include `playbackUrl` or asset details.

## Authorization Error Mapping

| Rule failure                | Service error                         | HTTP status | Response body                                  |
| --------------------------- | ------------------------------------- | ----------- | ---------------------------------------------- |
| User country is geo-blocked | `GeoBlockedPlaybackError`             | `403`       | `{ "errorCode": "GEO_BLOCKED" }`               |
| Premium 4K on Mobile        | `Premium4KPlaybackNotSupportedOnDeviceError` | `403` | `{ "errorCode": "DEVICE_NOT_SUPPORTED" }` |

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
  -> service rejects geo-blocked countries
  -> service rejects unsupported devices
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
- Geofencing checks `X-User-Country` against resolved `geoBlockCountries`
- Geo-blocked requests return `403 Forbidden` with `GEO_BLOCKED`
- Premium 4K content is blocked on `Mobile`
- Device-blocked requests return `403 Forbidden` with `DEVICE_NOT_SUPPORTED`
- Successful response includes playback URL and resolved metadata
