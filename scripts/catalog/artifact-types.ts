import type {
  CatalogCounts,
  CatalogScenarioIds,
  CatalogSourceProvenance,
  DerivedSeasonIdentity,
  JsonValue,
  NormalizedContentType,
  NormalizedVideoQuality,
} from "./types.js";
import type { CatalogLimits } from "./config.js";

export interface CatalogArtifactConfiguration extends CatalogLimits {
  tvmazeStartPage: number;
  maxPages: number;
  offline: boolean;
}

export const CATALOG_ARTIFACT_SCHEMA_VERSION = 1 as const;
export const CATALOG_GENERATOR_NAME = "saatcms-tvmaze-catalog" as const;
export const CONTENT_ARTIFACT_FILE = "content.ndjson.gz" as const;
export const GEO_BLOCKS_ARTIFACT_FILE = "geo-blocks.ndjson.gz" as const;
export const MANIFEST_FILE = "manifest.json" as const;

export interface ArtifactContentRow {
  id: string;
  type: NormalizedContentType;
  title: string;
  parentId: string | null;
  parentalRating: string | null;
  genre: string | null;
  quality: NormalizedVideoQuality | null;
  isPremium: boolean | null;
  playbackUrl: string | null;
  geoBlockCountriesOverride: boolean;
  source: "TVMAZE";
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

export interface ArtifactGeoBlockRow {
  contentId: string;
  countryCode: string;
}

export interface ArtifactFileManifest {
  fileName: string;
  rows: number;
  normalizedBytes: number;
  compressedBytes: number;
  sha256: string;
}

export interface CatalogArtifactManifest {
  artifactSchemaVersion: typeof CATALOG_ARTIFACT_SCHEMA_VERSION;
  generator: {
    name: typeof CATALOG_GENERATOR_NAME;
    version: string;
  };
  generatedAt: string;
  provenance: CatalogSourceProvenance[];
  configuration: CatalogArtifactConfiguration;
  counts: CatalogCounts;
  scenarioIds: CatalogScenarioIds;
  derivedSeasons: DerivedSeasonIdentity[];
  estimatedDatabaseBytes: number;
  totals: {
    normalizedBytes: number;
    compressedBytes: number;
  };
  files: {
    content: ArtifactFileManifest & { fileName: typeof CONTENT_ARTIFACT_FILE };
    geoBlocks: ArtifactFileManifest & { fileName: typeof GEO_BLOCKS_ARTIFACT_FILE };
  };
}
