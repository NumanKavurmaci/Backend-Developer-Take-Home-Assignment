# SaatCMS Middleware Core

A TypeScript backend prototype for OTT content metadata, playback authorization,
live-channel scheduling, and CMS operations.

Built as a backend take-home assignment using **Hono**, **Prisma**, and
**PostgreSQL 18**.

## What It Demonstrates

- Inherited metadata across `Series → Season → Episode`
- Geo-blocking and device-aware playback authorization
- Authenticated CMS CRUD for content, live channels, and EPG programs
- Concurrency-safe EPG scheduling with database-level overlap protection
- Optimistic updates using `ETag` and `If-Match`
- PostgreSQL integration, migrations, deterministic seed data, and automated tests

## Quick Start

Requirements: Node.js 24 and Docker.

```bash
npm install
cp .env.example .env
npm run db:start
npm run db:migrate
npm run db:seed
npm run dev
```

On Windows PowerShell, replace the copy command with:

```powershell
Copy-Item .env.example .env
```

The API starts at `http://localhost:3000`.

## API Overview

| Endpoint | Purpose |
| --- | --- |
| `GET /health` | Liveness check |
| `GET /ready` | Database readiness check |
| `GET /api/v1/mw/content/{contentId}` | Resolve inherited content metadata |
| `GET /api/v1/mw/playback/{contentId}` | Authorize and return playback data |
| `/api/v1/cms/content` | Content CRUD |
| `/api/v1/cms/channels` | Live-channel CRUD |
| `/api/v1/cms/channels/{channelId}/epg` | EPG program CRUD |

CMS routes require a bearer credential. Local reader, editor, and admin keys
are included in `.env.example` for demonstration only. See the
[CMS CRUD API guide](docs/api/cms-crud-api.md) for roles, request bodies,
pagination, error responses, and concurrency behavior.

## Common Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the API in watch mode |
| `npm run db:start` | Start local PostgreSQL |
| `npm run db:stop` | Stop local PostgreSQL |
| `npm run db:seed` | Load the demo dataset |
| `npm test` | Run the complete test suite |
| `npm run test:coverage` | Run tests with the coverage gate |
| `npm run typecheck` | Run TypeScript validation |

## Documentation

- [CMS CRUD API](docs/api/cms-crud-api.md)
- [OpenAPI contract](docs/api/cms-crud-openapi.yaml)
- [API examples and failure cases](docs/api/api-test-examples.md)
- [Postman collection](docs/api/saatcms-api-tests.postman_collection.json)
- [Content metadata API](docs/api/content-metadata-api.md)
- [Playback API](docs/api/mw-playback-api.md)
- [Database structure](docs/database/database-structure.md)
- [Deployment and rollback runbook](docs/ci-cd/deployment-runbook.md)
- [CI pipeline](docs/ci-cd/ci-pipeline.md)
- [Original assignment](docs/project/assignment.md)

## Verification

```bash
npm run typecheck
npm run build
npm test
npm run test:coverage
```

The test suite uses isolated PostgreSQL databases and covers domain rules,
HTTP contracts, database constraints, and concurrent EPG writes.
