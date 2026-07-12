import { describe, expect, it } from "vitest";
import {
  applyDeterministicDemoPolicies,
  validateCatalogPolicies,
} from "./policies.js";
import type { NormalizedCatalogChunk } from "./types.js";
import { policyFixtureChunk } from "./policy-fixture.js";

describe("minimal deterministic demo policies", () => {
  it("produces identical policies and scenario IDs regardless of row order", () => {
    const input = policyFixtureChunk();
    const first = applyDeterministicDemoPolicies(input);
    const second = applyDeterministicDemoPolicies({
      ...structuredClone(input),
      content: [...input.content].reverse(),
    });
    const policiesById = (value: typeof first) => Object.fromEntries(
      value.chunk.content
        .map((row) => [row.id, row.policies] as const)
        .sort(([left], [right]) => left.localeCompare(right)),
    );
    expect(policiesById(second)).toEqual(policiesById(first));
    expect(second.scenarioIds).toEqual(first.scenarioIds);
  });

  it("keeps provider facts unchanged and adds only one Season and Episode override", () => {
    const input = policyFixtureChunk();
    const sourceFacts = Object.fromEntries(input.content.map((row) => [row.id, row.sourceFacts]));
    const generated = applyDeterministicDemoPolicies(input);
    expect(Object.fromEntries(generated.chunk.content.map((row) => [row.id, row.sourceFacts]))).toEqual(sourceFacts);

    const byId = new Map(generated.chunk.content.map((row) => [row.id, row]));
    expect(byId.get("tvmaze-series-10")?.policies).toEqual({
      parentalRating: "13+", genre: "General", quality: "HD", isPremium: false,
      playbackUrl: "https://media.invalid/content/tvmaze-series-10",
      geoBlockCountriesOverride: true,
    });
    expect(byId.get("tvmaze-season-22")?.policies).toMatchObject({
      parentalRating: "16+", genre: "Mystery",
    });
    expect(byId.get("tvmaze-episode-202")?.policies).toEqual({
      parentalRating: null, genre: null, quality: "UHD_4K", isPremium: true,
      playbackUrl: "https://media.invalid/content/tvmaze-episode-202",
      geoBlockCountriesOverride: true,
    });
    expect(generated.chunk.geoBlocks).toEqual([
      { contentId: "tvmaze-series-10", countryCode: "IR" },
      { contentId: "tvmaze-series-10", countryCode: "SY" },
    ]);
  });

  it("reuses a minimal stable set of Content IDs for all scenarios", () => {
    expect(applyDeterministicDemoPolicies(policyFixtureChunk()).scenarioIds).toEqual({
      inheritedEpisodeId: "tvmaze-episode-101",
      seasonOverrideEpisodeId: "tvmaze-episode-201",
      episodeOverrideEpisodeId: "tvmaze-episode-202",
      geoBlockedContentId: "tvmaze-episode-101",
      emptyGeoOverrideEpisodeId: "tvmaze-episode-202",
      allowedPlaybackContentId: "tvmaze-episode-202",
      premium4kEpisodeId: "tvmaze-episode-202",
    });
  });

  it.each([
    ["quality", (chunk: NormalizedCatalogChunk) => { chunk.content[0]!.policies.quality = "8K" as "HD"; }, /Invalid policy quality/],
    ["country", (chunk: NormalizedCatalogChunk) => { chunk.geoBlocks[0]!.countryCode = "USA"; }, /Invalid country code/],
    ["hierarchy", (chunk: NormalizedCatalogChunk) => { chunk.content.at(-1)!.parentId = "missing"; }, /Missing parent/],
    ["playback", (chunk: NormalizedCatalogChunk) => { chunk.content[0]!.policies.playbackUrl = "https://real.example/stream.m3u8"; }, /media.invalid/],
  ])("rejects invalid %s policy data", (_label, mutate, expected) => {
    const chunk = applyDeterministicDemoPolicies(policyFixtureChunk()).chunk;
    mutate(chunk);
    expect(() => validateCatalogPolicies(chunk)).toThrow(expected);
  });

  it("fails clearly when the catalog is too small for stable scenarios", () => {
    const input = policyFixtureChunk();
    input.content = input.content.filter((row) => row.type === "SERIES");
    expect(() => applyDeterministicDemoPolicies(input)).toThrow(/cannot provide demo scenarios/);
  });
});
