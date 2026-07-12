import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearTestTables } from "../../src/test/test-database.js";
import { writeCatalogArtifact } from "./artifact.js";
import { DEFAULT_CATALOG_LIMITS } from "./config.js";
import { loadCatalogArtifact } from "./catalog-loader.js";
import { applyDeterministicDemoPolicies } from "./policies.js";
import { policyFixtureChunk } from "./policy-fixture.js";

const prisma = new PrismaClient();
let temporaryRoot: string;

beforeEach(async () => {
  await clearTestTables(prisma);
  temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "catalog-loader-"));
});
afterEach(async () => rm(temporaryRoot, { recursive: true, force: true }));
afterAll(async () => prisma.$disconnect());

describe("safe PostgreSQL catalog loader", () => {
  it("loads parent-first batches, replaces old Content, and preserves Live Channel/EPG data", async () => {
    const artifact = await createArtifact("preserve");
    await seedOldCatalogAndEpg();
    const batchEvents: Array<{ kind: string; inserted: number }> = [];
    const report = await loadCatalogArtifact(prisma, {
      ...loadOptions(artifact, 4),
      afterBatch: (event) => { batchEvents.push(event); },
    });

    expect(report.inserted).toMatchObject({
      content: 6, series: 1, seasons: 2, episodes: 3, geoBlocks: 2,
    });
    expect(report.verificationPassed).toBe(true);
    expect(batchEvents).toEqual([
      { kind: "content", inserted: 1 },
      { kind: "content", inserted: 3 },
      { kind: "content", inserted: 6 },
      { kind: "geo-block", inserted: 2 },
    ]);
    await expect(prisma.content.findUnique({ where: { id: "old-content" } })).resolves.toBeNull();
    await expect(prisma.content.findUnique({
      where: { id: "tvmaze-episode-202" },
      include: { parent: { include: { parent: true } } },
    })).resolves.toMatchObject({
      parent: { id: "tvmaze-season-22", parent: { id: "tvmaze-series-10" } },
    });
    await expect(Promise.all([
      prisma.liveChannel.count(), prisma.epgProgram.count(), prisma.epgScheduleLock.count(),
    ])).resolves.toEqual([1, 1, 1]);
  });

  it("is deterministic and duplicate-free when the same artifact is loaded repeatedly", async () => {
    const artifact = await createArtifact("repeat");
    const first = await loadCatalogArtifact(prisma, loadOptions(artifact, 2));
    const firstIdentities = await prisma.content.findMany({
      orderBy: { id: "asc" },
      select: { id: true, parentId: true, source: true, sourceId: true },
    });
    const second = await loadCatalogArtifact(prisma, loadOptions(artifact, 3));
    const secondIdentities = await prisma.content.findMany({
      orderBy: { id: "asc" },
      select: { id: true, parentId: true, source: true, sourceId: true },
    });
    expect(second.inserted).toEqual(first.inserted);
    expect(secondIdentities).toEqual(firstIdentities);
  });

  it("rolls back deletion and inserted batches after a mid-load failure", async () => {
    const artifact = await createArtifact("rollback");
    await prisma.content.create({ data: { id: "old-content", type: "MOVIE", title: "Old" } });
    await expect(loadCatalogArtifact(prisma, {
      ...loadOptions(artifact, 2),
      afterBatch: ({ kind }) => {
        if (kind === "content") throw new Error("injected batch failure");
      },
    })).rejects.toThrow(/injected batch failure/);
    await expect(prisma.content.findMany({ select: { id: true } })).resolves.toEqual([
      { id: "old-content" },
    ]);
  });

  it("validates corruption and estimate budgets before deleting existing Content", async () => {
    const corruptArtifact = await createArtifact("corrupt");
    await prisma.content.create({ data: { id: "old-content", type: "MOVIE", title: "Old" } });
    const contentFile = path.join(corruptArtifact, "content.ndjson.gz");
    const bytes = await readFile(contentFile);
    bytes[Math.floor(bytes.length / 2)]! ^= 1;
    await writeFile(contentFile, bytes);
    await expect(loadCatalogArtifact(prisma, loadOptions(corruptArtifact, 2))).rejects.toThrow(/checksum mismatch/);
    await expect(prisma.content.count()).resolves.toBe(1);

    const validArtifact = await createArtifact("over-estimate");
    await expect(loadCatalogArtifact(prisma, {
      ...loadOptions(validArtifact, 2), hardDatabaseGuardBytes: 999_999,
    })).rejects.toThrow(/preflight refused/);
    await expect(prisma.content.count()).resolves.toBe(1);
  });

  it("rolls back when actual PostgreSQL size exceeds the post-load hard guard", async () => {
    const artifact = await createArtifact("actual-size");
    await prisma.content.create({ data: { id: "old-content", type: "MOVIE", title: "Old" } });
    const [size] = await prisma.$queryRaw<Array<{ bytes: bigint }>>`
      SELECT pg_database_size(current_database())::bigint AS bytes
    `;
    const guard = Number(size!.bytes) - 1;
    expect(guard).toBeGreaterThan(1_000_000);
    await expect(loadCatalogArtifact(prisma, {
      ...loadOptions(artifact, 2), hardDatabaseGuardBytes: guard,
    })).rejects.toThrow(/actual PostgreSQL size.*exceeds hard guard/);
    await expect(prisma.content.findMany({ select: { id: true } })).resolves.toEqual([
      { id: "old-content" },
    ]);
  });
});

async function createArtifact(name: string): Promise<string> {
  const directory = path.join(temporaryRoot, name);
  const generated = applyDeterministicDemoPolicies(policyFixtureChunk());
  await writeCatalogArtifact(directory, generated.chunk, {
    generatedAt: "2026-07-12T20:00:00.000Z",
    generatorVersion: "0.1.0",
    provenance: [{
      source: "TVMAZE", providerName: "TVmaze", providerUrl: "https://www.tvmaze.com/api",
      license: "CC BY-SA", attribution: "Data provided by TVmaze", snapshotKey: "loader-test-v1",
    }],
    configuration: {
      ...DEFAULT_CATALOG_LIMITS,
      tvmazeStartPage: 0, maxPages: 1, fetchConcurrency: 4, offline: true,
    },
    scenarioIds: generated.scenarioIds,
    estimatedDatabaseBytes: 1_000_000,
  });
  return directory;
}

function loadOptions(artifactDirectory: string, batchSize: number) {
  const databaseUrl = new URL(process.env.DATABASE_URL!);
  return {
    artifactDirectory,
    batchSize,
    transactionTimeoutMs: 30_000,
    hardDatabaseGuardBytes: DEFAULT_CATALOG_LIMITS.maxEstimatedDatabaseBytes,
    expectedTarget: {
      databaseName: decodeURIComponent(databaseUrl.pathname.slice(1)),
      schemaName: databaseUrl.searchParams.get("schema") ?? "public",
    },
  };
}

async function seedOldCatalogAndEpg(): Promise<void> {
  await prisma.content.create({ data: { id: "old-content", type: "MOVIE", title: "Old" } });
  await prisma.liveChannel.create({
    data: {
      id: "preserved-channel", name: "Preserved", slug: "preserved",
      scheduleLock: { create: {} },
      epgPrograms: { create: {
        id: "preserved-program", programName: "Preserved Program",
        startTime: new Date("2026-07-12T10:00:00.000Z"),
        endTime: new Date("2026-07-12T11:00:00.000Z"),
      } },
    },
  });
}
