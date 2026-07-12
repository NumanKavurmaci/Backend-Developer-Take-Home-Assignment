import { calculateArtifactNormalizedBytes } from "./artifact.js";
import { assertEstimatedDatabaseBudget } from "./budget.js";
import type { CatalogArtifactConfiguration } from "./artifact-types.js";
import { applyDeterministicDemoPolicies, type GeneratedCatalogPolicies } from "./policies.js";
import type { TvMazeEpisode } from "./tvmaze-contracts.js";
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
  let combined: NormalizedCatalogChunk = {
    content: [],
    geoBlocks: [],
    derivedSeasons: [],
  };
  let pagesFetched = 0;
  let showsIncluded = 0;
  const showsSkipped: Array<{ showId: number; reason: string }> = [];
  const excludedEpisodes: ExcludedProviderRecord[] = [];
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

    for (const show of [...shows].sort((left, right) => left.id - right.id)) {
      if (showsIncluded >= config.maxShows) {
        stopReason = "max-shows";
        break outer;
      }
      if (seenShowIds.has(show.id)) continue;
      seenShowIds.add(show.id);
      if (!isUsableTvMazeShow(show)) {
        showsSkipped.push({ showId: show.id, reason: "INELIGIBLE_SHOW" });
        onProgress({ type: "show-skipped", showId: show.id, reason: "INELIGIBLE_SHOW" });
        continue;
      }

      const [seasons, sourceEpisodes] = await Promise.all([
        source.getShowSeasons(show.id),
        source.getShowEpisodes(show.id),
      ]);
      const episodes = limitRegularEpisodes(
        sourceEpisodes,
        config.maxEpisodesPerShow,
      );
      const normalized = normalizeTvMazeHierarchy({
        show,
        seasons: seasons.filter(
          (season) => Number.isSafeInteger(season.number) && season.number > 0,
        ),
        episodes,
      });
      if (normalized.status === "skipped") {
        showsSkipped.push({ showId: show.id, reason: normalized.reason });
        onProgress({ type: "show-skipped", showId: show.id, reason: normalized.reason });
        continue;
      }

      const candidate = mergeChunks(combined, normalized.chunk);
      if (candidate.content.length > config.maxContentRows) {
        stopReason = "max-content-rows";
        break outer;
      }

      const guarded = tryApplyStorageGuards(candidate, config);
      if (guarded.stopReason !== undefined) {
        stopReason = guarded.stopReason;
        break outer;
      }

      combined = candidate;
      showsIncluded += 1;
      excludedEpisodes.push(...normalized.excludedEpisodes);
      onProgress({
        type: "show-included",
        showId: show.id,
        showRows: normalized.chunk.content.length,
        showsIncluded,
        totalRows: combined.content.length,
        remainingShows: config.maxShows - showsIncluded,
        remainingRows: config.maxContentRows - combined.content.length,
      });
      if (showsIncluded >= config.maxShows) {
        stopReason = "max-shows";
        break outer;
      }
    }
  }

  if (combined.content.length === 0) {
    throw new Error("TVmaze catalog build produced no complete Show hierarchy.");
  }
  const generated = applyDeterministicDemoPolicies(combined);
  const normalizedBytes = calculateArtifactNormalizedBytes(generated.chunk);
  if (normalizedBytes > config.maxNormalizedArtifactBytes) {
    throw new Error(
      `Smallest scenario-capable catalog exceeds normalized artifact guard: ${normalizedBytes} bytes.`,
    );
  }
  const estimatedDatabaseBytes = estimateCatalogDatabaseBytes(
    generated.chunk,
    normalizedBytes,
  );
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
      showsIncluded,
      showsSkipped,
      excludedEpisodes: excludedEpisodes.sort((left, right) =>
        left.sourceId.localeCompare(right.sourceId),
      ),
      stopReason,
    },
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

function tryApplyStorageGuards(
  chunk: NormalizedCatalogChunk,
  config: CatalogArtifactConfiguration,
): { stopReason?: CatalogBuildStopReason } {
  let generated: GeneratedCatalogPolicies;
  try {
    generated = applyDeterministicDemoPolicies(chunk);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith("Catalog cannot provide demo scenarios")
    ) {
      return {};
    }
    throw error;
  }
  const normalizedBytes = calculateArtifactNormalizedBytes(generated.chunk);
  if (normalizedBytes > config.maxNormalizedArtifactBytes) {
    return { stopReason: "max-normalized-artifact-bytes" };
  }
  const estimate = estimateCatalogDatabaseBytes(generated.chunk, normalizedBytes);
  if (estimate > config.maxEstimatedDatabaseBytes) {
    return { stopReason: "max-estimated-database-bytes" };
  }
  return {};
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

function mergeChunks(
  left: NormalizedCatalogChunk,
  right: NormalizedCatalogChunk,
): NormalizedCatalogChunk {
  return {
    content: [...left.content, ...right.content],
    geoBlocks: [...left.geoBlocks, ...right.geoBlocks],
    derivedSeasons: [...left.derivedSeasons, ...right.derivedSeasons],
  };
}
