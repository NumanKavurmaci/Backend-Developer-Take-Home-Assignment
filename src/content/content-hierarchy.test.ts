import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { clearContentTables } from "../test/test-database.js";
import {
  assertContentType,
  isContentType,
} from "./content-types.js";
import { DomainError } from "../shared/domain/domain-error.js";
import { getAllowedParentType } from "./content-hierarchy.js";
import {
  assertVideoQuality,
  isVideoQuality,
} from "./content-metadata.js";
import {
  CONTENT_TYPE_VALUES,
  CONTENT_TYPES,
  INHERITABLE_METADATA_FIELDS,
  PLAYBACK_METADATA_FIELDS,
  VIDEO_QUALITIES,
  VIDEO_QUALITY_VALUES,
} from "../shared/domain/domain-contracts.js";
import {
  createContent,
  contentSelectForHierarchy,
  getContentAncestorPath,
  getContentWithChildren,
  getContentWithParent,
  listContentChildren,
  MAX_CONTENT_HIERARCHY_DEPTH,
  normalizeGeoBlockCountries,
} from "./content-repository.js";
import { resolveContentMetadata } from "./metadata-inheritance.js";

const prisma = new PrismaClient();

beforeEach(async () => {
  await clearContentTables(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function createSeries(id = "series-test") {
  return createContent(prisma, {
    id,
    type: CONTENT_TYPES.SERIES,
    title: `Series ${id}`,
  });
}

async function createSeason(id = "season-test", parentId = "series-test") {
  return createContent(prisma, {
    id,
    type: CONTENT_TYPES.SEASON,
    title: `Season ${id}`,
    parentId,
  });
}

async function createEpisode(id = "episode-test", parentId = "season-test") {
  return createContent(prisma, {
    id,
    type: CONTENT_TYPES.EPISODE,
    title: `Episode ${id}`,
    parentId,
  });
}

describe("content type model", () => {
  it("defines the supported content types", () => {
    expect(CONTENT_TYPE_VALUES).toEqual([
      CONTENT_TYPES.SERIES,
      CONTENT_TYPES.SEASON,
      CONTENT_TYPES.EPISODE,
      CONTENT_TYPES.MOVIE,
    ]);
  });

  it("identifies valid and invalid content type strings", () => {
    expect(isContentType("SERIES")).toBe(true);
    expect(isContentType("SEASON")).toBe(true);
    expect(isContentType("EPISODE")).toBe(true);
    expect(isContentType("MOVIE")).toBe(true);
    expect(isContentType("CLIP")).toBe(false);
  });

  it("throws a readable error for unsupported content types", () => {
    expect(() => assertContentType("CLIP")).toThrow(
      'Invalid content type "CLIP". Allowed values: SERIES, SEASON, EPISODE, MOVIE.',
    );
  });
});

describe("content hierarchy rules", () => {
  it("documents the allowed parent type for each content type", () => {
    expect(getAllowedParentType(CONTENT_TYPES.SERIES)).toBeNull();
    expect(getAllowedParentType(CONTENT_TYPES.SEASON)).toBe(
      CONTENT_TYPES.SERIES,
    );
    expect(getAllowedParentType(CONTENT_TYPES.EPISODE)).toBe(
      CONTENT_TYPES.SEASON,
    );
    expect(getAllowedParentType(CONTENT_TYPES.MOVIE)).toBeNull();
  });

  it("creates Series -> Season -> Episode relationships", async () => {
    await createSeries();
    await createSeason();
    await createEpisode();

    const season = await getContentWithParent(prisma, "season-test");
    const episode = await getContentWithParent(prisma, "episode-test");

    expect(season?.parent?.id).toBe("series-test");
    expect(episode?.parent?.id).toBe("season-test");
  });

  it("stores optional metadata fields while creating content", async () => {
    const series = await createContent(prisma, {
      id: "series-with-metadata",
      type: CONTENT_TYPES.SERIES,
      title: "Series With Metadata",
      parentalRating: "13+",
      genre: "Sci-Fi",
      quality: "HD",
      isPremium: false,
      playbackUrl: "https://cdn.saatcms.test/series/default.m3u8",
    });

    expect(series).toMatchObject({
      parentalRating: "13+",
      genre: "Sci-Fi",
      quality: "HD",
      isPremium: false,
      playbackUrl: "https://cdn.saatcms.test/series/default.m3u8",
    });
  });

  it("allows Movies as root content for future extension", async () => {
    const movie = await createContent(prisma, {
      id: "movie-test",
      type: CONTENT_TYPES.MOVIE,
      title: "Test Movie",
    });

    expect(movie.parentId).toBeNull();
  });

  it("rejects a Season without a Series parent", async () => {
    await expect(
      createContent(prisma, {
        id: "season-without-series",
        type: CONTENT_TYPES.SEASON,
        title: "Invalid Season",
      }),
    ).rejects.toThrow(DomainError);
  });

  it("rejects an Episode without a Season parent", async () => {
    await expect(
      createContent(prisma, {
        id: "episode-without-season",
        type: CONTENT_TYPES.EPISODE,
        title: "Invalid Episode",
      }),
    ).rejects.toThrow("EPISODE content must belong to a SEASON.");
  });

  it("rejects an Episode directly under a Series", async () => {
    await createSeries();

    await expect(
      createContent(prisma, {
        id: "episode-under-series",
        type: CONTENT_TYPES.EPISODE,
        title: "Invalid Episode",
        parentId: "series-test",
      }),
    ).rejects.toThrow(
      "EPISODE content must belong to a SEASON, but parent series-test is SERIES.",
    );
  });

  it("rejects a Season under another Season", async () => {
    await createSeries();
    await createSeason();

    await expect(
      createContent(prisma, {
        id: "nested-season",
        type: CONTENT_TYPES.SEASON,
        title: "Nested Season",
        parentId: "season-test",
      }),
    ).rejects.toThrow(
      "SEASON content must belong to a SERIES, but parent season-test is SEASON.",
    );
  });

  it("rejects root content with a parent", async () => {
    await createSeries();

    await expect(
      createContent(prisma, {
        id: "movie-with-parent",
        type: CONTENT_TYPES.MOVIE,
        title: "Invalid Movie",
        parentId: "series-test",
      }),
    ).rejects.toThrow("MOVIE content cannot have a parent.");

    await expect(
      createContent(prisma, {
        id: "series-with-parent",
        type: CONTENT_TYPES.SERIES,
        title: "Invalid Series",
        parentId: "series-test",
      }),
    ).rejects.toThrow("SERIES content cannot have a parent.");
  });

  it("rejects a missing parent before database insert", async () => {
    await expect(
      createContent(prisma, {
        id: "season-with-missing-parent",
        type: CONTENT_TYPES.SEASON,
        title: "Missing Parent Season",
        parentId: "missing-series",
      }),
    ).rejects.toThrow("SEASON content must belong to a SERIES.");

    await expect(prisma.content.count()).resolves.toBe(0);
  });
});

describe("inheritable metadata fields", () => {
  it("documents all inheritable metadata fields required by the assignment", () => {
    expect(INHERITABLE_METADATA_FIELDS).toEqual([
      "parentalRating",
      "genre",
      "quality",
      "isPremium",
      "playbackUrl",
      "geoBlockCountries",
    ]);
  });

  it("documents metadata fields needed by playback rules", () => {
    expect(PLAYBACK_METADATA_FIELDS).toEqual([
      "quality",
      "isPremium",
      "playbackUrl",
      "geoBlockCountries",
    ]);
  });

  it("defines allowed video qualities", () => {
    expect(VIDEO_QUALITY_VALUES).toEqual([
      VIDEO_QUALITIES.SD,
      VIDEO_QUALITIES.HD,
      VIDEO_QUALITIES.UHD_4K,
    ]);
    expect(isVideoQuality("HD")).toBe(true);
    expect(isVideoQuality("8K")).toBe(false);
  });

  it("rejects invalid video qualities before writing content", async () => {
    expect(() => assertVideoQuality("8K")).toThrow(DomainError);

    await expect(
      createContent(prisma, {
        id: "series-invalid-quality",
        type: CONTENT_TYPES.SERIES,
        title: "Invalid Quality Series",
        // TypeScript callers cannot pass this value, but runtime input still can.
        quality: "8K" as typeof VIDEO_QUALITIES.HD,
      }),
    ).rejects.toThrow("Invalid video quality \"8K\"");
  });

  it("lets a Series define default metadata values", async () => {
    const series = await createContent(prisma, {
      id: "series-defaults",
      type: CONTENT_TYPES.SERIES,
      title: "Series Defaults",
      parentalRating: "13+",
      genre: "Sci-Fi",
      quality: VIDEO_QUALITIES.HD,
      isPremium: false,
      playbackUrl: "https://cdn.saatcms.test/series/default.m3u8",
      geoBlockCountriesOverride: true,
      geoBlockCountries: ["IR", "SY"],
    });
    const countries = await prisma.contentGeoBlockCountry.findMany({
      where: { contentId: series.id },
      orderBy: { countryCode: "asc" },
    });

    expect(series).toMatchObject({
      parentalRating: "13+",
      genre: "Sci-Fi",
      quality: VIDEO_QUALITIES.HD,
      isPremium: false,
      playbackUrl: "https://cdn.saatcms.test/series/default.m3u8",
      geoBlockCountriesOverride: true,
    });
    expect(countries.map((country) => country.countryCode)).toEqual([
      "IR",
      "SY",
    ]);
  });

  it("lets a Season override selected metadata fields and leave others empty", async () => {
    await createContent(prisma, {
      id: "series-defaults",
      type: CONTENT_TYPES.SERIES,
      title: "Series Defaults",
      parentalRating: "13+",
      genre: "Sci-Fi",
      quality: VIDEO_QUALITIES.HD,
      isPremium: false,
      playbackUrl: "https://cdn.saatcms.test/series/default.m3u8",
    });

    const season = await createContent(prisma, {
      id: "season-genre-override",
      type: CONTENT_TYPES.SEASON,
      title: "Season Genre Override",
      parentId: "series-defaults",
      genre: "Space Adventure",
    });

    expect(season).toMatchObject({
      parentalRating: null,
      genre: "Space Adventure",
      quality: null,
      isPremium: null,
      playbackUrl: null,
    });
  });

  it("lets an Episode override selected metadata fields independently", async () => {
    await createContent(prisma, {
      id: "series-defaults",
      type: CONTENT_TYPES.SERIES,
      title: "Series Defaults",
      parentalRating: "13+",
      genre: "Sci-Fi",
      quality: VIDEO_QUALITIES.HD,
      isPremium: false,
      playbackUrl: "https://cdn.saatcms.test/series/default.m3u8",
    });
    await createContent(prisma, {
      id: "season-genre-override",
      type: CONTENT_TYPES.SEASON,
      title: "Season Genre Override",
      parentId: "series-defaults",
      genre: "Space Adventure",
    });

    const episode = await createContent(prisma, {
      id: "episode-rating-and-playback-override",
      type: CONTENT_TYPES.EPISODE,
      title: "Episode Override",
      parentId: "season-genre-override",
      parentalRating: "16+",
      playbackUrl: "https://cdn.saatcms.test/episode/override.m3u8",
    });

    expect(episode).toMatchObject({
      parentalRating: "16+",
      genre: null,
      quality: null,
      isPremium: null,
      playbackUrl: "https://cdn.saatcms.test/episode/override.m3u8",
    });
  });

  it("supports premium 4K metadata needed by device playback rules", async () => {
    const movie = await createContent(prisma, {
      id: "movie-premium-4k",
      type: CONTENT_TYPES.MOVIE,
      title: "Premium 4K Movie",
      parentalRating: "18+",
      genre: "Action",
      quality: VIDEO_QUALITIES.UHD_4K,
      isPremium: true,
      playbackUrl: "https://cdn.saatcms.test/movie/4k.m3u8",
    });

    expect(movie).toMatchObject({
      quality: VIDEO_QUALITIES.UHD_4K,
      isPremium: true,
      playbackUrl: "https://cdn.saatcms.test/movie/4k.m3u8",
    });
  });

  it("keeps each metadata field independent from the others", async () => {
    await createContent(prisma, {
      id: "series-defaults",
      type: CONTENT_TYPES.SERIES,
      title: "Series Defaults",
      parentalRating: "13+",
      genre: "Sci-Fi",
      quality: VIDEO_QUALITIES.HD,
      isPremium: false,
      playbackUrl: "https://cdn.saatcms.test/series/default.m3u8",
    });
    await createContent(prisma, {
      id: "season-rating-only",
      type: CONTENT_TYPES.SEASON,
      title: "Season Rating Only",
      parentId: "series-defaults",
      parentalRating: "16+",
    });

    const episode = await createContent(prisma, {
      id: "episode-quality-only",
      type: CONTENT_TYPES.EPISODE,
      title: "Episode Quality Only",
      parentId: "season-rating-only",
      quality: VIDEO_QUALITIES.UHD_4K,
    });

    expect(episode).toMatchObject({
      parentalRating: null,
      genre: null,
      quality: VIDEO_QUALITIES.UHD_4K,
      isPremium: null,
      playbackUrl: null,
    });
  });
});

describe("content hierarchy queries", () => {
  it("defines the minimal content projection needed for hierarchy checks", () => {
    expect(contentSelectForHierarchy()).toEqual({
      id: true,
      type: true,
      title: true,
      parentId: true,
    });
  });

  it("queries direct children in stable type/title order", async () => {
    await createSeries();
    await createSeason("season-b", "series-test");
    await createSeason("season-a", "series-test");

    const children = await listContentChildren(prisma, "series-test");

    expect(children.map((content) => content.id)).toEqual([
      "season-a",
      "season-b",
    ]);
  });

  it("returns content with direct children", async () => {
    await createSeries();
    await createSeason();

    const series = await getContentWithChildren(prisma, "series-test");

    expect(series?.id).toBe("series-test");
    expect(series?.children.map((content) => content.id)).toEqual([
      "season-test",
    ]);
  });

  it("returns content with direct parent", async () => {
    await createSeries();
    await createSeason();

    const season = await getContentWithParent(prisma, "season-test");

    expect(season?.id).toBe("season-test");
    expect(season?.parent?.id).toBe("series-test");
  });

  it("returns null for missing content in direct lookup helpers", async () => {
    await expect(
      getContentWithChildren(prisma, "missing-content"),
    ).resolves.toBeNull();
    await expect(
      getContentWithParent(prisma, "missing-content"),
    ).resolves.toBeNull();
  });

  it("returns an empty ancestor path for missing content", async () => {
    await expect(
      getContentAncestorPath(prisma, "missing-content"),
    ).resolves.toEqual([]);
  });

  it("loads the ancestor path as Series -> Season -> Episode", async () => {
    await createSeries();
    await createSeason();
    await createEpisode();

    const path = await getContentAncestorPath(prisma, "episode-test");

    expect(path.map((content) => content.id)).toEqual([
      "series-test",
      "season-test",
      "episode-test",
    ]);
  });

  it("loads root content as a one-item ancestor path", async () => {
    await createSeries();

    const path = await getContentAncestorPath(prisma, "series-test");

    expect(path.map((content) => content.id)).toEqual(["series-test"]);
  });

  it("loads ancestor paths without repeated findUnique lookups", async () => {
    await createSeries();
    await createSeason();
    await createEpisode();

    const findUniqueSpy = vi.spyOn(prisma.content, "findUnique");
    const path = await getContentAncestorPath(prisma, "episode-test");

    expect(findUniqueSpy).not.toHaveBeenCalled();
    expect(path.map((content) => content.id)).toEqual([
      "series-test",
      "season-test",
      "episode-test",
    ]);

    findUniqueSpy.mockRestore();
  });

  it("rejects cyclic hierarchy data defensively", async () => {
    await prisma.content.createMany({
      data: [
        {
          id: "cycle-a",
          type: CONTENT_TYPES.SERIES,
          title: "Cycle A",
          updatedAt: new Date(),
        },
        {
          id: "cycle-b",
          type: CONTENT_TYPES.SEASON,
          title: "Cycle B",
          parentId: "cycle-a",
          updatedAt: new Date(),
        },
      ],
    });
    await prisma.content.update({
      where: { id: "cycle-a" },
      data: { parentId: "cycle-b" },
    });

    await expect(getContentAncestorPath(prisma, "cycle-a")).rejects.toThrow(
      "Content hierarchy cycle detected at cycle-a.",
    );
  });

  it("rejects hierarchy data that exceeds the defensive depth limit", async () => {
    let parentId: string | null = null;

    for (let index = 0; index < MAX_CONTENT_HIERARCHY_DEPTH + 1; index += 1) {
      const id = `deep-node-${index}`;

      await prisma.content.create({
        data: {
          id,
          type: CONTENT_TYPES.SERIES,
          title: `Deep Node ${index}`,
          parentId,
        },
      });

      parentId = id;
    }

    await expect(
      getContentAncestorPath(
        prisma,
        `deep-node-${MAX_CONTENT_HIERARCHY_DEPTH}`,
      ),
    ).rejects.toThrow(
      `Content hierarchy exceeds max depth of ${MAX_CONTENT_HIERARCHY_DEPTH}.`,
    );
  });
});

describe("metadata inheritance engine", () => {
  async function createInheritanceTree() {
    await createContent(prisma, {
      id: "series-inheritance",
      type: CONTENT_TYPES.SERIES,
      title: "Inheritance Series",
      parentalRating: "13+",
      genre: "Sci-Fi",
      quality: VIDEO_QUALITIES.HD,
      isPremium: false,
      playbackUrl: "https://cdn.saatcms.test/series/default.m3u8",
      geoBlockCountriesOverride: true,
      geoBlockCountries: ["IR", "SY"],
    });
    await createContent(prisma, {
      id: "season-inheritance",
      type: CONTENT_TYPES.SEASON,
      title: "Inheritance Season",
      parentId: "series-inheritance",
      parentalRating: "16+",
      genre: "Space Adventure",
    });
    await createContent(prisma, {
      id: "episode-inheritance",
      type: CONTENT_TYPES.EPISODE,
      title: "Inheritance Episode",
      parentId: "season-inheritance",
      quality: VIDEO_QUALITIES.UHD_4K,
      playbackUrl: "https://cdn.saatcms.test/episode/override.m3u8",
    });
  }

  it("resolves final Episode metadata with Episode -> Season -> Series priority", async () => {
    await createInheritanceTree();

    const metadata = await resolveContentMetadata(
      prisma,
      "episode-inheritance",
    );

    expect(metadata).toEqual({
      contentId: "episode-inheritance",
      type: CONTENT_TYPES.EPISODE,
      title: "Inheritance Episode",
      parentalRating: "16+",
      genre: "Space Adventure",
      quality: VIDEO_QUALITIES.UHD_4K,
      isPremium: false,
      playbackUrl: "https://cdn.saatcms.test/episode/override.m3u8",
      geoBlockCountries: ["IR", "SY"],
    });
  });

  it("gives Episode-level values highest priority", async () => {
    await createInheritanceTree();
    await createContent(prisma, {
      id: "episode-full-override",
      type: CONTENT_TYPES.EPISODE,
      title: "Episode Full Override",
      parentId: "season-inheritance",
      parentalRating: "18+",
      genre: "Finale",
      quality: VIDEO_QUALITIES.SD,
      isPremium: true,
      playbackUrl: "https://cdn.saatcms.test/episode/full-override.m3u8",
      geoBlockCountriesOverride: true,
      geoBlockCountries: ["TR"],
    });

    const metadata = await resolveContentMetadata(
      prisma,
      "episode-full-override",
    );

    expect(metadata).toMatchObject({
      parentalRating: "18+",
      genre: "Finale",
      quality: VIDEO_QUALITIES.SD,
      isPremium: true,
      playbackUrl: "https://cdn.saatcms.test/episode/full-override.m3u8",
      geoBlockCountries: ["TR"],
    });
  });

  it("uses Season values when Episode values are missing", async () => {
    await createInheritanceTree();
    await createContent(prisma, {
      id: "episode-season-fallback",
      type: CONTENT_TYPES.EPISODE,
      title: "Episode Season Fallback",
      parentId: "season-inheritance",
    });

    const metadata = await resolveContentMetadata(
      prisma,
      "episode-season-fallback",
    );

    expect(metadata.parentalRating).toBe("16+");
    expect(metadata.genre).toBe("Space Adventure");
  });

  it("uses Series values when Episode and Season values are missing", async () => {
    await createContent(prisma, {
      id: "series-only-defaults",
      type: CONTENT_TYPES.SERIES,
      title: "Series Only Defaults",
      parentalRating: "13+",
      genre: "Drama",
      quality: VIDEO_QUALITIES.HD,
      isPremium: false,
      playbackUrl: "https://cdn.saatcms.test/series-only/default.m3u8",
    });
    await createContent(prisma, {
      id: "season-empty",
      type: CONTENT_TYPES.SEASON,
      title: "Season Empty",
      parentId: "series-only-defaults",
    });
    await createContent(prisma, {
      id: "episode-empty",
      type: CONTENT_TYPES.EPISODE,
      title: "Episode Empty",
      parentId: "season-empty",
    });

    const metadata = await resolveContentMetadata(prisma, "episode-empty");

    expect(metadata).toMatchObject({
      parentalRating: "13+",
      genre: "Drama",
      quality: VIDEO_QUALITIES.HD,
      isPremium: false,
      playbackUrl: "https://cdn.saatcms.test/series-only/default.m3u8",
    });
  });

  it("resolves each scalar metadata field independently", async () => {
    await createContent(prisma, {
      id: "series-mixed",
      type: CONTENT_TYPES.SERIES,
      title: "Series Mixed",
      parentalRating: "13+",
      genre: "Sci-Fi",
      quality: VIDEO_QUALITIES.HD,
      isPremium: false,
      playbackUrl: "https://cdn.saatcms.test/series-mixed/default.m3u8",
    });
    await createContent(prisma, {
      id: "season-mixed",
      type: CONTENT_TYPES.SEASON,
      title: "Season Mixed",
      parentId: "series-mixed",
      genre: "Adventure",
      isPremium: true,
    });
    await createContent(prisma, {
      id: "episode-mixed",
      type: CONTENT_TYPES.EPISODE,
      title: "Episode Mixed",
      parentId: "season-mixed",
      quality: VIDEO_QUALITIES.UHD_4K,
    });

    const metadata = await resolveContentMetadata(prisma, "episode-mixed");

    expect(metadata).toMatchObject({
      parentalRating: "13+",
      genre: "Adventure",
      quality: VIDEO_QUALITIES.UHD_4K,
      isPremium: true,
      playbackUrl: "https://cdn.saatcms.test/series-mixed/default.m3u8",
    });
  });

  it("keeps geo-block override with an empty list as the final value", async () => {
    await createInheritanceTree();
    await createContent(prisma, {
      id: "episode-empty-geo-override",
      type: CONTENT_TYPES.EPISODE,
      title: "Episode Empty Geo Override",
      parentId: "season-inheritance",
      geoBlockCountriesOverride: true,
      geoBlockCountries: [],
    });

    const metadata = await resolveContentMetadata(
      prisma,
      "episode-empty-geo-override",
    );

    expect(metadata.geoBlockCountries).toEqual([]);
  });

  it("returns a not-found error for missing content", async () => {
    await expect(
      resolveContentMetadata(prisma, "missing-content"),
    ).rejects.toMatchObject({
      name: "DomainError",
      errorCode: "CONTENT_NOT_FOUND",
    });
    await expect(
      resolveContentMetadata(prisma, "missing-content"),
    ).rejects.toThrow(DomainError);
  });

  it("rejects corrupted hierarchy data instead of resolving incorrect metadata", async () => {
    await prisma.content.create({
      data: {
        id: "corrupt-series",
        type: CONTENT_TYPES.SERIES,
        title: "Corrupt Series",
      },
    });
    await prisma.content.create({
      data: {
        id: "corrupt-episode",
        type: CONTENT_TYPES.EPISODE,
        title: "Corrupt Episode",
        parentId: "corrupt-series",
      },
    });

    await expect(
      resolveContentMetadata(prisma, "corrupt-episode"),
    ).rejects.toThrow(
      "EPISODE content must belong to a SEASON, but parent corrupt-series is SERIES.",
    );
  });

  it("loads geo-block rows for the whole path in one query", async () => {
    await createInheritanceTree();

    const findManySpy = vi.spyOn(prisma.contentGeoBlockCountry, "findMany");
    const metadata = await resolveContentMetadata(
      prisma,
      "episode-inheritance",
    );

    expect(metadata.geoBlockCountries).toEqual(["IR", "SY"]);
    expect(findManySpy).toHaveBeenCalledTimes(1);

    findManySpy.mockRestore();
  });
});

describe("metadata inheritance test cases", () => {
  it("lets an Episode inherit all metadata fields from its Series", async () => {
    await createContent(prisma, {
      id: "series-all-fields",
      type: CONTENT_TYPES.SERIES,
      title: "Series All Fields",
      parentalRating: "13+",
      genre: "Mystery",
      quality: VIDEO_QUALITIES.HD,
      isPremium: false,
      playbackUrl: "https://cdn.saatcms.test/series-all/default.m3u8",
      geoBlockCountriesOverride: true,
      geoBlockCountries: ["IR", "SY"],
    });
    await createContent(prisma, {
      id: "season-inherits-all",
      type: CONTENT_TYPES.SEASON,
      title: "Season Inherits All",
      parentId: "series-all-fields",
    });
    await createContent(prisma, {
      id: "episode-inherits-all",
      type: CONTENT_TYPES.EPISODE,
      title: "Episode Inherits All",
      parentId: "season-inherits-all",
    });

    await expect(
      resolveContentMetadata(prisma, "episode-inherits-all"),
    ).resolves.toEqual({
      contentId: "episode-inherits-all",
      type: CONTENT_TYPES.EPISODE,
      title: "Episode Inherits All",
      parentalRating: "13+",
      genre: "Mystery",
      quality: VIDEO_QUALITIES.HD,
      isPremium: false,
      playbackUrl: "https://cdn.saatcms.test/series-all/default.m3u8",
      geoBlockCountries: ["IR", "SY"],
    });
  });

  it("lets an Episode inherit metadata fields overridden by its Season", async () => {
    await createContent(prisma, {
      id: "series-season-overrides",
      type: CONTENT_TYPES.SERIES,
      title: "Series Season Overrides",
      parentalRating: "13+",
      genre: "Drama",
      quality: VIDEO_QUALITIES.HD,
      isPremium: false,
      playbackUrl: "https://cdn.saatcms.test/series-season/default.m3u8",
      geoBlockCountriesOverride: true,
      geoBlockCountries: ["IR"],
    });
    await createContent(prisma, {
      id: "season-overrides",
      type: CONTENT_TYPES.SEASON,
      title: "Season Overrides",
      parentId: "series-season-overrides",
      parentalRating: "16+",
      genre: "Thriller",
      quality: VIDEO_QUALITIES.UHD_4K,
      isPremium: true,
      playbackUrl: "https://cdn.saatcms.test/season-overrides/default.m3u8",
      geoBlockCountriesOverride: true,
      geoBlockCountries: ["TR"],
    });
    await createContent(prisma, {
      id: "episode-uses-season-overrides",
      type: CONTENT_TYPES.EPISODE,
      title: "Episode Uses Season Overrides",
      parentId: "season-overrides",
    });

    await expect(
      resolveContentMetadata(prisma, "episode-uses-season-overrides"),
    ).resolves.toMatchObject({
      parentalRating: "16+",
      genre: "Thriller",
      quality: VIDEO_QUALITIES.UHD_4K,
      isPremium: true,
      playbackUrl: "https://cdn.saatcms.test/season-overrides/default.m3u8",
      geoBlockCountries: ["TR"],
    });
  });

  it("gives Episode metadata priority over Season and Series metadata", async () => {
    await createContent(prisma, {
      id: "series-episode-priority",
      type: CONTENT_TYPES.SERIES,
      title: "Series Episode Priority",
      parentalRating: "13+",
      genre: "Drama",
      quality: VIDEO_QUALITIES.HD,
      isPremium: false,
      playbackUrl: "https://cdn.saatcms.test/series-priority/default.m3u8",
      geoBlockCountriesOverride: true,
      geoBlockCountries: ["IR"],
    });
    await createContent(prisma, {
      id: "season-episode-priority",
      type: CONTENT_TYPES.SEASON,
      title: "Season Episode Priority",
      parentId: "series-episode-priority",
      parentalRating: "16+",
      genre: "Thriller",
      quality: VIDEO_QUALITIES.UHD_4K,
      isPremium: true,
      playbackUrl: "https://cdn.saatcms.test/season-priority/default.m3u8",
      geoBlockCountriesOverride: true,
      geoBlockCountries: ["TR"],
    });
    await createContent(prisma, {
      id: "episode-priority",
      type: CONTENT_TYPES.EPISODE,
      title: "Episode Priority",
      parentId: "season-episode-priority",
      parentalRating: "18+",
      genre: "Finale",
      quality: VIDEO_QUALITIES.SD,
      isPremium: false,
      playbackUrl: "https://cdn.saatcms.test/episode-priority/default.m3u8",
      geoBlockCountriesOverride: true,
      geoBlockCountries: ["DE"],
    });

    await expect(
      resolveContentMetadata(prisma, "episode-priority"),
    ).resolves.toMatchObject({
      parentalRating: "18+",
      genre: "Finale",
      quality: VIDEO_QUALITIES.SD,
      isPremium: false,
      playbackUrl: "https://cdn.saatcms.test/episode-priority/default.m3u8",
      geoBlockCountries: ["DE"],
    });
  });

  it("resolves mixed inheritance across fields and preserves explicit false values", async () => {
    await createContent(prisma, {
      id: "series-mixed-step-nine",
      type: CONTENT_TYPES.SERIES,
      title: "Series Mixed Step Nine",
      parentalRating: "13+",
      genre: "Adventure",
      quality: VIDEO_QUALITIES.HD,
      isPremium: true,
      playbackUrl: "https://cdn.saatcms.test/series-mixed-step-nine/default.m3u8",
      geoBlockCountriesOverride: true,
      geoBlockCountries: ["IR", "SY"],
    });
    await createContent(prisma, {
      id: "season-mixed-step-nine",
      type: CONTENT_TYPES.SEASON,
      title: "Season Mixed Step Nine",
      parentId: "series-mixed-step-nine",
      genre: "Space Adventure",
      isPremium: false,
    });
    await createContent(prisma, {
      id: "episode-mixed-step-nine",
      type: CONTENT_TYPES.EPISODE,
      title: "Episode Mixed Step Nine",
      parentId: "season-mixed-step-nine",
      quality: VIDEO_QUALITIES.UHD_4K,
      playbackUrl: "https://cdn.saatcms.test/episode-mixed-step-nine/default.m3u8",
      geoBlockCountriesOverride: true,
      geoBlockCountries: [],
    });

    await expect(
      resolveContentMetadata(prisma, "episode-mixed-step-nine"),
    ).resolves.toMatchObject({
      parentalRating: "13+",
      genre: "Space Adventure",
      quality: VIDEO_QUALITIES.UHD_4K,
      isPremium: false,
      playbackUrl: "https://cdn.saatcms.test/episode-mixed-step-nine/default.m3u8",
      geoBlockCountries: [],
    });
  });

  it("returns a not-found error when resolving missing content metadata", async () => {
    await expect(
      resolveContentMetadata(prisma, "missing-step-nine-content"),
    ).rejects.toMatchObject({
      errorCode: "CONTENT_NOT_FOUND",
    });
  });

  it("rejects invalid hierarchy data before resolving metadata", async () => {
    await prisma.content.create({
      data: {
        id: "step-nine-series",
        type: CONTENT_TYPES.SERIES,
        title: "Step Nine Series",
      },
    });
    await prisma.content.create({
      data: {
        id: "step-nine-invalid-episode",
        type: CONTENT_TYPES.EPISODE,
        title: "Step Nine Invalid Episode",
        parentId: "step-nine-series",
      },
    });

    await expect(
      resolveContentMetadata(prisma, "step-nine-invalid-episode"),
    ).rejects.toThrow(
      "EPISODE content must belong to a SEASON, but parent step-nine-series is SERIES.",
    );
  });

  it("rejects incomplete raw hierarchy data before resolving metadata", async () => {
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "Content" DROP CONSTRAINT "Content_parentId_fkey"',
    );

    try {
      await prisma.content.create({
        data: {
          id: "orphan-season",
          type: CONTENT_TYPES.SEASON,
          title: "Orphan Season",
          parentId: "missing-series",
        },
      });

      await expect(
        resolveContentMetadata(prisma, "orphan-season"),
      ).rejects.toThrow(
        "Content hierarchy is incomplete for orphan-season; missing parent missing-series.",
      );
    } finally {
      await prisma.content.deleteMany({ where: { id: "orphan-season" } });
      await prisma.$executeRawUnsafe(`
        ALTER TABLE "Content"
        ADD CONSTRAINT "Content_parentId_fkey"
        FOREIGN KEY ("parentId") REFERENCES "Content"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
      `);
    }
  });
});

describe("geo-block input rules", () => {
  it("normalizes and deduplicates country codes", () => {
    expect(normalizeGeoBlockCountries([" tr ", "TR", "de"])).toEqual([
      "TR",
      "DE",
    ]);
  });

  it("rejects invalid country code formats", () => {
    expect(() => normalizeGeoBlockCountries(["TUR"])).toThrow(
      DomainError,
    );
    expect(() => normalizeGeoBlockCountries(["T1"])).toThrow(
      DomainError,
    );
    expect(() => normalizeGeoBlockCountries([""])).toThrow(DomainError);
  });

  it("rejects geo-block countries when geo-block override is false", async () => {
    await expect(
      createContent(prisma, {
        id: "movie-geo-inherit-with-countries",
        type: CONTENT_TYPES.MOVIE,
        title: "Invalid Geo Block Movie",
        geoBlockCountriesOverride: false,
        geoBlockCountries: ["TR", "DE"],
      }),
    ).rejects.toThrow(
      "geoBlockCountries can only be provided when geoBlockCountriesOverride is true.",
    );
  });

  it("allows geo-block override with an empty country list", async () => {
    const movie = await createContent(prisma, {
      id: "movie-empty-geo-override",
      type: CONTENT_TYPES.MOVIE,
      title: "Empty Geo Override Movie",
      geoBlockCountriesOverride: true,
      geoBlockCountries: [],
    });

    const countryRows = await prisma.contentGeoBlockCountry.findMany({
      where: { contentId: movie.id },
    });

    expect(movie.geoBlockCountriesOverride).toBe(true);
    expect(countryRows).toEqual([]);
  });

  it("creates normalized geo-block country rows when override is true", async () => {
    const movie = await createContent(prisma, {
      id: "movie-normalized-geo",
      type: CONTENT_TYPES.MOVIE,
      title: "Normalized Geo Movie",
      geoBlockCountriesOverride: true,
      geoBlockCountries: [" tr ", "TR", "de"],
    });

    const countryRows = await prisma.contentGeoBlockCountry.findMany({
      where: { contentId: movie.id },
      orderBy: { countryCode: "asc" },
    });

    expect(movie.geoBlockCountriesOverride).toBe(true);
    expect(countryRows.map((row) => row.countryCode)).toEqual(["DE", "TR"]);
  });
});
