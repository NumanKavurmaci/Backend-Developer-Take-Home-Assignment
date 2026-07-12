import { describe, expect, it } from "vitest";
import {
  tvmazeDerivedSeasonId,
  tvmazeEpisodeId,
  tvmazeSeasonId,
  tvmazeSeriesId,
  tvmazeSourceId,
} from "./identifiers.js";

describe("TVmaze deterministic identifiers", () => {
  it("builds stable Series, Season, and Episode IDs", () => {
    expect(tvmazeSeriesId(42)).toBe("tvmaze-series-42");
    expect(tvmazeSeasonId(77)).toBe("tvmaze-season-77");
    expect(tvmazeEpisodeId(99)).toBe("tvmaze-episode-99");
  });

  it("builds stable source identities", () => {
    expect(tvmazeSourceId("show", 42)).toBe("show:42");
    expect(tvmazeSourceId("season", 77)).toBe("season:77");
    expect(tvmazeSourceId("episode", 99)).toBe("episode:99");
  });

  it("uses the documented deterministic derived-Season ID", () => {
    expect(tvmazeDerivedSeasonId(42, 3)).toBe("tvmaze-series-42-season-3");
  });

  it.each([0, -1, 1.5, Number.NaN])("rejects malformed numeric identity %s", (id) => {
    expect(() => tvmazeSeriesId(id)).toThrow(/Invalid TVmaze/);
  });
});
