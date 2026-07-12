# Managed PostgreSQL Deployment Runbook

This runbook covers the shared demo deployment declared in
[`render.yaml`](../render.yaml). It is also the checklist for a staging
rehearsal and production-style cutover. Record the operator, timestamps,
deployment URL, database identifier, backup identifier, and application commit
in the deployment ticket.

## Architecture and Safety Controls

- Render provisions PostgreSQL 18 on the paid `basic-256mb` plan.
- `ipAllowList: []` blocks public database connections. The application uses
  Render's private network connection string.
- `DATABASE_URL` is a `fromDatabase` secret reference. No database password is
  committed to this repository.
- Paid Render PostgreSQL has point-in-time recovery (PITR). Confirm the Recovery
  page shows an active recovery window before cutover.
- The web service uses `/ready` as its deploy health check. With a short query
  timeout, it verifies required relations and completed migration history and
  returns `503 DATABASE_NOT_READY` for connectivity or schema incompatibility.
- Application startup uses `npm start`; it does not migrate, seed, reset, or
  open a local database file.

## Provision the Shared Demo

1. In Render, create a Blueprint from this repository and review the resources
   from `render.yaml` before applying it.
2. Confirm the database is PostgreSQL 18, paid, in `frankfurt`, and has an empty
   external IP allow list.
3. Confirm the web service's `DATABASE_URL` is sourced from
   `saatcms-postgres-demo`; do not paste a URL into source control.
4. Confirm `NODE_ENV=production` and `DEPLOYMENT_ENV=demo`.
5. Confirm the database Recovery page shows PITR before sending traffic.
6. Deploy. The pre-deploy log must show `prisma migrate deploy`. Do not proceed
   if any migration fails.
7. Confirm the service becomes healthy through `/ready`.

Creating the Blueprint requires Render workspace access and may create paid
resources. Repository changes alone do not prove that provisioning occurred.

## Staging Cutover Rehearsal

Use separate staging resources with the same PostgreSQL major version and
network rules.

1. Provision an empty managed PostgreSQL database.
2. Attach its private connection string to a staging service as the
   `DATABASE_URL` secret.
3. Deploy the candidate commit and confirm the pre-deploy phase applies every
   committed migration to the empty database.
4. From a one-off staging shell, run `npm run db:check`. Record the database
   name, database user, and PostgreSQL version from its output.
5. For demo staging only, run
   `DEMO_DATABASE_CONFIRMATION="actual-db-host/saatcms/public" npm run db:seed`
   (using the host from `DATABASE_URL`), followed by
   `npm run db:seed:verify`. Expected counts are six content records, two live
   channels, and three EPG programs.
6. From a clean checkout, run the read-only deployed smoke suite:

   ```bash
   npm ci
   DEPLOYMENT_URL=https://staging-service.example.com npm run deploy:smoke
   ```

7. Restart the staging web service without reseeding. Run
   `npm run deploy:smoke` again; `/ready` and seeded metadata must still work.
   This proves data is held by managed PostgreSQL rather than application disk.

The smoke suite checks `/health`, `/ready`, inherited metadata, allowed
playback, geo blocking, and device blocking. Every request has a ten-second
timeout. EPG write/concurrency checks run in CI against disposable isolated test
databases; deployed smoke checks remain read-only and leave no residual rows.

## Backup and Restore Rehearsal

Complete this before cutover.

1. In the database Recovery page, create a logical export or select a PITR
   timestamp and record its identifier.
2. Restore into a new isolated PostgreSQL instance. Never test restore by
   overwriting the active database.
3. Point a temporary staging service at the restored database using a secret.
4. Run `npm run db:check`, `npm run db:seed:verify`, and the read-only health,
   readiness, metadata, and playback checks.
5. Record the restore duration and verified record counts, then remove the
   temporary service and database.

## Cutover

1. Confirm CI is green for the exact commit being deployed.
2. Confirm the staging rehearsal, concurrent request test, restart test, and
   backup/restore rehearsal are recorded as passed.
3. Confirm PITR is active and create or record a fresh pre-cutover recovery
   point.
4. Deploy the candidate. Render runs `npm run db:migrate:deploy` before the new
   application revision receives traffic.
5. Confirm the migration log contains no failed migration and `/ready` returns
   `200`.
6. Seed only when this is a disposable demo environment and sample data is
   intentionally required. Never seed production.
7. Run `npm run db:seed:verify` after demo seeding and run the complete deployed
   smoke suite.
8. Restart the service and confirm readiness and data are unchanged.
9. Observe error rate and `DATABASE_NOT_READY` logs during the agreed validation
   window.

## Rollback

Application and database rollback are separate decisions.

1. Stop or block new writes if database integrity is in doubt.
2. If the schema remains compatible, redeploy the previous application commit
   and repeat `/health`, `/ready`, metadata, and playback checks.
3. Never run `prisma migrate reset`, delete migration rows, reverse SQL by hand,
   or point the old SQLite application at PostgreSQL.
4. If data or schema restoration is required, create a new database from the
   recorded PITR point or logical backup. Validate that restored instance in
   isolation.
5. Update the platform `DATABASE_URL` secret reference to the validated restored
   database, redeploy the matching application revision, and rerun smoke tests.
6. Keep the failed database isolated for investigation. Delete it only after
   the incident owner approves.
7. Record the recovery point, data-loss window, rollback duration, and final
   database/application versions.

Prefer a forward-fix migration when it is safe. PostgreSQL migrations in this
project are intentionally not auto-reversed.

## Responsibility Matrix

| Phase               | Responsibility                                                                                |
| ------------------- | --------------------------------------------------------------------------------------------- |
| Development         | Create and review migrations with `prisma migrate dev`.                                       |
| CI                  | Apply migrations to fresh PostgreSQL and block invalid migrations or failing tests.           |
| Deployment          | Apply committed migrations with `prisma migrate deploy` before traffic moves.                 |
| Demo initialization | An operator explicitly runs the guarded seed and verifies counts.                             |
| Runtime             | Serve requests and report PostgreSQL schema compatibility through `/ready`.                  |
| Recovery            | An operator restores into an isolated database and switches the secret only after validation. |
