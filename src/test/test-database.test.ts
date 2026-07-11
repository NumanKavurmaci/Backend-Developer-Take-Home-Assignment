import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import {
  assertUsingTestDatabase,
  clearContentTables,
  clearLiveChannelTables,
} from "./test-database.js";

const prisma = new PrismaClient();

afterAll(async () => {
  await prisma.$disconnect();
});

describe("test database safety guard", () => {
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
});
