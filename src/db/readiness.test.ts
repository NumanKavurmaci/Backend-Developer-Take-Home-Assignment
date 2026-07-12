import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { assertDatabaseReady } from "./readiness.js";

const prisma = new PrismaClient();

afterAll(async () => {
  await prisma.$disconnect();
});

describe("database schema readiness", () => {
  it("accepts the fully migrated schema", async () => {
    await expect(assertDatabaseReady(prisma)).resolves.toBeUndefined();
  });

  it.each([
    ["readiness_empty", false],
    ["readiness_partial", true],
  ])(
    "rejects an unmigrated or partial schema %s",
    async (schemaName, partial) => {
      await prisma.$executeRawUnsafe(`CREATE SCHEMA "${schemaName}"`);
      if (partial) {
        await prisma.$executeRawUnsafe(
          `CREATE TABLE "${schemaName}"."Content" (id text PRIMARY KEY)`,
        );
      }

      const databaseUrl = new URL(process.env.DATABASE_URL!);
      databaseUrl.searchParams.set("schema", schemaName);
      const isolated = new PrismaClient({
        datasources: { db: { url: databaseUrl.toString() } },
      });

      try {
        await expect(assertDatabaseReady(isolated)).rejects.toThrow(
          "missing required relations",
        );
      } finally {
        await isolated.$disconnect();
        await prisma.$executeRawUnsafe(`DROP SCHEMA "${schemaName}" CASCADE`);
      }
    },
  );

  it.each([
    ["readiness_failed_migration", false],
    ["readiness_rolled_back_migration", true],
  ])(
    "rejects invalid migration history in %s",
    async (schemaName, rolledBack) => {
      await prisma.$executeRawUnsafe(`CREATE SCHEMA "${schemaName}"`);
      for (const relationName of [
        "Content",
        "ContentGeoBlockCountry",
        "LiveChannel",
        "EpgProgram",
        "EpgScheduleLock",
      ]) {
        await prisma.$executeRawUnsafe(
          `CREATE TABLE "${schemaName}"."${relationName}" (id text PRIMARY KEY)`,
        );
      }
      await prisma.$executeRawUnsafe(
        `CREATE TABLE "${schemaName}"."_prisma_migrations" (migration_name text, finished_at timestamptz, rolled_back_at timestamptz)`,
      );
      await prisma.$executeRawUnsafe(
        `INSERT INTO "${schemaName}"."_prisma_migrations" VALUES ('20260712220000_add_content_catalog_fields', now(), NULL)`,
      );
      await prisma.$executeRawUnsafe(
        rolledBack
          ? `INSERT INTO "${schemaName}"."_prisma_migrations" VALUES ('rolled_back', now(), now())`
          : `INSERT INTO "${schemaName}"."_prisma_migrations" VALUES ('failed', NULL, NULL)`,
      );

      const databaseUrl = new URL(process.env.DATABASE_URL!);
      databaseUrl.searchParams.set("schema", schemaName);
      const isolated = new PrismaClient({
        datasources: { db: { url: databaseUrl.toString() } },
      });

      try {
        await expect(assertDatabaseReady(isolated)).rejects.toThrow(
          "incomplete, failed, or rolled back",
        );
      } finally {
        await isolated.$disconnect();
        await prisma.$executeRawUnsafe(`DROP SCHEMA "${schemaName}" CASCADE`);
      }
    },
  );
});
