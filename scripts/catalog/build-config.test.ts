import { describe, expect, it } from "vitest";
import { readCatalogBuildConfig } from "./build-config.js";

describe("catalog build configuration", () => {
  it("uses small rehearsal defaults", () => {
    expect(readCatalogBuildConfig([], {}).artifactConfiguration).toMatchObject({
      maxShows: 5,
      maxEpisodesPerShow: 50,
      maxContentRows: 500,
      maxPages: 1,
      offline: false,
    });
  });

  it("reads bounded local build options", () => {
    const config = readCatalogBuildConfig([
      "--max-shows=5", "--max-episodes-per-show=100", "--max-content-rows=500",
      "--start-page=2", "--max-pages=3", "--cache-dir=.cache/test",
      "--output-dir=data/catalog/test", "--offline",
    ], {});
    expect(config.artifactConfiguration).toMatchObject({
      maxShows: 5, maxEpisodesPerShow: 100, maxContentRows: 500,
      tvmazeStartPage: 2, maxPages: 3, offline: true,
    });
    expect(config.cacheDir).toMatch(/[\\/]\.cache[\\/]test$/);
    expect(config.outputDir).toMatch(/[\\/]data[\\/]catalog[\\/]test$/);
  });

  it.each([
    ["--max-pages=0", /at least 1/],
    ["--start-page=-1", /non-negative/],
    ["--offline=maybe", /true or false/],
    ["--unknown=1", /Unknown/],
  ])("rejects unsafe option %s", (argument, expected) => {
    expect(() => readCatalogBuildConfig([argument], {})).toThrow(expected);
  });
});
