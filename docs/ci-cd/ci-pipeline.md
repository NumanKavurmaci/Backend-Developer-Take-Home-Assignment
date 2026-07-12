# Continuous Integration Pipeline

The GitHub Actions workflow in [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)
uses two parallel validation lanes followed by a gated deployment rehearsal.

## Pipeline Stages

1. **Static validation** installs the locked dependency tree, generates Prisma
   Client, type-checks the source, and proves that the production build compiles.
2. **Database and test validation** starts PostgreSQL 18, applies the committed
   migration history, checks connectivity, runs the complete test suite with
   its coverage threshold, and verifies concurrent test-database isolation.
3. **Render deployment rehearsal** starts only after both validation jobs pass.
   It executes the exact build and pre-deploy commands declared in
   [`render.yaml`](../../render.yaml) against a fresh PostgreSQL service.

The two validation jobs run independently so fast compile failures and
database/test failures are reported without waiting for one another. The
deployment rehearsal uses `needs` as an explicit promotion gate and never runs
for a revision that failed validation.

## Safety and Reproducibility

- Workflow permissions are read-only.
- Third-party action execution is pinned to full commit SHAs, with the
  corresponding major versions recorded in comments for maintainability.
- Checkout credentials are not persisted because no job pushes repository
  changes.
- `npm ci` installs exactly the dependency versions in `package-lock.json`, and
  the npm download cache is keyed from that lockfile.
- Every job has a timeout and superseded runs on the same ref are cancelled.
- Tests use an isolated PostgreSQL service and explicit test environment values.
- The workflow validates deployment commands but does not deploy or seed data.
  Render remains responsible for deployment after required checks pass.

## Required Check Policy

Protect `master` and require these checks before merge:

- `Static validation`
- `Database and test validation`
- `Render deployment rehearsal`

Require pull requests and disallow bypasses for the normal development path.
Repository administrators must configure these branch rules in GitHub; the
workflow cannot enforce its own required-check policy.
