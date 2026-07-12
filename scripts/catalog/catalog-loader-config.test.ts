import { describe, expect, it } from "vitest";
import {
  CATALOG_REPLACE_CONFIRMATION,
  readCatalogLoaderConfiguration,
} from "./catalog-loader-config.js";

describe("catalog loader configuration", () => {
  it("requires explicit replacement and reads bounded settings", () => {
    const config = readCatalogLoaderConfiguration([
      "--artifact-dir=data/catalog/example",
      `--replace-content=${CATALOG_REPLACE_CONFIRMATION}`,
      "--batch-size=250",
      "--transaction-timeout-ms=900000",
      "--hard-database-guard-bytes=900000000",
    ], {});
    expect(config).toMatchObject({
      batchSize: 250,
      transactionTimeoutMs: 900_000,
      hardDatabaseGuardBytes: 900_000_000,
    });
    expect(config.artifactDirectory).toMatch(/[\\/]data[\\/]catalog[\\/]example$/);
  });

  it.each([
    [[], /explicitly confirm replacement/],
    [["--artifact-dir=x", "--replace-content=YES"], /explicitly confirm replacement/],
    [[`--replace-content=${CATALOG_REPLACE_CONFIRMATION}`], /artifact-dir/],
    [["--artifact-dir=x", `--replace-content=${CATALOG_REPLACE_CONFIRMATION}`, "--batch-size=0"], /at least|Unsafe batch size/],
    [["--artifact-dir=x", `--replace-content=${CATALOG_REPLACE_CONFIRMATION}`, "--batch-size=5001"], /Unsafe batch size/],
    [["--artifact-dir=x", `--replace-content=${CATALOG_REPLACE_CONFIRMATION}`, "--unknown=1"], /Unknown/],
  ])("refuses unsafe configuration %#", (argv, error) => {
    expect(() => readCatalogLoaderConfiguration(argv, {})).toThrow(error);
  });
});
