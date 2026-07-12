import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { clearLiveChannelTables } from "../test/test-database.js";
import type { EpgProgramRecord } from "./epg-program/epg-program-types.js";
import {
  assertValidLiveChannelInput,
  normalizeLiveChannelName,
  normalizeLiveChannelSlug,
  prepareLiveChannelCreateInput,
} from "./live-channel.js";
import {
  createLiveChannel,
  getLiveChannelById,
  getLiveChannelBySlug,
  getLiveChannelWithPrograms,
  getLiveChannelWithScheduleLock,
  listLiveChannels,
} from "./live-channel-repository.js";
import {
  createEpgProgram,
  createEpgProgramWithConcurrencyLock,
} from "./epg-program/epg-program-repository.js";

const prisma = new PrismaClient();
const independentPrismaClients: PrismaClient[] = [];

beforeEach(async () => {
  await clearLiveChannelTables(prisma);
});

afterAll(async () => {
  await Promise.all(
    independentPrismaClients.map((client) => client.$disconnect()),
  );
  await prisma.$disconnect();
});

function createIndependentPrismaClient(): PrismaClient {
  const client = new PrismaClient({
    transactionOptions: {
      maxWait: 10_000,
      timeout: 10_000,
    },
  });

  independentPrismaClients.push(client);
  return client;
}

function fulfilledResults<T>(
  results: PromiseSettledResult<T>[],
): PromiseFulfilledResult<T>[] {
  return results.filter(
    (result): result is PromiseFulfilledResult<T> =>
      result.status === "fulfilled",
  );
}

function rejectedResults<T>(
  results: PromiseSettledResult<T>[],
): PromiseRejectedResult[] {
  return results.filter(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
}

function expectNoOverlappingPrograms(programs: EpgProgramRecord[]): void {
  const orderedPrograms = [...programs].sort(
    (left, right) => left.startTime.getTime() - right.startTime.getTime(),
  );

  for (let index = 1; index < orderedPrograms.length; index += 1) {
    const previousProgram = orderedPrograms[index - 1];
    const currentProgram = orderedPrograms[index];

    expect(previousProgram.endTime.getTime()).toBeLessThanOrEqual(
      currentProgram.startTime.getTime(),
    );
  }
}

describe("live channel domain", () => {
  it("normalizes channel names and slugs", () => {
    expect(normalizeLiveChannelName("  Saat News  ")).toBe("Saat News");
    expect(normalizeLiveChannelSlug("  Saat-News  ")).toBe("saat-news");
  });

  it("rejects missing names and slugs", () => {
    expect(() =>
      assertValidLiveChannelInput({
        name: " ",
        slug: "saat-news",
      }),
    ).toThrow("Live channel name is required");

    expect(() =>
      assertValidLiveChannelInput({
        name: "Saat News",
        slug: " ",
      }),
    ).toThrow("Live channel slug is required");
  });

  it("rejects slugs outside the supported URL-safe format", () => {
    expect(() =>
      assertValidLiveChannelInput({
        name: "Saat News",
        slug: "saat_news",
      }),
    ).toThrow(
      "Live channel slug must contain lowercase letters, numbers, and hyphens only",
    );

    expect(() =>
      assertValidLiveChannelInput({
        name: "Saat News",
        slug: "-saat-news",
      }),
    ).toThrow(
      "Live channel slug must contain lowercase letters, numbers, and hyphens only",
    );
  });

  it("prepares normalized create input", () => {
    expect(
      prepareLiveChannelCreateInput({
        id: "channel-saat-news",
        name: "  Saat News  ",
        slug: "  Saat-News  ",
      }),
    ).toEqual({
      id: "channel-saat-news",
      name: "Saat News",
      slug: "saat-news",
    });
  });
});

describe("live channel repository", () => {
  it("creates a live channel with its schedule lock row", async () => {
    const channel = await createLiveChannel(prisma, {
      id: "channel-saat-news",
      name: "Saat News",
      slug: "saat-news",
    });

    const channelWithLock = await getLiveChannelWithScheduleLock(
      prisma,
      channel.id,
    );

    expect(channel).toMatchObject({
      id: "channel-saat-news",
      name: "Saat News",
      slug: "saat-news",
    });
    expect(channelWithLock?.scheduleLock).toMatchObject({
      channelId: "channel-saat-news",
      version: 0,
    });
  });

  it("looks up live channels by id and normalized slug", async () => {
    await createLiveChannel(prisma, {
      id: "channel-saat-news",
      name: "Saat News",
      slug: "saat-news",
    });

    await expect(
      getLiveChannelById(prisma, "channel-saat-news"),
    ).resolves.toMatchObject({
      id: "channel-saat-news",
    });
    await expect(
      getLiveChannelBySlug(prisma, " SAAT-NEWS "),
    ).resolves.toMatchObject({
      id: "channel-saat-news",
    });
  });

  it("lists live channels by display name", async () => {
    await createLiveChannel(prisma, {
      id: "channel-saat-sports",
      name: "Saat Sports",
      slug: "saat-sports",
    });
    await createLiveChannel(prisma, {
      id: "channel-saat-news",
      name: "Saat News",
      slug: "saat-news",
    });

    const channels = await listLiveChannels(prisma);

    expect(channels.map((channel) => channel.id)).toEqual([
      "channel-saat-news",
      "channel-saat-sports",
    ]);
  });

  it("loads EPG programs scoped to one channel in schedule order", async () => {
    await createLiveChannel(prisma, {
      id: "channel-saat-news",
      name: "Saat News",
      slug: "saat-news",
    });
    await createLiveChannel(prisma, {
      id: "channel-saat-sports",
      name: "Saat Sports",
      slug: "saat-sports",
    });
    await prisma.epgProgram.createMany({
      data: [
        {
          id: "news-later",
          channelId: "channel-saat-news",
          programName: "Later News",
          startTime: new Date("2026-07-02T11:00:00.000Z"),
          endTime: new Date("2026-07-02T12:00:00.000Z"),
        },
        {
          id: "sports-same-time",
          channelId: "channel-saat-sports",
          programName: "Sports Desk",
          startTime: new Date("2026-07-02T10:00:00.000Z"),
          endTime: new Date("2026-07-02T11:00:00.000Z"),
        },
        {
          id: "news-earlier",
          channelId: "channel-saat-news",
          programName: "Morning News",
          startTime: new Date("2026-07-02T10:00:00.000Z"),
          endTime: new Date("2026-07-02T11:00:00.000Z"),
        },
      ],
    });

    const channel = await getLiveChannelWithPrograms(
      prisma,
      "channel-saat-news",
    );

    expect(channel?.epgPrograms.map((program) => program.id)).toEqual([
      "news-earlier",
      "news-later",
    ]);
  });

  it("creates an EPG program for an existing channel", async () => {
    await createLiveChannel(prisma, {
      id: "channel-saat-news",
      name: "Saat News",
      slug: "saat-news",
    });

    const program = await createEpgProgram(prisma, {
      id: "epg-evening-news",
      channelId: "channel-saat-news",
      programName: " Evening News ",
      startTime: new Date("2026-07-02T18:00:00.000Z"),
      endTime: new Date("2026-07-02T19:00:00.000Z"),
    });

    expect(program).toMatchObject({
      id: "epg-evening-news",
      channelId: "channel-saat-news",
      programName: "Evening News",
      startTime: new Date("2026-07-02T18:00:00.000Z"),
      endTime: new Date("2026-07-02T19:00:00.000Z"),
    });
  });

  it("rejects an EPG program that overlaps an existing program on the same channel", async () => {
    await createLiveChannel(prisma, {
      id: "channel-saat-news",
      name: "Saat News",
      slug: "saat-news",
    });
    await createEpgProgram(prisma, {
      id: "epg-news-hour",
      channelId: "channel-saat-news",
      programName: "News Hour",
      startTime: new Date("2026-07-02T18:00:00.000Z"),
      endTime: new Date("2026-07-02T19:00:00.000Z"),
    });

    await expect(
      createEpgProgram(prisma, {
        id: "epg-overlapping-news",
        channelId: "channel-saat-news",
        programName: "Overlapping News",
        startTime: new Date("2026-07-02T18:30:00.000Z"),
        endTime: new Date("2026-07-02T19:30:00.000Z"),
      }),
    ).rejects.toThrow(
      "EPG program overlaps with an existing schedule on this channel.",
    );
  });

  it("allows back-to-back EPG programs on the same channel", async () => {
    await createLiveChannel(prisma, {
      id: "channel-saat-news",
      name: "Saat News",
      slug: "saat-news",
    });
    await createEpgProgram(prisma, {
      id: "epg-news-hour",
      channelId: "channel-saat-news",
      programName: "News Hour",
      startTime: new Date("2026-07-02T18:00:00.000Z"),
      endTime: new Date("2026-07-02T19:00:00.000Z"),
    });

    await expect(
      createEpgProgram(prisma, {
        id: "epg-late-news",
        channelId: "channel-saat-news",
        programName: "Late News",
        startTime: new Date("2026-07-02T19:00:00.000Z"),
        endTime: new Date("2026-07-02T20:00:00.000Z"),
      }),
    ).resolves.toMatchObject({
      id: "epg-late-news",
    });
  });

  it("allows an EPG program that ends exactly when an existing program starts", async () => {
    await createLiveChannel(prisma, {
      id: "channel-saat-news",
      name: "Saat News",
      slug: "saat-news",
    });
    await createEpgProgram(prisma, {
      id: "epg-news-hour",
      channelId: "channel-saat-news",
      programName: "News Hour",
      startTime: new Date("2026-07-02T18:00:00.000Z"),
      endTime: new Date("2026-07-02T19:00:00.000Z"),
    });

    await expect(
      createEpgProgram(prisma, {
        id: "epg-early-news",
        channelId: "channel-saat-news",
        programName: "Early News",
        startTime: new Date("2026-07-02T17:00:00.000Z"),
        endTime: new Date("2026-07-02T18:00:00.000Z"),
      }),
    ).resolves.toMatchObject({
      id: "epg-early-news",
    });
  });

  it("allows the same EPG time range on different channels", async () => {
    await createLiveChannel(prisma, {
      id: "channel-saat-news",
      name: "Saat News",
      slug: "saat-news",
    });
    await createLiveChannel(prisma, {
      id: "channel-saat-sports",
      name: "Saat Sports",
      slug: "saat-sports",
    });
    await createEpgProgram(prisma, {
      id: "epg-news-hour",
      channelId: "channel-saat-news",
      programName: "News Hour",
      startTime: new Date("2026-07-02T18:00:00.000Z"),
      endTime: new Date("2026-07-02T19:00:00.000Z"),
    });

    await expect(
      createEpgProgram(prisma, {
        id: "epg-sports-hour",
        channelId: "channel-saat-sports",
        programName: "Sports Hour",
        startTime: new Date("2026-07-02T18:00:00.000Z"),
        endTime: new Date("2026-07-02T19:00:00.000Z"),
      }),
    ).resolves.toMatchObject({
      id: "epg-sports-hour",
      channelId: "channel-saat-sports",
    });
  });

  it("allows only one of two concurrent overlapping EPG programs on the same channel", async () => {
    await createLiveChannel(prisma, {
      id: "channel-saat-news",
      name: "Saat News",
      slug: "saat-news",
    });

    const results = await Promise.allSettled([
      createEpgProgramWithConcurrencyLock(prisma, {
        id: "epg-breaking-news",
        channelId: "channel-saat-news",
        programName: "Breaking News",
        startTime: new Date("2026-07-02T18:00:00.000Z"),
        endTime: new Date("2026-07-02T19:00:00.000Z"),
      }),
      createEpgProgramWithConcurrencyLock(prisma, {
        id: "epg-overlapping-news",
        channelId: "channel-saat-news",
        programName: "Overlapping News",
        startTime: new Date("2026-07-02T18:30:00.000Z"),
        endTime: new Date("2026-07-02T19:30:00.000Z"),
      }),
    ]);

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);

    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);

    const rejectedResult = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );

    expect(rejectedResult?.reason).toMatchObject({
      message:
        "EPG program overlaps with an existing schedule on this channel.",
    });

    const programs = await prisma.epgProgram.findMany({
      where: {
        channelId: "channel-saat-news",
      },
      orderBy: {
        startTime: "asc",
      },
    });

    expect(programs).toHaveLength(1);
    expect(programs[0]).toMatchObject({
      channelId: "channel-saat-news",
    });
  });

  it("allows concurrent EPG creation for different channels", async () => {
    await createLiveChannel(prisma, {
      id: "channel-saat-news",
      name: "Saat News",
      slug: "saat-news",
    });

    await createLiveChannel(prisma, {
      id: "channel-saat-sports",
      name: "Saat Sports",
      slug: "saat-sports",
    });

    const results = await Promise.allSettled([
      createEpgProgramWithConcurrencyLock(prisma, {
        id: "epg-news-hour",
        channelId: "channel-saat-news",
        programName: "News Hour",
        startTime: new Date("2026-07-02T18:00:00.000Z"),
        endTime: new Date("2026-07-02T19:00:00.000Z"),
      }),
      createEpgProgramWithConcurrencyLock(prisma, {
        id: "epg-sports-hour",
        channelId: "channel-saat-sports",
        programName: "Sports Hour",
        startTime: new Date("2026-07-02T18:00:00.000Z"),
        endTime: new Date("2026-07-02T19:00:00.000Z"),
      }),
    ]);

    expect(results).toEqual([
      expect.objectContaining({ status: "fulfilled" }),
      expect.objectContaining({ status: "fulfilled" }),
    ]);

    const programs = await prisma.epgProgram.findMany({
      orderBy: [{ channelId: "asc" }, { startTime: "asc" }],
    });

    expect(programs).toHaveLength(2);
    expect(programs.map((program) => program.channelId).sort()).toEqual([
      "channel-saat-news",
      "channel-saat-sports",
    ]);
  });

  it("allows only one overlapping EPG write across independent Prisma clients", async () => {
    await createLiveChannel(prisma, {
      id: "channel-saat-news",
      name: "Saat News",
      slug: "saat-news",
    });

    const firstClient = createIndependentPrismaClient();
    const secondClient = createIndependentPrismaClient();

    const results = await Promise.allSettled([
      createEpgProgramWithConcurrencyLock(firstClient, {
        id: "epg-independent-breaking-news",
        channelId: "channel-saat-news",
        programName: "Breaking News",
        startTime: new Date("2026-07-02T18:00:00.000Z"),
        endTime: new Date("2026-07-02T19:00:00.000Z"),
      }),
      createEpgProgramWithConcurrencyLock(secondClient, {
        id: "epg-independent-overlap",
        channelId: "channel-saat-news",
        programName: "Overlapping News",
        startTime: new Date("2026-07-02T18:30:00.000Z"),
        endTime: new Date("2026-07-02T19:30:00.000Z"),
      }),
    ]);

    expect(fulfilledResults(results)).toHaveLength(1);
    expect(rejectedResults(results)).toHaveLength(1);

    const programs = await prisma.epgProgram.findMany({
      where: {
        channelId: "channel-saat-news",
      },
      orderBy: {
        startTime: "asc",
      },
    });

    expect(programs).toHaveLength(1);
    expectNoOverlappingPrograms(programs);
  });

  it("allows only one request in a burst of overlapping same-channel writes", async () => {
    await createLiveChannel(prisma, {
      id: "channel-saat-news",
      name: "Saat News",
      slug: "saat-news",
    });

    const clients = Array.from({ length: 12 }, () =>
      createIndependentPrismaClient(),
    );
    const results = await Promise.allSettled(
      clients.map((client, index) =>
        createEpgProgramWithConcurrencyLock(client, {
          id: `epg-burst-overlap-${index}`,
          channelId: "channel-saat-news",
          programName: `Burst Overlap ${index}`,
          startTime: new Date("2026-07-02T18:00:00.000Z"),
          endTime: new Date("2026-07-02T19:00:00.000Z"),
        }),
      ),
    );

    expect(fulfilledResults(results)).toHaveLength(1);
    expect(rejectedResults(results)).toHaveLength(clients.length - 1);

    const programs = await prisma.epgProgram.findMany({
      where: {
        channelId: "channel-saat-news",
      },
      orderBy: {
        startTime: "asc",
      },
    });

    expect(programs).toHaveLength(1);
    expectNoOverlappingPrograms(programs);

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
  }, 20_000);

  it("keeps concurrent same-time writes isolated across independent channel clients", async () => {
    const channelInputs = Array.from({ length: 3 }, (_, index) => ({
      id: `channel-independent-${index}`,
      name: `Independent Channel ${index}`,
      slug: `independent-channel-${index}`,
    }));

    for (const channelInput of channelInputs) {
      await createLiveChannel(prisma, channelInput);
    }

    const clients = channelInputs.map(() => createIndependentPrismaClient());

    const results = await Promise.allSettled(
      channelInputs.map((channelInput, index) =>
        createEpgProgramWithConcurrencyLock(clients[index], {
          id: `epg-independent-channel-${index}`,
          channelId: channelInput.id,
          programName: `Independent Program ${index}`,
          startTime: new Date("2026-07-02T18:00:00.000Z"),
          endTime: new Date("2026-07-02T19:00:00.000Z"),
        }),
      ),
    );

    expect(results).toEqual(
      channelInputs.map(() => expect.objectContaining({ status: "fulfilled" })),
    );

    const programs = await prisma.epgProgram.findMany({
      orderBy: [{ channelId: "asc" }, { startTime: "asc" }],
    });

    expect(programs).toHaveLength(channelInputs.length);
    expect(programs.map((program) => program.channelId).sort()).toEqual(
      channelInputs.map((channelInput) => channelInput.id).sort(),
    );
  }, 20_000);
  it("allows concurrent back-to-back writes on the same channel with independent clients", async () => {
    await createLiveChannel(prisma, {
      id: "channel-saat-news",
      name: "Saat News",
      slug: "saat-news",
    });

    const firstClient = createIndependentPrismaClient();
    const secondClient = createIndependentPrismaClient();

    const results = await Promise.allSettled([
      createEpgProgramWithConcurrencyLock(firstClient, {
        id: "epg-back-to-back-first",
        channelId: "channel-saat-news",
        programName: "First Program",
        startTime: new Date("2026-07-02T18:00:00.000Z"),
        endTime: new Date("2026-07-02T19:00:00.000Z"),
      }),
      createEpgProgramWithConcurrencyLock(secondClient, {
        id: "epg-back-to-back-second",
        channelId: "channel-saat-news",
        programName: "Second Program",
        startTime: new Date("2026-07-02T19:00:00.000Z"),
        endTime: new Date("2026-07-02T20:00:00.000Z"),
      }),
    ]);

    expect(results).toEqual([
      expect.objectContaining({ status: "fulfilled" }),
      expect.objectContaining({ status: "fulfilled" }),
    ]);

    const programs = await prisma.epgProgram.findMany({
      where: {
        channelId: "channel-saat-news",
      },
      orderBy: {
        startTime: "asc",
      },
    });

    expect(programs.map((program) => program.id)).toEqual([
      "epg-back-to-back-first",
      "epg-back-to-back-second",
    ]);
    expectNoOverlappingPrograms(programs);
  });
});
