import { readFile } from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { clearContentTables } from "../test/test-database.js";

const prisma = new PrismaClient();

beforeEach(async () => clearContentTables(prisma));
afterAll(async () => prisma.$disconnect());

describe("Content catalog database schema", () => {
  it("round-trips nullable catalog facts and PostgreSQL mappings", async () => {
    const longSummary = "A long provider description. ".repeat(500);
    const content = await prisma.content.create({
      data: {
        id: "tvmaze-episode-101",
        type: "EPISODE",
        title: "Pilot",
        source: "TVMAZE",
        sourceId: "101",
        sourceUrl: "https://www.tvmaze.com/episodes/101/pilot",
        originalTitle: "Pilot",
        summary: longSummary,
        language: "English",
        status: "Ended",
        countryCode: "US",
        networkName: "Example Network",
        officialSiteUrl: "https://example.test/show",
        imageUrl: "https://example.test/image.jpg",
        premieredAt: new Date("2015-01-08T00:00:00.000Z"),
        endedAt: new Date("2020-01-31T00:00:00.000Z"),
        runtimeMinutes: 42,
        seasonNumber: 1,
        episodeNumber: 1,
        ratingAverage: 8.25,
        genres: ["Drama", "Science-Fiction"],
        sourceMetadata: { providerSeasonId: 12, webChannel: true },
      },
    });

    expect(content).toMatchObject({
      source: "TVMAZE",
      sourceId: "101",
      summary: longSummary,
      runtimeMinutes: 42,
      seasonNumber: 1,
      episodeNumber: 1,
      ratingAverage: 8.25,
      genres: ["Drama", "Science-Fiction"],
      sourceMetadata: { providerSeasonId: 12, webChannel: true },
    });
    expect(content.premieredAt?.toISOString()).toBe("2015-01-08T00:00:00.000Z");
    expect(content.endedAt?.toISOString()).toBe("2020-01-31T00:00:00.000Z");
  });

  it("rejects duplicate provider identities", async () => {
    await prisma.content.create({ data: { id: "source-one", type: "SERIES", title: "One", source: "TVMAZE", sourceId: "42" } });
    await expect(prisma.content.create({ data: { id: "source-two", type: "SERIES", title: "Two", source: "TVMAZE", sourceId: "42" } })).rejects.toThrow();
  });

  it("permits multiple non-imported rows with null source identities", async () => {
    await prisma.content.createMany({ data: [
      { id: "local-one", type: "MOVIE", title: "Local One" },
      { id: "local-two", type: "MOVIE", title: "Local Two", source: null, sourceId: null },
    ] });
    await expect(prisma.content.count()).resolves.toBe(2);
    await expect(prisma.content.findMany({ select: { genres: true } })).resolves.toEqual([{ genres: [] }, { genres: [] }]);
  });

  it("uses the intended PostgreSQL column types and only the source identity index", async () => {
    const columns = await prisma.$queryRaw<Array<{ name: string; type: string; nullable: string }>>`
      SELECT column_name AS name, data_type AS type, is_nullable AS nullable
      FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'Content'
        AND column_name IN ('summary', 'premieredAt', 'endedAt', 'runtimeMinutes', 'ratingAverage', 'genres', 'sourceMetadata')
      ORDER BY column_name
    `;
    const catalogIndexes = await prisma.$queryRaw<Array<{ name: string }>>`
      SELECT indexname AS name FROM pg_indexes
      WHERE schemaname = current_schema() AND tablename = 'Content'
        AND indexname LIKE 'Content_source%'
    `;

    expect(columns).toEqual([
      { name: "endedAt", type: "date", nullable: "YES" },
      { name: "genres", type: "ARRAY", nullable: "NO" },
      { name: "premieredAt", type: "date", nullable: "YES" },
      { name: "ratingAverage", type: "double precision", nullable: "YES" },
      { name: "runtimeMinutes", type: "integer", nullable: "YES" },
      { name: "sourceMetadata", type: "jsonb", nullable: "YES" },
      { name: "summary", type: "text", nullable: "YES" },
    ]);
    expect(catalogIndexes).toEqual([{ name: "Content_source_sourceId_key" }]);
  });

  it("upgrades an old seeded schema without losing its Content row", async () => {
    const schema = `catalog_upgrade_${process.pid}`;
    const migration = await readFile(path.join(process.cwd(), "prisma/migrations/20260712220000_add_content_catalog_fields/migration.sql"), "utf8");
    await prisma.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    try {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
        await tx.$executeRawUnsafe(`CREATE TABLE "Content" (
          "id" TEXT PRIMARY KEY, "type" TEXT NOT NULL, "title" TEXT NOT NULL,
          "parentId" TEXT, "parentalRating" TEXT, "genre" TEXT, "quality" TEXT,
          "isPremium" BOOLEAN, "playbackUrl" TEXT,
          "geoBlockCountriesOverride" BOOLEAN NOT NULL DEFAULT false,
          "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" TIMESTAMPTZ(3) NOT NULL
        )`);
        await tx.$executeRawUnsafe(`INSERT INTO "Content" ("id", "type", "title", "updatedAt") VALUES ('old-demo', 'MOVIE', 'Old Demo', NOW())`);
        for (const statement of migration
          .split(";")
          .map((value) => value.trim())
          .filter(Boolean)) {
          await tx.$executeRawUnsafe(statement);
        }
        const rows = await tx.$queryRawUnsafe<Array<{ id: string; source: string | null; genres: string[] }>>(`SELECT "id", "source", "genres" FROM "Content"`);
        expect(rows).toEqual([{ id: "old-demo", source: null, genres: [] }]);
      });
    } finally {
      await prisma.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
    }
  });
});
