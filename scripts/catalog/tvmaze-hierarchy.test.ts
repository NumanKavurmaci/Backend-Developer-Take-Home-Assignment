import { describe, expect, it } from "vitest";
import type { TvMazeEpisode, TvMazeSeason, TvMazeShow } from "./tvmaze-contracts.js";
import { normalizeTvMazeHierarchy, type TvMazeShowSnapshot } from "./tvmaze-hierarchy.js";

const show: TvMazeShow = {
  id: 100,
  name: "Complete Show",
  url: "https://www.tvmaze.com/shows/100/complete-show",
  language: "English",
  status: "Ended",
  runtime: 52,
  premiered: "2020-01-02",
  ended: "2022-03-04",
  officialSite: "https://complete.example.test",
  genres: ["Thriller", "Drama"],
  rating: { average: 8.4 },
  network: { name: "Example Network", country: { code: "US" } },
  webChannel: null,
  image: { medium: "https://images.test/show-medium.jpg", original: "https://images.test/show-original.jpg" },
  summary: "<p>A <b>complete</b> &amp; safe show.</p>",
};

function season(id: number, number: number): TvMazeSeason {
  return {
    id,
    number,
    url: `https://www.tvmaze.com/seasons/${id}`,
    name: `Season ${number}`,
    premiereDate: `202${number - 1}-01-02`,
    endDate: `202${number - 1}-03-04`,
    network: { name: "Example Network", country: { code: "US" } },
    webChannel: null,
    image: { medium: `season-${id}-medium.jpg`, original: `season-${id}-original.jpg` },
    summary: `<p>Season <em>${number}</em>.</p>`,
  };
}

function episode(id: number, seasonNumber: number, episodeNumber: number): TvMazeEpisode {
  return {
    id,
    name: `Episode ${episodeNumber}`,
    url: `https://www.tvmaze.com/episodes/${id}`,
    type: "regular",
    season: seasonNumber,
    number: episodeNumber,
    airdate: `202${seasonNumber - 1}-01-${String(episodeNumber + 1).padStart(2, "0")}`,
    runtime: 51,
    rating: { average: 8.2 },
    image: { medium: `episode-${id}-medium.jpg`, original: `episode-${id}-original.jpg` },
    summary: `<p>Episode <strong>${episodeNumber}</strong> summary.</p>`,
  };
}

function snapshot(overrides: Partial<TvMazeShowSnapshot> = {}): TvMazeShowSnapshot {
  return {
    show: structuredClone(show),
    seasons: [season(201, 1), season(202, 2)],
    episodes: [episode(302, 2, 1), episode(301, 1, 1)],
    ...overrides,
  };
}

function normalized(value: TvMazeShowSnapshot = snapshot()) {
  const result = normalizeTvMazeHierarchy(value);
  expect(result.status).toBe("normalized");
  if (result.status !== "normalized") throw new Error("Expected normalized fixture.");
  return result;
}

describe("TVmaze hierarchy normalization", () => {
  it("maps every supported Show field and sanitizes its summary", () => {
    const rows = normalized().chunk.content;
    const series = rows[0]!;
    expect(series).toMatchObject({
      id: "tvmaze-series-100",
      type: "SERIES",
      title: "Complete Show",
      parentId: null,
      sourceFacts: {
        source: "TVMAZE",
        sourceId: "show:100",
        sourceUrl: show.url,
        originalTitle: "Complete Show",
        summary: "A complete & safe show.",
        language: "English",
        status: "Ended",
        countryCode: "US",
        networkName: "Example Network",
        officialSiteUrl: show.officialSite,
        imageUrl: "https://images.test/show-original.jpg",
        premieredAt: "2020-01-02",
        endedAt: "2022-03-04",
        runtimeMinutes: 52,
        ratingAverage: 8.4,
        genres: ["Drama", "Thriller"],
      },
    });
    expect(rows[1]).toMatchObject({
      id: "tvmaze-season-201",
      title: "Season 1",
      parentId: "tvmaze-series-100",
      sourceFacts: {
        sourceId: "season:201",
        sourceUrl: "https://www.tvmaze.com/seasons/201",
        originalTitle: "Season 1",
        summary: "Season 1.",
        countryCode: "US",
        networkName: "Example Network",
        imageUrl: "season-201-original.jpg",
        premieredAt: "2020-01-02",
        endedAt: "2020-03-04",
        seasonNumber: 1,
      },
    });
    expect(rows[3]).toMatchObject({
      id: "tvmaze-episode-301",
      title: "Episode 1",
      parentId: "tvmaze-season-201",
      sourceFacts: {
        sourceId: "episode:301",
        sourceUrl: "https://www.tvmaze.com/episodes/301",
        originalTitle: "Episode 1",
        summary: "Episode 1 summary.",
        imageUrl: "episode-301-original.jpg",
        premieredAt: "2020-01-02",
        runtimeMinutes: 51,
        seasonNumber: 1,
        episodeNumber: 1,
        ratingAverage: 8.2,
        sourceMetadata: { episodeType: "regular" },
      },
    });
  });

  it("maps sparse optional fields to null or empty arrays", () => {
    const sparse: TvMazeShow = {
      ...show,
      language: null, status: null, runtime: null, premiered: null, ended: null,
      officialSite: null, genres: [], rating: { average: null }, network: null,
      webChannel: null, image: null, summary: null,
    };
    const result = normalized({ show: sparse, seasons: [], episodes: [] });
    expect(result.chunk.content).toHaveLength(1);
    expect(result.chunk.content[0]!.sourceFacts).toMatchObject({
      language: null, status: null, runtimeMinutes: null, premieredAt: null,
      endedAt: null, officialSiteUrl: null, genres: [], ratingAverage: null,
      countryCode: null, networkName: null, imageUrl: null, summary: null,
    });
  });

  it("keeps sparse Season and Episode provider facts null", () => {
    const sparseSeason: TvMazeSeason = {
      ...season(201, 1), name: null, url: null, premiereDate: null, endDate: null,
      network: null, webChannel: null, image: null, summary: null,
    };
    const sparseEpisode: TvMazeEpisode = {
      ...episode(301, 1, 1), url: null, airdate: null, runtime: null,
      rating: { average: null }, image: null, summary: null,
    };
    const rows = normalized(snapshot({ seasons: [sparseSeason], episodes: [sparseEpisode] })).chunk.content;
    expect(rows[1]!.sourceFacts).toMatchObject({
      sourceUrl: null, originalTitle: null, summary: null, countryCode: null,
      networkName: null, imageUrl: null, premieredAt: null, endedAt: null,
    });
    expect(rows[2]!.sourceFacts).toMatchObject({
      sourceUrl: null, summary: null, imageUrl: null, premieredAt: null,
      runtimeMinutes: null, ratingAverage: null, genres: [],
    });
  });

  it("constructs a deterministic multi-season hierarchy using provider Season IDs", () => {
    const rows = normalized().chunk.content;
    expect(rows.map((row) => [row.id, row.parentId, row.sourceFacts.sourceId])).toEqual([
      ["tvmaze-series-100", null, "show:100"],
      ["tvmaze-season-201", "tvmaze-series-100", "season:201"],
      ["tvmaze-season-202", "tvmaze-series-100", "season:202"],
      ["tvmaze-episode-301", "tvmaze-season-201", "episode:301"],
      ["tvmaze-episode-302", "tvmaze-season-202", "episode:302"],
    ]);
  });

  it("creates and records a deterministic Season fallback without orphans", () => {
    const result = normalized(snapshot({ seasons: [season(201, 1)], episodes: [episode(303, 3, 1)] }));
    expect(result.chunk.content.map((row) => [row.id, row.parentId])).toEqual([
      ["tvmaze-series-100", null],
      ["tvmaze-season-201", "tvmaze-series-100"],
      ["tvmaze-series-100-season-3", "tvmaze-series-100"],
      ["tvmaze-episode-303", "tvmaze-series-100-season-3"],
    ]);
    expect(result.chunk.derivedSeasons).toMatchObject([
      { contentId: "tvmaze-series-100-season-3", sourceId: "season-derived:100:3" },
    ]);
  });

  it("skips an ambiguous Show instead of choosing between conflicting Seasons", () => {
    expect(normalizeTvMazeHierarchy(snapshot({ seasons: [season(201, 1), season(999, 1)] }))).toEqual({
      status: "skipped", showId: 100, reason: "AMBIGUOUS_SEASON_MAPPING",
    });
  });

  it("collapses repeated identical Seasons and Episodes", () => {
    const oneSeason = season(201, 1);
    const oneEpisode = episode(301, 1, 1);
    const result = normalized(snapshot({
      seasons: [oneSeason, structuredClone(oneSeason)],
      episodes: [oneEpisode, structuredClone(oneEpisode)],
    }));
    expect(result.chunk.content.map((row) => row.id)).toEqual([
      "tvmaze-series-100", "tvmaze-season-201", "tvmaze-episode-301",
    ]);
  });

  it("excludes special and null-numbered Episodes with explicit reasons", () => {
    const special = { ...episode(401, 1, 1), type: "significant_special" };
    const nullEpisode = { ...episode(402, 1, 1), number: null };
    const nullSeason = { ...episode(403, 1, 1), season: null };
    const result = normalized(snapshot({ seasons: [season(201, 1)], episodes: [special, nullEpisode, nullSeason] }));
    expect(result.chunk.content.map((row) => row.type)).toEqual(["SERIES", "SEASON"]);
    expect(result.excludedEpisodes).toHaveLength(3);
    expect(result.excludedEpisodes.every((item) => item.reason === "SPECIAL_OR_UNNUMBERED_EPISODE")).toBe(true);
  });

  it.each([
    ["date", { premiered: "2020-02-30" }, "premieredAt"],
    ["empty date", { premiered: "" }, "premieredAt"],
    ["runtime", { runtime: 0 }, "runtimeMinutes"],
    ["rating", { rating: { average: 11 } }, "ratingAverage"],
    ["country", { network: { name: "Network", country: { code: "USA" } } }, "countryCode"],
  ])("normalizes invalid optional %s values to null", (_label, showOverride, field) => {
    const result = normalized(snapshot({ show: { ...show, ...showOverride } }));
    expect(result.chunk.content[0]!.sourceFacts[field as keyof typeof result.chunk.content[0]["sourceFacts"]]).toBeNull();
  });

  it("returns the same normalized order for shuffled provider responses", () => {
    const ordered = normalized(snapshot()).chunk;
    const shuffled = normalized(snapshot({
      seasons: [season(202, 2), season(201, 1)],
      episodes: [episode(301, 1, 1), episode(302, 2, 1)],
    })).chunk;
    expect(shuffled).toEqual(ordered);
  });
});
