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

Compose derives resource names from the checkout by default. Set
`COMPOSE_PROJECT_NAME` to an explicit unique name and `POSTGRES_PORT` to an
unused host port when running multiple checkouts at once; containers and
volumes remain scoped to that project.

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
| `npm run deploy:setup` | Initialize and verify a disposable demo deployment end to end |
| `npm run typecheck` | Run TypeScript checks |
| `npm test` | Run the automated test suite against a disposable test database |
| `npm run test:coverage` | Run the automated test suite with the 90% line coverage gate |

Use `db:migrate` only during development. CI and production deployments use
`db:migrate:deploy`, which applies committed migrations without resetting data
or running the seed script. Application startup never migrates, resets, or
seeds the database automatically.

`db:reset` and `db:seed` share a fail-closed target guard. They require an
explicit `DEPLOYMENT_ENV`, an environment-specific host/schema policy, and a
live database identity check before any deletion. Local operations accept a
configurable database name only on a loopback PostgreSQL host with the `public`
schema outside production mode. Test operations additionally require a
generated `saatcms_test_*` database. Demo seeding requires
`NODE_ENV=production` and an exact
`DEMO_DATABASE_CONFIRMATION=<database-host>/<database-name>/public` value;
production and staging targets are always rejected. Reset does not seed
automatically, and the entire demo seed is committed atomically only after its
expected counts are verified.

## Shared Demo Deployment

[`render.yaml`](render.yaml) defines the shared demo as a Render web service
and a paid managed PostgreSQL 18 database. The database has no public IP allow
list, and Render injects its private connection string into `DATABASE_URL`
without storing credentials in Git. Paid Render PostgreSQL includes
point-in-time recovery; confirm it is active before cutover.

The deployment sequence is intentionally separate from application startup:

1. Build the application and generate Prisma Client.
2. Run `npm run db:migrate:deploy && npm run db:check` as the pre-deploy command.
3. Start the application only after migrations succeed.
4. Route traffic only after `GET /ready` can query PostgreSQL.

Migrations never seed data. For the demo environment, open a one-off service
shell and explicitly run:

```bash
DEMO_DATABASE_CONFIRMATION="actual-db-host/saatcms/public" npm run db:seed
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

For a new **disposable demo** database, the migration, connectivity check,
guarded seed, seed verification, and deployed smoke check can be run as one
operation after setting `DATABASE_URL`, `DEPLOYMENT_ENV=demo`,
`DEMO_DATABASE_CONFIRMATION`, and `DEPLOYMENT_URL`:

```bash
npm run deploy:setup
```

This command seeds data and is therefore not a production deployment command.
Use `npm run db:migrate:deploy` followed by read-only checks for production.

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

`GET /health` only confirms the process is alive. `GET /ready` applies a short
query timeout and verifies required relations, the latest completed migration,
and the absence of unfinished or rolled-back migration records.

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

Each Vitest process derives a unique `saatcms_test_<run-id>_<uuid>` database
from `.env.test`, creates it through a local maintenance connection, applies
committed migrations, and drops it in teardown. Destructive cleanup requires
`NODE_ENV=test`, a loopback host, the generated name prefix, and a matching live
database/schema identity. Separate terminals and worktrees therefore cannot
delete one another's fixtures.

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

GitHub Actions runs pull requests and pushes to `master`, cancelling superseded
runs. The coverage command is the single complete suite execution. CI also
checks concurrent test isolation and runs the exact Render build and pre-deploy
commands under `NODE_ENV=production` in a separate clean job.
