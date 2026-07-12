import {
  tvmazeDerivedSeasonId,
  tvmazeDerivedSeasonSourceId,
  tvmazeEpisodeId,
  tvmazeSeasonId,
  tvmazeSeriesId,
  tvmazeSourceId,
} from "./identifiers.js";
import type { TvMazeEpisode, TvMazeSeason, TvMazeShow } from "./tvmaze-contracts.js";
import { sanitizePlainText } from "./sanitize.js";
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
  const title = requiredPlainText(show.name, "show");
  assertUsableRecord(show.id, title, "show");
  const network = show.network ?? show.webChannel;
  return {
    id: tvmazeSeriesId(show.id),
    type: "SERIES",
    title,
    parentId: null,
    sourceFacts: sourceFacts({
      sourceId: tvmazeSourceId("show", show.id),
      sourceUrl: show.url,
      originalTitle: title,
      summary: sanitizePlainText(show.summary),
      language: sanitizePlainText(show.language),
      status: sanitizePlainText(show.status),
      countryCode: normalizeCountryCode(network?.country?.code ?? null),
      networkName: sanitizePlainText(network?.name ?? null),
      officialSiteUrl: show.officialSite,
      imageUrl: imageUrl(show.image),
      premieredAt: show.premiered,
      endedAt: show.ended,
      runtimeMinutes: show.runtime,
      ratingAverage: show.rating.average,
      genres: normalizeGenres(show.genres),
    }),
    policies: { ...(policies ?? EMPTY_SAATCMS_POLICIES) },
  };
}

export function normalizeTvMazeSeason(
  showId: number,
  season: TvMazeSeason,
  policies?: SaatCmsPolicies,
): NormalizedContentRow {
  const title = sanitizePlainText(season.name) ?? `Season ${season.number}`;
  assertUsableRecord(season.id, title, "season");
  const network = season.network ?? season.webChannel;
  return {
    id: tvmazeSeasonId(season.id),
    type: "SEASON",
    title,
    parentId: tvmazeSeriesId(showId),
    sourceFacts: sourceFacts({
      sourceId: tvmazeSourceId("season", season.id),
      sourceUrl: season.url,
      originalTitle: sanitizePlainText(season.name),
      summary: sanitizePlainText(season.summary),
      countryCode: normalizeCountryCode(network?.country?.code ?? null),
      networkName: sanitizePlainText(network?.name ?? null),
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
  const title = requiredPlainText(episode.name, "episode");
  assertUsableRecord(episode.id, title, "episode");
  return {
    id: tvmazeEpisodeId(episode.id),
    type: "EPISODE",
    title,
    parentId: seasonContentId,
    sourceFacts: sourceFacts({
      sourceId: tvmazeSourceId("episode", episode.id),
      sourceUrl: episode.url,
      originalTitle: title,
      summary: sanitizePlainText(episode.summary),
      imageUrl: imageUrl(episode.image),
      premieredAt: episode.airdate,
      runtimeMinutes: episode.runtime,
      seasonNumber: episode.season,
      episodeNumber: episode.number,
      ratingAverage: episode.rating.average,
      sourceMetadata: episode.type === null ? null : { episodeType: episode.type },
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

function requiredPlainText(value: string, kind: string): string {
  const text = sanitizePlainText(value);
  if (text === null) throw new Error(`Malformed TVmaze ${kind}: blank title.`);
  return text;
}

function normalizeCountryCode(value: string | null): string | null {
  return value === null ? null : value.trim().toUpperCase();
}

function normalizeGenres(values: string[]): string[] {
  return [...new Set(values.map((value) => sanitizePlainText(value)).filter((value): value is string => value !== null))]
    .sort((left, right) => left.localeCompare(right));
}
