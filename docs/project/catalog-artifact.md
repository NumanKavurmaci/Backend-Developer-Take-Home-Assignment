# Versioned Catalog Artifact

Catalog fetching and database loading are separate operations. The local build
pipeline passes a normalized, policy-complete catalog to the artifact writer,
which publishes this layout:

```text
data/catalog/current/
  content.ndjson.gz
  geo-blocks.ndjson.gz
  manifest.json
```

`content.ndjson.gz` contains flattened, loader-ready Content rows. Source facts
and SaatCMS policy values occupy their corresponding database fields;
`createdAt` and `updatedAt` remain database-owned. `geo-blocks.ndjson.gz`
contains the related country rows. Content is ordered as roots, Seasons, then
Episodes with stable IDs inside each group. Geo blocks are ordered by Content ID
and country code. JSON object keys are canonicalized before compression.

The manifest records artifact schema version 1, generator name and version,
UTC generation time, TVmaze attribution and snapshot key, safe catalog limits,
row counts, scenario IDs, derived-Season declarations, estimated database
bytes, normalized/compressed byte totals, and SHA-256 checksums for both gzip
files. Generation timestamps exist only in the manifest, so identical normalized
input produces identical NDJSON and compressed-file checksums.

## Publication decision

Generated artifacts are **local files and are not committed to Git**.
`data/catalog/`, `.cache/`, and partial staging output are gitignored. If an
artifact is too costly to regenerate for a deployment, the complete directory
may be packaged and attached manually as a release asset. A release asset must
contain all three files and pass the same validation command before use. It must
never be copied into the application image implicitly.

The writer creates a uniquely named sibling staging directory, writes both data
files, writes the manifest last, and finally renames the completed directory to
its target. It refuses to replace an existing target. A partial directory has
no valid manifest and cannot pass validation.

## Database-free validation

Validate a local artifact with:

```shell
npm run catalog:validate -- data/catalog/current
```

Validation checks the schema version before opening data files, verifies file
names, compressed sizes and checksums, then decompresses NDJSON as a stream.
Only Content IDs/types and source-identity keys are retained for uniqueness and
parent checks; complete rows are not accumulated in memory. Counts, ordering,
normalized sizes, geo relationships, derived Seasons, and scenario references
must match the manifest. Validation does not import Prisma or connect to a
database.

The artifact contract has no fields for database URLs, credentials, access
tokens, HTTP headers, cache paths, or local output paths. Cache snapshot keys
are opaque safe identifiers rather than filesystem locations.
