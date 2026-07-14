import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { CONTENT_TYPES } from "../../shared/domain/domain-contracts.js";
import { errorHandler, notFoundHandler } from "../../shared/http/error-handler.js";
import { CmsContentController } from "./cms-content.controller.js";
import { createCmsContentRoutes } from "./cms-content.route.js";
import type { CmsContentService } from "./cms-content.service.js";

const timestamp = new Date("2026-07-12T12:00:00.000Z");
const movie = {
  id: "movie-route",
  type: CONTENT_TYPES.MOVIE,
  title: "Route Movie",
  parentId: null,
  parentalRating: null,
  genre: null,
  quality: null,
  isPremium: null,
  playbackUrl: null,
  geoBlockCountriesOverride: false,
  geoBlockCountries: [],
  createdAt: timestamp,
  updatedAt: timestamp,
};

function createTestApp(service: Partial<CmsContentService>) {
  const app = new Hono();

  app.onError(errorHandler);
  app.notFound(notFoundHandler);
  app.route(
    "/api/v1/cms/content",
    createCmsContentRoutes(
      new CmsContentController(service as CmsContentService),
    ),
  );

  return app;
}

describe("CMS content API routes", () => {
  it("creates content and returns its version ETag", async () => {
    const createContent = vi.fn().mockResolvedValue(movie);
    const response = await createTestApp({ createContent }).request(
      "/api/v1/cms/content",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "MOVIE", title: "Route Movie" }),
      },
    );

    expect(response.status).toBe(201);
    expect(response.headers.get("ETag")).toBe(
      '"2026-07-12T12:00:00.000Z"',
    );
    await expect(response.json()).resolves.toMatchObject({
      id: "movie-route",
      title: "Route Movie",
    });
    expect(createContent).toHaveBeenCalledWith({
      type: "MOVIE",
      title: "Route Movie",
    });
  });

  it("gets and lists content", async () => {
    const getContent = vi.fn().mockResolvedValue(movie);
    const listContent = vi.fn().mockResolvedValue({
      items: [movie],
      page: 2,
      pageSize: 5,
      total: 8,
    });
    const app = createTestApp({ getContent, listContent });

    const getResponse = await app.request(
      "/api/v1/cms/content/movie-route",
    );
    const listResponse = await app.request(
      "/api/v1/cms/content?type=MOVIE&title=route&page=2&pageSize=5",
    );

    expect(getResponse.status).toBe(200);
    expect(getResponse.headers.get("ETag")).toBe(
      '"2026-07-12T12:00:00.000Z"',
    );
    expect(getContent).toHaveBeenCalledWith("movie-route");
    expect(listResponse.status).toBe(200);
    expect(listContent).toHaveBeenCalledWith({
      type: "MOVIE",
      title: "route",
      page: "2",
      pageSize: "5",
    });
  });

  it("patches content with the supplied precondition", async () => {
    const updated = { ...movie, title: "Updated Movie" };
    const updateContent = vi.fn().mockResolvedValue(updated);
    const response = await createTestApp({ updateContent }).request(
      "/api/v1/cms/content/movie-route",
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "If-Match": '"2026-07-12T12:00:00.000Z"',
        },
        body: JSON.stringify({ title: "Updated Movie" }),
      },
    );

    expect(response.status).toBe(200);
    expect(updateContent).toHaveBeenCalledWith(
      "movie-route",
      { title: "Updated Movie" },
      '"2026-07-12T12:00:00.000Z"',
    );
  });

  it("deletes content with an empty 204 response", async () => {
    const deleteContent = vi.fn().mockResolvedValue(undefined);
    const response = await createTestApp({ deleteContent }).request(
      "/api/v1/cms/content/movie-route",
      { method: "DELETE" },
    );

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(deleteContent).toHaveBeenCalledWith("movie-route");
  });

  it("rejects invalid JSON before calling the service", async () => {
    const createContent = vi.fn();
    const response = await createTestApp({ createContent }).request(
      "/api/v1/cms/content",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{",
      },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      errorCode: "INVALID_REQUEST_BODY",
      message: "Request body must be valid JSON",
    });
    expect(createContent).not.toHaveBeenCalled();
  });
});
