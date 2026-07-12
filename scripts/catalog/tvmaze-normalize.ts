import {
  tvmazeDerivedSeasonId,
  tvmazeDerivedSeasonSourceId,
  tvmazeEpisodeId,
  tvmazeSeasonId,
  tvmazeSeriesId,
  tvmazeSourceId,
} from "./identifiers.js";
import type { TvMazeEpisode, TvMazeSeason, TvMazeShow } from "./tvmaze-contracts.js";
import {
  EMPTY_SAATCMS_POLICIES,
  type CatalogSourceFacts,
  type DerivedSeasonIdentity,
  type NormalizedContentRow,
  type SaatCmsPolicies,
} from "./types.js";

export function isUsableTvMazeShow(record: Pick<TvMazeShow, "id" | "name">): boolean {
  return Number.isSafeInteger(record.id) && record.id > 0 && record.name.trim() !== "";
}

export function normalizeTvMazeShow(show: TvMazeShow, policies?: SaatCmsPolicies): NormalizedContentRow {
  assertUsableRecord(show.id, show.name, "show");
  const network = show.network ?? show.webChannel;
  return {
    id: tvmazeSeriesId(show.id),
    type: "SERIES",
    title: show.name.trim(),
    parentId: null,
    sourceFacts: sourceFacts({
      sourceId: tvmazeSourceId("show", show.id),
      sourceUrl: show.url,
      originalTitle: show.name,
      summary: show.summary,
      language: show.language,
      status: show.status,
      countryCode: network?.country?.code ?? null,
      networkName: network?.name ?? null,
      officialSiteUrl: show.officialSite,
      imageUrl: imageUrl(show.image),
      premieredAt: show.premiered,
      endedAt: show.ended,
      runtimeMinutes: show.runtime,
      ratingAverage: show.rating.average,
      genres: [...show.genres],
    }),
    policies: { ...(policies ?? EMPTY_SAATCMS_POLICIES) },
  };
}

export function normalizeTvMazeSeason(
  showId: number,
  season: TvMazeSeason,
  policies?: SaatCmsPolicies,
): NormalizedContentRow {
  assertUsableRecord(season.id, season.name ?? `Season ${season.number}`, "season");
  const network = season.network ?? season.webChannel;
  return {
    id: tvmazeSeasonId(season.id),
    type: "SEASON",
    title: season.name?.trim() || `Season ${season.number}`,
    parentId: tvmazeSeriesId(showId),
    sourceFacts: sourceFacts({
      sourceId: tvmazeSourceId("season", season.id),
      sourceUrl: season.url,
      originalTitle: season.name,
      summary: season.summary,
      countryCode: network?.country?.code ?? null,
      networkName: network?.name ?? null,
      imageUrl: imageUrl(season.image),
      premieredAt: season.premiereDate,
      endedAt: season.endDate,
      seasonNumber: season.number,
    }),
    policies: { ...(policies ?? EMPTY_SAATCMS_POLICIES) },
  };
}

export function normalizeTvMazeDerivedSeason(
  showId: number,
  seasonNumber: number,
  policies?: SaatCmsPolicies,
): { row: NormalizedContentRow; fallback: DerivedSeasonIdentity } {
  const contentId = tvmazeDerivedSeasonId(showId, seasonNumber);
  const sourceId = tvmazeDerivedSeasonSourceId(showId, seasonNumber);
  return {
    row: {
      id: contentId,
      type: "SEASON",
      title: `Season ${seasonNumber}`,
      parentId: tvmazeSeriesId(showId),
      sourceFacts: sourceFacts({ sourceId, seasonNumber }),
      policies: { ...(policies ?? EMPTY_SAATCMS_POLICIES) },
    },
    fallback: {
      contentId,
      seriesId: tvmazeSeriesId(showId),
      showId,
      seasonNumber,
      sourceId,
      reason: "TVMAZE_SEASON_RECORD_UNAVAILABLE",
    },
  };
}

export function normalizeTvMazeEpisode(
  showId: number,
  seasonContentId: string,
  episode: TvMazeEpisode,
  policies?: SaatCmsPolicies,
): NormalizedContentRow {
  tvmazeSeriesId(showId);
  assertUsableRecord(episode.id, episode.name, "episode");
  return {
    id: tvmazeEpisodeId(episode.id),
    type: "EPISODE",
    title: episode.name.trim(),
    parentId: seasonContentId,
    sourceFacts: sourceFacts({
      sourceId: tvmazeSourceId("episode", episode.id),
      sourceUrl: episode.url,
      originalTitle: episode.name,
      summary: episode.summary,
      imageUrl: imageUrl(episode.image),
      premieredAt: episode.airdate,
      runtimeMinutes: episode.runtime,
      seasonNumber: episode.season,
      episodeNumber: episode.number,
      ratingAverage: episode.rating.average,
    }),
    policies: { ...(policies ?? EMPTY_SAATCMS_POLICIES) },
  };
}

function sourceFacts(overrides: Partial<CatalogSourceFacts> & Pick<CatalogSourceFacts, "sourceId">): CatalogSourceFacts {
  const { sourceId, ...facts } = overrides;
  return {
    source: "TVMAZE",
    sourceId,
    sourceUrl: null,
    originalTitle: null,
    summary: null,
    language: null,
    status: null,
    countryCode: null,
    networkName: null,
    officialSiteUrl: null,
    imageUrl: null,
    premieredAt: null,
    endedAt: null,
    runtimeMinutes: null,
    seasonNumber: null,
    episodeNumber: null,
    ratingAverage: null,
    genres: [],
    sourceMetadata: null,
    ...facts,
  };
}

function imageUrl(image: { medium: string | null; original: string | null } | null): string | null {
  return image?.original ?? image?.medium ?? null;
}

function assertUsableRecord(id: number, title: string, kind: string): void {
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error(`Malformed TVmaze ${kind}: invalid ID.`);
  if (title.trim() === "") throw new Error(`Malformed TVmaze ${kind}: blank title.`);
}
