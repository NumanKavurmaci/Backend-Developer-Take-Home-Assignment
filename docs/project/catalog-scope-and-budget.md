# Catalog Scope and Storage Budget

TVmaze is the sole initial catalog provider. It supplies real Series, Season,
and Episode facts. TVmaze data is available under CC BY-SA; published artifacts
and user-facing documentation must credit TVmaze, link to
<https://www.tvmaze.com/api>, identify modifications, and comply with the
applicable share-alike requirements.

The Render PostgreSQL allowance is 1 GB (1,000,000,000 bytes). Catalog
generation has a hard database guard of 940 MB (940,000,000 bytes), reserving
at least 60 MB for
indexes, constraints, PostgreSQL overhead, EPG writes, migrations, measurement
variance, and future operational writes. A future movie provider is optional;
it may use only space inside the measured catalog allocation and must never
consume this reserved headroom.

## Configurable boundaries

The generator reads `--max-shows`, `--max-episodes-per-show`,
`--max-content-rows`, `--max-normalized-artifact-bytes`, and
`--max-estimated-database-bytes`. Their environment equivalents use uppercase
`CATALOG_` names, as documented in `.env.example`.

The budget tracker accepts a row only when the complete normalized JSON array
will remain within every applicable limit. Reaching a count limit or attempting
to cross the artifact limit produces a clean stop reason and leaves the last
valid artifact unchanged. An artifact estimate equal to the database guard is
valid; one byte above it is rejected.

The estimate is a preflight safety check, not a substitute for PostgreSQL
measurement. The final production `max-content-rows` value is **not selected
yet**. It must be selected only after the schema and importer stories allow a
representative local import.

## Required measurement

After a representative import, run:

```shell
npm run catalog:measure > data/catalog/postgresql-measurement.json
```

The report records `pg_database_size(current_database())`, heap bytes, index
bytes, and `pg_total_relation_size` for every user table. Commit the measurement
record with the chosen final row target and retain results from at least one
at-limit rehearsal. If the measured database exceeds 940 MB, reduce the row
target and repeat the import; do not raise the hard guard.
