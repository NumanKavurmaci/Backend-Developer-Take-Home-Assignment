import type {
  CatalogScenarioIds,
  NormalizedCatalogChunk,
  NormalizedContentRow,
  SaatCmsPolicies,
} from "./types.js";
import { validateNormalizedCatalogChunk } from "./validate.js";

const VALID_QUALITIES = new Set(["SD", "HD", "UHD_4K"]);
const COUNTRY_CODE = /^[A-Z]{2}$/;
const SERIES_BLOCKED_COUNTRIES = ["IR", "SY"] as const;

export type RequiredCatalogScenarioIds = Required<CatalogScenarioIds>;

export interface GeneratedCatalogPolicies {
  chunk: NormalizedCatalogChunk;
  scenarioIds: RequiredCatalogScenarioIds;
}

/** Adds only the policies required by the assignment's stable demo scenarios. */
export function applyDeterministicDemoPolicies(
  input: NormalizedCatalogChunk,
): GeneratedCatalogPolicies {
  validateNormalizedCatalogChunk(input);
  const chunk = structuredClone(input);
  const byId = new Map(chunk.content.map((row) => [row.id, row]));

  for (const row of chunk.content) {
    row.policies = row.type === "SERIES" ? seriesDefaults(row.id) : emptyPolicies();
  }

  const scenario = selectScenarioHierarchy(chunk.content);
  const seasonOverride = byId.get(scenario.seasonOverrideId)!;
  seasonOverride.policies = {
    ...emptyPolicies(),
    parentalRating: "16+",
    genre: "Mystery",
  };

  const premiumEpisode = byId.get(scenario.premiumEpisodeId)!;
  premiumEpisode.policies = {
    ...emptyPolicies(),
    quality: "UHD_4K",
    isPremium: true,
    playbackUrl: placeholderPlaybackUrl(premiumEpisode.id),
    geoBlockCountriesOverride: true,
  };

  chunk.geoBlocks = chunk.content
    .filter((row) => row.type === "SERIES")
    .flatMap((row) =>
      SERIES_BLOCKED_COUNTRIES.map((countryCode) => ({
        contentId: row.id,
        countryCode,
      })),
    )
    .sort((left, right) =>
      left.contentId.localeCompare(right.contentId) ||
      left.countryCode.localeCompare(right.countryCode),
    );

  const scenarioIds: RequiredCatalogScenarioIds = {
    inheritedEpisodeId: scenario.inheritedEpisodeId,
    seasonOverrideEpisodeId: scenario.seasonOverrideEpisodeId,
    episodeOverrideEpisodeId: scenario.premiumEpisodeId,
    geoBlockedContentId: scenario.inheritedEpisodeId,
    emptyGeoOverrideEpisodeId: scenario.premiumEpisodeId,
    allowedPlaybackContentId: scenario.premiumEpisodeId,
    premium4kEpisodeId: scenario.premiumEpisodeId,
  };
  validateCatalogPolicies(chunk);
  return { chunk, scenarioIds };
}

export function validateCatalogPolicies(chunk: NormalizedCatalogChunk): void {
  validateNormalizedCatalogChunk(chunk);
  const byId = new Map(chunk.content.map((row) => [row.id, row]));
  const geoKeys = new Set<string>();

  for (const row of chunk.content) {
    const policy = row.policies;
    if (policy.quality !== null && !VALID_QUALITIES.has(policy.quality)) {
      throw new Error(`Invalid policy quality for ${row.id}: ${policy.quality}.`);
    }
    if (policy.parentalRating !== null && policy.parentalRating.trim() === "") {
      throw new Error(`Blank policy parental rating for ${row.id}.`);
    }
    if (policy.genre !== null && policy.genre.trim() === "") {
      throw new Error(`Blank policy genre for ${row.id}.`);
    }
    if (policy.playbackUrl !== null) assertPlaceholderPlaybackUrl(policy.playbackUrl, row.id);
  }

  for (const geoBlock of chunk.geoBlocks) {
    if (!COUNTRY_CODE.test(geoBlock.countryCode)) {
      throw new Error(`Invalid policy country code for ${geoBlock.contentId}: ${geoBlock.countryCode}.`);
    }
    if (byId.get(geoBlock.contentId)?.policies.geoBlockCountriesOverride !== true) {
      throw new Error(`Geo-block rows require an explicit override: ${geoBlock.contentId}.`);
    }
    const key = `${geoBlock.contentId}/${geoBlock.countryCode}`;
    if (geoKeys.has(key)) throw new Error(`Duplicate policy country: ${key}.`);
    geoKeys.add(key);
  }
}

function selectScenarioHierarchy(rows: NormalizedContentRow[]): {
  inheritedEpisodeId: string;
  seasonOverrideId: string;
  seasonOverrideEpisodeId: string;
  premiumEpisodeId: string;
} {
  const sorted = [...rows].sort((left, right) => left.id.localeCompare(right.id));
  for (const series of sorted.filter((row) => row.type === "SERIES")) {
    const seasons = sorted.filter(
      (row) => row.type === "SEASON" && row.parentId === series.id,
    );
    const episodesBySeason = new Map(
      seasons.map((season) => [
        season.id,
        sorted.filter(
          (row) => row.type === "EPISODE" && row.parentId === season.id,
        ),
      ]),
    );
    const inheritedSeason = seasons.find(
      (season) => (episodesBySeason.get(season.id)?.length ?? 0) >= 1,
    );
    const overrideSeason = seasons.find(
      (season) =>
        season.id !== inheritedSeason?.id &&
        (episodesBySeason.get(season.id)?.length ?? 0) >= 2,
    );
    if (inheritedSeason !== undefined && overrideSeason !== undefined) {
      const overrideEpisodes = episodesBySeason.get(overrideSeason.id)!;
      return {
        inheritedEpisodeId: episodesBySeason.get(inheritedSeason.id)![0]!.id,
        seasonOverrideId: overrideSeason.id,
        seasonOverrideEpisodeId: overrideEpisodes[0]!.id,
        premiumEpisodeId: overrideEpisodes[1]!.id,
      };
    }
  }
  throw new Error(
    "Catalog cannot provide demo scenarios: expected one Series with two Seasons, one Episode in the first, and two Episodes in the second.",
  );
}

function seriesDefaults(contentId: string): SaatCmsPolicies {
  return {
    parentalRating: "13+",
    genre: "General",
    quality: "HD",
    isPremium: false,
    playbackUrl: placeholderPlaybackUrl(contentId),
    geoBlockCountriesOverride: true,
  };
}

function emptyPolicies(): SaatCmsPolicies {
  return {
    parentalRating: null,
    genre: null,
    quality: null,
    isPremium: null,
    playbackUrl: null,
    geoBlockCountriesOverride: false,
  };
}

function placeholderPlaybackUrl(contentId: string): string {
  return `https://media.invalid/content/${encodeURIComponent(contentId)}`;
}

function assertPlaceholderPlaybackUrl(value: string, contentId: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Invalid placeholder playback URL for ${contentId}.`);
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "media.invalid" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error(`Playback URL must use the media.invalid placeholder host: ${contentId}.`);
  }
}
