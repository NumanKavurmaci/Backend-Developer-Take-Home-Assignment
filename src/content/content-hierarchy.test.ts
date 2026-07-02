import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertContentType,
  CONTENT_TYPE_VALUES,
  CONTENT_TYPES,
  isContentType,
} from "./content-types.js";
import {
  ContentHierarchyError,
  getAllowedParentType,
} from "./content-hierarchy.js";
import {
  ContentGeoBlockError,
  createContent,
  getContentAncestorPath,
  getContentWithChildren,
  getContentWithParent,
  listContentChildren,
  MAX_CONTENT_HIERARCHY_DEPTH,
  normalizeGeoBlockCountries,
} from "./content-repository.js";

const prisma = new PrismaClient();

beforeEach(async () => {
  await clearContentTables();
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function clearContentTables() {
  await prisma.contentGeoBlockCountry.deleteMany();
  await prisma.content.updateMany({ data: { parentId: null } });
  await prisma.content.deleteMany();
}

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
    ).rejects.toThrow(ContentHierarchyError);
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

describe("content hierarchy queries", () => {
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

describe("geo-block input rules", () => {
  it("normalizes and deduplicates country codes", () => {
    expect(normalizeGeoBlockCountries([" tr ", "TR", "de"])).toEqual([
      "TR",
      "DE",
    ]);
  });

  it("rejects invalid country code formats", () => {
    expect(() => normalizeGeoBlockCountries(["TUR"])).toThrow(
      ContentGeoBlockError,
    );
    expect(() => normalizeGeoBlockCountries(["T1"])).toThrow(
      ContentGeoBlockError,
    );
    expect(() => normalizeGeoBlockCountries([""])).toThrow(
      ContentGeoBlockError,
    );
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
