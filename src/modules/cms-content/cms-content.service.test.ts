import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { CONTENT_TYPES } from "../../shared/domain/domain-contracts.js";
import { resolveContentMetadata } from "../../content/metadata-inheritance.js";
import { clearContentTables } from "../../test/test-database.js";
import {
  CmsContentService,
  createContentEtag,
} from "./cms-content.service.js";

const prisma = new PrismaClient();
const service = new CmsContentService(prisma);

beforeEach(async () => {
  await clearContentTables(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("CMS content service", () => {
  it("creates, gets, filters, and pages content with server-generated IDs", async () => {
    const first = await service.createContent({
      type: CONTENT_TYPES.MOVIE,
      title: "Alpha Movie",
      geoBlockCountriesOverride: true,
      geoBlockCountries: [" tr ", "TR", "de"],
    });
    await service.createContent({
      type: CONTENT_TYPES.MOVIE,
      title: "Beta Movie",
    });

    expect(first.id).toBeTruthy();
    expect(first.geoBlockCountries).toEqual(["DE", "TR"]);
    await expect(service.getContent(first.id)).resolves.toEqual(first);
    await expect(
      service.listContent({
        type: "MOVIE",
        title: "movie",
        page: "1",
        pageSize: "1",
      }),
    ).resolves.toMatchObject({
      items: [{ title: "Alpha Movie" }],
      page: 1,
      pageSize: 1,
      total: 2,
    });
  });

  it("uses default pagination and rejects an oversized page", async () => {
    await expect(service.listContent({})).resolves.toMatchObject({
      items: [],
      page: 1,
      pageSize: 20,
      total: 0,
    });
    await expect(
      service.listContent({ pageSize: "101" }),
    ).rejects.toMatchObject({
      statusCode: 400,
      errorCode: "INVALID_PAGINATION",
    });
  });

  it("reparents a season only to another series", async () => {
    const firstSeries = await service.createContent({
      type: "SERIES",
      title: "First Series",
    });
    const secondSeries = await service.createContent({
      type: "SERIES",
      title: "Second Series",
    });
    const season = await service.createContent({
      type: "SEASON",
      title: "Season",
      parentId: firstSeries.id,
    });

    await expect(
      service.updateContent(season.id, { parentId: secondSeries.id }),
    ).resolves.toMatchObject({ parentId: secondSeries.id });
    await expect(
      service.updateContent(season.id, { parentId: season.id }),
    ).rejects.toMatchObject({
      statusCode: 400,
      errorCode: "INVALID_CONTENT_HIERARCHY",
    });
  });

  it("atomically replaces and clears geo-block rows", async () => {
    const movie = await service.createContent({
      type: "MOVIE",
      title: "Geo Movie",
      geoBlockCountriesOverride: true,
      geoBlockCountries: ["TR"],
    });

    const updated = await service.updateContent(movie.id, {
      geoBlockCountries: ["de", "US"],
    });
    const cleared = await service.updateContent(movie.id, {
      geoBlockCountriesOverride: false,
    });

    expect(updated.geoBlockCountries).toEqual(["DE", "US"]);
    expect(cleared.geoBlockCountriesOverride).toBe(false);
    expect(cleared.geoBlockCountries).toEqual([]);
    await expect(
      prisma.contentGeoBlockCountry.count({
        where: { contentId: movie.id },
      }),
    ).resolves.toBe(0);
  });

  it("rolls back scalar changes when geo-block validation fails", async () => {
    const movie = await service.createContent({
      type: "MOVIE",
      title: "Original Title",
      geoBlockCountriesOverride: true,
      geoBlockCountries: ["TR"],
    });

    await expect(
      service.updateContent(movie.id, {
        title: "Must Roll Back",
        geoBlockCountries: ["TUR"],
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      errorCode: "INVALID_CONTENT_GEO_BLOCK_COUNTRIES",
    });
    await expect(service.getContent(movie.id)).resolves.toMatchObject({
      title: "Original Title",
      geoBlockCountries: ["TR"],
    });
  });

  it("clears metadata overrides back to inherited values", async () => {
    const series = await service.createContent({
      type: "SERIES",
      title: "Series",
      quality: "HD",
    });
    const season = await service.createContent({
      type: "SEASON",
      title: "Season",
      parentId: series.id,
    });
    const episode = await service.createContent({
      type: "EPISODE",
      title: "Episode",
      parentId: season.id,
      quality: "SD",
    });

    await service.updateContent(episode.id, { quality: null });
    await expect(
      resolveContentMetadata(prisma, episode.id),
    ).resolves.toMatchObject({
      quality: "HD",
    });
  });

  it("rejects stale optimistic-concurrency ETags without changing content", async () => {
    const movie = await service.createContent({
      type: "MOVIE",
      title: "Original",
    });
    const etag = createContentEtag(movie.updatedAt);

    await service.updateContent(movie.id, { title: "First Change" }, etag);
    await expect(
      service.updateContent(movie.id, { title: "Stale Change" }, etag),
    ).rejects.toMatchObject({
      statusCode: 409,
      errorCode: "CONTENT_WRITE_CONFLICT",
    });
    await expect(service.getContent(movie.id)).resolves.toMatchObject({
      title: "First Change",
    });
  });

  it("blocks parent deletion, then deletes a leaf and its geo rows", async () => {
    const series = await service.createContent({
      type: "SERIES",
      title: "Series",
    });
    const season = await service.createContent({
      type: "SEASON",
      title: "Season",
      parentId: series.id,
      geoBlockCountriesOverride: true,
      geoBlockCountries: ["TR"],
    });

    await expect(service.deleteContent(series.id)).rejects.toMatchObject({
      statusCode: 409,
      errorCode: "CONTENT_HAS_CHILDREN",
    });
    await service.deleteContent(season.id);
    await expect(service.getContent(season.id)).rejects.toMatchObject({
      statusCode: 404,
      errorCode: "CONTENT_NOT_FOUND",
    });
    await expect(
      prisma.contentGeoBlockCountry.count({ where: { contentId: season.id } }),
    ).resolves.toBe(0);
    await expect(service.getContent(series.id)).resolves.toBeTruthy();
  });

  it("rejects unknown fields, empty patches, type changes, and invalid quality", async () => {
    await expect(
      service.createContent({ type: "MOVIE", title: "Movie", id: "manual" }),
    ).rejects.toMatchObject({ errorCode: "UNKNOWN_FIELDS" });
    await expect(service.updateContent("missing", {})).rejects.toMatchObject({
      errorCode: "EMPTY_PATCH",
    });
    await expect(
      service.updateContent("missing", { type: "SERIES" }),
    ).rejects.toMatchObject({ errorCode: "CONTENT_TYPE_IMMUTABLE" });
    await expect(
      service.createContent({ type: "MOVIE", title: "Movie", quality: "8K" }),
    ).rejects.toMatchObject({ errorCode: "INVALID_CONTENT_METADATA" });
  });

  it("returns not-found errors for updates and deletes of missing content", async () => {
    await expect(
      service.updateContent("missing", { title: "Missing" }),
    ).rejects.toMatchObject({
      statusCode: 404,
      errorCode: "CONTENT_NOT_FOUND",
    });
    await expect(service.deleteContent("missing")).rejects.toMatchObject({
      statusCode: 404,
      errorCode: "CONTENT_NOT_FOUND",
    });
  });

  it("rejects malformed concurrency ETags", async () => {
    await expect(
      service.updateContent("missing", { title: "Missing" }, "not-an-etag"),
    ).rejects.toMatchObject({
      statusCode: 400,
      errorCode: "INVALID_IF_MATCH",
    });
  });
});
