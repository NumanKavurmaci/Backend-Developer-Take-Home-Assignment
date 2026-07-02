import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
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
import { createEpgProgram } from "./epg-program/epg-program-repository.js";

const prisma = new PrismaClient();

beforeEach(async () => {
  await clearLiveChannelTables();
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function clearLiveChannelTables() {
  await prisma.epgProgram.deleteMany();
  await prisma.epgScheduleLock.deleteMany();
  await prisma.liveChannel.deleteMany();
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
});
