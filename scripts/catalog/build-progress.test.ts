import { describe, expect, it } from "vitest";
import { CatalogBuildProgressReporter, formatBytes } from "./build-progress.js";
import { DEFAULT_CATALOG_LIMITS } from "./config.js";

describe("catalog build progress reporting", () => {
  it("tracks cache, network, retry, row, and remaining budget progress", () => {
    const messages: string[] = [];
    const reporter = new CatalogBuildProgressReporter(
      {
        ...DEFAULT_CATALOG_LIMITS,
        maxShows: 10,
        maxContentRows: 1_000,
        tvmazeStartPage: 0,
        maxPages: 2,
        fetchConcurrency: 16,
        offline: false,
      },
      (message) => messages.push(message),
    );
    reporter.onHttpEvent({
      type: "cache-hit", provider: "TVmaze", operation: "show-page-0", bytes: 2_000,
    });
    reporter.onHttpEvent({
      type: "request-start", provider: "TVmaze", operation: "show-1-seasons", attempt: 1, maxAttempts: 6,
    });
    reporter.onHttpEvent({
      type: "retry", provider: "TVmaze", operation: "show-1-seasons", delayMs: 1_000, status: 429,
    });
    reporter.onHttpEvent({
      type: "response-cached", provider: "TVmaze", operation: "show-1-seasons", bytes: 3_000,
    });
    reporter.onBuildEvent({
      type: "show-included", showId: 1, showRows: 43, showsIncluded: 1,
      totalRows: 43, remainingShows: 9, remainingRows: 957,
    });
    reporter.onBuildEvent({
      type: "complete", stopReason: "max-shows", normalizedBytes: 40_000,
      estimatedDatabaseBytes: 150_000,
    });

    expect(reporter.snapshot).toEqual({
      operationsCompleted: 2,
      cacheHits: 1,
      networkResponses: 1,
      networkAttempts: 1,
      retries: 1,
      cachedSourceBytesRead: 2_000,
      networkSourceBytesCached: 3_000,
    });
    expect(messages.join("\n")).toContain("cacheHits=1 network=1");
    expect(messages.join("\n")).toContain("remainingShows=9 remainingRows=957");
    expect(messages.join("\n")).toContain("estimatedDatabase=150.0KB");
  });

  it("formats decimal storage units used by the 1 GB Render allowance", () => {
    expect(formatBytes(999)).toBe("999B");
    expect(formatBytes(42_389)).toBe("42.4KB");
    expect(formatBytes(900_000_000)).toBe("900.0MB");
    expect(formatBytes(1_000_000_000)).toBe("1.00GB");
  });
});
