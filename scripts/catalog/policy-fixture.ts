import type { TvMazeEpisode, TvMazeSeason, TvMazeShow } from "./tvmaze-contracts.js";
import { normalizeTvMazeHierarchy } from "./tvmaze-hierarchy.js";
import type { NormalizedCatalogChunk } from "./types.js";

export function policyFixtureChunk(): NormalizedCatalogChunk {
  const show: TvMazeShow = {
    id: 10, name: "Policy Show", url: null, language: null, status: null,
    runtime: null, premiered: null, ended: null, officialSite: null, genres: [],
    rating: { average: null }, network: null, webChannel: null, image: null, summary: null,
  };
  const seasons: TvMazeSeason[] = [1, 2].map((number) => ({
    id: 20 + number, number, name: `Season ${number}`, url: null,
    premiereDate: null, endDate: null, network: null, webChannel: null,
    image: null, summary: null,
  }));
  const makeEpisode = (id: number, season: number, number: number): TvMazeEpisode => ({
    id, season, number, name: `Episode ${id}`, type: "regular", url: null,
    airdate: null, runtime: null, rating: { average: null }, image: null, summary: null,
  });
  const result = normalizeTvMazeHierarchy({
    show,
    seasons,
    episodes: [makeEpisode(101, 1, 1), makeEpisode(201, 2, 1), makeEpisode(202, 2, 2)],
  });
  if (result.status !== "normalized") throw new Error("Policy fixture must normalize.");
  return result.chunk;
}
