import { describe, expect, it } from "vitest";
import { DEFAULT_MAX_ESTIMATED_DATABASE_BYTES, readCatalogLimits } from "./config.js";

describe("readCatalogLimits", () => {
  it("accepts explicit content and byte limits", () => {
    expect(readCatalogLimits([
      "--max-shows=10", "--max-episodes-per-show=20", "--max-content-rows=100",
      "--max-normalized-artifact-bytes=10000", "--max-estimated-database-bytes=20000",
    ], {})).toEqual({ maxShows: 10, maxEpisodesPerShow: 20, maxContentRows: 100, maxNormalizedArtifactBytes: 10_000, maxEstimatedDatabaseBytes: 20_000 });
  });

  it("reserves 60 MB from the 1 GB allowance by default", () => {
    expect(readCatalogLimits([], {}).maxEstimatedDatabaseBytes).toBe(DEFAULT_MAX_ESTIMATED_DATABASE_BYTES);
  });

  it.each(["-1", "0", "1.5", "many", "9007199254740992"])("rejects invalid limit %s", (value) => {
    expect(() => readCatalogLimits([`--max-shows=${value}`], {})).toThrow();
  });

  it("rejects limits above the hard guard", () => {
    expect(() => readCatalogLimits(["--max-estimated-database-bytes=940000001"], {})).toThrow(/Unsafe/);
  });
});
