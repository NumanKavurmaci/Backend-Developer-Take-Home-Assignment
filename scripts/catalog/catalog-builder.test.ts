import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CachedJsonClient } from "./http.js";
import { HttpTvMazeCatalogSource, type TvMazeCatalogSource } from "./tvmaze-source.js";
import type { TvMazeEpisode, TvMazeSeason, TvMazeShow } from "./tvmaze-contracts.js";
import { buildCatalogFromTvMaze } from "./catalog-builder.js";
import type { CatalogArtifactConfiguration } from "./artifact-types.js";
import { DEFAULT_CATALOG_LIMITS } from "./config.js";
import { writeCatalogArtifact } from "./artifact.js";
import { validateCatalogArtifact } from "./artifact-validator.js";

let temporaryRoot: string;
beforeEach(async () => { temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "catalog-builder-")); });
afterEach(async () => rm(temporaryRoot, { recursive: true, force: true }));

function config(overrides: Partial<CatalogArtifactConfiguration> = {}): CatalogArtifactConfiguration {
  return {
    ...DEFAULT_CATALOG_LIMITS,
    maxShows: 2,
    maxEpisodesPerShow: 10,
    maxContentRows: 100,
    tvmazeStartPage: 0,
    maxPages: 2,
    offline: true,
    ...overrides,
  };
}

function show(id: number): TvMazeShow {
  return {
    id, name: `Show ${id}`, url: null, language: null, status: null, runtime: null,
    premiered: null, ended: null, officialSite: null, genres: [],
    rating: { average: null }, network: null, webChannel: null, image: null, summary: null,
  };
}

function seasons(showId: number): TvMazeSeason[] {
  return [1, 2].map((number) => ({
    id: showId * 100 + number, number, name: `Season ${number}`, url: null,
    premiereDate: null, endDate: null, network: null, webChannel: null,
    image: null, summary: null,
  }));
}

function episodes(showId: number): TvMazeEpisode[] {
  const base = showId * 1_000;
  return [
    { id: base + 1, season: 1, number: 1 },
    { id: base + 2, season: 2, number: 1 },
    { id: base + 3, season: 2, number: 2 },
    { id: base + 4, season: 2, number: 3 },
    { id: base + 5, season: 2, number: 4 },
  ].map((item) => ({
    ...item, name: `Episode ${item.id}`, type: "regular", url: null,
    airdate: null, runtime: null, rating: { average: null }, image: null, summary: null,
  }));
}

class FixtureSource implements TvMazeCatalogSource {
  constructor(
    readonly shows: TvMazeShow[],
    readonly seasonRows = new Map(shows.map((item) => [item.id, seasons(item.id)])),
    readonly episodeRows = new Map(shows.map((item) => [item.id, episodes(item.id)])),
  ) {}
  async getShowPage(page: number) { return page === 0 ? structuredClone(this.shows) : null; }
  async getShowSeasons(showId: number) { return structuredClone(this.seasonRows.get(showId) ?? []); }
  async getShowEpisodes(showId: number) { return structuredClone(this.episodeRows.get(showId) ?? []); }
}

describe("TVmaze catalog build orchestration", () => {
  it("accepts a complete Show at the row boundary and stops before splitting the next", async () => {
    const result = await buildCatalogFromTvMaze(
      new FixtureSource([show(1), show(2)]),
      config({ maxContentRows: 8, maxEpisodesPerShow: 5 }),
    );
    expect(result.chunk.content).toHaveLength(8);
    expect(result.chunk.content.some((row) => row.id === "tvmaze-series-2")).toBe(false);
    expect(result.summary).toMatchObject({ showsIncluded: 1, stopReason: "max-content-rows" });
  });

  it("caps imported regular Episodes deterministically per Show", async () => {
    const result = await buildCatalogFromTvMaze(
      new FixtureSource([show(1)]),
      config({ maxShows: 1, maxEpisodesPerShow: 3 }),
    );
    expect(result.chunk.content.filter((row) => row.type === "EPISODE").map((row) => row.id)).toEqual([
      "tvmaze-episode-1001", "tvmaze-episode-1002", "tvmaze-episode-1003",
    ]);
  });

  it("excludes provider Season zero and its special Episodes", async () => {
    const source = new FixtureSource([show(1)]);
    source.seasonRows.get(1)!.push({ ...seasons(1)[0]!, id: 199, number: 0 });
    source.episodeRows.get(1)!.push({
      ...episodes(1)[0]!, id: 1999, season: 0, number: 1,
    });
    const result = await buildCatalogFromTvMaze(source, config({ maxShows: 1 }));
    expect(result.chunk.content.some((row) => row.id === "tvmaze-season-199")).toBe(false);
    expect(result.summary.excludedEpisodes).toContainEqual({
      sourceId: "episode:1999",
      reason: "SPECIAL_OR_UNNUMBERED_EPISODE",
    });
  });

  it("summarizes skipped Shows, excluded Episodes, and its stop reason", async () => {
    const source = new FixtureSource([show(1), show(2), show(3)]);
    source.seasonRows.set(2, [seasons(2)[0]!, { ...seasons(2)[0]!, id: 999 }]);
    source.episodeRows.get(1)!.push({
      ...episodes(1)[0]!, id: 1999, type: "significant_special",
    });
    const result = await buildCatalogFromTvMaze(source, config({ maxShows: 2 }));
    expect(result.summary).toMatchObject({
      showsIncluded: 2,
      stopReason: "max-shows",
      showsSkipped: [{ showId: 2, reason: "AMBIGUOUS_SEASON_MAPPING" }],
    });
    expect(result.summary.excludedEpisodes).toEqual([
      { sourceId: "episode:1999", reason: "SPECIAL_OR_UNNUMBERED_EPISODE" },
    ]);
  });

  it("produces identical artifact checksums from shuffled provider responses", async () => {
    const ordered = new FixtureSource([show(1)]);
    const shuffled = new FixtureSource([show(1)]);
    shuffled.seasonRows.set(1, [...seasons(1)].reverse());
    shuffled.episodeRows.set(1, [...episodes(1)].reverse());
    const [first, second] = await Promise.all([
      buildCatalogFromTvMaze(ordered, config({ maxShows: 1 })),
      buildCatalogFromTvMaze(shuffled, config({ maxShows: 1 })),
    ]);
    const firstManifest = await writeBuiltArtifact(path.join(temporaryRoot, "first"), first, config({ maxShows: 1 }));
    const secondManifest = await writeBuiltArtifact(path.join(temporaryRoot, "second"), second, config({ maxShows: 1 }));
    expect(secondManifest.files).toEqual(firstManifest.files);
  });

  it("replays a cached build offline and produces a valid artifact without network", async () => {
    const cacheDir = path.join(temporaryRoot, "cache");
    const onlineFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/seasons")) return jsonResponse(seasons(1));
      if (url.endsWith("/episodes")) return jsonResponse(episodes(1));
      return jsonResponse([show(1)]);
    });
    const onlineSource = new HttpTvMazeCatalogSource(new CachedJsonClient({
      provider: "TVmaze", namespace: "tvmaze-v1", cacheDir,
      userAgent: "SaatCMS-Test/1.0", minIntervalMs: 0, offline: false,
      maxAttempts: 1, fetch: onlineFetch as unknown as typeof fetch,
    }));
    await buildCatalogFromTvMaze(onlineSource, config({ maxShows: 1, offline: false }));
    expect(onlineFetch).toHaveBeenCalledTimes(3);

    const offlineFetch = vi.fn();
    const offlineSource = new HttpTvMazeCatalogSource(new CachedJsonClient({
      provider: "TVmaze", namespace: "tvmaze-v1", cacheDir,
      userAgent: "SaatCMS-Test/1.0", minIntervalMs: 0, offline: true,
      fetch: offlineFetch as unknown as typeof fetch,
    }));
    const replay = await buildCatalogFromTvMaze(offlineSource, config({ maxShows: 1, offline: true }));
    const output = path.join(temporaryRoot, "offline-artifact");
    await writeBuiltArtifact(output, replay, config({ maxShows: 1, offline: true }));
    await expect(validateCatalogArtifact(output)).resolves.toBeDefined();
    expect(offlineFetch).not.toHaveBeenCalled();
  });
});

async function writeBuiltArtifact(
  output: string,
  built: Awaited<ReturnType<typeof buildCatalogFromTvMaze>>,
  configuration: CatalogArtifactConfiguration,
) {
  return writeCatalogArtifact(output, built.chunk, {
    generatedAt: "2026-07-12T20:00:00.000Z",
    generatorVersion: "0.1.0",
    provenance: [{
      source: "TVMAZE", providerName: "TVmaze", providerUrl: "https://www.tvmaze.com/api",
      license: "CC BY-SA", attribution: "TVmaze", snapshotKey: "test-cache-v1",
    }],
    configuration,
    scenarioIds: built.scenarioIds,
    estimatedDatabaseBytes: built.estimatedDatabaseBytes,
  });
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200 });
}
