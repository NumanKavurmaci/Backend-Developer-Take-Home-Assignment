# OpenAPI Documentation Delivery Plan

## Goal

Make the repository's existing middleware and CMS OpenAPI contracts available
from the deployed Hono service and provide one interactive documentation page
at `/docs`.

## Design Decisions

- Keep the checked-in YAML files as the source of truth. Do not generate a
  second contract from route code or duplicate the schemas in TypeScript.
- Publish each contract at a stable, read-only HTTP endpoint:
  - `/openapi/mw.yaml`
  - `/openapi/cms.yaml`
- Render `/docs` with Hono's Swagger UI middleware and configure its contract
  selector with both published endpoints.
- Keep documentation routes public. They describe the API but do not contain
  credentials, and CMS authorization remains enforced by the existing CMS
  middleware.
- Resolve contract files from the repository root so local development,
  compiled execution, CI, and Render use the same checked-in artifacts.

## Execution Steps

1. Add a documentation module that serves both YAML contracts with the correct
   OpenAPI media type and explicit cache behavior.
2. Add route tests proving both contracts are reachable and retain their
   expected OpenAPI titles and versions.
3. Add `@hono/swagger-ui` and register `/docs` with a selector for the
   middleware and CMS contracts.
4. Add tests for the Swagger UI response and its configured contract URLs.
5. Register the documentation module in the application and update the route
   inventory guard.
6. Update the README with local and deployed documentation URLs.
7. Run type checking, the production build, the focused documentation tests,
   and the complete test suite.

## Delivery Strategy

Use small commits so each change can be reviewed independently:

1. Plan the OpenAPI documentation delivery.
2. Expose the OpenAPI YAML contracts.
3. Add the interactive Swagger UI.
4. Document and verify the public documentation surface.

## Out of Scope

- Rewriting the existing contracts with a schema-generation framework.
- Combining the middleware and CMS contracts into a new third specification.
- Changing API behavior, CMS authorization, or deployment credentials.
- Opening the pull request; the published feature branch will be reviewed and
  opened separately.

