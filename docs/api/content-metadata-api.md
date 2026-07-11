# Content Metadata API

The middleware content endpoint returns resolved metadata for one content item.

```http
GET /api/v1/mw/content/{contentId}
```

The endpoint is intentionally read-only. It does not expose raw CMS rows or protected playback asset data; it returns only public metadata that a middleware consumer can inspect before requesting playback.

## Resolution Rules

For scalar metadata fields, the closest non-null value wins.

```text
Episode -> Season -> Series
```

The rule is applied independently to each field:

| Field            | Inheritance rule                               |
| ---------------- | ---------------------------------------------- |
| `parentalRating` | closest non-null value wins                    |
| `genre`          | closest non-null value wins                    |
| `quality`        | closest non-null value wins                    |
| `isPremium`      | closest non-null value wins, including `false` |

`playbackUrl` is resolved internally for the playback gatekeeper, but it is intentionally omitted from this public endpoint. Use `GET /api/v1/mw/playback/{contentId}` to receive playback details after geo and device checks pass.

Geo-block countries use a separate override flag because an empty country list can be meaningful.

| `geoBlockCountriesOverride` | Meaning                                                        |
| --------------------------- | -------------------------------------------------------------- |
| `false`                     | keep looking at parent content                                 |
| `true`                      | use this content item's countries, even when the list is empty |

## Success Response

Example request:

```bash
curl http://localhost:3000/api/v1/mw/content/episode-galactic-odyssey-s1e2
```

Example response:

```json
{
  "contentId": "episode-galactic-odyssey-s1e2",
  "type": "EPISODE",
  "title": "Dark Side Relay",
  "parentalRating": "16+",
  "genre": "Space Adventure",
  "quality": "HD",
  "isPremium": false,
  "geoBlockCountries": ["IR", "SY"]
}
```

## Empty Geo-Block Override

Example request:

```bash
curl http://localhost:3000/api/v1/mw/content/episode-galactic-odyssey-s1e3
```

Important response field:

```json
{
  "geoBlockCountries": []
}
```

This means the episode intentionally clears the inherited Series block list.

## Missing Content

Example request:

```bash
curl -i http://localhost:3000/api/v1/mw/content/missing-content
```

Example response:

```json
{
  "errorCode": "CONTENT_NOT_FOUND",
  "message": "Content not found"
}
```

Status:

```http
404 Not Found
```

## Implementation Map

| Layer      | File                                              |
| ---------- | ------------------------------------------------- |
| Route      | `src/modules/mw-content/mw-content.route.ts`      |
| Controller | `src/modules/mw-content/mw-content.controller.ts` |
| Service    | `src/modules/mw-content/mw-content.service.ts`    |
| Resolver   | `src/content/metadata-inheritance.ts`             |
| Repository | `src/content/content-repository.ts`               |

The service delegates to `resolveContentMetadata(...)` for internal inheritance, then maps the result to a public response DTO before returning it from this endpoint.
