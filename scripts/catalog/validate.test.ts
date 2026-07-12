import { describe, expect, it } from "vitest";
import type { NormalizedCatalogArtifact, NormalizedContentRow } from "./types.js";
import { normalizeTvMazeDerivedSeason, normalizeTvMazeEpisode, normalizeTvMazeSeason, normalizeTvMazeShow } from "./tvmaze-normalize.js";
import type { TvMazeEpisode, TvMazeSeason, TvMazeShow } from "./tvmaze-contracts.js";
import { validateNormalizedCatalog } from "./validate.js";

const show: TvMazeShow = {
  id: 1, name: "Show", url: null, language: "English", status: "Running", runtime: 30,
  premiered: "2024-01-01", ended: null, officialSite: null, genres: ["Drama"],
  rating: { average: 7.5 }, network: { name: "Network", country: { code: "US" } },
  webChannel: null, image: null, summary: null,
};
const season: TvMazeSeason = {
  id: 2, number: 1, name: "Season 1", url: null, premiereDate: "2024-01-01",
  endDate: null, network: null, webChannel: null, image: null, summary: null,
};
const episode: TvMazeEpisode = {
  id: 3, name: "Episode", url: null, season: 1, number: 1, airdate: "2024-01-02",
  runtime: 30, rating: { average: 8 }, image: null, summary: null,
};

function artifact(): NormalizedCatalogArtifact {
  const seriesRow = normalizeTvMazeShow(show);
  const seasonRow = normalizeTvMazeSeason(show.id, season);
  const episodeRow = normalizeTvMazeEpisode(show.id, seasonRow.id, episode);
  return {
    metadata: {
      schemaVersion: 1,
      generatedAt: "2026-07-12T00:00:00.000Z",
      normalizedBytes: 1,
      estimatedDatabaseBytes: 1,
      counts: { content: 3, series: 1, seasons: 1, episodes: 1, movies: 0, geoBlocks: 0, derivedSeasons: 0 },
      scenarioIds: {},
      provenance: [{ source: "TVMAZE", providerName: "TVmaze", providerUrl: "https://www.tvmaze.com/api", license: "CC BY-SA", attribution: "Data provided by TVmaze", snapshotKey: "fixture" }],
      derivedSeasons: [],
    },
    content: [seriesRow, seasonRow, episodeRow],
    geoBlocks: [],
  };
}

describe("normalized catalog validation", () => {
  it("accepts a valid hierarchy", () => expect(() => validateNormalizedCatalog(artifact())).not.toThrow());

  it("rejects duplicate content IDs", () => {
    const value = artifact();
    value.content.push(structuredClone(value.content[0]!));
    expect(() => validateNormalizedCatalog(value)).toThrow(/Duplicate content ID/);
  });

  it("rejects duplicate source identities", () => {
    const value = artifact();
    value.content[1]!.sourceFacts = { ...value.content[1]!.sourceFacts, sourceId: value.content[0]!.sourceFacts.sourceId };
    expect(() => validateNormalizedCatalog(value)).toThrow(/Duplicate source identity/);
  });

  it.each([
    ["Season", 1, "missing-series"],
    ["Episode", 2, "missing-season"],
  ])("rejects orphan %s rows", (_label, index, parentId) => {
    const value = artifact();
    value.content[index]!.parentId = parentId as string;
    expect(() => validateNormalizedCatalog(value)).toThrow(/Missing parent/);
  });

  it("rejects an Episode parented directly by a Series", () => {
    const value = artifact();
    value.content[2]!.parentId = value.content[0]!.id;
    expect(() => validateNormalizedCatalog(value)).toThrow(/Episode parent must be SEASON/);
  });

  it("rejects a Season parented by an Episode", () => {
    const value = artifact();
    value.content[1]!.parentId = value.content[2]!.id;
    expect(() => validateNormalizedCatalog(value)).toThrow(/Season parent must be SERIES/);
  });

  it("rejects a Series with any parent", () => {
    const value = artifact();
    value.content[0]!.parentId = value.content[1]!.id;
    expect(() => validateNormalizedCatalog(value)).toThrow(/SERIES must not have a parent/);
  });

  it.each([
    ["blank title", (row: NormalizedContentRow) => { row.title = " "; }, /Blank content title/],
    ["invalid date", (row: NormalizedContentRow) => { row.sourceFacts.premieredAt = "2024-02-30"; }, /Invalid premieredAt/],
    ["invalid rating", (row: NormalizedContentRow) => { row.sourceFacts.ratingAverage = 10.1; }, /Invalid rating/],
    ["invalid country", (row: NormalizedContentRow) => { row.sourceFacts.countryCode = "usa"; }, /Invalid country code/],
  ])("rejects %s", (_label, mutate, expected) => {
    const value = artifact();
    mutate(value.content[0]!);
    expect(() => validateNormalizedCatalog(value)).toThrow(expected);
  });

  it("rejects a malformed Season record without a season number", () => {
    const value = artifact();
    value.content[1]!.sourceFacts.seasonNumber = null;
    expect(() => validateNormalizedCatalog(value)).toThrow(/Missing seasonNumber/);
  });

  it("requires every derived Season in the artifact manifest", () => {
    const value = artifact();
    const derived = normalizeTvMazeDerivedSeason(1, 2);
    value.content.push(derived.row);
    expect(() => validateNormalizedCatalog(value)).toThrow(/missing from artifact manifest/);
    value.metadata.derivedSeasons.push(derived.fallback);
    expect(() => validateNormalizedCatalog(value)).not.toThrow();
  });

  it("rejects mixing actual and derived identity for one logical Season", () => {
    const value = artifact();
    const derived = normalizeTvMazeDerivedSeason(1, 1);
    value.content.push(derived.row);
    value.metadata.derivedSeasons.push(derived.fallback);
    expect(() => validateNormalizedCatalog(value)).toThrow(/cannot be mixed/);
  });
});
