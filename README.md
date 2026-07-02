# SaatCMS Middleware Core

Prototype backend for the SaatCMS OTT middleware assignment.

## Current Status

The project currently has:

- TypeScript project setup
- SQLite + Prisma local database setup
- Seed data for content, geo-blocking, device rules, live channels, and EPG programs
- Hono application scaffold
- Health-check endpoint

The content metadata endpoint is intentionally not added yet.

## Run Locally

Install dependencies:

```bash
npm install
```

Create and seed the local database:

```bash
npm run db:reset
npm run db:seed
```

Start the Hono development server:

```bash
npm run dev
```

Health check:

```http
GET /health
```

Example:

```bash
curl http://localhost:3000/health
```

Response:

```json
{
  "status": "ok",
  "service": "saatcms-middleware-core"
}
```

## Checks

Run TypeScript checks:

```bash
npm run typecheck
```

Run tests:

```bash
npm test
```
