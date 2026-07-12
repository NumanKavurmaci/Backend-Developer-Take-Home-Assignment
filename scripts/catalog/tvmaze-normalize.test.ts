import { describe, expect, it } from "vitest";
import type { TvMazeEpisode, TvMazeSeason, TvMazeShow } from "./tvmaze-contracts.js";
import {
  isUsableTvMazeShow,
  normalizeTvMazeDerivedSeason,
  normalizeTvMazeEpisode,
  normalizeTvMazeSeason,
  normalizeTvMazeShow,
} from "./tvmaze-normalize.js";

const show: TvMazeShow = {
  id: 42, name: "Example Show", url: "https://tvmaze.test/shows/42", language: "English",
  status: "Running", runtime: 45, premiered: "2020-01-02", ended: null,
  officialSite: "https://example.test", genres: ["Drama"], rating: { average: 8.1 },
  network: { name: "Network", country: { code: "US" } }, webChannel: null,
  image: { medium: "medium.jpg", original: "original.jpg" }, summary: "Summary",
};
const season: TvMazeSeason = {
  id: 77, number: 1, url: "https://tvmaze.test/seasons/77", name: null,
  premiereDate: "2020-01-02", endDate: "2020-03-01", network: null, webChannel: null,
  image: null, summary: null,
};
const episode: TvMazeEpisode = {
  id: 99, name: "Pilot", url: "https://tvmaze.test/episodes/99", season: 1,
  type: "regular", number: 1, airdate: "2020-01-02", runtime: 45, rating: { average: 8.2 },
  image: null, summary: "Episode summary",
};

describe("TVmaze normalization contracts", () => {
  it("maps actual provider IDs and relationships", () => {
    const seriesRow = normalizeTvMazeShow(show);
    const seasonRow = normalizeTvMazeSeason(show.id, season);
    const episodeRow = normalizeTvMazeEpisode(show.id, seasonRow.id, episode);

    expect(seriesRow).toMatchObject({ id: "tvmaze-series-42", parentId: null, sourceFacts: { sourceId: "show:42" } });
    expect(seasonRow).toMatchObject({ id: "tvmaze-season-77", parentId: seriesRow.id, sourceFacts: { sourceId: "season:77", seasonNumber: 1 } });
    expect(episodeRow).toMatchObject({ id: "tvmaze-episode-99", parentId: seasonRow.id, sourceFacts: { sourceId: "episode:99", seasonNumber: 1, episodeNumber: 1 } });
  });

  it("produces identical IDs and relationships on repeated builds", () => {
    const build = () => {
      const seriesRow = normalizeTvMazeShow(structuredClone(show));
      const seasonRow = normalizeTvMazeSeason(show.id, structuredClone(season));
      const episodeRow = normalizeTvMazeEpisode(show.id, seasonRow.id, structuredClone(episode));
      return [seriesRow, seasonRow, episodeRow].map(({ id, parentId, sourceFacts }) => ({ id, parentId, sourceId: sourceFacts.sourceId }));
    };
    expect(build()).toEqual(build());
  });

  it("makes derived identity explicit in both row and manifest", () => {
    expect(normalizeTvMazeDerivedSeason(42, 2)).toMatchObject({
      row: { id: "tvmaze-series-42-season-2", parentId: "tvmaze-series-42", sourceFacts: { sourceId: "season-derived:42:2" } },
      fallback: { contentId: "tvmaze-series-42-season-2", reason: "TVMAZE_SEASON_RECORD_UNAVAILABLE" },
    });
  });

  it("skips ineligible show candidates and rejects selected blank records", () => {
    expect(isUsableTvMazeShow({ id: 42, name: "  " })).toBe(false);
    expect(() => normalizeTvMazeShow({ ...show, name: " " })).toThrow(/blank title/);
    expect(() => normalizeTvMazeEpisode(show.id, "tvmaze-season-77", { ...episode, id: 0 })).toThrow(/invalid ID/);
  });
});
