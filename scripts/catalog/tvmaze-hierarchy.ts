import { isDeepStrictEqual } from "node:util";
import { tvmazeSourceId } from "./identifiers.js";
import type { TvMazeEpisode, TvMazeSeason, TvMazeShow } from "./tvmaze-contracts.js";
import {
  isUsableTvMazeShow,
  normalizeTvMazeDerivedSeason,
  normalizeTvMazeEpisode,
  normalizeTvMazeSeason,
  normalizeTvMazeShow,
} from "./tvmaze-normalize.js";
import type {
  ExcludedProviderRecord,
  NormalizedCatalogChunk,
  NormalizedContentRow,
} from "./types.js";
import { validateNormalizedCatalogChunk } from "./validate.js";

export interface TvMazeShowSnapshot {
  show: TvMazeShow;
  seasons: TvMazeSeason[];
  episodes: TvMazeEpisode[];
}

export type TvMazeHierarchyResult =
  | {
      status: "normalized";
      chunk: NormalizedCatalogChunk;
      excludedEpisodes: ExcludedProviderRecord[];
    }
  | {
      status: "skipped";
      showId: number;
      reason: "INELIGIBLE_SHOW" | "AMBIGUOUS_SEASON_MAPPING";
    };

export function normalizeTvMazeHierarchy(snapshot: TvMazeShowSnapshot): TvMazeHierarchyResult {
  if (!isUsableTvMazeShow(snapshot.show)) {
    return { status: "skipped", showId: snapshot.show.id, reason: "INELIGIBLE_SHOW" };
  }

  const seasons = deduplicateById(snapshot.seasons, "Season");
  const episodes = deduplicateById(snapshot.episodes, "Episode");
  const seasonByNumber = new Map<number, TvMazeSeason>();
  for (const season of seasons) {
    assertPositiveInteger(season.number, `Season ${season.id} number`);
    const existing = seasonByNumber.get(season.number);
    if (existing !== undefined && existing.id !== season.id) {
      return {
        status: "skipped",
        showId: snapshot.show.id,
        reason: "AMBIGUOUS_SEASON_MAPPING",
      };
    }
    seasonByNumber.set(season.number, season);
  }

  const excludedEpisodes: ExcludedProviderRecord[] = [];
  const includedEpisodes: Array<TvMazeEpisode & { season: number; number: number }> = [];
  for (const episode of episodes) {
    if (!isRegularNumberedEpisode(episode)) {
      excludedEpisodes.push({
        sourceId: tvmazeSourceId("episode", episode.id),
        reason: "SPECIAL_OR_UNNUMBERED_EPISODE",
      });
    } else {
      includedEpisodes.push(episode);
    }
  }

  const seriesRow = normalizeTvMazeShow(snapshot.show);
  const seasonRows: NormalizedContentRow[] = [];
  const derivedSeasons: NormalizedCatalogChunk["derivedSeasons"] = [];
  const seasonContentIdByNumber = new Map<number, string>();

  for (const season of [...seasonByNumber.values()].sort(compareSeasons)) {
    const row = normalizeTvMazeSeason(snapshot.show.id, season);
    seasonRows.push(row);
    seasonContentIdByNumber.set(season.number, row.id);
  }

  const missingSeasonNumbers = [...new Set(
    includedEpisodes
      .map((episode) => episode.season)
      .filter((seasonNumber) => !seasonContentIdByNumber.has(seasonNumber)),
  )].sort((left, right) => left - right);

  for (const seasonNumber of missingSeasonNumbers) {
    const derived = normalizeTvMazeDerivedSeason(snapshot.show.id, seasonNumber);
    seasonRows.push(derived.row);
    derivedSeasons.push(derived.fallback);
    seasonContentIdByNumber.set(seasonNumber, derived.row.id);
  }

  seasonRows.sort(compareNormalizedSeasons);
  const episodeRows = includedEpisodes
    .sort(compareEpisodes)
    .map((episode) => {
      const parentId = seasonContentIdByNumber.get(episode.season);
      if (parentId === undefined) {
        throw new Error(`TVmaze Episode ${episode.id} has no normalized Season parent.`);
      }
      return normalizeTvMazeEpisode(snapshot.show.id, parentId, episode);
    });

  const chunk: NormalizedCatalogChunk = {
    content: [seriesRow, ...seasonRows, ...episodeRows],
    geoBlocks: [],
    derivedSeasons: derivedSeasons.sort(
      (left, right) => left.seasonNumber - right.seasonNumber || left.contentId.localeCompare(right.contentId),
    ),
  };
  validateNormalizedCatalogChunk(chunk);
  excludedEpisodes.sort((left, right) => left.sourceId.localeCompare(right.sourceId));
  return { status: "normalized", chunk, excludedEpisodes };
}

function deduplicateById<T extends { id: number }>(records: T[], label: string): T[] {
  const byId = new Map<number, T>();
  for (const record of records) {
    assertPositiveInteger(record.id, `${label} ID`);
    const existing = byId.get(record.id);
    if (existing !== undefined && !isDeepStrictEqual(existing, record)) {
      throw new Error(`Conflicting duplicate TVmaze ${label} ID: ${record.id}.`);
    }
    byId.set(record.id, record);
  }
  return [...byId.values()];
}

function isRegularNumberedEpisode(
  episode: TvMazeEpisode,
): episode is TvMazeEpisode & { season: number; number: number } {
  return episode.type === "regular" &&
    Number.isSafeInteger(episode.season) && episode.season! > 0 &&
    Number.isSafeInteger(episode.number) && episode.number! > 0;
}

function compareSeasons(left: TvMazeSeason, right: TvMazeSeason): number {
  return left.number - right.number || left.id - right.id;
}

function compareNormalizedSeasons(left: NormalizedContentRow, right: NormalizedContentRow): number {
  return (left.sourceFacts.seasonNumber ?? 0) - (right.sourceFacts.seasonNumber ?? 0) ||
    left.id.localeCompare(right.id);
}

function compareEpisodes(left: TvMazeEpisode & { season: number; number: number }, right: TvMazeEpisode & { season: number; number: number }): number {
  return left.season - right.season || left.number - right.number || left.id - right.id;
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Invalid TVmaze ${label}: ${value}.`);
}
