import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  clearContentTables,
  clearLiveChannelTables,
} from "../test/test-database.js";
import { CONTENT_TYPES } from "../content/content-types.js";
import { VIDEO_QUALITIES } from "../content/content-metadata.js";
import { createLiveChannel } from "../live-channel/live-channel-repository.js";

const prisma = new PrismaClient();

beforeEach(async () => {
  await clearLiveChannelTables(prisma);
  await clearContentTables(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("database-level constraints", () => {
  it("rejects direct EPG inserts where startTime equals endTime", async () => {
    await createLiveChannel(prisma, {
      id: "channel-saat-news",
      name: "Saat News",
      slug: "saat-news",
    });

    const time = new Date("2026-07-02T18:00:00.000Z");

    await expect(
      prisma.epgProgram.create({
        data: {
          id: "epg-equal-range",
          channelId: "channel-saat-news",
          programName: "Equal Range",
          startTime: time,
          endTime: time,
        },
      }),
    ).rejects.toThrow();
  });

  it("rejects direct EPG inserts where startTime is after endTime", async () => {
    await createLiveChannel(prisma, {
      id: "channel-saat-news",
      name: "Saat News",
      slug: "saat-news",
    });

    await expect(
      prisma.epgProgram.create({
        data: {
          id: "epg-reversed-range",
          channelId: "channel-saat-news",
          programName: "Reversed Range",
          startTime: new Date("2026-07-02T19:00:00.000Z"),
          endTime: new Date("2026-07-02T18:00:00.000Z"),
        },
      }),
    ).rejects.toThrow();
  });

  it("rejects unsupported content types at the database layer", async () => {
    await expect(
      prisma.content.create({
        data: {
          id: "invalid-content-type",
          type: "TRAILER",
          title: "Invalid Content Type",
        },
      }),
    ).rejects.toThrow();
  });

  it("rejects unsupported quality values at the database layer", async () => {
    await expect(
      prisma.content.create({
        data: {
          id: "invalid-quality",
          type: CONTENT_TYPES.MOVIE,
          title: "Invalid Quality",
          quality: "8K",
        },
      }),
    ).rejects.toThrow();
  });

  it("accepts supported content types and nullable or supported quality values", async () => {
    await prisma.content.createMany({
      data: [
        {
          id: "movie-null-quality",
          type: CONTENT_TYPES.MOVIE,
          title: "Movie With Nullable Quality",
          quality: null,
        },
        {
          id: "episode-hd-quality",
          type: CONTENT_TYPES.EPISODE,
          title: "Episode With HD Quality",
          quality: VIDEO_QUALITIES.HD,
        },
      ],
    });

    await expect(prisma.content.count()).resolves.toBe(2);
  });

  it("applies migrations from an empty database with the expected constraints", async () => {
    const tables = await prisma.$queryRaw<Array<{ name: string }>>`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
        AND name IN ('Content', 'EpgProgram')
      ORDER BY name
    `;
    const tableDefinitions = await prisma.$queryRaw<Array<{ sql: string }>>`
      SELECT sql
      FROM sqlite_master
      WHERE type = 'table'
        AND name IN ('Content', 'EpgProgram')
      ORDER BY name
    `;
    const migrationSql = tableDefinitions.map((row) => row.sql).join("\n");

    expect(tables.map((table) => table.name)).toEqual([
      "Content",
      "EpgProgram",
    ]);
    expect(migrationSql).toContain("Content_type_check");
    expect(migrationSql).toContain("Content_quality_check");
    expect(migrationSql).toContain("EpgProgram_time_range_check");
  });
});
