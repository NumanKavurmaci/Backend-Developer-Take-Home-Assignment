import { describe, expect, it } from "vitest";
import {
  CONTENT_TYPES,
  VIDEO_QUALITIES,
} from "../shared/domain/domain-contracts.js";
import { toResolvedContentView } from "./resolved-content-view.js";

describe("resolved content view", () => {
  it("selects public resolved metadata without protected playback fields", () => {
    expect(
      toResolvedContentView({
        contentId: "episode-1",
        type: CONTENT_TYPES.EPISODE,
        title: "Episode 1",
        parentalRating: null,
        genre: null,
        quality: VIDEO_QUALITIES.HD,
        isPremium: false,
        playbackUrl: "https://cdn.saatcms.test/episode-1.m3u8",
        geoBlockCountries: [],
      }),
    ).toEqual({
      type: CONTENT_TYPES.EPISODE,
      title: "Episode 1",
      parentalRating: null,
      genre: null,
      quality: VIDEO_QUALITIES.HD,
      isPremium: false,
      geoBlockCountries: [],
    });
  });
});
