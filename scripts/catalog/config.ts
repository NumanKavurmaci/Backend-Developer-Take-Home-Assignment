export const MIB = 1024 * 1024;
export const RENDER_DATABASE_ALLOWANCE_BYTES = 1_000_000_000;
export const OPERATIONAL_HEADROOM_BYTES = 60_000_000;
export const DEFAULT_MAX_ESTIMATED_DATABASE_BYTES =
  RENDER_DATABASE_ALLOWANCE_BYTES - OPERATIONAL_HEADROOM_BYTES;

export interface CatalogLimits {
  maxShows: number;
  maxEpisodesPerShow: number;
  maxContentRows: number;
  maxNormalizedArtifactBytes: number;
  maxEstimatedDatabaseBytes: number;
}

export const DEFAULT_CATALOG_LIMITS: Readonly<CatalogLimits> = Object.freeze({
  maxShows: 650,
  maxEpisodesPerShow: 2_000,
  maxContentRows: 50_000,
  maxNormalizedArtifactBytes: 95 * MIB,
  maxEstimatedDatabaseBytes: DEFAULT_MAX_ESTIMATED_DATABASE_BYTES,
});

const OPTIONS: Record<string, { property: keyof CatalogLimits; environment: string; maximum: number }> = {
  "max-shows": { property: "maxShows", environment: "CATALOG_MAX_SHOWS", maximum: 10_000 },
  "max-episodes-per-show": { property: "maxEpisodesPerShow", environment: "CATALOG_MAX_EPISODES_PER_SHOW", maximum: 20_000 },
  "max-content-rows": { property: "maxContentRows", environment: "CATALOG_MAX_CONTENT_ROWS", maximum: 250_000 },
  "max-normalized-artifact-bytes": { property: "maxNormalizedArtifactBytes", environment: "CATALOG_MAX_NORMALIZED_ARTIFACT_BYTES", maximum: DEFAULT_MAX_ESTIMATED_DATABASE_BYTES },
  "max-estimated-database-bytes": { property: "maxEstimatedDatabaseBytes", environment: "CATALOG_MAX_ESTIMATED_DATABASE_BYTES", maximum: DEFAULT_MAX_ESTIMATED_DATABASE_BYTES },
};

export function readCatalogLimits(argv: string[] = process.argv.slice(2), environment: NodeJS.ProcessEnv = process.env): CatalogLimits {
  const argumentsMap = parseArguments(argv);
  const limits = { ...DEFAULT_CATALOG_LIMITS };
  for (const [option, definition] of Object.entries(OPTIONS)) {
    const value = argumentsMap.get(option) ?? environment[definition.environment];
    if (value !== undefined) limits[definition.property] = readPositiveSafeInteger(value, option, definition.maximum);
  }
  return limits;
}

function parseArguments(argv: string[]): Map<string, string> {
  const result = new Map<string, string>();
  for (const argument of argv) {
    if (!argument.startsWith("--") || !argument.includes("=")) throw new Error(`Invalid catalog argument ${JSON.stringify(argument)}; expected --name=value.`);
    const [key, ...valueParts] = argument.slice(2).split("=");
    if (!(key in OPTIONS)) throw new Error(`Unknown catalog limit: --${key}.`);
    if (result.has(key)) throw new Error(`Duplicate catalog limit: --${key}.`);
    result.set(key, valueParts.join("="));
  }
  return result;
}

function readPositiveSafeInteger(value: string, label: string, maximum: number): number {
  if (!/^\d+$/.test(value)) throw new Error(`Invalid ${label}: expected a positive integer.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > maximum) throw new Error(`Unsafe ${label}: expected 1-${maximum}, received ${value}.`);
  return parsed;
}
