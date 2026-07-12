import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { clearTestTables } from "../src/test/test-database.js";
import { seedDemoData } from "./seed.js";

const prisma = new PrismaClient();

beforeEach(async () => {
  await clearTestTables(prisma);
});

afterAll(async () => {
  await clearTestTables(prisma);
  await prisma.$disconnect();
});

describe("atomic demo seeding", () => {
  it("rolls deletion back when seeding fails after the clear step", async () => {
    await prisma.content.create({
      data: {
        id: "pre-seed-marker",
        type: "MOVIE",
        title: "Must survive failed seed",
      },
    });

    await expect(
      seedDemoData(prisma, () => {
        throw new Error("injected seed failure");
      }),
    ).rejects.toThrow("injected seed failure");

    await expect(
      prisma.content.findUnique({ where: { id: "pre-seed-marker" } }),
    ).resolves.not.toBeNull();
  });
});
