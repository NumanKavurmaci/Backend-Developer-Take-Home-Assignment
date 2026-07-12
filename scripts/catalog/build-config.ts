import path from "node:path";
import { readCatalogLimits } from "./config.js";
import type { CatalogArtifactConfiguration } from "./artifact-types.js";

const LIMIT_OPTIONS = new Set([
  "max-shows",
  "max-episodes-per-show",
  "max-content-rows",
  "max-normalized-artifact-bytes",
  "max-estimated-database-bytes",
]);

export interface CatalogBuildConfig {
  artifactConfiguration: CatalogArtifactConfiguration;
  cacheDir: string;
  outputDir: string;
}

export function readCatalogBuildConfig(
  argv: string[] = process.argv.slice(2),
  environment: NodeJS.ProcessEnv = process.env,
): CatalogBuildConfig {
  const limitArguments: string[] = [];
  const values = new Map<string, string>();
  let offlineArgument: boolean | undefined;

  for (const argument of argv) {
    if (argument === "--offline") {
      if (offlineArgument !== undefined) throw new Error("Duplicate catalog option: --offline.");
      offlineArgument = true;
      continue;
    }
    if (!argument.startsWith("--") || !argument.includes("=")) {
      throw new Error(`Invalid catalog build argument: ${argument}.`);
    }
    const key = argument.slice(2, argument.indexOf("="));
    if (LIMIT_OPTIONS.has(key)) {
      limitArguments.push(argument);
      continue;
    }
    if (!["start-page", "max-pages", "fetch-concurrency", "cache-dir", "output-dir", "offline"].includes(key)) {
      throw new Error(`Unknown catalog build option: --${key}.`);
    }
    if (values.has(key) || (key === "offline" && offlineArgument !== undefined)) {
      throw new Error(`Duplicate catalog option: --${key}.`);
    }
    values.set(key, argument.slice(argument.indexOf("=") + 1));
  }

  const limits = readCatalogLimits(limitArguments, {
    ...environment,
    CATALOG_MAX_SHOWS: environment.CATALOG_MAX_SHOWS ?? "5",
    CATALOG_MAX_EPISODES_PER_SHOW:
      environment.CATALOG_MAX_EPISODES_PER_SHOW ?? "50",
    CATALOG_MAX_CONTENT_ROWS: environment.CATALOG_MAX_CONTENT_ROWS ?? "500",
  });
  const offline = offlineArgument ?? readBoolean(
    values.get("offline") ?? environment.CATALOG_OFFLINE ?? "false",
    "offline",
  );
  return {
    artifactConfiguration: {
      ...limits,
      tvmazeStartPage: readNonNegativeInteger(
        values.get("start-page") ?? environment.CATALOG_TVMAZE_START_PAGE ?? "0",
        "start page",
        1_000_000,
      ),
      maxPages: readPositiveInteger(
        values.get("max-pages") ?? environment.CATALOG_TVMAZE_MAX_PAGES ?? "1",
        "maximum pages",
        10_000,
      ),
      fetchConcurrency: readPositiveInteger(
        values.get("fetch-concurrency") ??
          environment.CATALOG_FETCH_CONCURRENCY ??
          "16",
        "fetch concurrency",
        64,
      ),
      offline,
    },
    cacheDir: path.resolve(
      values.get("cache-dir") ?? environment.CATALOG_CACHE_DIR ?? ".cache/catalog",
    ),
    outputDir: path.resolve(
      values.get("output-dir") ?? environment.CATALOG_OUTPUT_DIR ?? "data/catalog/current",
    ),
  };
}

function readBoolean(value: string, label: string): boolean {
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  throw new Error(`Invalid ${label}: expected true or false.`);
}

function readNonNegativeInteger(value: string, label: string, maximum: number): number {
  if (!/^\d+$/.test(value)) throw new Error(`Invalid ${label}: expected a non-negative integer.`);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number > maximum) {
    throw new Error(`Unsafe ${label}: expected 0-${maximum}.`);
  }
  return number;
}

function readPositiveInteger(value: string, label: string, maximum: number): number {
  const number = readNonNegativeInteger(value, label, maximum);
  if (number === 0) throw new Error(`Invalid ${label}: expected at least 1.`);
  return number;
}
