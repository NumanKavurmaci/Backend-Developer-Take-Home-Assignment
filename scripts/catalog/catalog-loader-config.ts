import path from "node:path";
import { DEFAULT_MAX_ESTIMATED_DATABASE_BYTES } from "./config.js";

export const CATALOG_REPLACE_CONFIRMATION = "REPLACE_CONTENT";

export interface CatalogLoaderConfiguration {
  artifactDirectory: string;
  batchSize: number;
  transactionTimeoutMs: number;
  hardDatabaseGuardBytes: number;
}

export function readCatalogLoaderConfiguration(
  argv: string[] = process.argv.slice(2),
  environment: NodeJS.ProcessEnv = process.env,
): CatalogLoaderConfiguration {
  const values = new Map<string, string>();
  for (const argument of argv) {
    if (!argument.startsWith("--") || !argument.includes("=")) {
      throw new Error(`Invalid catalog load argument: ${argument}.`);
    }
    const separator = argument.indexOf("=");
    const key = argument.slice(2, separator);
    if (!["artifact-dir", "batch-size", "transaction-timeout-ms", "hard-database-guard-bytes", "replace-content"].includes(key)) {
      throw new Error(`Unknown catalog load option: --${key}.`);
    }
    if (values.has(key)) throw new Error(`Duplicate catalog load option: --${key}.`);
    values.set(key, argument.slice(separator + 1));
  }

  const confirmation = values.get("replace-content") ?? environment.CATALOG_REPLACE_CONFIRMATION;
  if (confirmation !== CATALOG_REPLACE_CONFIRMATION) {
    throw new Error(
      `Catalog load refused: explicitly confirm replacement with --replace-content=${CATALOG_REPLACE_CONFIRMATION} or CATALOG_REPLACE_CONFIRMATION=${CATALOG_REPLACE_CONFIRMATION}.`,
    );
  }
  const artifactDirectory = values.get("artifact-dir") ?? environment.CATALOG_ARTIFACT_DIR;
  if (!artifactDirectory?.trim()) {
    throw new Error("Catalog load refused: --artifact-dir or CATALOG_ARTIFACT_DIR is required.");
  }
  return {
    artifactDirectory: path.resolve(artifactDirectory),
    batchSize: positiveInteger(
      values.get("batch-size") ?? environment.CATALOG_LOAD_BATCH_SIZE ?? "500",
      "batch size",
      5_000,
    ),
    transactionTimeoutMs: positiveInteger(
      values.get("transaction-timeout-ms") ??
        environment.CATALOG_LOAD_TRANSACTION_TIMEOUT_MS ??
        "600000",
      "transaction timeout",
      3_600_000,
    ),
    hardDatabaseGuardBytes: positiveInteger(
      values.get("hard-database-guard-bytes") ??
        environment.CATALOG_MAX_ESTIMATED_DATABASE_BYTES ??
        String(DEFAULT_MAX_ESTIMATED_DATABASE_BYTES),
      "hard database guard",
      DEFAULT_MAX_ESTIMATED_DATABASE_BYTES,
    ),
  };
}

function positiveInteger(value: string, label: string, maximum: number): number {
  if (!/^\d+$/.test(value)) throw new Error(`Invalid ${label}: expected a positive integer.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > maximum) {
    throw new Error(`Unsafe ${label}: expected 1-${maximum}, received ${value}.`);
  }
  return parsed;
}
