import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, truncate, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_CATALOG_LIMITS } from "./config.js";
import { applyDeterministicDemoPolicies } from "./policies.js";
import { policyFixtureChunk } from "./policy-fixture.js";
import {
  CONTENT_ARTIFACT_FILE,
  GEO_BLOCKS_ARTIFACT_FILE,
  MANIFEST_FILE,
  type CatalogArtifactManifest,
} from "./artifact-types.js";
import { writeCatalogArtifact, type WriteCatalogArtifactOptions } from "./artifact.js";
import { validateCatalogArtifact } from "./artifact-validator.js";
import type { NormalizedCatalogChunk } from "./types.js";
import { normalizeTvMazeHierarchy } from "./tvmaze-hierarchy.js";

let temporaryRoot: string;

beforeEach(async () => {
  temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "saatcms-artifact-"));
});
afterEach(async () => rm(temporaryRoot, { recursive: true, force: true }));

function options(generatedAt = "2026-07-12T20:00:00.000Z"): WriteCatalogArtifactOptions {
  return {
    generatedAt,
    generatorVersion: "0.1.0",
    provenance: [{
      source: "TVMAZE",
      providerName: "TVmaze",
      providerUrl: "https://www.tvmaze.com/api",
      license: "CC BY-SA",
      attribution: "Data provided by TVmaze",
      snapshotKey: "fixture-20260712",
    }],
    configuration: {
      ...DEFAULT_CATALOG_LIMITS,
      tvmazeStartPage: 0,
      maxPages: 1,
      offline: true,
    },
    scenarioIds: applyDeterministicDemoPolicies(policyFixtureChunk()).scenarioIds,
    estimatedDatabaseBytes: 1_000_000,
  };
}

function generatedChunk(): NormalizedCatalogChunk {
  return applyDeterministicDemoPolicies(policyFixtureChunk()).chunk;
}

describe("versioned catalog artifact", () => {
  it("builds identical rows and checksums twice, excluding generatedAt", async () => {
    const firstDir = path.join(temporaryRoot, "first");
    const secondDir = path.join(temporaryRoot, "second");
    const first = await writeCatalogArtifact(firstDir, generatedChunk(), options());
    const second = await writeCatalogArtifact(
      secondDir,
      { ...generatedChunk(), content: [...generatedChunk().content].reverse() },
      options("2026-07-12T21:00:00.000Z"),
    );
    expect(second.files).toEqual(first.files);
    expect(second.counts).toEqual(first.counts);
    expect(second.generatedAt).not.toBe(first.generatedAt);
    await expect(readFile(path.join(secondDir, CONTENT_ARTIFACT_FILE))).resolves.toEqual(
      await readFile(path.join(firstDir, CONTENT_ARTIFACT_FILE)),
    );
  });

  it("records manifest counts and validates without a database", async () => {
    const directory = path.join(temporaryRoot, "valid");
    const manifest = await writeCatalogArtifact(directory, generatedChunk(), options());
    expect(manifest.counts).toEqual({
      content: 6, series: 1, seasons: 2, episodes: 3, movies: 0,
      geoBlocks: 2, derivedSeasons: 0,
    });
    expect(manifest).toMatchObject({
      artifactSchemaVersion: 1,
      generator: { name: "saatcms-tvmaze-catalog", version: "0.1.0" },
      generatedAt: "2026-07-12T20:00:00.000Z",
      provenance: [{ providerName: "TVmaze", license: "CC BY-SA" }],
      configuration: {
        ...DEFAULT_CATALOG_LIMITS,
        tvmazeStartPage: 0,
        maxPages: 1,
        offline: true,
      },
      scenarioIds: {
        inheritedEpisodeId: "tvmaze-episode-101",
        premium4kEpisodeId: "tvmaze-episode-202",
      },
      estimatedDatabaseBytes: 1_000_000,
      files: {
        content: { fileName: CONTENT_ARTIFACT_FILE, rows: 6 },
        geoBlocks: { fileName: GEO_BLOCKS_ARTIFACT_FILE, rows: 2 },
      },
    });
    await expect(validateCatalogArtifact(directory)).resolves.toMatchObject({
      contentIdsRetained: 6,
      manifest: { counts: manifest.counts },
    });
  });

  it("rejects checksum corruption", async () => {
    const directory = path.join(temporaryRoot, "corrupt");
    await writeCatalogArtifact(directory, generatedChunk(), options());
    const file = path.join(directory, CONTENT_ARTIFACT_FILE);
    const bytes = await readFile(file);
    bytes[Math.floor(bytes.length / 2)]! ^= 1;
    await writeFile(file, bytes);
    await expect(validateCatalogArtifact(directory)).rejects.toThrow(/checksum mismatch/);
  });

  it("rejects an unsupported schema version before opening data files", async () => {
    const directory = path.join(temporaryRoot, "version");
    await writeCatalogArtifact(directory, generatedChunk(), options());
    const manifest = await readManifest(directory) as unknown as Record<string, unknown>;
    manifest.artifactSchemaVersion = 999;
    await writeManifest(directory, manifest);
    await rm(path.join(directory, CONTENT_ARTIFACT_FILE));
    await expect(validateCatalogArtifact(directory)).rejects.toThrow(/Unsupported catalog artifact schema version: 999/);
  });

  it("fails safely when compressed NDJSON is truncated", async () => {
    const directory = path.join(temporaryRoot, "truncated");
    await writeCatalogArtifact(directory, generatedChunk(), options());
    const file = path.join(directory, CONTENT_ARTIFACT_FILE);
    const bytes = await readFile(file);
    await truncate(file, bytes.length - 5);
    const truncated = await readFile(file);
    const manifest = await readManifest(directory);
    manifest.files.content.compressedBytes = truncated.length;
    manifest.files.content.sha256 = createHash("sha256").update(truncated).digest("hex");
    await writeManifest(directory, manifest);
    await expect(validateCatalogArtifact(directory)).rejects.toThrow(/truncated or malformed/);
  });

  it("publishes atomically and never replaces an existing artifact", async () => {
    const directory = path.join(temporaryRoot, "complete");
    await writeCatalogArtifact(directory, generatedChunk(), options());
    await expect(writeCatalogArtifact(directory, generatedChunk(), options())).rejects.toThrow(/Refusing to replace/);
    await expect(readFile(path.join(directory, MANIFEST_FILE), "utf8")).resolves.toContain('"artifactSchemaVersion": 1');
    const partial = path.join(temporaryRoot, "unfinished.partial-build");
    await writeFile(partial, "partial data");
    await expect(validateCatalogArtifact(partial)).rejects.toThrow(/manifest is missing or malformed/);
  });

  it("does not serialize configured credentials or local filesystem paths", async () => {
    const directory = path.join(temporaryRoot, "secrets");
    process.env.TEST_ARTIFACT_TOKEN = "artifact-super-secret-token";
    const databaseUrl = process.env.DATABASE_URL ?? "postgresql://user:password@localhost/private";
    await writeCatalogArtifact(directory, generatedChunk(), options());
    const searchable = [
      await readFile(path.join(directory, MANIFEST_FILE), "utf8"),
      gunzipSync(await readFile(path.join(directory, CONTENT_ARTIFACT_FILE))).toString("utf8"),
      gunzipSync(await readFile(path.join(directory, GEO_BLOCKS_ARTIFACT_FILE))).toString("utf8"),
    ].join("\n");
    expect(searchable).not.toContain(process.env.TEST_ARTIFACT_TOKEN);
    expect(searchable).not.toContain(databaseUrl);
    expect(searchable).not.toContain(process.cwd());
    delete process.env.TEST_ARTIFACT_TOKEN;
  });

  it("stream-validates a representative multi-show artifact", async () => {
    const directory = path.join(temporaryRoot, "large");
    const chunk = representativeChunk(250);
    const generated = applyDeterministicDemoPolicies(chunk);
    const manifest = await writeCatalogArtifact(directory, generated.chunk, {
      ...options(),
      scenarioIds: generated.scenarioIds,
    });
    expect(manifest.counts.content).toBe(1_500);
    await expect(validateCatalogArtifact(directory)).resolves.toMatchObject({
      contentIdsRetained: 1_500,
      manifest: { counts: { content: 1_500 } },
    });
  });
});

async function readManifest(directory: string): Promise<CatalogArtifactManifest> {
  return JSON.parse(await readFile(path.join(directory, MANIFEST_FILE), "utf8")) as CatalogArtifactManifest;
}

async function writeManifest(directory: string, manifest: unknown): Promise<void> {
  await writeFile(path.join(directory, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
}

function representativeChunk(showCount: number): NormalizedCatalogChunk {
  const chunks: NormalizedCatalogChunk[] = [];
  for (let index = 1; index <= showCount; index += 1) {
    const seasonOneId = index * 10 + 1;
    const seasonTwoId = index * 10 + 2;
    const episodeBase = index * 100;
    const result = normalizeTvMazeHierarchy({
      show: {
        id: index, name: `Show ${index}`, url: null, language: null, status: null,
        runtime: null, premiered: null, ended: null, officialSite: null,
        genres: [], rating: { average: null }, network: null, webChannel: null,
        image: null, summary: null,
      },
      seasons: [1, 2].map((number) => ({
        id: number === 1 ? seasonOneId : seasonTwoId,
        number, name: `Season ${number}`, url: null, premiereDate: null,
        endDate: null, network: null, webChannel: null, image: null, summary: null,
      })),
      episodes: [
        { id: episodeBase + 1, season: 1, number: 1 },
        { id: episodeBase + 2, season: 2, number: 1 },
        { id: episodeBase + 3, season: 2, number: 2 },
      ].map((episode) => ({
        ...episode, name: `Episode ${episode.id}`, type: "regular", url: null,
        airdate: null, runtime: null, rating: { average: null }, image: null,
        summary: null,
      })),
    });
    if (result.status !== "normalized") throw new Error("Representative fixture must normalize.");
    chunks.push(result.chunk);
  }
  return {
    content: chunks.flatMap((chunk) => chunk.content),
    geoBlocks: [],
    derivedSeasons: [],
  };
}
