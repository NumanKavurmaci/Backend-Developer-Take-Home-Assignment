# CMS CRUD API

The CMS API manages Content, Live Channels, and EPG Programs through explicit
domain endpoints. It does not expose generic database-table access or the
internal `EpgScheduleLock` model.

The machine-readable contract is [cms-crud-openapi.yaml](cms-crud-openapi.yaml).

## Authentication and Roles

Every route below requires a bearer credential:

```http
Authorization: Bearer <CMS API key>
```

| Operation | Minimum role |
| --- | --- |
| Read or list | `reader` |
| Create or patch | `editor` |
| Delete Content or EPG Program | `editor` |
| Delete Live Channel and cascade its schedule | `admin` |

Missing credentials return `401 CMS_AUTHENTICATION_REQUIRED`; an invalid key
returns `401 INVALID_CMS_API_KEY`; insufficient permissions return
`403 CMS_FORBIDDEN`. If the server has no configured credentials, CMS access
fails closed with `503 CMS_AUTH_NOT_CONFIGURED`.

## Common Contracts

Create, get, and patch responses include:

```http
ETag: "2026-07-12T12:00:00.000Z"
```

Clients should send that exact value in `If-Match` on a later PATCH. If another
request changed the resource first, the stale request returns `409` with the
resource-specific `*_WRITE_CONFLICT` code. `If-Match` is optional for backward
compatibility.

List endpoints use `page` and `pageSize`. Defaults are `1` and `20`, and the
maximum page size is `100`:

```json
{
  "items": [],
  "page": 1,
  "pageSize": 20,
  "total": 0
}
```

Request bodies are strict allowlists. Unknown fields, malformed JSON, empty
PATCH objects, invalid pagination, and attempts to modify server-owned fields
return `400`.

## Content

### Routes

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/api/v1/cms/content` | Create Content with a server-generated ID |
| `GET` | `/api/v1/cms/content` | List and filter Content |
| `GET` | `/api/v1/cms/content/{id}` | Get one Content item |
| `PATCH` | `/api/v1/cms/content/{id}` | Update mutable fields |
| `DELETE` | `/api/v1/cms/content/{id}` | Delete a leaf Content item |

List filters are `type`, `parentId`, and case-insensitive `title`, plus
pagination.

Create fields:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `type` | `SERIES`, `SEASON`, `EPISODE`, `MOVIE` | yes | Immutable after creation |
| `title` | string | yes | Non-empty |
| `parentId` | string or `null` | by type | Season → Series; Episode → Season; Series/Movie have no parent |
| `parentalRating` | string or `null` | no | `null` means inherit |
| `genre` | string or `null` | no | `null` means inherit |
| `quality` | `SD`, `HD`, `UHD_4K`, or `null` | no | `null` means inherit |
| `isPremium` | boolean or `null` | no | `null` means inherit |
| `playbackUrl` | string or `null` | no | CMS-only protected value |
| `geoBlockCountriesOverride` | boolean | no | Defaults to `false` |
| `geoBlockCountries` | string[] | no | ISO-3166 alpha-2 codes; only valid with override `true` |

PATCH accepts every field above except `type`. Omitted values remain unchanged;
explicit `null` restores inheritance for nullable metadata. Supplying
`geoBlockCountries` atomically replaces all country rows.

```bash
curl -i -X POST http://localhost:3000/api/v1/cms/content \
  -H "Authorization: Bearer $CMS_EDITOR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"type":"MOVIE","title":"New Movie","quality":"HD","geoBlockCountriesOverride":true,"geoBlockCountries":["TR","DE"]}'
```

Reparenting validates the complete resulting hierarchy and rejects cycles.
Deleting Content with children returns `409 CONTENT_HAS_CHILDREN`; deleting a
leaf cascades only its geo-block country rows.

## Live Channels

### Routes

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/api/v1/cms/channels` | Create a channel and its internal schedule lock |
| `GET` | `/api/v1/cms/channels` | List channels |
| `GET` | `/api/v1/cms/channels/{channelId}` | Get one channel |
| `PATCH` | `/api/v1/cms/channels/{channelId}` | Update name and/or slug |
| `DELETE` | `/api/v1/cms/channels/{channelId}?confirm=true` | Delete channel and schedule |

List filters are case-insensitive `name` and `slug`, plus pagination. Create
requires `name` and `slug`; PATCH accepts either field. Slugs are normalized to
lowercase and permit lowercase letters, numbers, and single hyphen-separated
segments. Duplicate slugs return `409 LIVE_CHANNEL_SLUG_CONFLICT`.

Channel deletion requires both an `admin` credential and the exact query
parameter `confirm=true`. It atomically cascades the channel's EPG Programs and
internal schedule lock. A missing confirmation returns
`400 DELETE_CONFIRMATION_REQUIRED` without changing data.

## EPG Programs

### Routes

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/api/v1/cms/channels/{channelId}/epg` | Create a program |
| `GET` | `/api/v1/cms/channels/{channelId}/epg` | List a UTC schedule window |
| `GET` | `/api/v1/cms/channels/{channelId}/epg/{programId}` | Get one program |
| `PATCH` | `/api/v1/cms/channels/{channelId}/epg/{programId}` | Update name and/or times |
| `DELETE` | `/api/v1/cms/channels/{channelId}/epg/{programId}` | Delete a program |

The list route requires timezone-aware `windowStart` and `windowEnd` query
parameters and returns programs intersecting the half-open window. It also
accepts `page` and `pageSize`.

Create requires `programName`, `startTime`, and `endTime`. PATCH accepts those
same fields partially, but an EPG Program cannot move channels. All timestamps
must include a timezone and `startTime` must be earlier than `endTime`.

Create, update, and delete serialize on the channel schedule lock. Create and
update also use the PostgreSQL exclusion constraint, so overlapping programs
cannot be committed even when requests race. Back-to-back schedules are valid.
See [CMS EPG Program API](cms-epg-program-api.md) for scheduling details.

## Error Codes

| Status | Representative codes |
| --- | --- |
| `400` | `INVALID_REQUEST_BODY`, `UNKNOWN_FIELDS`, `INVALID_PAGINATION`, `INVALID_IF_MATCH`, `INVALID_CONTENT_HIERARCHY`, `INVALID_TIME_RANGE`, `EPG_OVERLAP` |
| `401` | `CMS_AUTHENTICATION_REQUIRED`, `INVALID_CMS_API_KEY` |
| `403` | `CMS_FORBIDDEN` |
| `404` | `CONTENT_NOT_FOUND`, `CHANNEL_NOT_FOUND`, `EPG_PROGRAM_NOT_FOUND` |
| `409` | `CONTENT_HAS_CHILDREN`, `CONTENT_ID_CONFLICT`, `CONTENT_WRITE_CONFLICT`, `LIVE_CHANNEL_SLUG_CONFLICT`, `LIVE_CHANNEL_WRITE_CONFLICT`, `EPG_WRITE_CONFLICT` |
| `413` | `REQUEST_BODY_TOO_LARGE` |
| `429` | `CMS_RATE_LIMITED` |
| `503` | `CMS_AUTH_NOT_CONFIGURED` |

All expected failures use:

```json
{
  "errorCode": "ERROR_CODE",
  "message": "Readable error message"
}
```
