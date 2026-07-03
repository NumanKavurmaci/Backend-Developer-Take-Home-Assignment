import { describe, expect, it } from "vitest";
import { CmsEpgProgramService } from "./cms-epg-program.service.js";

describe("CMS EPG program service", () => {
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
      statusCode: 404,
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
