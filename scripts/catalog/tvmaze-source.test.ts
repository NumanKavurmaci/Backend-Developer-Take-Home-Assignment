import { describe, expect, it, vi } from "vitest";
import type { CachedJsonClient } from "./http.js";
import { HttpTvMazeCatalogSource } from "./tvmaze-source.js";

const rawShow = {
  id: 1, name: "Show", url: "https://www.tvmaze.com/shows/1/show",
  language: "English", status: "Ended", runtime: 42, premiered: "2020-01-01",
  ended: "2021-01-01", officialSite: null, genres: ["Drama"],
  rating: { average: 8 }, network: { name: "Network", country: { code: "US" } },
  webChannel: null, image: { medium: "m.jpg", original: "o.jpg" }, summary: "<p>Summary</p>",
};

describe("TVmaze endpoint source", () => {
  it("fetches and decodes Show pages, Seasons, and Episodes with stable operations", async () => {
    const calls: Array<{ url: string; request: unknown }> = [];
    const getJson = vi.fn(async (url: string, request: unknown) => {
      calls.push({ url, request });
      if (url.endsWith("/seasons")) return [{
        id: 11, number: 1, url: null, name: null, premiereDate: null,
        endDate: null, network: null, webChannel: null, image: null, summary: null,
      }];
      if (url.endsWith("/episodes")) return [{
        id: 21, name: "Episode", url: null, type: "regular", season: 1,
        number: 1, airdate: null, runtime: null, rating: { average: null },
        image: null, summary: null,
      }];
      return [rawShow];
    });
    const source = new HttpTvMazeCatalogSource({ getJson } as unknown as CachedJsonClient);
    await expect(source.getShowPage(2)).resolves.toMatchObject([{ id: 1, name: "Show" }]);
    await expect(source.getShowSeasons(1)).resolves.toMatchObject([{ id: 11, number: 1 }]);
    await expect(source.getShowEpisodes(1)).resolves.toMatchObject([{ id: 21, season: 1, number: 1 }]);
    expect(calls).toEqual([
      { url: "https://api.tvmaze.com/shows?page=2", request: { operation: "show-page-2", allowNotFound: true } },
      { url: "https://api.tvmaze.com/shows/1/seasons", request: { operation: "show-1-seasons" } },
      { url: "https://api.tvmaze.com/shows/1/episodes", request: { operation: "show-1-episodes" } },
    ]);
  });

  it("treats a 404 Show page as the end of the index", async () => {
    const source = new HttpTvMazeCatalogSource({
      getJson: vi.fn(async () => null),
    } as unknown as CachedJsonClient);
    await expect(source.getShowPage(999)).resolves.toBeNull();
  });

  it("rejects malformed provider data without echoing its contents", async () => {
    const source = new HttpTvMazeCatalogSource({
      getJson: vi.fn(async () => [{ ...rawShow, rating: "secret-response-body" }]),
    } as unknown as CachedJsonClient);
    const error = await captureError(source.getShowPage(0));
    expect(error.message).toContain("TVmaze show-page-0 returned malformed data");
    expect(error.message).not.toContain("secret-response-body");
  });
});

async function captureError(promise: Promise<unknown>): Promise<Error> {
  try { await promise; } catch (error) {
    if (error instanceof Error) return error;
    throw new Error("Expected an Error instance.");
  }
  throw new Error("Expected operation to fail.");
}
