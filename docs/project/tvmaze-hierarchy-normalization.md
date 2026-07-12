# TVmaze Hierarchy Normalization

TVmaze snapshots are normalized as one `SERIES` row followed by `SEASON` rows
and then `EPISODE` rows. Actual TVmaze Season records are indexed by their
season number for Episode binding, but their provider Season ID remains the
Content and source identity. Episode season numbers validate and select the
parent; they never replace an available provider Season ID.

Normalization order is deterministic:

1. Series;
2. Seasons by season number, then stable Content ID;
3. Episodes by season number, episode number, then TVmaze Episode ID.

Identical repeated Season or Episode records are collapsed. Conflicting records
with the same provider ID are rejected. If two different Season IDs claim the
same season number, the entire Show is skipped as ambiguous. If a regular
Episode references a season number for which no Season record exists, the
documented deterministic derived Season and manifest entry are created before
the Episode; an orphan Episode is never emitted.

## Episode inclusion

Only Episodes whose TVmaze `type` is `regular` and whose season and episode
numbers are positive integers are included. Specials, null-numbered Episodes,
and non-positive-numbered Episodes are excluded and recorded with reason
`SPECIAL_OR_UNNUMBERED_EPISODE`. The normal TVmaze episodes endpoint already
excludes most specials by default, but normalization enforces the rule again so
cached fixtures and future endpoint options cannot silently change the catalog.

## Provider facts and safety

All available normalized source fields are retained on their exact Content row;
missing optional facts become null or an empty `genres` array. Provider IDs and
URLs remain available for attribution and debugging. HTML summaries and other
human-readable provider strings are converted to compact plain text: markup and
script/style content are removed, entities are decoded, and whitespace is
normalized. Genres are sanitized, deduplicated, and sorted.

Calendar dates must be real `YYYY-MM-DD` values. Ratings must be finite values
from 0 through 10. Runtime, season, and episode numbers must be positive
integers when present. Invalid included records reject normalization rather than
inventing or silently correcting source facts.
