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

  it("preserves RESTRICT for content parents and CASCADE for child rows", async () => {
    await prisma.content.create({
      data: {
        id: "series-foreign-key",
        type: CONTENT_TYPES.SERIES,
        title: "Foreign Key Series",
        geoBlockCountries: { create: { countryCode: "TR" } },
      },
    });
    await prisma.content.create({
      data: {
        id: "season-foreign-key",
        type: CONTENT_TYPES.SEASON,
        title: "Foreign Key Season",
        parentId: "series-foreign-key",
      },
    });

    await expect(
      prisma.content.delete({ where: { id: "series-foreign-key" } }),
    ).rejects.toThrow();

    await prisma.content.delete({ where: { id: "season-foreign-key" } });
    await prisma.content.delete({ where: { id: "series-foreign-key" } });

    await expect(prisma.contentGeoBlockCountry.count()).resolves.toBe(0);
  });

  it("cascades channel deletion to programs and the schedule lock", async () => {
    await createLiveChannel(prisma, {
      id: "channel-cascade",
      name: "Cascade Channel",
      slug: "cascade-channel",
    });
    await prisma.epgProgram.create({
      data: {
        id: "epg-cascade",
        channelId: "channel-cascade",
        programName: "Cascade Program",
        startTime: new Date("2026-07-02T18:00:00.000Z"),
        endTime: new Date("2026-07-02T19:00:00.000Z"),
      },
    });

    await prisma.liveChannel.delete({ where: { id: "channel-cascade" } });

    await expect(prisma.epgProgram.count()).resolves.toBe(0);
    await expect(prisma.epgScheduleLock.count()).resolves.toBe(0);
  });

  it("enforces the geo-block composite primary key", async () => {
    await prisma.content.create({
      data: {
        id: "movie-composite-key",
        type: CONTENT_TYPES.MOVIE,
        title: "Composite Key Movie",
        geoBlockCountries: { create: { countryCode: "TR" } },
      },
    });

    await expect(
      prisma.contentGeoBlockCountry.create({
        data: { contentId: "movie-composite-key", countryCode: "TR" },
      }),
    ).rejects.toThrow();
  });

  it("enforces unique live-channel slugs", async () => {
    await createLiveChannel(prisma, {
      id: "channel-unique-one",
      name: "Unique One",
      slug: "unique-channel",
    });

    await expect(
      createLiveChannel(prisma, {
        id: "channel-unique-two",
        name: "Unique Two",
        slug: "unique-channel",
      }),
    ).rejects.toThrow();
  });

  it("round-trips UTC and timezone-offset EPG timestamps as the same instant", async () => {
    await createLiveChannel(prisma, {
      id: "channel-timezone",
      name: "Timezone Channel",
      slug: "timezone-channel",
    });

    const program = await prisma.epgProgram.create({
      data: {
        id: "epg-timezone",
        channelId: "channel-timezone",
        programName: "Timezone Program",
        startTime: new Date("2026-07-02T21:00:00.000+03:00"),
        endTime: new Date("2026-07-02T22:00:00.000+03:00"),
      },
    });

    expect(program.startTime.toISOString()).toBe("2026-07-02T18:00:00.000Z");
    expect(program.endTime.toISOString()).toBe("2026-07-02T19:00:00.000Z");
    expect(program.createdAt).toBeInstanceOf(Date);
    expect(program.updatedAt).toBeInstanceOf(Date);
  });

  it("applies migrations from an empty database with the expected constraints", async () => {
    const tables = await prisma.$queryRaw<Array<{ tableName: string }>>`
      SELECT table_name AS "tableName"
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('Content', 'EpgProgram')
      ORDER BY table_name
    `;
    const constraints = await prisma.$queryRaw<Array<{ name: string }>>`
      SELECT conname AS name
      FROM pg_constraint
      WHERE conname IN (
        'Content_type_check',
        'Content_quality_check',
        'EpgProgram_time_range_check'
      )
      ORDER BY conname
    `;
    const timestampColumns = await prisma.$queryRaw<
      Array<{ columnName: string; dataType: string }>
    >`
      SELECT column_name AS "columnName", data_type AS "dataType"
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'EpgProgram'
        AND column_name IN ('startTime', 'endTime')
      ORDER BY column_name
    `;

    expect(tables.map((table) => table.tableName)).toEqual([
      "Content",
      "EpgProgram",
    ]);
    expect(constraints.map((constraint) => constraint.name)).toEqual([
      "Content_quality_check",
      "Content_type_check",
      "EpgProgram_time_range_check",
    ]);
    expect(timestampColumns).toEqual([
      { columnName: "endTime", dataType: "timestamp with time zone" },
      { columnName: "startTime", dataType: "timestamp with time zone" },
    ]);
  });
});
