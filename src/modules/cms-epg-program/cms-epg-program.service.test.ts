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
      status: 400,
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
      status: 400,
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
      status: 400,
      message: "endTime is required",
    });
  });
});
