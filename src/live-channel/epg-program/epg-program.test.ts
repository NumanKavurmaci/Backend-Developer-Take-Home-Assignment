import { describe, expect, it } from "vitest";
import { DomainError } from "../../shared/domain/domain-error.js";
import {
  assertValidEpgProgramInput,
  assertValidEpgProgramTimeRange,
  normalizeEpgProgramChannelId,
  normalizeEpgProgramName,
  prepareEpgProgramCreateInput,
  prepareEpgProgramUpdateInput,
} from "./epg-program.js";

describe("EPG program domain", () => {
  it("normalizes channel IDs and program names", () => {
    expect(normalizeEpgProgramChannelId("  channel-saat-news  ")).toBe(
      "channel-saat-news",
    );
    expect(normalizeEpgProgramName("  Morning Briefing  ")).toBe(
      "Morning Briefing",
    );
  });

  it("accepts a valid time range", () => {
    expect(() =>
      assertValidEpgProgramTimeRange(
        new Date("2026-07-02T08:00:00.000Z"),
        new Date("2026-07-02T09:00:00.000Z"),
      ),
    ).not.toThrow();
  });

  it("rejects a time range where startTime equals endTime", () => {
    const startTime = new Date("2026-07-02T08:00:00.000Z");

    expect(() => assertValidEpgProgramTimeRange(startTime, startTime)).toThrow(
      DomainError,
    );
    expect(() => assertValidEpgProgramTimeRange(startTime, startTime)).toThrow(
      expect.objectContaining({
        errorCode: "INVALID_TIME_RANGE",
      }),
    );
    expect(() => assertValidEpgProgramTimeRange(startTime, startTime)).toThrow(
      "EPG program startTime must be before endTime.",
    );
  });

  it("rejects a time range where startTime is after endTime", () => {
    expect(() =>
      assertValidEpgProgramTimeRange(
        new Date("2026-07-02T09:00:00.000Z"),
        new Date("2026-07-02T08:00:00.000Z"),
      ),
    ).toThrow("EPG program startTime must be before endTime.");
  });

  it("rejects invalid date values", () => {
    expect(() =>
      assertValidEpgProgramTimeRange(
        new Date("not-a-date"),
        new Date("2026-07-02T09:00:00.000Z"),
      ),
    ).toThrow("EPG program startTime is invalid.");

    expect(() =>
      assertValidEpgProgramTimeRange(
        new Date("2026-07-02T08:00:00.000Z"),
        new Date("not-a-date"),
      ),
    ).toThrow("EPG program endTime is invalid.");
  });

  it("rejects missing channel and program name values", () => {
    const validStartTime = new Date("2026-07-02T08:00:00.000Z");
    const validEndTime = new Date("2026-07-02T09:00:00.000Z");

    expect(() =>
      assertValidEpgProgramInput({
        channelId: " ",
        programName: "Morning Briefing",
        startTime: validStartTime,
        endTime: validEndTime,
      }),
    ).toThrow("EPG program channelId is required.");

    expect(() =>
      assertValidEpgProgramInput({
        channelId: "channel-saat-news",
        programName: " ",
        startTime: validStartTime,
        endTime: validEndTime,
      }),
    ).toThrow("EPG program name is required.");
  });

  it("prepares normalized create input for repository writes", () => {
    const startTime = new Date("2026-07-02T08:00:00.000Z");
    const endTime = new Date("2026-07-02T09:00:00.000Z");

    expect(
      prepareEpgProgramCreateInput({
        id: "epg-saat-news-morning-briefing",
        channelId: "  channel-saat-news  ",
        programName: "  Morning Briefing  ",
        startTime,
        endTime,
      }),
    ).toEqual({
      id: "epg-saat-news-morning-briefing",
      channelId: "channel-saat-news",
      programName: "Morning Briefing",
      startTime,
      endTime,
    });
  });

  it("validates partial updates against the effective time range", () => {
    const current = {
      channelId: "channel-news",
      programName: "News",
      startTime: new Date("2026-07-02T18:00:00.000Z"),
      endTime: new Date("2026-07-02T19:00:00.000Z"),
    };

    expect(
      prepareEpgProgramUpdateInput(current, { programName: " Updated News " }),
    ).toEqual({ programName: "Updated News" });
    expect(() =>
      prepareEpgProgramUpdateInput(current, {
        startTime: new Date("2026-07-02T20:00:00.000Z"),
      }),
    ).toThrow("EPG program startTime must be before endTime.");
  });
});
