# Middleware Playback API

The middleware playback endpoint validates the request context needed for playback authorization.

```http
GET /api/v1/mw/playback/{contentId}
```

At this stage, the endpoint focuses on request header handling. Later assignment steps will extend the same endpoint with content lookup, geofencing, device entitlement rules, and the final playback response.

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

Current Step 21 response:

```json
{
  "contentId": "episode-galactic-odyssey-s1e2",
  "requestContext": {
    "userId": "user-123",
    "userCountry": "TR",
    "deviceType": "Web"
  }
}
```

This temporary response intentionally echoes the normalized request context so header handling can be tested clearly. It will be replaced by the final playback payload in later playback steps.

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
  -> controller returns the current validation response
```

## Current Scope

Implemented now:

- Required playback headers
- Missing-header errors
- Supported device-type validation
- `contentId` normalization at the service boundary

Planned in later steps:

- Content lookup
- Geofencing rule
- Device restriction rule
- Final playback success payload
