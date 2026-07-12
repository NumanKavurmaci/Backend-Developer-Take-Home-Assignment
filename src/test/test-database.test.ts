import { readdir } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  assertUsingTestDatabase,
  clearTestTables,
  clearContentTables,
  clearLiveChannelTables,
  configureTestDatabaseUrl,
} from "./test-database.js";

const prisma = new PrismaClient();

afterAll(async () => {
  await prisma.$disconnect();
});

describe("test database safety guard", () => {
  it("preserves a DATABASE_URL supplied by CI", async () => {
    const originalDatabaseUrl = process.env.DATABASE_URL;
    const ciDatabaseUrl =
      "postgresql://saatcms:saatcms_ci@localhost:5432/saatcms_test?schema=public";

    try {
      process.env.DATABASE_URL = ciDatabaseUrl;

      await configureTestDatabaseUrl();

      expect(process.env.DATABASE_URL).toBe(ciDatabaseUrl);
    } finally {
      if (originalDatabaseUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = originalDatabaseUrl;
      }
    }
  });

  it("accepts the dedicated disposable test database", () => {
    expect(() =>
      assertUsingTestDatabase(
        "postgresql://saatcms:saatcms_local@localhost:5432/saatcms_test?schema=public",
      ),
    ).not.toThrow();
  });

  it("rejects the development database before destructive cleanup", () => {
    expect(() =>
      assertUsingTestDatabase(
        "postgresql://saatcms:saatcms_local@localhost:5432/saatcms?schema=public",
      ),
    ).toThrow("Refusing to run destructive test cleanup");
  });

  it("rejects a production-like database before destructive cleanup", () => {
    expect(() =>
      assertUsingTestDatabase(
        "postgresql://saatcms:secret@db.saatcms.example:5432/saatcms_test?schema=public",
      ),
    ).toThrow("Refusing to run destructive test cleanup");
  });

  it("rejects destructive cleanup outside the test runtime", () => {
    expect(() =>
      assertUsingTestDatabase(
        "postgresql://saatcms:saatcms_local@localhost:5432/saatcms_test?schema=public",
        "production",
      ),
    ).toThrow("Refusing to run destructive test cleanup");
  });

  it("starts with every committed migration applied", async () => {
    const migrationDirectories = readdir(
      new URL("../../prisma/migrations/", import.meta.url),
      {
        withFileTypes: true,
      },
    );
    const committedMigrations = (await migrationDirectories)
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    const appliedMigrations = await prisma.$queryRaw<
      Array<{ migration_name: string }>
    >`SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name`;

    expect(appliedMigrations.map(({ migration_name }) => migration_name)).toEqual(
      committedMigrations,
    );
  });

  it("rejects cleanup when a Prisma client reaches a different schema", async () => {
    const databaseUrl = new URL(process.env.DATABASE_URL!);
    databaseUrl.searchParams.set("schema", "information_schema");
    const mismatchedClient = new PrismaClient({
      datasources: { db: { url: databaseUrl.toString() } },
    });

    try {
      await expect(clearTestTables(mismatchedClient)).rejects.toThrow(
        "connected PostgreSQL database or schema does not match",
      );
    } finally {
      await mismatchedClient.$disconnect();
    }
  });

  it("clears content data from the disposable test database", async () => {
    await prisma.content.create({
      data: {
        id: "test-db-guard-content",
        type: "MOVIE",
        title: "Disposable Test Content",
      },
    });

    await expect(prisma.content.count()).resolves.toBeGreaterThan(0);

    await clearContentTables(prisma);

    await expect(prisma.content.count()).resolves.toBe(0);
  });

  it("clears live channel data from the disposable test database", async () => {
    await prisma.liveChannel.create({
      data: {
        id: "test-db-guard-channel",
        name: "Disposable Test Channel",
        slug: "disposable-test-channel",
      },
    });

    await expect(prisma.liveChannel.count()).resolves.toBeGreaterThan(0);

    await clearLiveChannelTables(prisma);

    await expect(prisma.liveChannel.count()).resolves.toBe(0);
  });

  it("clears all application tables without removing migration history", async () => {
    await prisma.content.create({
      data: { type: "MOVIE", title: "Cleanup content" },
    });
    await prisma.liveChannel.create({
      data: { name: "Cleanup channel", slug: "cleanup-channel" },
    });

    await clearTestTables(prisma);

    await expect(prisma.content.count()).resolves.toBe(0);
    await expect(prisma.liveChannel.count()).resolves.toBe(0);
    const [{ count }] = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) AS count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL
    `;
    expect(count).toBeGreaterThan(0n);
  });
});

describe("cross-test database isolation", () => {
  beforeEach(async () => {
    await clearContentTables(prisma);
  });

  it("allows a test to leave data behind", async () => {
    await expect(prisma.content.count()).resolves.toBe(0);
    await prisma.content.create({
      data: { id: "cross-test-marker", type: "MOVIE", title: "Marker" },
    });
    await expect(prisma.content.count()).resolves.toBe(1);
  });

  it("starts independently with an empty table", async () => {
    await expect(prisma.content.count()).resolves.toBe(0);
  });
});
