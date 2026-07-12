import { Buffer } from "node:buffer";
import path from "node:path";
import type {
  AdvancedSeedConfig,
  BuiltCatalog,
  CatalogContentRow,
  NormalizedCatalogChunk,
} from "./types.js";
import { fetchTvMazeCatalog } from "./tvmaze.js";
import { fetchWikidataMovies } from "./wikidata.js";

const DEFAULT_TARGET_CONTENT = 50_000;
const DEFAULT_MAX_ESTIMATED_DATABASE_BYTES = 220 * 1024 * 1024;
const DEFAULT_MAX_NORMALIZED_BYTES = 95 * 1024 * 1024;

export function readAdvancedSeedConfig(
  argv: string[] = process.argv.slice(2),
  environment: NodeJS.ProcessEnv = process.env,
): AdvancedSeedConfig {
  const argumentsMap = parseArguments(argv);
  const now = new Date();

  return {
    targetContent: readInteger(
      argumentsMap.get("target-content") ??
        environment.ADVANCED_SEED_TARGET_CONTENT,
      DEFAULT_TARGET_CONTENT,
      100,
      250_000,
      "target content",
    ),
    maxShows: readInteger(
      argumentsMap.get("max-shows") ?? environment.ADVANCED_SEED_MAX_SHOWS,
      650,
      1,
      10_000,
      "maximum shows",
    ),
    maxMovies: readInteger(
      argumentsMap.get("max-movies") ?? environment.ADVANCED_SEED_MAX_MOVIES,
      5_000,
      0,
      100_000,
      "maximum movies",
    ),
    maxEpisodesPerShow: readInteger(
      argumentsMap.get("max-episodes-per-show") ??
        environment.ADVANCED_SEED_MAX_EPISODES_PER_SHOW,
      2_000,
      1,
      20_000,
      "maximum episodes per show",
    ),
    tvmazeStartPage: readInteger(
      argumentsMap.get("tvmaze-start-page") ??
        environment.ADVANCED_SEED_TVMAZE_START_PAGE,
      0,
      0,
      1_000_000,
      "TVmaze start page",
    ),
    tvmazeMinRating: readNumber(
      argumentsMap.get("tvmaze-min-rating") ??
        environment.ADVANCED_SEED_TVMAZE_MIN_RATING,
      6,
      0,
      10,
      "TVmaze minimum rating",
    ),
    movieFromYear: readInteger(
      argumentsMap.get("movie-from-year") ??
        environment.ADVANCED_SEED_MOVIE_FROM_YEAR,
      1950,
      1888,
      now.getUTCFullYear(),
      "movie start year",
    ),
    movieToYear: readInteger(
      argumentsMap.get("movie-to-year") ??
        environment.ADVANCED_SEED_MOVIE_TO_YEAR,
      now.getUTCFullYear(),
      1888,
      now.getUTCFullYear() + 2,
      "movie end year",
    ),
    moviesPerYear: readInteger(
      argumentsMap.get("movies-per-year") ??
        environment.ADVANCED_SEED_MOVIES_PER_YEAR,
      100,
      1,
      500,
      "movies per year",
    ),
    cacheDir: path.resolve(
      argumentsMap.get("cache-dir") ??
        environment.ADVANCED_SEED_CACHE_DIR ??
        ".cache/catalog",
    ),
    offline: readBooleanFlag(
      argumentsMap,
      "offline",
      environment.ADVANCED_SEED_OFFLINE,
    ),
    dryRun: readBooleanFlag(
      argumentsMap,
      "dry-run",
      environment.ADVANCED_SEED_DRY_RUN,
    ),
    maxNormalizedBytes: readInteger(
      argumentsMap.get("max-normalized-bytes") ??
        environment.ADVANCED_SEED_MAX_NORMALIZED_BYTES,
      DEFAULT_MAX_NORMALIZED_BYTES,
      1_000_000,
      500_000_000,
      "maximum normalized bytes",
    ),
    maxEstimatedDatabaseBytes: readInteger(
      argumentsMap.get("max-estimated-db-bytes") ??
        environment.ADVANCED_SEED_MAX_ESTIMATED_DATABASE_BYTES,
      DEFAULT_MAX_ESTIMATED_DATABASE_BYTES,
      10_000_000,
      240 * 1024 * 1024,
      "maximum estimated database bytes",
    ),
  };
}

export async function buildAdvancedCatalog(
  config: AdvancedSeedConfig,
): Promise<BuiltCatalog> {
  if (config.movieFromYear > config.movieToYear) {
    throw new Error("Movie start year cannot be after movie end year.");
  }

  const televisionBudget = Math.max(
    1,
    config.targetContent - Math.min(config.maxMovies, config.targetContent),
  );
  const television = await fetchTvMazeCatalog(config, televisionBudget);
  const remainingBudget = Math.max(
    0,
    config.targetContent - television.content.length,
  );
  const movies = await fetchWikidataMovies(config, remainingBudget);
  const catalog = combineCatalogs(television, movies);
  validateCatalog(catalog);

  const normalizedBytes = Buffer.byteLength(
    JSON.stringify(catalog),
    "utf8",
  );
  const estimatedDatabaseBytes = estimateDatabaseBytes(
    catalog,
    normalizedBytes,
  );

  if (normalizedBytes > config.maxNormalizedBytes) {
    throw new Error(
      `Advanced catalog normalized payload exceeds its guard: ${normalizedBytes} > ${config.maxNormalizedBytes} bytes. Reduce target size or raise the explicit guard.`,
    );
  }

  if (estimatedDatabaseBytes > config.maxEstimatedDatabaseBytes) {
    throw new Error(
      `Advanced catalog may exceed the database budget: estimated ${estimatedDatabaseBytes} > ${config.maxEstimatedDatabaseBytes} bytes. Reduce the target before writing.`,
    );
  }

  const counts = countCatalog(catalog.content, catalog.metadata.length, catalog.geoBlocks.length);

  return {
    ...catalog,
    sources: [
      {
        name: "TVmaze",
        license: "CC BY-SA",
        url: "https://www.tvmaze.com/api",
        records: catalog.metadata.filter((row) => row.source === "TVMAZE")
          .length,
      },
      {
        name: "Wikidata",
        license: "CC0",
        url: "https://www.wikidata.org/",
        records: catalog.metadata.filter((row) => row.source === "WIKIDATA")
          .length,
      },
    ],
    configuration: config,
    normalizedBytes,
    estimatedDatabaseBytes,
    counts,
  };
}

function validateCatalog(catalog: NormalizedCatalogChunk): void {
  const contentById = new Map<string, CatalogContentRow>();
  const sourceKeys = new Set<string>();
  const metadataContentIds = new Set<string>();
  const geoBlockKeys = new Set<string>();

  for (const content of catalog.content) {
    if (contentById.has(content.id)) {
      throw new Error(`Duplicate catalog content ID: ${content.id}`);
    }

    if (content.title.trim() === "") {
      throw new Error(`Catalog content has an empty title: ${content.id}`);
    }

    contentById.set(content.id, content);
  }

  for (const content of catalog.content) {
    if (content.type === "SERIES" || content.type === "MOVIE") {
      if (content.parentId !== null) {
        throw new Error(`${content.type} must not have a parent: ${content.id}`);
      }
      continue;
    }

    if (content.parentId === null) {
      throw new Error(`${content.type} must have a parent: ${content.id}`);
    }

    const parent = contentById.get(content.parentId);

    if (parent === undefined) {
      throw new Error(
        `Catalog parent does not exist: ${content.id} -> ${content.parentId}`,
      );
    }

    if (content.type === "SEASON" && parent.type !== "SERIES") {
      throw new Error(`Season parent must be SERIES: ${content.id}`);
    }

    if (content.type === "EPISODE" && parent.type !== "SEASON") {
      throw new Error(`Episode parent must be SEASON: ${content.id}`);
    }
  }

  for (const metadata of catalog.metadata) {
    if (!contentById.has(metadata.contentId)) {
      throw new Error(
        `Catalog metadata points to missing content: ${metadata.contentId}`,
      );
    }

    if (metadataContentIds.has(metadata.contentId)) {
      throw new Error(
        `Catalog content has multiple metadata rows: ${metadata.contentId}`,
      );
    }

    const sourceKey = `${metadata.source}:${metadata.sourceId}`;

    if (sourceKeys.has(sourceKey)) {
      throw new Error(`Duplicate external source key: ${sourceKey}`);
    }

    metadataContentIds.add(metadata.contentId);
    sourceKeys.add(sourceKey);
  }

  if (metadataContentIds.size !== contentById.size) {
    const missingId = [...contentById.keys()].find(
      (contentId) => !metadataContentIds.has(contentId),
    );
    throw new Error(`Catalog content is missing metadata: ${missingId}`);
  }

  for (const geoBlock of catalog.geoBlocks) {
    if (!contentById.has(geoBlock.contentId)) {
      throw new Error(
        `Geo-block row points to missing content: ${geoBlock.contentId}`,
      );
    }

    if (!/^[A-Z]{2}$/.test(geoBlock.countryCode)) {
      throw new Error(
        `Invalid geo-block country code: ${geoBlock.countryCode}`,
      );
    }

    const key = `${geoBlock.contentId}:${geoBlock.countryCode}`;

    if (geoBlockKeys.has(key)) {
      throw new Error(`Duplicate geo-block row: ${key}`);
    }

    geoBlockKeys.add(key);
  }
}

function combineCatalogs(
  ...catalogs: NormalizedCatalogChunk[]
): NormalizedCatalogChunk {
  return {
    content: catalogs.flatMap((catalog) => catalog.content),
    metadata: catalogs.flatMap((catalog) => catalog.metadata),
    geoBlocks: catalogs.flatMap((catalog) => catalog.geoBlocks),
  };
}

function estimateDatabaseBytes(
  catalog: NormalizedCatalogChunk,
  normalizedBytes: number,
): number {
  const rowAndIndexOverhead =
    catalog.content.length * 900 +
    catalog.metadata.length * 1_000 +
    catalog.geoBlocks.length * 300;

  return Math.ceil(normalizedBytes * 2.5 + rowAndIndexOverhead);
}

function countCatalog(
  content: CatalogContentRow[],
  metadata: number,
  geoBlocks: number,
): BuiltCatalog["counts"] {
  return {
    content: content.length,
    series: content.filter((row) => row.type === "SERIES").length,
    seasons: content.filter((row) => row.type === "SEASON").length,
    episodes: content.filter((row) => row.type === "EPISODE").length,
    movies: content.filter((row) => row.type === "MOVIE").length,
    metadata,
    geoBlocks,
  };
}

function parseArguments(argumentsList: string[]): Map<string, string> {
  const result = new Map<string, string>();

  for (const argument of argumentsList) {
    if (!argument.startsWith("--")) {
      throw new Error(`Unexpected advanced seed argument: ${argument}`);
    }

    const withoutPrefix = argument.slice(2);
    const equalsIndex = withoutPrefix.indexOf("=");

    if (equalsIndex === -1) {
      result.set(withoutPrefix, "true");
      continue;
    }

    result.set(
      withoutPrefix.slice(0, equalsIndex),
      withoutPrefix.slice(equalsIndex + 1),
    );
  }

  return result;
}

function readBooleanFlag(
  argumentsMap: Map<string, string>,
  key: string,
  environmentValue: string | undefined,
): boolean {
  const value = argumentsMap.get(key) ?? environmentValue ?? "false";

  if (value === "true" || value === "1") {
    return true;
  }

  if (value === "false" || value === "0") {
    return false;
  }

  throw new Error(`Invalid boolean for ${key}: ${value}`);
}

function readInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  label: string,
): number {
  const parsed = value === undefined ? fallback : Number(value);

  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(
      `Invalid ${label}: expected integer ${minimum}-${maximum}, received ${value ?? parsed}.`,
    );
  }

  return parsed;
}

function readNumber(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  label: string,
): number {
  const parsed = value === undefined ? fallback : Number(value);

  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(
      `Invalid ${label}: expected number ${minimum}-${maximum}, received ${value ?? parsed}.`,
    );
  }

  return parsed;
}
