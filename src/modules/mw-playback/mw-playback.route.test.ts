import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { CONTENT_TYPES } from "../../content/content-types.js";
import { VIDEO_QUALITIES } from "../../content/content-metadata.js";
import { type ResolvedContentMetadata } from "../../content/metadata-inheritance.js";
import { DomainError } from "../../shared/domain/domain-error.js";
import {
  errorHandler,
  notFoundHandler,
} from "../../shared/http/error-handler.js";
import { MwPlaybackController } from "./mw-playback.controller.js";
import { createMwPlaybackRoutes } from "./mw-playback.route.js";
import { MwPlaybackService } from "./mw-playback.service.js";

function expectNoPlaybackUrl(value: unknown): void {
  expect(JSON.stringify(value)).not.toContain("playbackUrl");
}

function createResolvedContentMetadata(
  contentId: string,
  overrides: Partial<ResolvedContentMetadata> = {},
): ResolvedContentMetadata {
  return {
    contentId,
    type: CONTENT_TYPES.EPISODE,
    title: "Dark Side Relay",
    parentalRating: "16+",
    genre: "Space Adventure",
    quality: VIDEO_QUALITIES.HD,
    isPremium: false,
    playbackUrl: "https://cdn.saatcms.test/galactic-odyssey/s1/e2.m3u8",
    geoBlockCountries: ["IR", "SY"],
    ...overrides,
  };
}

function createTestService() {
  return new MwPlaybackService(async (contentId) => {
    if (contentId === "missing-content") {
      throw new DomainError("CONTENT_NOT_FOUND", "Content not found");
    }

    if (contentId === "premium-4k-content") {
      return createResolvedContentMetadata(contentId, {
        isPremium: true,
        quality: VIDEO_QUALITIES.UHD_4K,
        playbackUrl: "https://cdn.saatcms.test/premium/4k.m3u8",
        geoBlockCountries: [],
      });
    }

    if (contentId === "premium-hd-content") {
      return createResolvedContentMetadata(contentId, {
        isPremium: true,
        quality: VIDEO_QUALITIES.HD,
        playbackUrl: "https://cdn.saatcms.test/premium/hd.m3u8",
        geoBlockCountries: [],
      });
    }

    if (contentId === "standard-4k-content") {
      return createResolvedContentMetadata(contentId, {
        isPremium: false,
        quality: VIDEO_QUALITIES.UHD_4K,
        playbackUrl: "https://cdn.saatcms.test/standard/4k.m3u8",
        geoBlockCountries: [],
      });
    }

    return createResolvedContentMetadata(contentId);
  });
}

function createTestApp(service = createTestService()) {
  const app = new Hono();

  app.onError(errorHandler);
  app.notFound(notFoundHandler);

  app.route(
    "/api/v1/mw/playback",
    createMwPlaybackRoutes(new MwPlaybackController(service)),
  );

  return app;
}

describe("Middleware playback request headers", () => {
  it("accepts required playback headers", async () => {
    const response = await createTestApp().request(
      "/api/v1/mw/playback/episode-galactic-odyssey-s1e2",
      {
        headers: {
          "X-User-Id": "user-123",
          "X-User-Country": "TR",
          "X-Device-Type": "Web",
        },
      },
    );

    await expect(response.json()).resolves.toEqual({
      contentId: "episode-galactic-odyssey-s1e2",
      requestContext: {
        userId: "user-123",
        userCountry: "TR",
        deviceType: "Web",
      },
      playback: {
        playbackUrl:
          "https://cdn.saatcms.test/galactic-odyssey/s1/e2.m3u8",
      },
      metadata: {
        type: CONTENT_TYPES.EPISODE,
        title: "Dark Side Relay",
        parentalRating: "16+",
        genre: "Space Adventure",
        quality: VIDEO_QUALITIES.HD,
        isPremium: false,
        geoBlockCountries: ["IR", "SY"],
      },
    });

    expect(response.status).toBe(200);
  });

  it("trims accepted playback headers", async () => {
    const response = await createTestApp().request(
      "/api/v1/mw/playback/episode-galactic-odyssey-s1e2",
      {
        headers: {
          "X-User-Id": "  user-123  ",
          "X-User-Country": "  TR  ",
          "X-Device-Type": "  Web  ",
        },
      },
    );

    await expect(response.json()).resolves.toEqual({
      contentId: "episode-galactic-odyssey-s1e2",
      requestContext: {
        userId: "user-123",
        userCountry: "TR",
        deviceType: "Web",
      },
      playback: {
        playbackUrl:
          "https://cdn.saatcms.test/galactic-odyssey/s1/e2.m3u8",
      },
      metadata: {
        type: CONTENT_TYPES.EPISODE,
        title: "Dark Side Relay",
        parentalRating: "16+",
        genre: "Space Adventure",
        quality: VIDEO_QUALITIES.HD,
        isPremium: false,
        geoBlockCountries: ["IR", "SY"],
      },
    });

    expect(response.status).toBe(200);
  });

  it("accepts Mobile as a supported device type", async () => {
    const response = await createTestApp().request(
      "/api/v1/mw/playback/episode-galactic-odyssey-s1e2",
      {
        headers: {
          "X-User-Id": "user-123",
          "X-User-Country": "TR",
          "X-Device-Type": "Mobile",
        },
      },
    );

    await expect(response.json()).resolves.toMatchObject({
      requestContext: {
        deviceType: "Mobile",
      },
    });

    expect(response.status).toBe(200);
  });

  it("accepts SmartTV as a supported device type", async () => {
    const response = await createTestApp().request(
      "/api/v1/mw/playback/episode-galactic-odyssey-s1e2",
      {
        headers: {
          "X-User-Id": "user-123",
          "X-User-Country": "TR",
          "X-Device-Type": "SmartTV",
        },
      },
    );

    await expect(response.json()).resolves.toMatchObject({
      requestContext: {
        deviceType: "SmartTV",
      },
    });

    expect(response.status).toBe(200);
  });

  it("rejects missing X-User-Id header", async () => {
    const response = await createTestApp().request(
      "/api/v1/mw/playback/episode-galactic-odyssey-s1e2",
      {
        headers: {
          "X-User-Country": "TR",
          "X-Device-Type": "Web",
        },
      },
    );

    await expect(response.json()).resolves.toEqual({
      errorCode: "MISSING_HEADER",
      message: "X-User-Id header is required",
    });

    expect(response.status).toBe(400);
  });

  it("rejects blank X-User-Id header", async () => {
    const response = await createTestApp().request(
      "/api/v1/mw/playback/episode-galactic-odyssey-s1e2",
      {
        headers: {
          "X-User-Id": "   ",
          "X-User-Country": "TR",
          "X-Device-Type": "Web",
        },
      },
    );

    await expect(response.json()).resolves.toEqual({
      errorCode: "MISSING_HEADER",
      message: "X-User-Id header is required",
    });

    expect(response.status).toBe(400);
  });

  it("rejects missing X-User-Country header", async () => {
    const response = await createTestApp().request(
      "/api/v1/mw/playback/episode-galactic-odyssey-s1e2",
      {
        headers: {
          "X-User-Id": "user-123",
          "X-Device-Type": "Web",
        },
      },
    );

    await expect(response.json()).resolves.toEqual({
      errorCode: "MISSING_HEADER",
      message: "X-User-Country header is required",
    });

    expect(response.status).toBe(400);
  });

  it("rejects blank X-User-Country header", async () => {
    const response = await createTestApp().request(
      "/api/v1/mw/playback/episode-galactic-odyssey-s1e2",
      {
        headers: {
          "X-User-Id": "user-123",
          "X-User-Country": "   ",
          "X-Device-Type": "Web",
        },
      },
    );

    await expect(response.json()).resolves.toEqual({
      errorCode: "MISSING_HEADER",
      message: "X-User-Country header is required",
    });

    expect(response.status).toBe(400);
  });

  it("rejects missing X-Device-Type header", async () => {
    const response = await createTestApp().request(
      "/api/v1/mw/playback/episode-galactic-odyssey-s1e2",
      {
        headers: {
          "X-User-Id": "user-123",
          "X-User-Country": "TR",
        },
      },
    );

    await expect(response.json()).resolves.toEqual({
      errorCode: "MISSING_HEADER",
      message: "X-Device-Type header is required",
    });

    expect(response.status).toBe(400);
  });

  it("rejects blank X-Device-Type header", async () => {
    const response = await createTestApp().request(
      "/api/v1/mw/playback/episode-galactic-odyssey-s1e2",
      {
        headers: {
          "X-User-Id": "user-123",
          "X-User-Country": "TR",
          "X-Device-Type": "   ",
        },
      },
    );

    await expect(response.json()).resolves.toEqual({
      errorCode: "MISSING_HEADER",
      message: "X-Device-Type header is required",
    });

    expect(response.status).toBe(400);
  });

  it("rejects invalid X-Device-Type header", async () => {
    const response = await createTestApp().request(
      "/api/v1/mw/playback/episode-galactic-odyssey-s1e2",
      {
        headers: {
          "X-User-Id": "user-123",
          "X-User-Country": "TR",
          "X-Device-Type": "Console",
        },
      },
    );

    await expect(response.json()).resolves.toEqual({
      errorCode: "INVALID_DEVICE_TYPE",
      message: "X-Device-Type must be one of: Mobile, SmartTV, Web",
    });

    expect(response.status).toBe(400);
  });

  it("returns not found when requested content does not exist", async () => {
    const response = await createTestApp().request(
      "/api/v1/mw/playback/missing-content",
      {
        headers: {
          "X-User-Id": "user-123",
          "X-User-Country": "TR",
          "X-Device-Type": "Web",
        },
      },
    );

    await expect(response.json()).resolves.toEqual({
      errorCode: "CONTENT_NOT_FOUND",
      message: "Content not found",
    });

    expect(response.status).toBe(404);
  });

  it("rejects playback when the user country is geo-blocked", async () => {
    const response = await createTestApp().request(
      "/api/v1/mw/playback/episode-galactic-odyssey-s1e2",
      {
        headers: {
          "X-User-Id": "user-123",
          "X-User-Country": "IR",
          "X-Device-Type": "Web",
        },
      },
    );

    const body = await response.json();

    expect(body).toEqual({
      errorCode: "GEO_BLOCKED",
      message: "Playback is not available in the user's country.",
    });
    expectNoPlaybackUrl(body);

    expect(response.status).toBe(403);
  });

  it("rejects premium 4K playback on Mobile", async () => {
    const response = await createTestApp().request(
      "/api/v1/mw/playback/premium-4k-content",
      {
        headers: {
          "X-User-Id": "user-123",
          "X-User-Country": "TR",
          "X-Device-Type": "Mobile",
        },
      },
    );

    const body = await response.json();

    expect(body).toEqual({
      errorCode: "DEVICE_NOT_SUPPORTED",
      message: "Playback is not available on this device type.",
    });
    expectNoPlaybackUrl(body);

    expect(response.status).toBe(403);
  });

  it("allows premium non-4K playback on Mobile", async () => {
    const response = await createTestApp().request(
      "/api/v1/mw/playback/premium-hd-content",
      {
        headers: {
          "X-User-Id": "user-123",
          "X-User-Country": "TR",
          "X-Device-Type": "Mobile",
        },
      },
    );

    await expect(response.json()).resolves.toMatchObject({
      contentId: "premium-hd-content",
      playback: {
        playbackUrl: "https://cdn.saatcms.test/premium/hd.m3u8",
      },
      metadata: {
        quality: VIDEO_QUALITIES.HD,
        isPremium: true,
      },
    });

    expect(response.status).toBe(200);
  });

  it("allows non-premium 4K playback on Mobile", async () => {
    const response = await createTestApp().request(
      "/api/v1/mw/playback/standard-4k-content",
      {
        headers: {
          "X-User-Id": "user-123",
          "X-User-Country": "TR",
          "X-Device-Type": "Mobile",
        },
      },
    );

    await expect(response.json()).resolves.toMatchObject({
      contentId: "standard-4k-content",
      playback: {
        playbackUrl: "https://cdn.saatcms.test/standard/4k.m3u8",
      },
      metadata: {
        quality: VIDEO_QUALITIES.UHD_4K,
        isPremium: false,
      },
    });

    expect(response.status).toBe(200);
  });

  it("allows premium 4K playback on SmartTV", async () => {
    const response = await createTestApp().request(
      "/api/v1/mw/playback/premium-4k-content",
      {
        headers: {
          "X-User-Id": "user-123",
          "X-User-Country": "TR",
          "X-Device-Type": "SmartTV",
        },
      },
    );

    await expect(response.json()).resolves.toMatchObject({
      contentId: "premium-4k-content",
      playback: {
        playbackUrl: "https://cdn.saatcms.test/premium/4k.m3u8",
      },
      metadata: {
        quality: VIDEO_QUALITIES.UHD_4K,
        isPremium: true,
      },
    });

    expect(response.status).toBe(200);
  });

  it("allows premium 4K playback on Web", async () => {
    const response = await createTestApp().request(
      "/api/v1/mw/playback/premium-4k-content",
      {
        headers: {
          "X-User-Id": "user-123",
          "X-User-Country": "TR",
          "X-Device-Type": "Web",
        },
      },
    );

    await expect(response.json()).resolves.toMatchObject({
      contentId: "premium-4k-content",
      playback: {
        playbackUrl: "https://cdn.saatcms.test/premium/4k.m3u8",
      },
      metadata: {
        quality: VIDEO_QUALITIES.UHD_4K,
        isPremium: true,
      },
    });

    expect(response.status).toBe(200);
  });
});

describe("Middleware playback service", () => {
  it("rejects missing contentId", async () => {
    await expect(
      createTestService().getPlayback(undefined, {
        userId: "user-123",
        userCountry: "TR",
        deviceType: "Web",
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      errorCode: "INVALID_REQUEST",
      message: "contentId is required",
    });
  });

  it("rejects blank contentId", async () => {
    await expect(
      createTestService().getPlayback("   ", {
        userId: "user-123",
        userCountry: "TR",
        deviceType: "Web",
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      errorCode: "INVALID_REQUEST",
      message: "contentId is required",
    });
  });

  it("trims contentId", async () => {
    await expect(
      createTestService().getPlayback(
        "  episode-galactic-odyssey-s1e2  ",
        {
          userId: "user-123",
          userCountry: "TR",
          deviceType: "Web",
        },
      ),
    ).resolves.toEqual({
      contentId: "episode-galactic-odyssey-s1e2",
      requestContext: {
        userId: "user-123",
        userCountry: "TR",
        deviceType: "Web",
      },
      playback: {
        playbackUrl:
          "https://cdn.saatcms.test/galactic-odyssey/s1/e2.m3u8",
      },
      metadata: {
        type: CONTENT_TYPES.EPISODE,
        title: "Dark Side Relay",
        parentalRating: "16+",
        genre: "Space Adventure",
        quality: VIDEO_QUALITIES.HD,
        isPremium: false,
        geoBlockCountries: ["IR", "SY"],
      },
    });
  });

  it("rejects geo-blocked users before returning playback details", async () => {
    await expect(
      createTestService().getPlayback("episode-galactic-odyssey-s1e2", {
        userId: "user-123",
        userCountry: "sy",
        deviceType: "Web",
      }),
    ).rejects.toMatchObject({
      errorCode: "GEO_BLOCKED",
      message: "Playback is not available in the user's country.",
    });
  });

  it("rejects unsupported devices before returning playback details", async () => {
    await expect(
      createTestService().getPlayback("premium-4k-content", {
        userId: "user-123",
        userCountry: "TR",
        deviceType: "Mobile",
      }),
    ).rejects.toMatchObject({
      errorCode: "DEVICE_NOT_SUPPORTED",
      message: "Playback is not available on this device type.",
    });
  });
});
