import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { errorHandler, notFoundHandler } from "../../shared/http/error-handler.js";
import { ApiError } from "../../shared/http/api-error.js";
import {
  CONTENT_TYPES,
  VIDEO_QUALITIES,
} from "../../shared/domain/domain-contracts.js";
import { MwContentController } from "./mw-content.controller.js";
import { createMwContentRoutes } from "./mw-content.route.js";
import {
  toPublicContentResponse,
  type MwContentService,
} from "./mw-content.service.js";

function expectNoPlaybackUrl(value: unknown): void {
  expect(JSON.stringify(value)).not.toContain("playbackUrl");
}

function createTestApp(service: Pick<MwContentService, "getResolvedContent">) {
  const app = new Hono();

  app.onError(errorHandler);
  app.notFound(notFoundHandler);
  app.route(
    "/api/v1/mw/content",
    createMwContentRoutes(new MwContentController(service as MwContentService)),
  );

  return app;
}

describe("content metadata API routes", () => {
  it("returns resolved content metadata from the middleware route", async () => {
    const getResolvedContent = vi.fn().mockResolvedValue({
      contentId: "episode-galactic-odyssey-s1e2",
      type: CONTENT_TYPES.EPISODE,
      title: "Dark Side Relay",
      parentalRating: "16+",
      genre: "Space Adventure",
      quality: VIDEO_QUALITIES.HD,
      isPremium: false,
      geoBlockCountries: ["IR", "SY"],
    });

    const response = await createTestApp({ getResolvedContent }).request(
      "/api/v1/mw/content/episode-galactic-odyssey-s1e2",
    );

    const body = await response.json();

    expect(body).toEqual({
      contentId: "episode-galactic-odyssey-s1e2",
      type: CONTENT_TYPES.EPISODE,
      title: "Dark Side Relay",
      parentalRating: "16+",
      genre: "Space Adventure",
      quality: VIDEO_QUALITIES.HD,
      isPremium: false,
      geoBlockCountries: ["IR", "SY"],
    });
    expectNoPlaybackUrl(body);
    expect(response.status).toBe(200);
    expect(getResolvedContent).toHaveBeenCalledWith(
      "episode-galactic-odyssey-s1e2",
    );
  });

  it("maps internal metadata to a public response without playbackUrl", () => {
    const response = toPublicContentResponse({
      contentId: "episode-galactic-odyssey-s1e2",
      type: CONTENT_TYPES.EPISODE,
      title: "Dark Side Relay",
      parentalRating: "16+",
      genre: "Space Adventure",
      quality: VIDEO_QUALITIES.HD,
      isPremium: false,
      playbackUrl: "https://cdn.saatcms.test/galactic-odyssey/s1/e2.m3u8",
      geoBlockCountries: ["IR", "SY"],
    });

    expect(response).toEqual({
      contentId: "episode-galactic-odyssey-s1e2",
      type: CONTENT_TYPES.EPISODE,
      title: "Dark Side Relay",
      parentalRating: "16+",
      genre: "Space Adventure",
      quality: VIDEO_QUALITIES.HD,
      isPremium: false,
      geoBlockCountries: ["IR", "SY"],
    });
    expectNoPlaybackUrl(response);
  });

  it("returns a consistent 404 response when content is missing", async () => {
    const getResolvedContent = vi.fn().mockRejectedValue(
      new ApiError(404, "CONTENT_NOT_FOUND", "Content not found"),
    );

    const response = await createTestApp({ getResolvedContent }).request(
      "/api/v1/mw/content/missing-content",
    );

    await expect(response.json()).resolves.toEqual({
      errorCode: "CONTENT_NOT_FOUND",
      message: "Content not found",
    });
    expect(response.status).toBe(404);
  });
});
