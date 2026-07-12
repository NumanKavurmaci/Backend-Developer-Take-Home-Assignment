import { Prisma, PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveContentMetadata } from "../../src/content/metadata-inheritance.js";
import { MwPlaybackService } from "../../src/modules/mw-playback/mw-playback.service.js";
import { clearContentTables } from "../../src/test/test-database.js";
import { applyDeterministicDemoPolicies, type GeneratedCatalogPolicies } from "./policies.js";
import { policyFixtureChunk } from "./policy-fixture.js";
import type { NormalizedCatalogChunk } from "./types.js";

const prisma = new PrismaClient();
let generated: GeneratedCatalogPolicies;

beforeEach(async () => {
  await clearContentTables(prisma);
  generated = applyDeterministicDemoPolicies(policyFixtureChunk());
  await persistChunk(generated.chunk);
});

afterEach(() => vi.unstubAllGlobals());
afterAll(async () => prisma.$disconnect());

describe("generated policy integration", () => {
  it("resolves Series defaults for the inherited Episode", async () => {
    await expect(resolveContentMetadata(prisma, generated.scenarioIds.inheritedEpisodeId)).resolves.toMatchObject({
      parentalRating: "13+",
      genre: "General",
      quality: "HD",
      isPremium: false,
      playbackUrl: "https://media.invalid/content/tvmaze-series-10",
      geoBlockCountries: ["IR", "SY"],
    });
  });

  it("resolves the selected Season override and selected Episode override", async () => {
    await expect(resolveContentMetadata(prisma, generated.scenarioIds.seasonOverrideEpisodeId)).resolves.toMatchObject({
      parentalRating: "16+",
      genre: "Mystery",
      quality: "HD",
      isPremium: false,
    });
    await expect(resolveContentMetadata(prisma, generated.scenarioIds.episodeOverrideEpisodeId)).resolves.toMatchObject({
      parentalRating: "16+",
      genre: "Mystery",
      quality: "UHD_4K",
      isPremium: true,
      playbackUrl: "https://media.invalid/content/tvmaze-episode-202",
      geoBlockCountries: [],
    });
  });

  it("enforces geo and premium-device rules while allowing Web and SmartTV", async () => {
    const service = new MwPlaybackService((contentId) => resolveContentMetadata(prisma, contentId));
    await expect(service.getPlayback(generated.scenarioIds.geoBlockedContentId, {
      userId: "demo", userCountry: "IR", deviceType: "Web",
    })).rejects.toMatchObject({ errorCode: "GEO_BLOCKED" });
    await expect(service.getPlayback(generated.scenarioIds.premium4kEpisodeId, {
      userId: "demo", userCountry: "TR", deviceType: "Mobile",
    })).rejects.toMatchObject({ errorCode: "DEVICE_NOT_SUPPORTED" });

    for (const deviceType of ["Web", "SmartTV"] as const) {
      await expect(service.getPlayback(generated.scenarioIds.allowedPlaybackContentId, {
        userId: "demo", userCountry: "TR", deviceType,
      })).resolves.toMatchObject({
        playback: { playbackUrl: "https://media.invalid/content/tvmaze-episode-202" },
        metadata: { quality: "UHD_4K", isPremium: true, geoBlockCountries: [] },
      });
    }
  });

  it("never fetches the placeholder playback URL", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const service = new MwPlaybackService((contentId) => resolveContentMetadata(prisma, contentId));
    await service.getPlayback(generated.scenarioIds.allowedPlaybackContentId, {
      userId: "demo", userCountry: "TR", deviceType: "Web",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

async function persistChunk(chunk: NormalizedCatalogChunk): Promise<void> {
  for (const row of chunk.content) {
    const facts = row.sourceFacts;
    await prisma.content.create({
      data: {
        id: row.id,
        type: row.type,
        title: row.title,
        parentId: row.parentId,
        ...row.policies,
        source: facts.source,
        sourceId: facts.sourceId,
        sourceUrl: facts.sourceUrl,
        originalTitle: facts.originalTitle,
        summary: facts.summary,
        language: facts.language,
        status: facts.status,
        countryCode: facts.countryCode,
        networkName: facts.networkName,
        officialSiteUrl: facts.officialSiteUrl,
        imageUrl: facts.imageUrl,
        premieredAt: catalogDate(facts.premieredAt),
        endedAt: catalogDate(facts.endedAt),
        runtimeMinutes: facts.runtimeMinutes,
        seasonNumber: facts.seasonNumber,
        episodeNumber: facts.episodeNumber,
        ratingAverage: facts.ratingAverage,
        genres: facts.genres,
        sourceMetadata:
          facts.sourceMetadata === null
            ? undefined
            : (facts.sourceMetadata as Prisma.InputJsonValue),
      },
    });
  }
  if (chunk.geoBlocks.length > 0) {
    await prisma.contentGeoBlockCountry.createMany({ data: chunk.geoBlocks });
  }
}

function catalogDate(value: string | null): Date | null {
  return value === null ? null : new Date(`${value}T00:00:00.000Z`);
}
