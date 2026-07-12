# Local Catalog Build Command

RLD-07A connects the cached TVmaze client, response decoder, hierarchy
normalizer, minimal demo policies, storage guards, artifact writer, and
database-free validator. It is the only workflow authorized to contact TVmaze.

The no-argument build defaults are deliberately a rehearsal: 5 Shows, 50
regular Episodes per Show, 500 Content rows, and one TVmaze Show-index page.
Increase these only after inspecting the resulting manifest and, later,
measuring a representative PostgreSQL load.

On shells where npm forwards arguments normally:

```shell
npm run catalog:build -- --max-shows=5 --max-episodes-per-show=50 --max-content-rows=500 --max-pages=1 --output-dir=data/catalog/current
```

The installed Windows npm version may consume unknown `--name=value` flags
instead of forwarding them. In PowerShell, use environment variables with the
npm command:

```powershell
$env:CATALOG_MAX_SHOWS="5"
$env:CATALOG_MAX_EPISODES_PER_SHOW="50"
$env:CATALOG_MAX_CONTENT_ROWS="500"
$env:CATALOG_TVMAZE_MAX_PAGES="1"
$env:CATALOG_OUTPUT_DIR="data/catalog/current"
npm run catalog:build
```

Alternatively, the underlying cross-platform CLI accepts the options directly:

```shell
npx tsx scripts/catalog/build-catalog.ts --max-shows=5 --max-episodes-per-show=50 --max-content-rows=500 --max-pages=1 --output-dir=data/catalog/current
```

Replay only cached responses by setting `CATALOG_OFFLINE=true` or passing
`--offline` to the underlying CLI. The output target must not already exist;
the writer refuses replacement rather than deleting an artifact implicitly.

Validate completed output independently:

```shell
npm run catalog:validate -- data/catalog/current
```

## First live rehearsal

The first live request exposed TVmaze Season `0`, a specials container. RLD-05
already excluded null/non-positive Episode numbering, so the build command now
also excludes non-positive Season records and records their Episodes as
excluded. The cached Show was then replayed offline and produced a valid
artifact with 1 Series, 3 Seasons, 39 Episodes, and 2 geo-block rows. No database
was contacted.

The exact no-argument `npm run catalog:build` rehearsal then produced and
validated `data/catalog/current` with 5 Series, 24 Seasons, 202 Episodes, and 10
geo-block rows. The artifact is 239,042 normalized bytes and 42,389 compressed
bytes, with a conservative estimated database size of 877,805 bytes. OneDrive
briefly returned a transient Windows `EPERM` during directory publication, so
the atomic final rename now uses bounded retries for `EPERM`/`EBUSY`; it never
falls back to copying or accepts partial output.
