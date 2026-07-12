import { calculateArtifactNormalizedBytes } from "./artifact.js";
import { assertEstimatedDatabaseBudget } from "./budget.js";
import type { CatalogArtifactConfiguration } from "./artifact-types.js";
import { applyDeterministicDemoPolicies, type GeneratedCatalogPolicies } from "./policies.js";
import type { TvMazeEpisode, TvMazeShow } from "./tvmaze-contracts.js";
import type { TvMazeCatalogSource } from "./tvmaze-source.js";
import { isUsableTvMazeShow } from "./tvmaze-normalize.js";
import { normalizeTvMazeHierarchy } from "./tvmaze-hierarchy.js";
import type { ExcludedProviderRecord, NormalizedCatalogChunk } from "./types.js";

export type CatalogBuildStopReason =
  | "max-shows"
  | "max-content-rows"
  | "max-normalized-artifact-bytes"
  | "max-estimated-database-bytes"
  | "end-of-index"
  | "max-pages";

export interface CatalogBuildResult extends GeneratedCatalogPolicies {
  normalizedBytes: number;
  estimatedDatabaseBytes: number;
  summary: {
    pagesFetched: number;
    showsIncluded: number;
    showsSkipped: Array<{ showId: number; reason: string }>;
    excludedEpisodes: ExcludedProviderRecord[];
    stopReason: CatalogBuildStopReason;
  };
}

export type CatalogBuildProgressEvent =
  | { type: "page"; page: number; showsDiscovered: number; pagesFetched: number }
  | {
      type: "show-included";
      showId: number;
      showRows: number;
      showsIncluded: number;
      totalRows: number;
      remainingShows: number;
      remainingRows: number;
    }
  | { type: "show-skipped"; showId: number; reason: string }
  | { type: "complete"; stopReason: CatalogBuildStopReason; normalizedBytes: number; estimatedDatabaseBytes: number };

export async function buildCatalogFromTvMaze(
  source: TvMazeCatalogSource,
  config: CatalogArtifactConfiguration,
  onProgress: (event: CatalogBuildProgressEvent) => void = () => undefined,
): Promise<CatalogBuildResult> {
  const acceptedShows: AcceptedShow[] = [];
  let pagesFetched = 0;
  let totalRows = 0;
  const showsSkipped: Array<{ showId: number; reason: string }> = [];
  const seenShowIds = new Set<number>();
  let stopReason: CatalogBuildStopReason = "max-pages";

  outer: for (
    let page = config.tvmazeStartPage;
    page < config.tvmazeStartPage + config.maxPages;
    page += 1
  ) {
    const shows = await source.getShowPage(page);
    pagesFetched += 1;
    onProgress({
      type: "page",
      page,
      showsDiscovered: shows?.length ?? 0,
      pagesFetched,
    });
    if (shows === null || shows.length === 0) {
      stopReason = "end-of-index";
      break;
    }

    const uniqueShows = [...shows]
      .sort((left, right) => left.id - right.id)
      .filter((show) => {
        if (seenShowIds.has(show.id)) return false;
        seenShowIds.add(show.id);
        return true;
      });

    for (let offset = 0; offset < uniqueShows.length;) {
      const remainingShowSlots = config.maxShows - acceptedShows.length;
      if (remainingShowSlots <= 0) {
        stopReason = "max-shows";
        break outer;
      }
      const batchSize = Math.min(
        config.fetchConcurrency,
        remainingShowSlots,
        uniqueShows.length - offset,
      );
      const batch = uniqueShows.slice(offset, offset + batchSize);
      offset += batchSize;
      const processed = await Promise.all(
        batch.map((show) => processShow(source, show, config)),
      );

      for (const result of processed) {
        if (result.status === "skipped") {
          showsSkipped.push({ showId: result.showId, reason: result.reason });
          onProgress({ type: "show-skipped", showId: result.showId, reason: result.reason });
          continue;
        }
        const showRows = result.chunk.content.length;
        if (totalRows + showRows > config.maxContentRows) {
          stopReason = "max-content-rows";
          break outer;
        }
        acceptedShows.push(result);
        totalRows += showRows;
        onProgress({
          type: "show-included",
          showId: result.showId,
          showRows,
          showsIncluded: acceptedShows.length,
          totalRows,
          remainingShows: config.maxShows - acceptedShows.length,
          remainingRows: config.maxContentRows - totalRows,
        });
        if (acceptedShows.length >= config.maxShows) {
          stopReason = "max-shows";
          break outer;
        }
      }
    }
  }

  if (acceptedShows.length === 0) {
    throw new Error("TVmaze catalog build produced no complete Show hierarchy.");
  }
  const fitted = fitCompleteShowPrefix(acceptedShows, config);
  if (fitted.showCount < acceptedShows.length) stopReason = fitted.stopReason;
  const { generated, normalizedBytes, estimatedDatabaseBytes } = fitted;
  assertEstimatedDatabaseBudget(estimatedDatabaseBytes, config);
  onProgress({
    type: "complete",
    stopReason,
    normalizedBytes,
    estimatedDatabaseBytes,
  });

  return {
    ...generated,
    normalizedBytes,
    estimatedDatabaseBytes,
    summary: {
      pagesFetched,
      showsIncluded: fitted.showCount,
      showsSkipped,
      excludedEpisodes: acceptedShows
        .slice(0, fitted.showCount)
        .flatMap((show) => show.excludedEpisodes)
        .sort((left, right) => left.sourceId.localeCompare(right.sourceId)),
      stopReason,
    },
  };
}

interface AcceptedShow {
  status: "normalized";
  showId: number;
  chunk: NormalizedCatalogChunk;
  excludedEpisodes: ExcludedProviderRecord[];
}

type ProcessedShow =
  | AcceptedShow
  | { status: "skipped"; showId: number; reason: string };

async function processShow(
  source: TvMazeCatalogSource,
  show: TvMazeShow,
  config: CatalogArtifactConfiguration,
): Promise<ProcessedShow> {
  if (!isUsableTvMazeShow(show)) {
    return { status: "skipped", showId: show.id, reason: "INELIGIBLE_SHOW" };
  }
  const [seasons, sourceEpisodes] = await Promise.all([
    source.getShowSeasons(show.id),
    source.getShowEpisodes(show.id),
  ]);
  const normalized = normalizeTvMazeHierarchy({
    show,
    seasons: seasons.filter(
      (season) => Number.isSafeInteger(season.number) && season.number > 0,
    ),
    episodes: limitRegularEpisodes(sourceEpisodes, config.maxEpisodesPerShow),
  });
  return normalized.status === "skipped"
    ? { status: "skipped", showId: show.id, reason: normalized.reason }
    : {
        status: "normalized",
        showId: show.id,
        chunk: normalized.chunk,
        excludedEpisodes: normalized.excludedEpisodes,
      };
}

interface EvaluatedPrefix {
  showCount: number;
  generated: GeneratedCatalogPolicies;
  normalizedBytes: number;
  estimatedDatabaseBytes: number;
  stopReason: Extract<
    CatalogBuildStopReason,
    "max-normalized-artifact-bytes" | "max-estimated-database-bytes"
  >;
}

function fitCompleteShowPrefix(
  shows: AcceptedShow[],
  config: CatalogArtifactConfiguration,
): EvaluatedPrefix {
  const minimum = shows.findIndex((show) => supportsDemoScenarios(show.chunk)) + 1;
  if (minimum === 0) {
    throw new Error(
      "Catalog cannot provide demo scenarios: no complete Show has the required Season/Episode hierarchy.",
    );
  }
  const evaluate = (showCount: number): Omit<EvaluatedPrefix, "stopReason"> => {
    const generated = applyDeterministicDemoPolicies(mergeShowChunks(shows, showCount));
    const normalizedBytes = calculateArtifactNormalizedBytes(generated.chunk);
    return {
      showCount,
      generated,
      normalizedBytes,
      estimatedDatabaseBytes: estimateCatalogDatabaseBytes(generated.chunk, normalizedBytes),
    };
  };
  const fits = (candidate: Omit<EvaluatedPrefix, "stopReason">): boolean =>
    candidate.normalizedBytes <= config.maxNormalizedArtifactBytes &&
    candidate.estimatedDatabaseBytes <= config.maxEstimatedDatabaseBytes;

  const complete = evaluate(shows.length);
  if (fits(complete)) {
    return { ...complete, stopReason: "max-estimated-database-bytes" };
  }
  const stopReason = complete.normalizedBytes > config.maxNormalizedArtifactBytes
    ? "max-normalized-artifact-bytes"
    : "max-estimated-database-bytes";
  let low = minimum;
  let high = shows.length - 1;
  let best: Omit<EvaluatedPrefix, "stopReason"> | undefined;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = evaluate(middle);
    if (fits(candidate)) {
      best = candidate;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  if (best === undefined) {
    const smallest = evaluate(minimum);
    throw new Error(
      `Smallest scenario-capable catalog exceeds storage guard: ${smallest.normalizedBytes} normalized bytes, ${smallest.estimatedDatabaseBytes} estimated database bytes.`,
    );
  }
  return { ...best, stopReason };
}

function supportsDemoScenarios(chunk: NormalizedCatalogChunk): boolean {
  for (const series of chunk.content.filter((row) => row.type === "SERIES")) {
    const seasons = chunk.content.filter(
      (row) => row.type === "SEASON" && row.parentId === series.id,
    );
    const episodeCounts = seasons.map(
      (season) => chunk.content.filter(
        (row) => row.type === "EPISODE" && row.parentId === season.id,
      ).length,
    );
    return episodeCounts.some((count) => count >= 1) &&
      episodeCounts.some((count, index) => count >= 2 && episodeCounts.some(
        (otherCount, otherIndex) => otherIndex !== index && otherCount >= 1,
      ));
  }
  return false;
}

function mergeShowChunks(shows: AcceptedShow[], count: number): NormalizedCatalogChunk {
  const selected = shows.slice(0, count);
  return {
    content: selected.flatMap((show) => show.chunk.content),
    geoBlocks: selected.flatMap((show) => show.chunk.geoBlocks),
    derivedSeasons: selected.flatMap((show) => show.chunk.derivedSeasons),
  };
}

export function estimateCatalogDatabaseBytes(
  chunk: NormalizedCatalogChunk,
  normalizedBytes: number,
): number {
  return Math.ceil(
    normalizedBytes * 2.5 +
      chunk.content.length * 1_200 +
      chunk.geoBlocks.length * 300,
  );
}

function limitRegularEpisodes(
  episodes: TvMazeEpisode[],
  maximum: number,
): TvMazeEpisode[] {
  const regular = [...episodes]
    .filter(
      (episode) =>
        episode.type === "regular" &&
        Number.isSafeInteger(episode.season) &&
        (episode.season ?? 0) > 0 &&
        Number.isSafeInteger(episode.number) &&
        (episode.number ?? 0) > 0,
    )
    .sort(
      (left, right) =>
        (left.season ?? 0) - (right.season ?? 0) ||
        (left.number ?? 0) - (right.number ?? 0) ||
        left.id - right.id,
    );
  const selectedIds = new Set<number>();
  for (const episode of regular) {
    if (!selectedIds.has(episode.id) && selectedIds.size < maximum) {
      selectedIds.add(episode.id);
    }
  }
  return episodes.filter(
    (episode) =>
      episode.type !== "regular" ||
      episode.season === null ||
      episode.number === null ||
      episode.season <= 0 ||
      episode.number <= 0 ||
      selectedIds.has(episode.id),
  );
}
