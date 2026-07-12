# Catalog Import Contracts and Identities

Catalog tooling uses the provider-neutral contracts in `scripts/catalog/types.ts`
between fetch, normalization, artifact, and loader stages. Provider response
types remain under `scripts/catalog`; application domain and HTTP modules do not
import TVmaze wire types.

Each normalized Content row separates `sourceFacts` from `policies`:

- `sourceFacts` are facts owned by the exact provider record and never inherit.
- `policies` are deterministic SaatCMS demo rules and may participate in the
  existing inheritance behavior.

TVmaze identities are deterministic:

| Record | Content ID | Source identity |
| --- | --- | --- |
| Show | `tvmaze-series-{showId}` | `TVMAZE / show:{showId}` |
| Season | `tvmaze-season-{seasonId}` | `TVMAZE / season:{seasonId}` |
| Episode | `tvmaze-episode-{episodeId}` | `TVMAZE / episode:{episodeId}` |

An eligible Show is skipped before selection when its ID is not a positive
integer or its title is blank. Once selected, malformed Show, Season, or Episode
records are rejected rather than partially normalized.

If TVmaze supplies Episodes but no usable Season record, tooling may explicitly
create `tvmaze-series-{showId}-season-{seasonNumber}` with source identity
`season-derived:{showId}:{seasonNumber}`. Every such row must have a matching
`derivedSeasons` manifest entry with reason
`TVMAZE_SEASON_RECORD_UNAVAILABLE`. Validation rejects missing or altered
entries and rejects mixing provider-backed and derived identities for the same
Series/season-number pair.

Validation also rejects duplicate Content IDs, duplicate source identities,
blank titles, missing or invalid parents, impossible calendar dates, ratings
outside 0–10, and country codes other than uppercase ISO-style alpha-2 values.
