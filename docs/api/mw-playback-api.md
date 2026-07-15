# Middleware Playback API

The middleware playback endpoint validates the request context, resolves content metadata, checks geofencing and device restrictions, and returns playback details for allowed content.

```http
GET /api/v1/mw/playback/{contentId}
```

At this stage, the endpoint performs content lookup, blocks geo-restricted requests, blocks unsupported devices for premium 4K content, and returns the resolved playback URL.

See [Content Endpoint Roles](content-endpoint-roles.md) for why playback remains
separate from public metadata lookup and authenticated CMS content reads.

## Request

Path parameters:

| Parameter   | Required | Description                                                  |
| ----------- | -------- | ------------------------------------------------------------ |
| `contentId` | yes      | Content ID requested for playback, such as an Episode ID.    |

Required headers:

| Header           | Required | Example    | Description                                      |
| ---------------- | -------- | ---------- | ------------------------------------------------ |
| `X-User-Id`      | yes      | `user-123` | User identifier supplied by the calling system.  |
| `X-User-Country` | yes      | `TR`       | Two-letter country code checked against resolved geo-block metadata. |
| `X-Device-Type`  | yes      | `Web`      | Strict playback device type checked against resolved playback metadata. |

Supported device types:

```text
Mobile
SmartTV
Web
```

Header values are trimmed before validation. Empty header values are treated as missing.

Country behavior:

- `X-User-Country` is normalized to uppercase.
- Valid values must contain exactly two letters, such as `TR`, `US`, or `DE`.
- `tr` is accepted and normalized to `TR`.
- `T`, `TUR`, `T1`, `T-`, and `12` are rejected.

Device behavior is strict and case-sensitive. Only `Mobile`, `SmartTV`, and `Web` are accepted. Values such as `mobile`, `smarttv`, `web`, and `Console` are rejected.

## Success Response

Playback succeeds when the resolved metadata allows the supplied user country and device type.

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
  "errorCode": "ERROR_CODE",
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
  "errorCode": "MISSING_HEADER",
  "message": "X-User-Id header is required"
}
```

### Missing User Country

Example response:

```json
{
  "errorCode": "MISSING_HEADER",
  "message": "X-User-Country header is required"
}
```

### Missing Device Type

Example response:

```json
{
  "errorCode": "MISSING_HEADER",
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
  "errorCode": "INVALID_DEVICE_TYPE",
  "message": "X-Device-Type must be one of: Mobile, SmartTV, Web"
}
```

### Invalid User Country

Example request:

```bash
curl -i http://localhost:3000/api/v1/mw/playback/episode-galactic-odyssey-s1e2 \
  -H "X-User-Id: user-123" \
  -H "X-User-Country: TUR" \
  -H "X-Device-Type: Web"
```

Status:

```http
400 Bad Request
```

Example response:

```json
{
  "errorCode": "INVALID_COUNTRY_CODE",
  "message": "X-User-Country must be a two-letter country code"
}
```

### Missing Content

Example response:

```json
{
  "errorCode": "CONTENT_NOT_FOUND",
  "message": "Content not found"
}
```

### Geo-blocked Playback

Example response:

```json
{
  "errorCode": "GEO_BLOCKED",
  "message": "Playback is not available in the user's country."
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
  "errorCode": "DEVICE_NOT_SUPPORTED",
  "message": "Playback is not available on this device type."
}
```

Status:

```http
403 Forbidden
```

Device-blocked responses do not include `playbackUrl` or asset details.

## Authorization Error Mapping

| Rule failure                | Domain error code      | HTTP status |
| --------------------------- | ---------------------- | ----------- |
| User country is geo-blocked | `GEO_BLOCKED`          | `403`       |
| Premium 4K on Mobile        | `DEVICE_NOT_SUPPORTED` | `403`       |

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
- Country-code normalization and validation
- Strict supported device-type validation
- `contentId` normalization at the service boundary
- Content lookup through the metadata inheritance engine
- Missing content returns `404 Not Found`
- Geofencing checks `X-User-Country` against resolved `geoBlockCountries`
- Geo-blocked requests return `403 Forbidden` with `GEO_BLOCKED`
- Premium 4K content is blocked on `Mobile`
- Device-blocked requests return `403 Forbidden` with `DEVICE_NOT_SUPPORTED`
- Successful response includes `contentId`, `playback.playbackUrl`, request context, and resolved metadata
