import { describe, expect, it } from "vitest";
import { CatalogBudget, assertEstimatedDatabaseBudget } from "./budget.js";
import type { CatalogLimits } from "./config.js";

const limits: CatalogLimits = { maxShows: 2, maxEpisodesPerShow: 2, maxContentRows: 3, maxNormalizedArtifactBytes: 100, maxEstimatedDatabaseBytes: 1_000 };

describe("CatalogBudget", () => {
  it("accepts a dataset exactly at the row limit and rejects the next row", () => {
    const budget = new CatalogBudget(limits);
    expect(budget.tryAdd({ type: "SERIES", row: { id: "s" } })).toBe(true);
    expect(budget.tryAdd({ type: "SEASON", row: { id: "n" } })).toBe(true);
    expect(budget.tryAdd({ type: "EPISODE", showId: "s", row: { id: "e" } })).toBe(true);
    expect(budget.tryAdd({ type: "EPISODE", showId: "s", row: { id: "x" } })).toBe(false);
    expect(budget.state).toMatchObject({ contentRows: 3, stopReason: "max-content-rows" });
  });

  it("stops before exceeding the normalized artifact limit", () => {
    const budget = new CatalogBudget({ ...limits, maxNormalizedArtifactBytes: 12 });
    expect(budget.tryAdd({ type: "SERIES", row: { x: 1 } })).toBe(true);
    expect(budget.state.normalizedArtifactBytes).toBe(9);
    expect(budget.tryAdd({ type: "SEASON", row: { x: 2 } })).toBe(false);
    expect(budget.state).toMatchObject({ normalizedArtifactBytes: 9, stopReason: "max-normalized-artifact-bytes" });
  });
});

describe("assertEstimatedDatabaseBudget", () => {
  it("accepts the exact boundary and rejects a value above it", () => {
    expect(() => assertEstimatedDatabaseBudget(1_000, limits)).not.toThrow();
    expect(() => assertEstimatedDatabaseBudget(1_001, limits)).toThrow(/hard guard/);
  });
});
