import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { clearLiveChannelTables } from "../../test/test-database.js";
import { createLiveChannel } from "../live-channel-repository.js";
import {
  createEpgProgram,
  createEpgProgramWithConcurrencyLock,
  deleteEpgProgram,
  getEpgProgram,
  listEpgPrograms,
  updateEpgProgramWithConcurrencyLock,
} from "./epg-program-repository.js";

const prisma = new PrismaClient();
const independentClients: PrismaClient[] = [];

beforeEach(async () => {
  await clearLiveChannelTables(prisma);
});

afterAll(async () => {
  await Promise.all(independentClients.map((client) => client.$disconnect()));
  await prisma.$disconnect();
});

describe("EPG program CRUD repository", () => {
  it("gets a program only through its owning channel route", async () => {
    await createChannel("channel-news");
    await createChannel("channel-sports");
    await createProgram("epg-news", "channel-news", 10, 11);

    await expect(
      getEpgProgram(prisma, "channel-news", "epg-news"),
    ).resolves.toMatchObject({ id: "epg-news" });
    await expect(
      getEpgProgram(prisma, "channel-sports", "epg-news"),
    ).rejects.toMatchObject({ errorCode: "EPG_PROGRAM_NOT_FOUND" });
  });

  it("lists an overlapping UTC window with stable bounded pagination", async () => {
    await createChannel("channel-news");
    await createProgram("epg-before", "channel-news", 8, 9);
    await createProgram("epg-first", "channel-news", 9, 10);
    await createProgram("epg-second", "channel-news", 10, 11);
    await createProgram("epg-after", "channel-news", 11, 12);

    const page = await listEpgPrograms(prisma, {
      channelId: "channel-news",
      windowStart: atHour(9),
      windowEnd: atHour(11),
      page: 2,
      pageSize: 1,
    });

    expect(page).toMatchObject({ page: 2, pageSize: 1, total: 2 });
    expect(page.items.map((program) => program.id)).toEqual(["epg-second"]);
  });

  it("updates its own time range while excluding itself from overlap checks", async () => {
    await createChannel("channel-news");
    await createProgram("epg-news", "channel-news", 10, 11);

    await expect(
      updateEpgProgramWithConcurrencyLock(
        prisma,
        "channel-news",
        "epg-news",
        { programName: " Updated News " },
      ),
    ).resolves.toMatchObject({
      id: "epg-news",
      programName: "Updated News",
      startTime: atHour(10),
      endTime: atHour(11),
    });
  });

  it("allows a back-to-back update and rejects an overlapping update", async () => {
    await createChannel("channel-news");
    await createProgram("epg-first", "channel-news", 10, 11);
    await createProgram("epg-second", "channel-news", 12, 13);

    await expect(
      updateEpgProgramWithConcurrencyLock(
        prisma,
        "channel-news",
        "epg-second",
        { startTime: atHour(11) },
      ),
    ).resolves.toMatchObject({ startTime: atHour(11) });

    await expect(
      updateEpgProgramWithConcurrencyLock(
        prisma,
        "channel-news",
        "epg-second",
        { startTime: new Date("2026-07-02T10:30:00.000Z") },
      ),
    ).rejects.toMatchObject({ errorCode: "EPG_OVERLAP" });
  });

  it("deletes a program without removing the channel schedule lock", async () => {
    await createChannel("channel-news");
    await createProgram("epg-news", "channel-news", 10, 11);

    await deleteEpgProgram(prisma, "channel-news", "epg-news");

    await expect(prisma.epgProgram.count()).resolves.toBe(0);
    await expect(
      prisma.epgScheduleLock.findUnique({
        where: { channelId: "channel-news" },
      }),
    ).resolves.not.toBeNull();
  });

  it("serializes a create against an overlapping update across clients", async () => {
    await createChannel("channel-news");
    await createProgram("epg-existing", "channel-news", 8, 9);
    const firstClient = createIndependentClient();
    const secondClient = createIndependentClient();

    const results = await Promise.allSettled([
      updateEpgProgramWithConcurrencyLock(
        firstClient,
        "channel-news",
        "epg-existing",
        { startTime: atHour(10), endTime: atHour(12) },
      ),
      createEpgProgramWithConcurrencyLock(secondClient, {
        id: "epg-created",
        channelId: "channel-news",
        programName: "Created",
        startTime: atHour(11),
        endTime: atHour(13),
      }),
    ]);

    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(
      1,
    );
    expect(results.filter(({ status }) => status === "rejected")).toHaveLength(
      1,
    );
    await expectNoDatabaseOverlaps();
  });

  it("serializes competing overlapping updates across clients", async () => {
    await createChannel("channel-news");
    await createProgram("epg-first", "channel-news", 8, 9);
    await createProgram("epg-second", "channel-news", 14, 15);
    const firstClient = createIndependentClient();
    const secondClient = createIndependentClient();

    const results = await Promise.allSettled([
      updateEpgProgramWithConcurrencyLock(
        firstClient,
        "channel-news",
        "epg-first",
        { startTime: atHour(10), endTime: atHour(12) },
      ),
      updateEpgProgramWithConcurrencyLock(
        secondClient,
        "channel-news",
        "epg-second",
        { startTime: atHour(11), endTime: atHour(13) },
      ),
    ]);

    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(
      1,
    );
    expect(results.filter(({ status }) => status === "rejected")).toHaveLength(
      1,
    );
    await expectNoDatabaseOverlaps();
  });
});

async function createChannel(id: string): Promise<void> {
  await createLiveChannel(prisma, {
    id,
    name: id,
    slug: id,
  });
}

async function createProgram(
  id: string,
  channelId: string,
  startHour: number,
  endHour: number,
): Promise<void> {
  await createEpgProgram(prisma, {
    id,
    channelId,
    programName: id,
    startTime: atHour(startHour),
    endTime: atHour(endHour),
  });
}

function atHour(hour: number): Date {
  return new Date(`2026-07-02T${String(hour).padStart(2, "0")}:00:00.000Z`);
}

function createIndependentClient(): PrismaClient {
  const client = new PrismaClient({
    transactionOptions: { maxWait: 10_000, timeout: 10_000 },
  });
  independentClients.push(client);
  return client;
}

async function expectNoDatabaseOverlaps(): Promise<void> {
  const overlaps = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*) AS count
    FROM "EpgProgram" first_program
    JOIN "EpgProgram" second_program
      ON first_program."channelId" = second_program."channelId"
     AND first_program.id < second_program.id
     AND first_program."startTime" < second_program."endTime"
     AND first_program."endTime" > second_program."startTime"
  `;

  expect(overlaps[0]?.count).toBe(0n);
}
