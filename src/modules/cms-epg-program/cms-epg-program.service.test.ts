import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createLiveChannel } from "../../live-channel/live-channel-repository.js";
import { clearLiveChannelTables } from "../../test/test-database.js";
import { CmsEpgProgramService } from "./cms-epg-program.service.js";

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
});
