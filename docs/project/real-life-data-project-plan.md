# SaatCMS Real-Life Content Data Project Plan

This document defines the user stories required to replace the small fictional content dataset with a bounded real-life catalog while preserving the existing SaatCMS hierarchy, metadata inheritance, playback entitlement, EPG, and deployment behavior.

The implementation will keep the same domain approach:

- `Content` remains the single model for Series, Seasons, Episodes, and Movies.
- Real-life catalog facts are added directly to `Content`; no separate catalog metadata or seed-manifest database tables are introduced.
- Existing OTT policy fields continue to support `Episode -> Season -> Series` inheritance.
- Real-life source facts do not inherit from parent content.
- External source APIs are called only by an explicitly executed local generator.
- A generated artifact is loaded from the developer machine into local or Render PostgreSQL by an explicit, guarded command.
- Render build, migration, deploy, and application startup never call external catalog APIs and never automatically replace catalog data.
- The deployed PostgreSQL database must remain below Render's 1 GB limit, with operational headroom rather than using the full allowance.

## Terminology and Data Ownership

| Category             | Examples                                                                                   | Ownership and behavior                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| Source catalog facts | title, summary, language, genres, premiere date, runtime, rating, image URL                | Imported from the real-life provider and stored on the individual `Content` row; never inherited. |
| SaatCMS OTT policy   | parental rating, inherited genre, quality, premium flag, playback URL, geo-block countries | Generated deterministically for the demo and resolved through the existing inheritance engine.    |
| Operational metadata | source, source ID, source URL, artifact version, counts, checksum                          | Used to make generation, loading, attribution, and verification reproducible.                     |

The first implementation will use TVmaze as its only real-life source. TVmaze provides coherent Show, Season, and Episode records with stable provider identifiers, requires no API key for its public API, and supports the hierarchy required by the assignment. A movie source such as Wikidata is explicitly deferred until the TVmaze catalog has been imported and measured against the database budget. It is not part of the initial implementation or definition of done.

## Selected Source and Existing Implementation Baseline

| Decision                 | Selection                                                             |
| ------------------------ | --------------------------------------------------------------------- |
| Initial provider         | TVmaze public API                                                     |
| Imported content types   | Series, Seasons, and Episodes                                         |
| Provider hierarchy       | TVmaze Show -> TVmaze Season -> TVmaze Episode                        |
| Authentication           | No API key required for the public API                                |
| Usage model              | One-time local generation with caching and offline replay             |
| Provider calls on Render | None                                                                  |
| Attribution              | TVmaze must be credited and usage must comply with its CC BY-SA terms |
| Deferred source          | Wikidata movies, considered only after storage measurement            |

Closed PR #3 is the implementation baseline for the catalog tooling. Its source client, TVmaze contracts and fetching logic, configuration parsing, normalization validation, deterministic policy generation, batching, and verification concepts should be selectively ported onto the current branch. The closed branch must not be merged wholesale because its separate `CatalogMetadata` and `CatalogSeedManifest` models conflict with the selected single-`Content` design and its branch contains unrelated historical changes.

### PR #3 Reuse Map

| Existing PR #3 file                 | Planned treatment                                                                                      |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `scripts/catalog/http.ts`           | Port with minimal changes; retain caching, pacing, offline behavior, bounded retries, and safe errors. |
| `scripts/catalog/tvmaze.ts`         | Port and adapt to fetch/map actual TVmaze Season records and emit flattened Content rows.              |
| `scripts/catalog/types.ts`          | Rewrite so provider facts and SaatCMS policies share one normalized Content contract.                  |
| `scripts/catalog/build.ts`          | Port configuration, catalog validation, deterministic ordering, and storage-budget concepts.           |
| `scripts/seed-advanced-catalog.ts`  | Reuse guarded batching concepts but rewrite persistence for flattened Content and artifact input.      |
| `scripts/verify-advanced-seed.ts`   | Reuse count, hierarchy, scenario, and database-size verification concepts.                             |
| `scripts/catalog/wikidata.ts`       | Do not port in the initial implementation.                                                             |
| Catalog Prisma models and migration | Do not port; add catalog columns directly to `Content` in a new migration.                             |

---

## RLD-01 - Define the Catalog Scope and Storage Budget

### Story Points

**2 points**

### Description

Define a measurable catalog boundary before changing the schema or importing data. The catalog generator must be configurable by content count and storage limits, but the final dataset size must be selected from actual PostgreSQL measurements rather than raw JSON size alone.

The 1 GB Render allowance includes table rows, indexes, constraints, and PostgreSQL overhead. The initial target should keep the complete database at or below 940 MB after import, leaving at least 60 MB for operational headroom, migrations, EPG writes, and measurement variance.

### Acceptance Criteria

- TVmaze is selected as the initial real-life Series/Season/Episode provider.
- The importer supports explicit maximums for shows, episodes per show, total content rows, normalized artifact bytes, and estimated database bytes.
- The default hard database guard is no greater than 940 MB.
- The final row target is chosen only after a representative local PostgreSQL import is measured.
- The plan reserves space for indexes, constraints, EPG data, migrations, and future writes.
- The generator stops cleanly when a configured content or storage budget is reached.
- Adding a movie provider is treated as optional work that cannot consume the reserved headroom.
- Provider attribution and applicable license requirements are documented before the data is published.

### Tests Required

- Configuration test accepts valid content and byte limits.
- Configuration test rejects negative, zero where invalid, non-numeric, and unsafe limits.
- Budget test stops generation before exceeding the configured normalized artifact limit.
- Budget test refuses an artifact whose estimated database size exceeds the hard guard.
- Local measurement records `pg_database_size(current_database())` and per-table total sizes after a representative import.
- Boundary test confirms a dataset at the limit is accepted and a dataset above the limit is rejected.

---

## RLD-02 - Extend the Existing Content Database Model

### Story Points

**5 points**

### Description

Add nullable real-life catalog fields directly to the existing `Content` table. Do not introduce `CatalogMetadata` or `CatalogSeedManifest` tables. Keep current hierarchy and inheritable OTT policy fields unchanged.

Expected catalog fields include:

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
- optional compact `sourceMetadata` only when a required source fact has no normalized column

`genre` remains the singular, inheritable SaatCMS policy field. `genres` stores the provider's non-inheritable catalog classifications.

### Acceptance Criteria

- All selected catalog columns exist on `Content` and are nullable unless a default is necessary.
- `summary` uses a PostgreSQL text type suitable for longer descriptions.
- `premieredAt` and `endedAt` use date semantics rather than server-local timestamps.
- `genres` uses a PostgreSQL string array with an empty-array default.
- `(source, sourceId)` is unique when provider identifiers are present.
- Queries by source and hierarchy remain supported by minimal, justified indexes.
- Large text, JSON, and URL columns are not indexed without a demonstrated query need.
- Existing `ContentGeoBlockCountry`, hierarchy relations, delete behavior, EPG tables, and EPG constraints remain unchanged.
- The migration applies to both a clean database and an existing database containing the old demo rows.
- Prisma Client is regenerated after the schema change.
- Database structure documentation identifies which fields are source facts and which fields are inheritable policies.

### Tests Required

- Fresh-database migration test applies every committed migration successfully.
- Upgrade migration test applies the new migration over the current schema and seed.
- Database test accepts catalog rows with valid nullable catalog fields.
- Database test rejects duplicate `(source, sourceId)` pairs.
- Database test permits multiple `NULL` source identities for non-imported content where PostgreSQL semantics allow it.
- Database test verifies array, date, text, integer, float, and JSON mappings.
- Regression tests confirm existing content type, quality, hierarchy, and EPG constraints still work.
- Prisma schema and migration consistency check passes.

---

## RLD-03 - Define Import Contracts and Deterministic Identifiers

### Story Points

**5 points**

### Description

Create typed contracts between source fetching, normalization, artifact generation, and database loading. Every generated row must have a stable identity so rebuilding the same source snapshot produces the same Content IDs and relationships.

Recommended identifiers use actual TVmaze IDs at every provider-backed level:

```text
tvmaze-series-{showId}
tvmaze-season-{seasonId}
tvmaze-episode-{episodeId}
```

Recommended source identities:

```text
TVMAZE / show:{showId}
TVMAZE / season:{seasonId}
TVMAZE / episode:{episodeId}
```

If an otherwise eligible show has Episodes but TVmaze returns no usable Season record, the importer may either skip that show or use the explicitly documented fallback `tvmaze-series-{showId}-season-{seasonNumber}`. It must never silently mix actual and derived Season identities for the same Season.

### Acceptance Criteria

- Typed normalized contracts cover Content rows, geo-block rows, source provenance, counts, useful scenario IDs, and artifact metadata.
- IDs are stable across repeated builds of the same provider records.
- Season IDs use stable TVmaze Season IDs when provider Season records are available.
- Any derived-Season fallback is explicit, deterministic, validated, and recorded in the artifact manifest.
- Every Season points to a Series and every Episode points to a Season.
- Source identity is unique across the normalized catalog.
- Normalization rejects blank titles, duplicate IDs, duplicate source identities, missing parents, invalid parent types, invalid dates, invalid ratings, and invalid country codes.
- Contracts distinguish source facts from deterministic SaatCMS policies.
- Provider-specific response types remain inside the catalog tooling and do not leak into the application domain API.

### Tests Required

- Stable-ID unit tests for Series, Season, and Episode records.
- Repeated-build test produces identical IDs and relationships for identical input.
- Duplicate content ID and duplicate source identity tests fail validation.
- Orphan Season and orphan Episode tests fail validation.
- Invalid Series/Season/Episode parent combinations fail validation.
- Empty-title and malformed-provider-record tests are skipped or rejected according to documented rules.
- Typecheck covers every source-to-normalized-field mapping.

---

## RLD-04 - Build a Polite, Cached, Local-Only Source Client

### Story Points

**5 points**

### Description

Port `scripts/catalog/http.ts` and the useful HTTP, caching, retry, and pacing concepts from PR #3 into local catalog tooling. The source client is a development utility and must not become a runtime dependency of the API server or Render deployment.

### Acceptance Criteria

- TVmaze requests use an identifying User-Agent.
- The client operates within TVmaze's documented public API rate limit and backs off on HTTP `429` responses.
- Requests are rate-limited and retry only documented transient failures.
- Successful source responses are cached under a gitignored local cache directory.
- Offline mode reads only cached responses and fails clearly when a required cache entry is missing.
- Cache keys are stable and collision-resistant for the requested endpoint and parameters.
- Timeouts and retry counts are bounded.
- Error output identifies the provider and failed operation without exposing secrets.
- The application server, migrations, seed loader, CI tests, and Render deployment do not require network access to TVmaze.
- No source API credentials or Render database credentials are written to cache or artifacts.

### Tests Required

- Cache-hit test avoids a second HTTP request.
- Offline cache-hit test succeeds without network access.
- Offline cache-miss test fails with an actionable error.
- Rate-limit test proves the configured minimum interval is respected.
- Retry tests cover retryable status codes, non-retryable status codes, timeout, and exhausted retries.
- Malformed JSON response test fails safely.
- User-Agent and request-header test verifies provider requirements.
- Repository search or dependency-boundary test confirms runtime modules do not import catalog HTTP tooling.

---

## RLD-05 - Normalize TVmaze into the Existing Content Hierarchy

### Story Points

**8 points**

### Description

Transform TVmaze Shows, Seasons, and Episodes into flattened `Content` rows. Prefer actual TVmaze Season records and stable Season IDs instead of deriving every Season solely from Episode numbers. Preserve provider facts accurately and sanitize source content before it becomes public API data.

### Acceptance Criteria

- Eligible TVmaze shows become `SERIES` rows.
- Eligible TVmaze Season records become `SEASON` rows below their Show.
- TVmaze Episodes become `EPISODE` rows below the matching provider Season.
- Episode `season` numbers are used to validate the Show/Season/Episode binding, not as the primary Season identity when a TVmaze Season ID exists.
- A missing or inconsistent Season mapping causes the show to be skipped or handled through the documented deterministic fallback; it never creates an orphan Episode.
- Titles, summaries, language, status, country, network, official site, images, premiere/end dates, runtime, rating, and genres are normalized where available.
- Missing optional provider fields become `NULL` or empty arrays without inventing source facts.
- HTML summaries are sanitized or converted to safe plain text before storage.
- Invalid dates and out-of-range ratings are rejected or normalized through documented rules.
- Special episodes and null season/episode numbers follow an explicit inclusion rule.
- Provider URLs and IDs remain traceable for attribution and debugging.
- Normalization order is deterministic so artifact checksums do not change due only to source response ordering.

### Tests Required

- Complete-show fixture test maps every supported provider field.
- Sparse-show fixture test handles nullable fields.
- Multi-season fixture test constructs one Series, correct Seasons, and correct Episodes.
- Provider Season ID test proves Season Content and source identities use the TVmaze Season ID.
- Missing Season mapping test follows the documented skip or fallback policy without producing orphans.
- HTML summary test produces safe output.
- Duplicate episode and repeated season tests do not create duplicate rows.
- Special/null-number episode tests follow the documented rule.
- Invalid date, runtime, and rating tests fail or normalize predictably.
- Deterministic ordering test returns the same normalized sequence for shuffled input.

---

## RLD-06 - Generate Minimal Deterministic Demo Policies

### Story Points

**3 points**

### Description

TVmaze supplies catalog facts, not SaatCMS playback rules. Add only the small
set of deterministic mock policies needed to demonstrate the existing
assignment behavior: metadata inheritance, geo-blocking, and premium 4K device
restriction. This is a middleware demonstration, not a real IPTV service.

Policies include:

- `parentalRating`
- inheritable `genre`
- `quality`
- `isPremium`
- `playbackUrl` as a non-playable placeholder only
- `geoBlockCountriesOverride`
- `ContentGeoBlockCountry` rows

Series own simple defaults. A few deterministically selected Seasons and
Episodes provide the overrides needed by the tests. Playback references use the
reserved `.invalid` domain, are returned only as mock authorization results,
and are never fetched or checked as media.

Out of scope: real streams, IPTV playlists, signed URLs, credentials, DRM,
media hosting, stream availability checks, and provider-specific commercial
rules.

### Acceptance Criteria

- Policy generation is deterministic and independent of generation time or row order.
- Provider catalog facts are never mislabeled as provider-supplied OTT policies.
- Series rows provide the defaults needed for descendant inheritance.
- Only the small deterministic set of Seasons and Episodes required for demo scenarios receives overrides.
- Playback URLs are placeholder values under `https://media.invalid/` and are never fetched or validated as streams.
- Generated country codes are valid ISO-3166 alpha-2 codes.
- The catalog contains stable examples for inheritance, a Season override, an Episode override, geo-blocking, an empty geo override, allowed playback, and premium 4K Mobile blocking.
- Those scenario Content IDs are written into the artifact manifest for tests and verification.
- Existing playback authorization logic does not require provider-specific conditions.

### Tests Required

- Repeated generation produces the same policies and scenario IDs.
- Inherited Episode scenario resolves Series defaults.
- Season override scenario resolves the Season value.
- Episode override scenario resolves the Episode value.
- Empty geo override scenario clears an inherited block list.
- Geo-blocked scenario returns `GEO_BLOCKED`.
- Premium 4K Mobile scenario returns `DEVICE_NOT_SUPPORTED` while Web and SmartTV succeed.
- Allowed playback returns a `.invalid` placeholder without making a network request.
- Policy validation rejects invalid quality, country, hierarchy, or non-placeholder playback values.

---

## RLD-07 - Produce a Versioned, Verifiable Catalog Artifact

### Story Points

**8 points**

### Description

Generate a portable artifact locally so data fetching and database loading are separate operations. Use a streamable format such as compressed NDJSON, accompanied by a small manifest. The artifact may remain a local release asset if its final size is unsuitable for Git.

Recommended layout:

```text
data/catalog/
  content.ndjson.gz
  geo-blocks.ndjson.gz
  manifest.json
```

### Acceptance Criteria

- The artifact contains all normalized Content and geo-block rows required for loading.
- The manifest records schema version, generator version, provider and attribution, generation time, configuration, row counts by type, useful scenario IDs, compressed and normalized bytes, and checksums.
- Content and geo-block records have deterministic ordering.
- The artifact can be validated without connecting to a database.
- Temporary and partial artifact files are never mistaken for complete output.
- Local HTTP cache and temporary files are gitignored.
- The repository explicitly documents whether the final generated artifact is committed, attached as a release asset, or generated locally.
- Loader compatibility is controlled by an explicit artifact schema version.
- The artifact contains no database URL, credentials, access tokens, or local filesystem paths.

### Tests Required

- Build-twice test creates identical row content and checksums from identical cached input, excluding documented generated timestamps.
- Manifest count test matches actual artifact rows.
- Checksum corruption test fails validation.
- Unsupported artifact-version test fails before database writes.
- Truncated compressed file test fails safely.
- Secret scanning test confirms fixtures and artifacts do not contain configured credentials.
- Streaming test validates a representative artifact without loading the entire dataset into memory.

---

## RLD-08 - Implement a Safe Batched PostgreSQL Catalog Loader

### Story Points

**13 points**

### Description

Create an explicit local command that loads the generated artifact into either local PostgreSQL or the Render database. Loading is destructive for on-demand Content data and therefore must reuse and extend the existing fail-closed destructive-target protections.

The loader should avoid temporary staging tables unless measurement proves that sufficient storage headroom exists. Insert empty-target data in dependency order using bounded batches:

```text
Series -> Movies -> Seasons -> Episodes -> geo-block countries
```

Live Channels, EPG Programs, and EPG schedule locks remain separate from catalog replacement and must not be deleted by a content-only import.

### Acceptance Criteria

- Loading requires an explicit command and explicit replacement confirmation.
- The loader validates the artifact completely before deleting existing Content data.
- The loader validates the connected database identity using the existing destructive-operation guard.
- Render loading requires a separately supplied Render database URL and expected database confirmation.
- Content deletion first removes geo-block rows or relies on verified cascades, clears parent relationships where required, and respects hierarchy constraints.
- Inserts are ordered so every referenced parent exists before its children.
- Batches have configurable bounded sizes and do not load the full artifact into memory.
- A failed batch leaves a clearly defined recoverable state; transaction boundaries and recovery steps are documented.
- Re-running the same artifact produces the same final catalog without duplicates.
- The loader reports inserted counts, duration, verification result, and actual PostgreSQL database size.
- The loader aborts if preflight estimates exceed the configured budget.
- The loader does not fetch provider data.
- The command is not part of application startup, Prisma migration deployment, Render build, or automatic pre-deploy execution.

### Tests Required

- Local load integration test imports a small artifact into an empty PostgreSQL database.
- Replacement test removes old Content data while preserving Live Channel and EPG data.
- Parent-order test loads a complete hierarchy without foreign-key failures.
- Invalid target confirmation test refuses destructive loading.
- Production-like unconfirmed target test is refused.
- Corrupt artifact test performs no deletion or insertion.
- Repeated-load test produces identical counts and no duplicate source identities.
- Mid-load failure test proves the documented rollback or recovery behavior.
- Batch-size tests cover final partial batches and large fixture streams.
- Post-load database-size guard test fails when the actual size exceeds the hard limit.

---

## RLD-09 - Replace the Existing Fictional Seed Workflow

### Story Points

**5 points**

### Description

Remove the six fictional Content records from `prisma/seed.ts` and make the generated real-life catalog the source of on-demand demo data. Keep deterministic synthetic Live Channel and EPG records because the real-life catalog source does not provide the assignment-specific scheduling scenarios.

Separate the concerns currently combined by `deploy:setup`: migrations and connectivity checks may remain automated, but destructive catalog loading must be manually executed from the developer machine.

### Acceptance Criteria

- `Galactic Odyssey` and `Crystal Frontier` Content records are removed from the seed implementation.
- The normal content seed/load path consumes the validated artifact and never calls TVmaze.
- Live Channel, EPG Program, and schedule-lock seed scenarios remain repeatable.
- Existing seed/reset safety checks remain fail-closed.
- Package scripts distinguish catalog generation, artifact validation, local loading, Render loading, and post-load verification.
- `deploy:setup` no longer performs destructive content seeding automatically.
- Render migration/deploy remains independent of whether a catalog refresh is performed.
- A clean local setup has documented commands for migration, artifact acquisition or generation, catalog load, and verification.
- Old fixed count and fictional ID assumptions are removed from scripts, tests, deployment smoke checks, README examples, API examples, and the Postman collection.

### Tests Required

- Seed regression test confirms fictional Content IDs and titles are absent.
- Live data regression test confirms required channels, schedule locks, and EPG programs remain present.
- Package-script test checks the expected safe command definitions.
- Deploy setup test proves no destructive seed command runs automatically.
- Clean-checkout workflow test applies migrations and loads a small test artifact successfully.
- Repository search check finds no stale fictional IDs outside clearly marked historical documents.

---

## RLD-10 - Update the Content Repository and Inheritance Layer

### Story Points

**8 points**

### Description

Update the data-access layer for the expanded Prisma `Content` type. The recursive ancestor CTE currently enumerates Content columns explicitly, so it must be updated when catalog columns are added or changed. Catalog facts must be returned from the requested Content row only; they must not be resolved through ancestors.

### Acceptance Criteria

- The recursive ancestor query remains type-correct after the schema expansion.
- `toContent` returns a complete Prisma `Content` shape expected by domain services.
- Existing hierarchy cycle and maximum-depth protections remain intact.
- Existing inheritable fields retain the exact `Episode -> Season -> Series` resolution order.
- Catalog facts are read only from the requested content row.
- Source `genres` do not replace or alter inheritance of the existing singular `genre` field.
- Repository reads remain bounded and do not introduce an N+1 query per ancestor or catalog field.
- Content creation types are updated only where the application genuinely supports creating catalog fields; importer-specific writes remain in catalog tooling.
- Playback resolution remains provider-agnostic.

### Tests Required

- Repository integration test maps every new Content column through the recursive query.
- Requested-row test proves an Episode does not inherit Series summary, image, rating, source identity, or episode numbering.
- Existing scalar inheritance tests continue to pass unchanged.
- Existing geo-block override tests continue to pass unchanged.
- Cycle, incomplete hierarchy, invalid parent, and maximum-depth tests continue to pass.
- Query-count or repository-spy test confirms no per-field or per-ancestor N+1 behavior is introduced.
- Typecheck fails if the raw recursive query mapping becomes inconsistent with the Prisma Content contract.

---

## RLD-11 - Expose Safe Real-Life Metadata Through the Content API

### Story Points

**5 points**

### Description

Extend `GET /api/v1/mw/content/{contentId}` so the real-life dataset produces a visibly useful public response. Update the service DTO and mapper without exposing protected playback URLs or unnecessary raw provider payloads.

Candidate public catalog fields:

- `summary`
- `imageUrl`
- `genres`
- `language`
- `status`
- `premieredAt`
- `runtimeMinutes`
- `seasonNumber`
- `episodeNumber`
- `ratingAverage`
- optional source attribution containing provider name and source URL

### Acceptance Criteria

- The public content response contains selected real-life catalog facts from the requested row.
- Date values use a documented stable JSON representation.
- Missing optional source facts are represented consistently.
- Existing resolved policy fields remain backward compatible.
- `playbackUrl` remains absent from the public metadata endpoint at every nesting level.
- Raw `sourceMetadata` is never returned publicly.
- Provider attribution is included or linked according to the source license requirements.
- Playback success responses continue to expose playback details only after entitlement checks.
- Controllers and routes require no provider-specific branching.
- API documentation and Postman examples use stable real-life IDs from the manifest.

### Tests Required

- Service mapping test covers all selected public catalog fields.
- Route success test returns real-life metadata for a Series and an Episode.
- Sparse metadata test returns the documented nullable/empty representation.
- Non-inheritance test proves Episode catalog facts are not copied from its Season or Series.
- Security regression test confirms no `playbackUrl` or raw `sourceMetadata` appears in the public response.
- Playback success, geo-block, device-block, missing-header, and not-found regression tests continue to pass with real-life IDs.
- Response serialization test covers date and array fields.

---

## RLD-12 - Replace Fixed Seed Verification with Catalog Invariants

### Story Points

**8 points**

### Description

Replace `scripts/verify-demo-seed.ts` assumptions about six fixed Content IDs with manifest-backed counts and domain invariants. Verification must work after loading locally and against Render.

### Acceptance Criteria

- Content totals and type counts match the artifact manifest.
- Every Season has an existing Series parent.
- Every Episode has an existing Season parent.
- Series and Movies have no parent.
- No hierarchy row is orphaned or cyclic.
- Every imported Content row has a unique source identity.
- Useful scenario IDs from the manifest exist and produce their promised inheritance and playback behavior.
- Catalog facts and OTT policy fields pass domain validation.
- Live Channel and EPG seed invariants remain verified independently.
- Verification reports actual database size and fails above the configured hard limit.
- Verification is read-only and safe to run repeatedly against Render.

### Tests Required

- Valid catalog fixture passes all checks.
- Count mismatch test fails with expected and actual counts.
- Missing useful scenario test fails with the scenario name and ID.
- Orphan, invalid parent type, duplicate source, invalid policy, and missing provider tests fail clearly.
- Database-size limit test covers below, equal, and above-limit results.
- Read-only behavior test confirms verification performs no database writes.
- Render smoke workflow executes the verification command successfully after a controlled load.

---

## RLD-13 - Update Application Tests and Test Fixtures

### Story Points

**8 points**

### Description

Keep automated tests small and isolated even though the deployed catalog is large. Unit and integration suites should use compact real-life-shaped fixtures or a tiny generated artifact rather than loading the full production catalog for every test run.

### Acceptance Criteria

- Tests no longer depend on fictional Galactic Odyssey or Crystal Frontier IDs.
- A small committed test artifact or fixture represents at least one Series, Season, Episode, and optional Movie.
- Fixtures include every inheritance, geo-block, and device restriction scenario required by the assignment.
- Tests remain deterministic and require no external network access.
- The full large catalog is used only for explicit loader, capacity, and deployment verification.
- Test database cleanup remains isolated and protected.
- Coverage remains at or above the existing 90 percent line threshold.
- Test runtime remains appropriate for CI.

### Tests Required

- Update content hierarchy, metadata inheritance, middleware content, playback, seed, database tooling, deployment smoke, and docs consistency tests to use new stable fixture IDs.
- Add importer unit tests using committed provider-response fixtures.
- Add artifact validation and loader integration tests using a tiny artifact.
- Run `npm run typecheck`.
- Run `npm test`.
- Run `npm run test:coverage` and meet the global threshold.
- Run `npm run build`.
- Confirm the full suite succeeds with outbound network access disabled.

---

## RLD-14 - Document and Secure the Local-to-Render Import Procedure

### Story Points

**5 points**

### Description

Document an operator-controlled workflow for generating data locally and loading it into Render PostgreSQL. The procedure must protect credentials, prevent accidental database replacement, and provide preflight, backup, verification, and recovery steps.

### Acceptance Criteria

- Render credentials are supplied only through environment variables or approved secret storage and are never committed.
- The runbook identifies the exact target database identity required by the destructive guard.
- A backup or restore point is created or verified before catalog replacement.
- The operator validates the artifact and preflight estimate before connecting to Render.
- The operator explicitly confirms content replacement.
- The loader reports actual database and table/index sizes after loading.
- Post-load verification and deployed API smoke tests are documented.
- Recovery instructions cover failed loads, partial loads, budget overruns, and application incompatibility.
- Normal Render deployment applies migrations and starts the server without fetching or loading catalog data.
- A catalog refresh can be performed independently of application deployment.
- Logs do not print database credentials or full connection strings.

### Tests Required

- Dry-run of the documented local generation and validation commands.
- Local PostgreSQL rehearsal using the intended production-sized artifact.
- Backup/restore rehearsal before the first Render replacement.
- Render preflight rejects incorrect database confirmation.
- Controlled Render load followed by read-only catalog verification.
- Deployed smoke tests cover health, readiness, content metadata, allowed playback, geo-blocking, device blocking, EPG creation, and EPG overlap rejection.
- Restart/redeploy test confirms imported catalog data persists without rerunning the loader.
- Credential scan confirms documentation, logs, artifacts, and Git history contain no Render database URL.

---

## RLD-15 - Update Repository Documentation and Attribution

### Story Points

**3 points**

### Description

Update all repository documentation and examples affected by the replacement of fictional Content data. Clearly distinguish current operational instructions from historical project records.

### Acceptance Criteria

- README documents catalog generation, validation, local loading, Render loading, verification, and database-size measurement.
- Database structure documentation lists the new Content columns and their source-fact/non-inheritable behavior.
- Content domain documentation explains the distinction between `genre` and `genres`.
- Content metadata API documentation shows the expanded response.
- Playback API documentation uses stable real-life scenario IDs.
- API test examples and Postman collection use manifest-backed example IDs.
- Deployment runbook removes six-row verification and automatic destructive seeding assumptions.
- CI/CD documentation states that CI and Render deployment do not fetch external catalog data.
- Source attribution, license, source URL, and data-generation date are documented.
- Historical PR #3 is documented as the selective implementation baseline, not as a branch to merge wholesale.
- Documentation identifies the PR #3 files that were ported and the catalog schema/persistence pieces that were intentionally rewritten.
- Markdown links and documented commands remain valid.

### Tests Required

- Documentation consistency tests cover renamed commands and required files.
- Repository search finds no stale fictional IDs or six-row expectations outside historical documentation.
- Markdown link check passes.
- Postman collection parses and contains current stable scenario IDs.
- Every documented npm command exists in `package.json`.
- Clean-checkout documentation rehearsal completes without undocumented steps.

---

## Story Point Summary

Story points use the Fibonacci scale and represent relative implementation complexity, uncertainty, operational risk, and testing effort. They are not direct hour or day estimates.

| Story     | Summary                                | Points |
| --------- | -------------------------------------- | -----: |
| RLD-01    | Scope and storage budget               |      2 |
| RLD-02    | Extend the Content database model      |      5 |
| RLD-03    | Import contracts and deterministic IDs |      5 |
| RLD-04    | Cached local-only source client        |      5 |
| RLD-05    | TVmaze hierarchy normalization         |      8 |
| RLD-06    | Minimal deterministic demo policies    |      3 |
| RLD-07    | Versioned content data artifact        |      8 |
| RLD-08    | Safe batched PostgreSQL loader         |     13 |
| RLD-09    | Replace fictional seed workflow        |      5 |
| RLD-10    | Repository and inheritance updates     |      8 |
| RLD-11    | Public content API metadata            |      5 |
| RLD-12    | Imported-data invariant verification   |      8 |
| RLD-13    | Application tests and fixtures         |      8 |
| RLD-14    | Local-to-Render import procedure       |      5 |
| RLD-15    | Documentation and attribution          |      3 |
| **Total** |                                        | **91** |

RLD-08 has the highest estimate because it combines destructive-operation safety, streaming and batching, hierarchy ordering, repeatability, failure recovery, Render target protection, and storage-limit enforcement. RLD-05, RLD-07, RLD-10, RLD-12, and RLD-13 carry additional uncertainty around provider data quality, artifact integrity, the raw recursive SQL mapping, production-size validation, and regression coverage.

Estimates should be reviewed after a small end-to-end TVmaze import proves the provider response shape, actual Season mapping, artifact size, and PostgreSQL storage ratio. If a story grows beyond 13 points during implementation, it should be split before work continues.

## Layer-by-Layer Change Map

| Layer                               | Expected changes                                                                                                                                     |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| External source                     | Local-only TVmaze fetcher, rate limiting, retries, caching, offline support, provider response contracts.                                            |
| Catalog normalization               | Stable IDs, Series/Season/Episode construction, source-field normalization, summary sanitation, deterministic ordering, hierarchy validation.        |
| OTT policy generation               | Deterministic inherited metadata, geo rules, premium/quality rules, fictional playback URLs, guaranteed useful scenarios.                            |
| Artifact                            | Compressed streamable records, manifest, counts, checksums, source attribution, schema version, useful scenario IDs, size limits.                    |
| Prisma schema                       | Nullable catalog fields added directly to `Content`, unique source identity, minimal indexes; no new catalog tables.                                 |
| SQL migrations                      | Add catalog columns, PostgreSQL array/date/text/JSON mappings, source uniqueness and indexes; preserve all current constraints.                      |
| Database loading                    | Guarded local command, complete pre-validation, parent-first batched writes, content-only replacement, repeatability, size reporting.                |
| Seed/reset tooling                  | Remove fictional Content creation, preserve Live Channel/EPG data, separate catalog loading from automatic deploy setup.                             |
| Content domain                      | Explicit classification of inheritable policies versus non-inheritable catalog facts; catalog validation types where appropriate.                    |
| Content repository                  | Update recursive CTE column list and mapping, preserve cycle/depth checks, return requested-row catalog facts without N+1 queries.                   |
| Metadata inheritance                | Preserve existing policy resolution exactly; do not inherit summary, images, source identity, dates, ratings, genres, or numbering.                  |
| Middleware content service          | Extend public DTO and mapper with approved catalog fields while omitting protected/raw fields.                                                       |
| Middleware content route/controller | Preserve endpoint and error contract; serialize new optional catalog fields consistently.                                                            |
| Playback service                    | No provider-specific behavior; update only scenario IDs/fixtures while preserving entitlement logic.                                                 |
| Live Channel and EPG                | Preserve schema and behavior; ensure catalog replacement never deletes or rewrites scheduling data.                                                  |
| Configuration                       | Add catalog limits, cache/artifact paths, loader target variables, explicit confirmation, and safe defaults.                                         |
| Package scripts                     | Add build, validate, load-local, load-Render, and verify commands; remove catalog seeding from automatic deployment.                                 |
| Tests                               | Small offline fixtures, importer units, loader integrations, database migration checks, API regressions, invariant verification, capacity rehearsal. |
| CI                                  | Run schema, typecheck, unit/integration, coverage, build, and small-artifact tests without external provider calls or production data loading.       |
| Render operations                   | Migrate/start normally; catalog generation and loading run manually from local; verify size, persistence, and APIs after import.                     |
| Documentation                       | README, database, domain, APIs, Postman, CI/CD, deployment runbook, attribution, useful IDs, recovery instructions.                                  |

## Proposed Commands

Final names may change during implementation, but responsibilities should remain separate:

```text
npm run catalog:build
npm run catalog:validate
npm run catalog:load:local
npm run catalog:load:render -- --confirm-replace-content
npm run catalog:verify
```

`catalog:build` is the only command that contacts external providers. `catalog:load:*` consumes an existing artifact. `catalog:verify` is read-only.

## Recommended Delivery Order

```text
RLD-01
  |
RLD-02 -- RLD-03
  |         |
  |       RLD-04
  |         |
  |       RLD-05
  |         |
  |       RLD-06
  |         |
  +-------RLD-07
            |
          RLD-08
            |
          RLD-09
            |
          RLD-10
            |
          RLD-11
            |
          RLD-12
            |
          RLD-13
            |
          RLD-14
            |
          RLD-15
```

The database schema and contracts can be developed together. Source fetching, normalization, and policy generation lead to the artifact. Database loading must not begin until artifact validation exists. Public API changes should follow a verified database load path.

## Final Definition of Done

The real-life data replacement is complete when:

- Fictional on-demand Content seed records are replaced by a coherent real-life catalog.
- TVmaze is the only provider required by the initial implementation, and actual TVmaze Season records are used wherever available.
- Selected PR #3 catalog tooling is ported without importing its separate catalog database models or unrelated branch changes.
- `Content` directly stores approved real-life source fields without separate catalog tables.
- Series, Season, and Episode relationships are valid and deterministically reproducible.
- Existing metadata inheritance, geo-blocking, device restriction, and playback security behavior remain correct.
- Provider fetching runs only through an explicit local command and supports cache/offline operation.
- A versioned, checksummed artifact can be validated independently of the database.
- Local and Render loaders are explicit, guarded, repeatable, and do not affect Live Channel or EPG data.
- Render build, migration, deployment, and application startup never fetch or automatically reload the catalog.
- The deployed PostgreSQL database remains at or below the 940 MB project guard and therefore below Render's 1 GB platform limit with operational headroom.
- Manifest-backed useful IDs demonstrate every required assignment scenario.
- Public metadata exposes useful real-life facts without exposing playback URLs or raw provider payloads.
- Full typecheck, tests, 90 percent coverage gate, and production build pass without external network access.
- README, API docs, database docs, Postman collection, CI/CD docs, deployment runbook, and attribution match the implemented workflow.
