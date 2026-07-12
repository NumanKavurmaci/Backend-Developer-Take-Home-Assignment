# SaatCMS Middleware Core

Prototype backend for the SaatCMS OTT middleware assignment.

The project implements the core middleware and CMS scheduling concerns from the case study: inherited content metadata, EPG overlap validation, playback request authorization, local persistence, repeatable seed data, and focused automated tests.

## Highlights

| Area | Implemented |
| --- | --- |
| Runtime | TypeScript, Hono, Prisma, PostgreSQL 18 |
| Health check | `GET /health` liveness and `GET /ready` database readiness |
| Metadata inheritance | `Series -> Season -> Episode` resolution |
| Content metadata API | `GET /api/v1/mw/content/{contentId}` |
| Playback API | `GET /api/v1/mw/playback/{contentId}` with request headers |
| CMS EPG API | `POST /api/v1/cms/channels/{channelId}/epg` |
| EPG validation | ISO date-time parsing, UTC normalization, overlap blocking |
| Concurrency model | Per-channel lock row plus PostgreSQL exclusion constraint |
| Observability | `X-Request-Id` correlation and structured request logs |
| Tests | Domain, service, and route coverage |

## Quick Start

```bash
npm install
cp .env.example .env
npm run db:start
npm run db:migrate
npm run db:seed
npm run dev
```

On Windows PowerShell, use `Copy-Item .env.example .env` instead of `cp .env.example .env`.

The API runs locally at:

```text
http://localhost:3000
```

The active Prisma schema and committed migration history target PostgreSQL.

### Local PostgreSQL

Docker Compose runs PostgreSQL 18 on `localhost:5432` and initializes two
databases:

- `saatcms` for local development;
- `saatcms_test` for automated tests.

The credentials in `compose.yaml`, `.env.example`, and `.env.test` are
local/test-only values. Deployed environments must provide secrets through
their hosting platform.

Start PostgreSQL and wait for its health check:

```bash
npm run db:start
```

Stop PostgreSQL while preserving its named volume:

```bash
npm run db:stop
```

For a full local reset, stop PostgreSQL and delete the named volume. This is
destructive and removes both local databases:

```bash
npm run db:destroy
```

## Useful Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Hono server in watch mode |
| `npm run db:start` | Start PostgreSQL 18 and wait until it is healthy |
| `npm run db:stop` | Stop local PostgreSQL and preserve its data |
| `npm run db:destroy` | Stop PostgreSQL and delete its local named volume |
| `npm run db:setup` | Generate Prisma Client and run development migrations |
| `npm run db:migrate` | Create/apply migrations locally with `prisma migrate dev` |
| `npm run db:migrate:deploy` | Apply committed migrations in CI or production without seeding |
| `npm run db:reset` | **Destructively** reset a local/test database; never use in production |
| `npm run db:seed` | Explicitly replace local/demo data with the repeatable sample dataset |
| `npm run db:seed:verify` | Verify the expected demo records exist |
| `npm run db:test` | Run the disposable test database checks and DB-backed domain tests |
| `npm run deploy:smoke` | Run deployed API and HTTP concurrency checks using `DEPLOYMENT_URL` |
| `npm run typecheck` | Run TypeScript checks |
| `npm test` | Run the automated test suite against a disposable test database |
| `npm run test:coverage` | Run the automated test suite with the 90% line coverage gate |

Use `db:migrate` only during development. CI and production deployments use
`db:migrate:deploy`, which applies committed migrations without resetting data
or running the seed script. Application startup never migrates, resets, or
seeds the database automatically.

`db:reset` is destructive and is restricted to local development or the
disposable test database. It does not seed automatically. Sample data is
created only through a separate `db:seed` operation, and the seed refuses to
run when `DEPLOYMENT_ENV=production`.

## Shared Demo Deployment

[`render.yaml`](render.yaml) defines the shared demo as a Render web service
and a paid managed PostgreSQL 18 database. The database has no public IP allow
list, and Render injects its private connection string into `DATABASE_URL`
without storing credentials in Git. Paid Render PostgreSQL includes
point-in-time recovery; confirm it is active before cutover.

The deployment sequence is intentionally separate from application startup:

1. Build the application and generate Prisma Client.
2. Run `npm run db:migrate:deploy` as the pre-deploy command.
3. Start the application only after migrations succeed.
4. Route traffic only after `GET /ready` can query PostgreSQL.

Migrations never seed data. For the demo environment, open a one-off service
shell and explicitly run:

```bash
npm run db:seed
npm run db:seed:verify
```

Then verify the deployed service from a clean checkout:

```bash
npm ci
DEPLOYMENT_URL=https://your-service.example.com npm run deploy:smoke
```

PowerShell equivalent:

```powershell
npm ci
$env:DEPLOYMENT_URL="https://your-service.example.com"
npm run deploy:smoke
```

Provisioning, rehearsal, backup/restore, cutover, and rollback instructions are
in the [deployment runbook](docs/deployment-runbook.md).

## API Surface

| Endpoint | Purpose | Details |
| --- | --- | --- |
| `GET /health` | Liveness check | This README |
| `GET /ready` | Database readiness check | This README |
| `GET /api/v1/mw/content/{contentId}` | Resolve inherited content metadata | [Content metadata API](docs/api/content-metadata-api.md) |
| `POST /api/v1/cms/channels/{channelId}/epg` | Create an EPG program for a live channel | [CMS EPG program API](docs/api/cms-epg-program-api.md) |
| `GET /api/v1/mw/playback/{contentId}` | Request playback after geo and device checks | [Middleware playback API](docs/api/mw-playback-api.md) |

Reviewer-ready cURL examples and Postman requests are collected in [API test examples](docs/api/api-test-examples.md). The importable Postman collection lives at [docs/api/saatcms-api-tests.postman_collection.json](docs/api/saatcms-api-tests.postman_collection.json).

## Health Check

```bash
curl http://localhost:3000/health
```

```json
{
  "status": "ok",
  "service": "saatcms-middleware-core"
}
```

## Readiness Check

```bash
curl http://localhost:3000/ready
```

```json
{
  "status": "ready",
  "service": "saatcms-middleware-core"
}
```

`GET /health` only confirms the process is alive. `GET /ready` also checks database connectivity.

## Request Correlation

Every response includes `X-Request-Id`. If the caller sends `X-Request-Id`, the same value is returned; otherwise the API generates one. Request logs are structured JSON with `requestId`, `method`, `path`, `status`, `durationMs`, and `errorCode` when applicable.

## Documentation

| Topic | Document |
| --- | --- |
| API test examples | [docs/api/api-test-examples.md](docs/api/api-test-examples.md) |
| Postman collection | [docs/api/saatcms-api-tests.postman_collection.json](docs/api/saatcms-api-tests.postman_collection.json) |
| Content metadata API | [docs/api/content-metadata-api.md](docs/api/content-metadata-api.md) |
| CMS EPG program API | [docs/api/cms-epg-program-api.md](docs/api/cms-epg-program-api.md) |
| Middleware playback API | [docs/api/mw-playback-api.md](docs/api/mw-playback-api.md) |
| Database structure | [docs/database-structure.md](docs/database-structure.md) |
| Deployment and rollback runbook | [docs/deployment-runbook.md](docs/deployment-runbook.md) |
| Content domain | [docs/domain/content-domain-index.md](docs/domain/content-domain-index.md) |
| Live channel domain | [docs/domain/live-channel-domain-index.md](docs/domain/live-channel-domain-index.md) |
| Assignment notes | [docs/project/assignment.md](docs/project/assignment.md) |
| Assignment PDF | [docs/project/Saat_Teknoloji_CMS_MW_Assignment_Final.pdf](docs/project/Saat_Teknoloji_CMS_MW_Assignment_Final.pdf) |
| Project steps | [docs/project/project-steps.md](docs/project/project-steps.md) |
| Technical improvement recommendations | [docs/project/SaatCMS_Technical_Improvement_Recommendations.md](docs/project/SaatCMS_Technical_Improvement_Recommendations.md) |
| Post-release fixes | [docs/project/post-release-fixes.md](docs/project/post-release-fixes.md) |

## Project Structure

```text
src/
  content/                      Content hierarchy and metadata inheritance logic
  live-channel/                 Live channel and EPG program domain logic
  modules/
    cms-epg-program/            CMS EPG HTTP module
    mw-content/                 Middleware content metadata HTTP module
    mw-playback/                Middleware playback HTTP module
  shared/http/                  Shared HTTP error handling
  db/                           Prisma client and database checks
docs/                           API, domain, database, and project notes
prisma/                         Prisma schema, migrations, and seed data
```

## Verification

```bash
npm run typecheck
npm run db:test
npm test
npm run test:coverage
```

The tests use `.env.test` and rebuild the dedicated `saatcms_test` PostgreSQL database from committed migrations. Destructive cleanup requires `NODE_ENV=test`, refuses non-local hosts and any database not named `saatcms_test`, and verifies the live Prisma connection's database and schema before deleting data. Suite teardown clears application tables while preserving the committed migration history and disconnects its Prisma client.

Coverage includes application source under `src` and excludes tests, test helpers, docs-only checks, generated/build output, and CLI entrypoints that start long-running processes. The global line coverage threshold is 90%.

## Migration Responsibilities

| Environment | Migration owner | Seeding |
| --- | --- | --- |
| Local development | Developer runs `npm run db:migrate` | Explicit `npm run db:seed` |
| Automated tests | Test setup rebuilds the guarded `saatcms_test` database | Test fixtures only |
| CI | GitHub Actions runs `npm run db:migrate:deploy` before the quality gate | Never |
| Shared deployment | Render runs `npm run db:migrate:deploy` in the pre-deploy phase | Explicit demo-only command |
| Application startup | Never migrates or resets the database | Never |

Migration, build, test, or readiness failures block deployment. The previous
application remains active because migrations run before the new release is
routed traffic.

## CI Quality Gate

GitHub Actions runs on every push and pull request. It starts PostgreSQL,
generates Prisma Client, deploys committed migrations, proves the active
PostgreSQL connection, runs database constraint and concurrency tests,
typechecks, runs the complete test and coverage gates, and builds production
output.
