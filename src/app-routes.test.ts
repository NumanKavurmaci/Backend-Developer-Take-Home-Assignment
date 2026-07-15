import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";

const expectedEndpoints = [
  "GET /",
  "GET /health",
  "GET /ready",
  "GET /openapi/mw.yaml",
  "GET /openapi/cms.yaml",
  "GET /api/v1/mw/content/:contentId",
  "GET /api/v1/mw/playback/:contentId",
  "POST /api/v1/cms/content",
  "GET /api/v1/cms/content",
  "GET /api/v1/cms/content/:id",
  "PATCH /api/v1/cms/content/:id",
  "DELETE /api/v1/cms/content/:id",
  "POST /api/v1/cms/channels",
  "GET /api/v1/cms/channels",
  "GET /api/v1/cms/channels/:channelId",
  "PATCH /api/v1/cms/channels/:channelId",
  "DELETE /api/v1/cms/channels/:channelId",
  "POST /api/v1/cms/channels/:channelId/epg",
  "GET /api/v1/cms/channels/:channelId/epg",
  "GET /api/v1/cms/channels/:channelId/epg/:programId",
  "PATCH /api/v1/cms/channels/:channelId/epg/:programId",
  "DELETE /api/v1/cms/channels/:channelId/epg/:programId",
].sort();

describe("application route registration", () => {
  it("registers the reviewed endpoint inventory", () => {
    expect(readEndpointRoutes()).toEqual(expectedEndpoints);
  });

  it("does not register duplicate method and normalized path pairs", () => {
    const routeCounts = new Map<string, number>();

    for (const route of readEndpointRoutes()) {
      const [method, path] = route.split(" ", 2);
      const normalizedRoute = `${method} ${normalizeRoutePath(path)}`;
      routeCounts.set(normalizedRoute, (routeCounts.get(normalizedRoute) ?? 0) + 1);
    }

    const duplicates = [...routeCounts.entries()]
      .filter(([, count]) => count > 1)
      .map(([route]) => route);

    expect(duplicates).toEqual([]);
  });
});

function readEndpointRoutes(): string[] {
  const app = createApp({
    cmsSecurity: {
      credentials: [],
      authenticationAttemptLimitPerMinute: 1,
      maxBodyBytes: 1_000,
      mutationsEnabled: true,
      rateLimitPerMinute: 1,
    },
  });

  return app.routes
    .filter(({ method }) => method !== "ALL")
    .map(({ method, path }) => `${method} ${path}`)
    .sort();
}

function normalizeRoutePath(path: string): string {
  const withoutTrailingSlash = path.length > 1 ? path.replace(/\/+$/, "") : path;

  return withoutTrailingSlash.replace(/:[^/]+/g, ":parameter");
}
