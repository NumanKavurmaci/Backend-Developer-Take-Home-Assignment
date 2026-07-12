# Safe Catalog Loader

RLD-08 adds one explicit local utility, `npm run catalog:load`. It reads an
existing catalog artifact and never contacts TVmaze. It is not called by API
startup, migrations, builds, seed commands, or Render deployment hooks.

## Safety sequence

The command fails closed in this order:

1. Require the literal replacement confirmation `REPLACE_CONTENT`.
2. Fully validate manifest version, checksums, byte counts, row counts,
   deterministic ordering, identities, and hierarchy without a database write.
3. Reject an artifact whose database estimate exceeds the configured hard
   guard (940 MB by default).
4. Validate the separately supplied catalog database URL and query the live
   connection to confirm its database and schema identity.
5. Begin one PostgreSQL transaction, delete only geo-block and Content rows,
   and insert bounded batches in `Series -> Movies -> Seasons -> Episodes ->
   geo-blocks` order.
6. Verify imported counts, verify that Live Channel/EPG counts did not change,
   and measure `pg_database_size(current_database())` before commit.
7. Commit only when verification and the actual-size guard pass.

Validation retains only a compact Content ID/type index needed to prove
parents and references; loading streams decompressed NDJSON rows and retains at
most one configured batch of row objects. No temporary or staging tables are
created.

## Local load

Start PostgreSQL and apply migrations first. In PowerShell:

```powershell
$env:CATALOG_ARTIFACT_DIR="data/catalog/catalog-660-series-fast"
$env:CATALOG_DATABASE_TARGET="local"
$env:CATALOG_DATABASE_URL="postgresql://saatcms:saatcms_local@localhost:5432/saatcms?schema=public"
$env:CATALOG_REPLACE_CONFIRMATION="REPLACE_CONTENT"
$env:CATALOG_LOAD_BATCH_SIZE="500"
npm run catalog:load
```

The final JSON report includes inserted counts, duration, verification status,
database name, actual PostgreSQL bytes, and the hard guard.

## Render load

Use Render's external PostgreSQL URL as a session-only value; do not place it in
the repository, artifact, cache, shell history, or logs. The application
`DATABASE_URL` is intentionally ignored by this command.

```powershell
$env:CATALOG_ARTIFACT_DIR="data/catalog/catalog-660-series-fast"
$env:CATALOG_DATABASE_TARGET="render"
$env:CATALOG_DATABASE_URL="<Render external PostgreSQL URL>"
$env:CATALOG_EXPECTED_DATABASE="<database name from that URL>"
$env:CATALOG_RENDER_CONFIRMATION="<host>/<database>/public"
$env:CATALOG_REPLACE_CONFIRMATION="REPLACE_CONTENT"
npm run catalog:load
```

Back up the Render database and rehearse the same artifact locally before the
first remote replacement.

## Transactions and recovery

The complete content replacement is atomic. A corrupt stream, foreign-key or
unique failure, timeout, interrupted process, failed verification, or size
overrun rolls the transaction back, leaving the prior Content catalog and all
Live Channel/EPG rows logically intact. PostgreSQL may retain allocated physical
pages after a rolled-back write; this does not create partial catalog rows.

After failure, fix the reported cause and run the same explicit command again.
Do not use the demo seed or database reset as loader recovery. If the connection
drops and the outcome is uncertain, reconnect, inspect Content counts and useful
manifest IDs, then rerun the same artifact—the replacement is deterministic and
duplicate-free.

The default transaction timeout is ten minutes and the supported batch range is
1–5,000 rows. Adjust `CATALOG_LOAD_TRANSACTION_TIMEOUT_MS` or
`CATALOG_LOAD_BATCH_SIZE` only after a local rehearsal. A post-load physical-size
failure means the dataset cannot be committed under that guard; generate a
smaller artifact instead of consuming the reserved headroom.
