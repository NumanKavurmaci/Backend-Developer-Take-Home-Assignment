# TODOs

## Expose rich catalog metadata through the backend

The advanced seed importer stores substantially richer real-world series, season, episode, and movie metadata than the current middleware response can expose. Extend the content domain model, repository queries, service mapping, API response contracts, validation, documentation, and tests so clients can safely consume the new catalog fields without changing the existing metadata-inheritance behavior.

Fields to support:

- `source`
- `sourceId`
- `sourceUrl`
- `originalTitle`
- `summary`
- `language`
- `status`
- `countryCode`
- `networkName`
- `officialSiteUrl`
- `imageUrl`
- `premieredAt`
- `endedAt`
- `runtimeMinutes`
- `seasonNumber`
- `episodeNumber`
- `ratingAverage`
- `genres`
- `sourceMetadata`

The implementation should load the optional `catalogMetadata` relation efficiently, avoid N+1 queries for hierarchy responses, preserve nullable values, define a stable public JSON shape, and include source attribution where required by the underlying dataset license.
