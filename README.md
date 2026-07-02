# SaatCMS Middleware Core

Prototype backend for the SaatCMS OTT middleware assignment.

## Current Status

The project currently has:

- TypeScript project setup
- SQLite + Prisma local database setup
- Seed data for content, geo-blocking, device rules, live channels, and EPG programs
- Hono application scaffold
- Health-check endpoint
- Middleware content metadata endpoint with Series -> Season -> Episode inheritance
- Focused tests for content hierarchy, metadata resolution, content metadata routing, and live-channel domain behavior

## Run Locally

Install dependencies:

```bash
npm install
```

Create and seed the local database:

```bash
npm run db:reset
npm run db:seed
```

Start the Hono development server:

```bash
npm run dev
```

Health check:

```http
GET /health
```

Example:

```bash
curl http://localhost:3000/health
```

Response:

```json
{
  "status": "ok",
  "service": "saatcms-middleware-core"
}
```

## Content Metadata API

### Get resolved content metadata

```http
GET /api/v1/mw/content/{contentId}
```

Returns the final resolved metadata for a content item.

For inherited fields, the closest non-null value wins.

For an Episode, metadata is resolved in this order:

```text
Episode -> Season -> Series
```

Resolved fields:

- `parentalRating`
- `genre`
- `quality`
- `isPremium`
- `playbackUrl`
- `geoBlockCountries`

Geo-block countries use `geoBlockCountriesOverride`.

If `geoBlockCountriesOverride` is `false`, the API keeps looking at the parent.

If `geoBlockCountriesOverride` is `true`, the API uses that content item's own country list, even when the list is empty. This allows an Episode to override the parent geo-block list with an empty list.

### Example: resolved episode metadata

```bash
curl http://localhost:3000/api/v1/mw/content/episode-galactic-odyssey-s1e2
```

Response:

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

In this example:

- `parentalRating` is overridden by the Episode.
- `genre` is inherited from the Season.
- `quality`, `isPremium`, and `geoBlockCountries` are inherited from the nearest parent that defines them.
- `playbackUrl` is overridden by the Episode.

### Example: geo-block empty override

```bash
curl http://localhost:3000/api/v1/mw/content/episode-galactic-odyssey-s1e3
```

This Episode overrides geo-block countries with an empty list, so it does not inherit the Series block list.

Expected important field:

```json
{
  "geoBlockCountries": []
}
```

### Missing content

```bash
curl -i http://localhost:3000/api/v1/mw/content/numan
```

Returns:

```http
HTTP/1.1 404 Not Found
```

Example response:

```json
{
  "errorCode": "REQUEST_FAILED",
  "message": "Content not found"
}
```

## Checks

Run TypeScript checks:

```bash
npm run typecheck
```

Run tests:

```bash
npm test
```

## Documentation

Additional project notes live under `docs/`:

- `docs/api/content-metadata-api.md`
- `docs/database-structure.md`
- `docs/domain/content-domain-index.md`
- `docs/domain/live-channel-domain-index.md`
- `docs/project/assignment.md`
- `docs/project/project-steps.md`
