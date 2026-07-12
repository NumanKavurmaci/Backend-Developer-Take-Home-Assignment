import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createLiveChannel } from "../../live-channel/live-channel-repository.js";
import { clearLiveChannelTables } from "../../test/test-database.js";
import { CmsEpgProgramService } from "./cms-epg-program.service.js";
import { createUpdatedAtEntityTag } from "../../shared/http/entity-tag.js";

const prisma = new PrismaClient();

beforeEach(async () => {
  await clearLiveChannelTables(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("CMS EPG program service", () => {
  it("creates an EPG program for an existing channel", async () => {
    await createLiveChannel(prisma, {
      id: "channel-service-news",
      name: "Service News",
      slug: "service-news",
    });

    const program = await new CmsEpgProgramService().createProgram(
      "channel-service-news",
      {
        programName: "Service Evening News",
        startTime: "2026-07-02T18:00:00Z",
        endTime: "2026-07-02T19:00:00Z",
      },
    );

    expect(program).toMatchObject({
      channelId: "channel-service-news",
      programName: "Service Evening News",
    });
    expect(program.startTime.toISOString()).toBe("2026-07-02T18:00:00.000Z");
    expect(program.endTime.toISOString()).toBe("2026-07-02T19:00:00.000Z");
    await expect(
      prisma.epgProgram.count({
        where: { channelId: "channel-service-news" },
      }),
    ).resolves.toBe(1);
  });

  it("rejects a missing channelId before reading the request body", async () => {
    await expect(
      new CmsEpgProgramService().createProgram(" ", {
        programName: "Evening News",
        startTime: "2026-07-02T18:00:00Z",
        endTime: "2026-07-02T19:00:00Z",
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      errorCode: "INVALID_REQUEST",
      message: "channelId is required",
    });
  });

  it("rejects a non-object request body", async () => {
    for (const body of [null, ["not", "an", "object"]]) {
      await expect(
        new CmsEpgProgramService().createProgram("channel-saat-news", body),
      ).rejects.toMatchObject({
        statusCode: 400,
        errorCode: "INVALID_REQUEST_BODY",
        message: "Request body must be a JSON object",
      });
    }
  });

  it("rejects a missing programName before creating an EPG program", async () => {
    await expect(
      new CmsEpgProgramService().createProgram("channel-saat-news", {
        startTime: "2026-07-02T18:00:00Z",
        endTime: "2026-07-02T19:00:00Z",
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      errorCode: "INVALID_REQUEST_BODY",
      message: "programName is required",
    });
  });

  it("rejects a missing startTime before creating an EPG program", async () => {
    await expect(
      new CmsEpgProgramService().createProgram("channel-saat-news", {
        programName: "Evening News",
        endTime: "2026-07-02T19:00:00Z",
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      errorCode: "INVALID_REQUEST_BODY",
      message: "startTime is required",
    });
  });

  it("rejects a missing endTime before creating an EPG program", async () => {
    await expect(
      new CmsEpgProgramService().createProgram("channel-saat-news", {
        programName: "Evening News",
        startTime: "2026-07-02T18:00:00Z",
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      errorCode: "INVALID_REQUEST_BODY",
      message: "endTime is required",
    });
  });

  it("rejects a date-time value without timezone information", async () => {
    await expect(
      new CmsEpgProgramService().createProgram("missing-channel", {
        programName: "Evening News",
        startTime: "2026-07-02T18:00:00",
        endTime: "2026-07-02T19:00:00Z",
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      errorCode: "INVALID_DATE_TIME_FORMAT",
      message: "startTime must be an ISO 8601 date-time string with timezone",
    });
  });

  it("rejects out-of-range date-time components before creating an EPG program", async () => {
    await expect(
      new CmsEpgProgramService().createProgram("missing-channel", {
        programName: "Evening News",
        startTime: "2026-07-02T18:00:00+03:60",
        endTime: "2026-07-02T19:00:00Z",
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      errorCode: "INVALID_DATE_TIME_FORMAT",
      message: "startTime must be an ISO 8601 date-time string with timezone",
    });
  });

  it("rejects an invalid calendar date before creating an EPG program", async () => {
    await expect(
      new CmsEpgProgramService().createProgram("missing-channel", {
        programName: "Evening News",
        startTime: "2026-02-30T18:00:00Z",
        endTime: "2026-07-02T19:00:00Z",
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      errorCode: "INVALID_DATE_TIME_FORMAT",
      message: "startTime must be an ISO 8601 date-time string with timezone",
    });
  });

  it("compares offset date-time values as UTC instants", async () => {
    await expect(
      new CmsEpgProgramService().createProgram("missing-channel", {
        programName: "Evening News",
        startTime: "2026-07-02T21:00:00+03:00",
        endTime: "2026-07-02T18:30:00Z",
      }),
    ).rejects.toMatchObject({
      errorCode: "CHANNEL_NOT_FOUND",
      message: "Channel not found",
    });
  });

  it("rejects invalid ranges after normalizing offset date-time values", async () => {
    await expect(
      new CmsEpgProgramService().createProgram("missing-channel", {
        programName: "Evening News",
        startTime: "2026-07-02T21:00:00+03:00",
        endTime: "2026-07-02T17:30:00Z",
      }),
    ).rejects.toMatchObject({
      errorCode: "INVALID_TIME_RANGE",
      message: "EPG program startTime must be before endTime.",
    });
  });

  it("gets, updates, and deletes a program through its owning channel", async () => {
    await createLiveChannel(prisma, {
      id: "channel-service-news",
      name: "Service News",
      slug: "service-news",
    });
    const service = new CmsEpgProgramService();
    const created = await service.createProgram("channel-service-news", {
      programName: "News",
      startTime: "2026-07-02T18:00:00Z",
      endTime: "2026-07-02T19:00:00Z",
    });

    await expect(
      service.getProgram("channel-service-news", created.id),
    ).resolves.toMatchObject({ id: created.id, programName: "News" });
    await expect(
      service.updateProgram("channel-service-news", created.id, {
        programName: " Updated News ",
      }),
    ).resolves.toMatchObject({ id: created.id, programName: "Updated News" });

    await service.deleteProgram("channel-service-news", created.id);
    await expect(
      service.getProgram("channel-service-news", created.id),
    ).rejects.toMatchObject({ errorCode: "EPG_PROGRAM_NOT_FOUND" });
    await expect(
      prisma.epgScheduleLock.findUnique({
        where: { channelId: "channel-service-news" },
      }),
    ).resolves.not.toBeNull();
  });

  it("rejects stale optimistic-concurrency ETags", async () => {
    await createLiveChannel(prisma, {
      id: "channel-versioned",
      name: "Versioned",
      slug: "versioned",
    });
    const service = new CmsEpgProgramService();
    const program = await service.createProgram("channel-versioned", {
      programName: "Original",
      startTime: "2026-07-02T18:00:00Z",
      endTime: "2026-07-02T19:00:00Z",
    });
    const etag = createUpdatedAtEntityTag(program.updatedAt);

    await service.updateProgram(
      "channel-versioned",
      program.id,
      { programName: "First" },
      etag,
    );
    await expect(
      service.updateProgram(
        "channel-versioned",
        program.id,
        { programName: "Stale" },
        etag,
      ),
    ).rejects.toMatchObject({ errorCode: "EPG_WRITE_CONFLICT" });
    await expect(
      service.getProgram("channel-versioned", program.id),
    ).resolves.toMatchObject({ programName: "First" });
  });

  it("rejects malformed concurrency ETags", async () => {
    await expect(
      new CmsEpgProgramService().updateProgram(
        "channel-versioned",
        "program",
        { programName: "Invalid" },
        "invalid",
      ),
    ).rejects.toMatchObject({
      statusCode: 400,
      errorCode: "INVALID_IF_MATCH",
    });
  });

  it("does not reveal a program through another channel route", async () => {
    for (const [id, slug] of [
      ["channel-service-news", "service-news"],
      ["channel-service-sports", "service-sports"],
    ]) {
      await createLiveChannel(prisma, { id, name: id, slug });
    }
    const service = new CmsEpgProgramService();
    const program = await service.createProgram("channel-service-news", {
      programName: "News",
      startTime: "2026-07-02T18:00:00Z",
      endTime: "2026-07-02T19:00:00Z",
    });

    await expect(
      service.getProgram("channel-service-sports", program.id),
    ).rejects.toMatchObject({ errorCode: "EPG_PROGRAM_NOT_FOUND" });
    await expect(
      service.updateProgram("channel-service-sports", program.id, {
        programName: "Leaked",
      }),
    ).rejects.toMatchObject({ errorCode: "EPG_PROGRAM_NOT_FOUND" });
    await expect(
      service.deleteProgram("channel-service-sports", program.id),
    ).rejects.toMatchObject({ errorCode: "EPG_PROGRAM_NOT_FOUND" });
  });

  it("lists programs intersecting a required UTC window with pagination", async () => {
    await createLiveChannel(prisma, {
      id: "channel-service-news",
      name: "Service News",
      slug: "service-news",
    });
    const service = new CmsEpgProgramService();
    for (const [name, startTime, endTime] of [
      ["First", "2026-07-02T18:00:00Z", "2026-07-02T19:00:00Z"],
      ["Second", "2026-07-02T19:00:00Z", "2026-07-02T20:00:00Z"],
      ["After", "2026-07-02T20:00:00Z", "2026-07-02T21:00:00Z"],
    ]) {
      await service.createProgram("channel-service-news", {
        programName: name,
        startTime,
        endTime,
      });
    }

    await expect(
      service.listPrograms("channel-service-news", {
        windowStart: "2026-07-02T18:00:00Z",
        windowEnd: "2026-07-02T20:00:00Z",
        page: "2",
        pageSize: "1",
      }),
    ).resolves.toMatchObject({
      page: 2,
      pageSize: 1,
      total: 2,
      items: [expect.objectContaining({ programName: "Second" })],
    });
  });

  it("rejects invalid list and PATCH contracts", async () => {
    const service = new CmsEpgProgramService();

    await expect(
      service.listPrograms("channel-service-news", {
        windowEnd: "2026-07-02T20:00:00Z",
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: "windowStart is required",
    });
    await expect(
      service.listPrograms("channel-service-news", {
        windowStart: "2026-07-02T18:00:00Z",
        windowEnd: "2026-07-02T20:00:00Z",
        pageSize: "101",
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      errorCode: "INVALID_PAGINATION",
      message: "pageSize must be at most 100",
    });
    await expect(
      service.updateProgram("channel-service-news", "epg-news", {}),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: "PATCH request body must include at least one mutable field",
    });
    await expect(
      service.updateProgram("channel-service-news", "epg-news", {
        channelId: "channel-service-sports",
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      errorCode: "UNKNOWN_FIELDS",
      message: "Unknown field: channelId",
    });
  });
});
