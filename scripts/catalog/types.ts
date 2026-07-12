export type NormalizedContentType = "SERIES" | "SEASON" | "EPISODE" | "MOVIE";
export type NormalizedVideoQuality = "SD" | "HD" | "UHD_4K";
export type CatalogSource = "TVMAZE";
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

/** Provider-owned facts from exactly one source record. These never inherit. */
export interface CatalogSourceFacts {
  source: CatalogSource;
  sourceId: string;
  sourceUrl: string | null;
  originalTitle: string | null;
  summary: string | null;
  language: string | null;
  status: string | null;
  countryCode: string | null;
  networkName: string | null;
  officialSiteUrl: string | null;
  imageUrl: string | null;
  premieredAt: string | null;
  endedAt: string | null;
  runtimeMinutes: number | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
  ratingAverage: number | null;
  genres: string[];
  sourceMetadata: Record<string, JsonValue> | null;
}

/** SaatCMS-owned demo policies. RLD-06 supplies deterministic values. */
export interface SaatCmsPolicies {
  parentalRating: string | null;
  genre: string | null;
  quality: NormalizedVideoQuality | null;
  isPremium: boolean | null;
  playbackUrl: string | null;
  geoBlockCountriesOverride: boolean;
}

export interface NormalizedContentRow {
  id: string;
  type: NormalizedContentType;
  title: string;
  parentId: string | null;
  sourceFacts: CatalogSourceFacts;
  policies: SaatCmsPolicies;
}

export interface NormalizedGeoBlockRow {
  contentId: string;
  countryCode: string;
}

export interface CatalogSourceProvenance {
  source: CatalogSource;
  providerName: "TVmaze";
  providerUrl: "https://www.tvmaze.com/api";
  license: "CC BY-SA";
  attribution: string;
  snapshotKey: string;
}

export interface CatalogCounts {
  content: number;
  series: number;
  seasons: number;
  episodes: number;
  movies: number;
  geoBlocks: number;
  derivedSeasons: number;
}

export interface CatalogScenarioIds {
  inheritedEpisodeId?: string;
  seasonOverrideEpisodeId?: string;
  premium4kEpisodeId?: string;
  geoBlockedContentId?: string;
}

export interface DerivedSeasonIdentity {
  contentId: string;
  seriesId: string;
  showId: number;
  seasonNumber: number;
  sourceId: string;
  reason: "TVMAZE_SEASON_RECORD_UNAVAILABLE";
}

export interface CatalogArtifactMetadata {
  schemaVersion: 1;
  generatedAt: string;
  normalizedBytes: number;
  estimatedDatabaseBytes: number;
  counts: CatalogCounts;
  scenarioIds: CatalogScenarioIds;
  provenance: CatalogSourceProvenance[];
  derivedSeasons: DerivedSeasonIdentity[];
}

export interface NormalizedCatalogArtifact {
  metadata: CatalogArtifactMetadata;
  content: NormalizedContentRow[];
  geoBlocks: NormalizedGeoBlockRow[];
}

export const EMPTY_SAATCMS_POLICIES: Readonly<SaatCmsPolicies> = Object.freeze({
  parentalRating: null,
  genre: null,
  quality: null,
  isPremium: null,
  playbackUrl: null,
  geoBlockCountriesOverride: false,
});
