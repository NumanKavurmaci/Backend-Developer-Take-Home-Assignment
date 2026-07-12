# Local TVmaze Source Client

The TVmaze source client is a development-only utility under `scripts/catalog`.
Application startup, Prisma migrations, demo seeding, CI, and Render deployment
do not import it or invoke catalog fetching. Only an explicit future local
catalog-build command may contact TVmaze.

TVmaze documents a public limit of at least 20 calls per 10 seconds per IP. The
client uses a 550 ms minimum start interval, sends the identifying User-Agent
`SaatCMS-Catalog/0.1`, and serializes request starts even when callers submit
concurrent work. It retries only HTTP 429, 500, 502, 503, and 504 responses and
fetch-level network/timeouts. HTTP 429 honors a numeric `Retry-After` value;
otherwise bounded exponential backoff applies. Defaults are six attempts, a
45-second per-attempt timeout, and a 30-second maximum retry delay.

Successful JSON responses are cached under `.cache/catalog/tvmaze-v1`, which is
gitignored. Cache identity is SHA-256 over the HTTP method and canonical URL,
including deterministically sorted parameters. Filenames contain only a safe
operation label and digest. Request URLs, parameters, headers, credentials, and
database configuration are never written alongside cached data.

Offline mode performs no fetches. It returns the matching cached JSON or fails
with the provider, operation, and digest-based cache key needed to populate the
entry online. Malformed upstream or cached JSON fails safely and is never
accepted as a source response. Errors omit request URLs, response bodies, and
underlying fetch messages so query parameters and secrets cannot leak through
logs.

References: [TVmaze API rate limiting and licensing](https://www.tvmaze.com/api).
