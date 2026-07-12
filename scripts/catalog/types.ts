export type CatalogContentType = "SERIES" | "SEASON" | "EPISODE" | "MOVIE";

export interface CatalogContentRow {
  id: string;
  type: CatalogContentType;
  title: string;
  parentId: string | null;
  parentalRating: string | null;
  genre: string | null;
  quality: "SD" | "HD" | "UHD_4K" | null;
  isPremium: boolean | null;
  playbackUrl: string | null;
  geoBlockCountriesOverride: boolean;
}

export interface CatalogMetadataRow {
  contentId: string;
  source: "TVMAZE" | "WIKIDATA";
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
  premieredAt: Date | null;
  endedAt: Date | null;
  runtimeMinutes: number | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
  ratingAverage: number | null;
  genres: string[];
  sourceMetadata: Record<string, string | number | boolean | null>;
}

export interface CatalogGeoBlockRow {
  contentId: string;
  countryCode: string;
}

export interface NormalizedCatalogChunk {
  content: CatalogContentRow[];
  metadata: CatalogMetadataRow[];
  geoBlocks: CatalogGeoBlockRow[];
}

export interface CatalogSourceSummary {
  name: "TVmaze" | "Wikidata";
  license: "CC BY-SA" | "CC0";
  url: string;
  records: number;
}

export interface AdvancedSeedConfig {
  targetContent: number;
  maxShows: number;
  maxMovies: number;
  maxEpisodesPerShow: number;
  tvmazeStartPage: number;
  tvmazeMinRating: number;
  movieFromYear: number;
  movieToYear: number;
  moviesPerYear: number;
  cacheDir: string;
  offline: boolean;
  dryRun: boolean;
  maxNormalizedBytes: number;
  maxEstimatedDatabaseBytes: number;
}

export interface BuiltCatalog extends NormalizedCatalogChunk {
  sources: CatalogSourceSummary[];
  configuration: AdvancedSeedConfig;
  normalizedBytes: number;
  estimatedDatabaseBytes: number;
  counts: {
    content: number;
    series: number;
    seasons: number;
    episodes: number;
    movies: number;
    metadata: number;
    geoBlocks: number;
  };
}
