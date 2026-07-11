import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { CONTENT_TYPES } from "../../content/content-types.js";
import { VIDEO_QUALITIES } from "../../content/content-metadata.js";
import { createContent } from "../../content/content-repository.js";
import { clearContentTables } from "../../test/test-database.js";
import { MwContentService } from "./mw-content.service.js";

const prisma = new PrismaClient();

beforeEach(async () => {
  await clearContentTables(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("middleware content service", () => {
  it("rejects missing and blank content IDs", async () => {
    const service = new MwContentService();

    await expect(service.getResolvedContent(undefined)).rejects.toMatchObject({
      statusCode: 400,
      errorCode: "INVALID_REQUEST",
      message: "contentId is required",
    });
    await expect(service.getResolvedContent("   ")).rejects.toMatchObject({
      statusCode: 400,
      errorCode: "INVALID_REQUEST",
      message: "contentId is required",
    });
  });

  it("returns resolved public metadata without exposing playbackUrl", async () => {
    await createContent(prisma, {
      id: "series-public-service",
      type: CONTENT_TYPES.SERIES,
      title: "Public Service Series",
      parentalRating: "13+",
      genre: "Drama",
      quality: VIDEO_QUALITIES.HD,
      isPremium: false,
      playbackUrl: "https://cdn.saatcms.test/series-public-service/default.m3u8",
      geoBlockCountriesOverride: true,
      geoBlockCountries: ["IR", "SY"],
    });
    await createContent(prisma, {
      id: "season-public-service",
      type: CONTENT_TYPES.SEASON,
      title: "Public Service Season",
      parentId: "series-public-service",
      genre: "Mystery",
    });
    await createContent(prisma, {
      id: "episode-public-service",
      type: CONTENT_TYPES.EPISODE,
      title: "Public Service Episode",
      parentId: "season-public-service",
      quality: VIDEO_QUALITIES.UHD_4K,
    });

    const response = await new MwContentService().getResolvedContent(
      "episode-public-service",
    );

    expect(response).toEqual({
      contentId: "episode-public-service",
      type: CONTENT_TYPES.EPISODE,
      title: "Public Service Episode",
      parentalRating: "13+",
      genre: "Mystery",
      quality: VIDEO_QUALITIES.UHD_4K,
      isPremium: false,
      geoBlockCountries: ["IR", "SY"],
    });
    expect(JSON.stringify(response)).not.toContain("playbackUrl");
  });
});
