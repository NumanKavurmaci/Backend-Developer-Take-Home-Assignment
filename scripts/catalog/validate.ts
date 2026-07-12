import {
  tvmazeDerivedSeasonId,
  tvmazeDerivedSeasonSourceId,
  tvmazeEpisodeId,
  tvmazeSeasonId,
  tvmazeSeriesId,
} from "./identifiers.js";
import type { DerivedSeasonIdentity, NormalizedCatalogArtifact, NormalizedContentRow } from "./types.js";

const COUNTRY_CODE = /^[A-Z]{2}$/;

export function validateNormalizedCatalog(artifact: NormalizedCatalogArtifact): void {
  const byId = new Map<string, NormalizedContentRow>();
  const sourceIdentities = new Set<string>();
  const logicalSeasons = new Set<string>();

  for (const row of artifact.content) {
    if (row.title.trim() === "") throw new Error(`Blank content title: ${row.id}.`);
    if (byId.has(row.id)) throw new Error(`Duplicate content ID: ${row.id}.`);
    byId.set(row.id, row);

    const sourceKey = `${row.sourceFacts.source}/${row.sourceFacts.sourceId}`;
    if (sourceIdentities.has(sourceKey)) throw new Error(`Duplicate source identity: ${sourceKey}.`);
    sourceIdentities.add(sourceKey);

    validateSourceFacts(row);
    validateStableTvMazeIdentity(row);
  }

  for (const row of artifact.content) {
    validateParent(row, byId);
    if (row.type === "SEASON") {
      const key = `${row.parentId}/${row.sourceFacts.seasonNumber}`;
      if (logicalSeasons.has(key)) throw new Error(`Actual and derived Season identities cannot be mixed: ${key}.`);
      logicalSeasons.add(key);
    }
  }

  validateDerivedSeasons(artifact.metadata.derivedSeasons, artifact.content, byId);
  for (const geoBlock of artifact.geoBlocks) {
    if (!byId.has(geoBlock.contentId)) throw new Error(`Geo-block row has missing Content: ${geoBlock.contentId}.`);
    assertCountryCode(geoBlock.countryCode, `geo-block ${geoBlock.contentId}`);
  }
}

function validateParent(row: NormalizedContentRow, byId: Map<string, NormalizedContentRow>): void {
  if (row.type === "SERIES" || row.type === "MOVIE") {
    if (row.parentId !== null) throw new Error(`${row.type} must not have a parent: ${row.id}.`);
    return;
  }
  if (row.parentId === null) throw new Error(`Orphan ${row.type}: ${row.id}.`);
  const parent = byId.get(row.parentId);
  if (parent === undefined) throw new Error(`Missing parent for ${row.id}: ${row.parentId}.`);
  if (row.type === "SEASON" && parent.type !== "SERIES") throw new Error(`Season parent must be SERIES: ${row.id}.`);
  if (row.type === "EPISODE" && parent.type !== "SEASON") throw new Error(`Episode parent must be SEASON: ${row.id}.`);
}

function validateSourceFacts(row: NormalizedContentRow): void {
  const facts = row.sourceFacts;
  if (facts.sourceId.trim() === "") throw new Error(`Blank source identity: ${row.id}.`);
  if ((row.type === "SEASON" || row.type === "EPISODE") && facts.seasonNumber === null) {
    throw new Error(`Missing seasonNumber for ${row.id}.`);
  }
  if (facts.countryCode !== null) assertCountryCode(facts.countryCode, row.id);
  for (const [label, value] of [["premieredAt", facts.premieredAt], ["endedAt", facts.endedAt]] as const) {
    if (value !== null && !isIsoDate(value)) throw new Error(`Invalid ${label} for ${row.id}: ${value}.`);
  }
  if (facts.ratingAverage !== null && (!Number.isFinite(facts.ratingAverage) || facts.ratingAverage < 0 || facts.ratingAverage > 10)) {
    throw new Error(`Invalid rating for ${row.id}: ${facts.ratingAverage}.`);
  }
  for (const [label, value] of [["runtimeMinutes", facts.runtimeMinutes], ["seasonNumber", facts.seasonNumber], ["episodeNumber", facts.episodeNumber]] as const) {
    if (value !== null && (!Number.isSafeInteger(value) || value <= 0)) throw new Error(`Invalid ${label} for ${row.id}: ${value}.`);
  }
}

function validateStableTvMazeIdentity(row: NormalizedContentRow): void {
  const sourceId = row.sourceFacts.sourceId;
  let match: RegExpMatchArray | null;
  if (row.type === "SERIES" && (match = sourceId.match(/^show:(\d+)$/))) {
    if (row.id !== tvmazeSeriesId(Number(match[1]))) throw new Error(`Unstable Series ID: ${row.id}.`);
  } else if (row.type === "SEASON" && (match = sourceId.match(/^season:(\d+)$/))) {
    if (row.id !== tvmazeSeasonId(Number(match[1]))) throw new Error(`Unstable Season ID: ${row.id}.`);
  } else if (row.type === "SEASON" && /^season-derived:\d+:\d+$/.test(sourceId)) {
    return;
  } else if (row.type === "EPISODE" && (match = sourceId.match(/^episode:(\d+)$/))) {
    if (row.id !== tvmazeEpisodeId(Number(match[1]))) throw new Error(`Unstable Episode ID: ${row.id}.`);
  } else {
    throw new Error(`Malformed TVmaze source identity for ${row.id}: ${sourceId}.`);
  }
}

function validateDerivedSeasons(fallbacks: DerivedSeasonIdentity[], rows: NormalizedContentRow[], byId: Map<string, NormalizedContentRow>): void {
  const byContentId = new Map(fallbacks.map((fallback) => [fallback.contentId, fallback]));
  if (byContentId.size !== fallbacks.length) throw new Error("Duplicate derived-Season manifest entry.");
  for (const row of rows.filter((candidate) => candidate.type === "SEASON" && candidate.sourceFacts.sourceId.startsWith("season-derived:"))) {
    if (!byContentId.has(row.id)) throw new Error(`Derived Season is missing from artifact manifest: ${row.id}.`);
  }
  for (const fallback of fallbacks) {
    const row = byId.get(fallback.contentId);
    const expectedContentId = tvmazeDerivedSeasonId(fallback.showId, fallback.seasonNumber);
    const expectedSourceId = tvmazeDerivedSeasonSourceId(fallback.showId, fallback.seasonNumber);
    if (row?.type !== "SEASON" || row.id !== expectedContentId || row.parentId !== fallback.seriesId || fallback.seriesId !== tvmazeSeriesId(fallback.showId) || row.sourceFacts.sourceId !== expectedSourceId || fallback.sourceId !== expectedSourceId || row.sourceFacts.seasonNumber !== fallback.seasonNumber || fallback.reason !== "TVMAZE_SEASON_RECORD_UNAVAILABLE") {
      throw new Error(`Invalid derived-Season manifest entry: ${fallback.contentId}.`);
    }
  }
}

function assertCountryCode(value: string, label: string): void {
  if (!COUNTRY_CODE.test(value)) throw new Error(`Invalid country code for ${label}: ${value}.`);
}

function isIsoDate(value: string): boolean {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
