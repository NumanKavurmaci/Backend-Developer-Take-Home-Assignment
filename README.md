# SaatCMS Middleware Core

Prototype backend for the SaatCMS OTT middleware assignment.

The project implements the core middleware and CMS scheduling concerns from the case study: inherited content metadata, EPG overlap validation, playback request authorization, local persistence, repeatable seed data, and focused automated tests.

## Highlights

| Area | Implemented |
| --- | --- |
| Runtime | TypeScript, Hono, Prisma, SQLite |
| Health check | `GET /health` |
| Metadata inheritance | `Series -> Season -> Episode` resolution |
| Content metadata API | `GET /api/v1/mw/content/{contentId}` |
| Playback API | `GET /api/v1/mw/playback/{contentId}` with request headers |
| CMS EPG API | `POST /api/v1/cms/channels/{channelId}/epg` |
| EPG validation | ISO date-time parsing, UTC normalization, overlap blocking |
| Concurrency model | Transactional per-channel schedule lock |
| Tests | Domain, service, and route coverage |

## Quick Start

```bash
npm install
cp .env.example .env
npm run db:reset
npm run db:seed
npm run dev
```

On Windows PowerShell, use `Copy-Item .env.example .env` instead of `cp .env.example .env`.

The API runs locally at:

```text
http://localhost:3000
```

## Useful Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Hono server in watch mode |
| `npm run db:reset` | Recreate the local SQLite database |
| `npm run db:seed` | Insert repeatable sample data |
| `npm run db:test` | Run the disposable test database checks and DB-backed domain tests |
| `npm run typecheck` | Run TypeScript checks |
| `npm test` | Run the automated test suite against a disposable test database |

## API Surface

| Endpoint | Purpose | Details |
| --- | --- | --- |
| `GET /health` | Service health check | This README |
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

## Documentation

| Topic | Document |
| --- | --- |
| API test examples | [docs/api/api-test-examples.md](docs/api/api-test-examples.md) |
| Postman collection | [docs/api/saatcms-api-tests.postman_collection.json](docs/api/saatcms-api-tests.postman_collection.json) |
| Content metadata API | [docs/api/content-metadata-api.md](docs/api/content-metadata-api.md) |
| CMS EPG program API | [docs/api/cms-epg-program-api.md](docs/api/cms-epg-program-api.md) |
| Middleware playback API | [docs/api/mw-playback-api.md](docs/api/mw-playback-api.md) |
| Database structure | [docs/database-structure.md](docs/database-structure.md) |
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
```

The tests use `.env.test` and create a disposable SQLite database at `data/test.db`. The suite recreates that database before tests and removes it afterward. Destructive test cleanup has a safety guard and refuses to run against the development database at `data/dev.db`.
