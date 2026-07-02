import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { describe, expect, it, vi } from "vitest";
import { errorHandler, notFoundHandler } from "../../shared/http/error-handler.js";
import { CmsEpgProgramController } from "./cms-epg-program.controller.js";
import { createCmsEpgProgramRoutes } from "./cms-epg-program.route.js";
import type { CmsEpgProgramService } from "./cms-epg-program.service.js";

function createTestApp(
  service: Pick<CmsEpgProgramService, "createProgram">,
) {
  const app = new Hono();

  app.onError(errorHandler);
  app.notFound(notFoundHandler);
  app.route(
    "/api/v1/cms/channels",
    createCmsEpgProgramRoutes(
      new CmsEpgProgramController(service as CmsEpgProgramService),
    ),
  );

  return app;
}

describe("CMS EPG program API routes", () => {
  it("creates an EPG program for the requested channel", async () => {
    const createProgram = vi.fn().mockResolvedValue({
      id: "epg-evening-news",
      channelId: "channel-saat-news",
      programName: "Evening News",
      startTime: new Date("2026-07-02T18:00:00.000Z"),
      endTime: new Date("2026-07-02T19:00:00.000Z"),
      createdAt: new Date("2026-07-02T17:00:00.000Z"),
      updatedAt: new Date("2026-07-02T17:00:00.000Z"),
    });

    const response = await createTestApp({ createProgram }).request(
      "/api/v1/cms/channels/channel-saat-news/epg",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          programName: "Evening News",
          startTime: "2026-07-02T18:00:00Z",
          endTime: "2026-07-02T19:00:00Z",
        }),
      },
    );

    await expect(response.json()).resolves.toEqual({
      id: "epg-evening-news",
      channelId: "channel-saat-news",
      programName: "Evening News",
      startTime: "2026-07-02T18:00:00.000Z",
      endTime: "2026-07-02T19:00:00.000Z",
      createdAt: "2026-07-02T17:00:00.000Z",
      updatedAt: "2026-07-02T17:00:00.000Z",
    });
    expect(response.status).toBe(201);
    expect(createProgram).toHaveBeenCalledWith("channel-saat-news", {
      programName: "Evening News",
      startTime: "2026-07-02T18:00:00Z",
      endTime: "2026-07-02T19:00:00Z",
    });
  });

  it("returns a client error when the request body is invalid JSON", async () => {
    const createProgram = vi.fn();

    const response = await createTestApp({ createProgram }).request(
      "/api/v1/cms/channels/channel-saat-news/epg",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: "{",
      },
    );

    await expect(response.json()).resolves.toEqual({
      errorCode: "REQUEST_FAILED",
      message: "Request body must be valid JSON",
    });
    expect(response.status).toBe(400);
    expect(createProgram).not.toHaveBeenCalled();
  });

  it("returns a client error when a required field is missing", async () => {
    const createProgram = vi.fn().mockRejectedValue(
      new HTTPException(400, {
        message: "programName is required",
      }),
    );

    const response = await createTestApp({ createProgram }).request(
      "/api/v1/cms/channels/channel-saat-news/epg",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          startTime: "2026-07-02T18:00:00Z",
          endTime: "2026-07-02T19:00:00Z",
        }),
      },
    );

    await expect(response.json()).resolves.toEqual({
      errorCode: "REQUEST_FAILED",
      message: "programName is required",
    });
    expect(response.status).toBe(400);
  });

  it("returns a client error when the time range is invalid", async () => {
    const createProgram = vi.fn().mockRejectedValue(
      new HTTPException(400, {
        message: "EPG program startTime must be before endTime.",
      }),
    );

    const response = await createTestApp({ createProgram }).request(
      "/api/v1/cms/channels/channel-saat-news/epg",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          programName: "Evening News",
          startTime: "2026-07-02T19:00:00Z",
          endTime: "2026-07-02T18:00:00Z",
        }),
      },
    );

    await expect(response.json()).resolves.toEqual({
      errorCode: "REQUEST_FAILED",
      message: "EPG program startTime must be before endTime.",
    });
    expect(response.status).toBe(400);
  });

  it("returns a client error when the program overlaps an existing schedule", async () => {
    const createProgram = vi.fn().mockRejectedValue(
      new HTTPException(400, {
        message: "EPG program overlaps with an existing schedule on this channel.",
      }),
    );

    const response = await createTestApp({ createProgram }).request(
      "/api/v1/cms/channels/channel-saat-news/epg",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          programName: "Evening News",
          startTime: "2026-07-02T18:30:00Z",
          endTime: "2026-07-02T19:30:00Z",
        }),
      },
    );

    await expect(response.json()).resolves.toEqual({
      errorCode: "REQUEST_FAILED",
      message: "EPG program overlaps with an existing schedule on this channel.",
    });
    expect(response.status).toBe(400);
  });

  it("returns a consistent 404 response when the channel is missing", async () => {
    const createProgram = vi.fn().mockRejectedValue(
      new HTTPException(404, {
        message: "Channel not found",
      }),
    );

    const response = await createTestApp({ createProgram }).request(
      "/api/v1/cms/channels/missing-channel/epg",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          programName: "Evening News",
          startTime: "2026-07-02T18:00:00Z",
          endTime: "2026-07-02T19:00:00Z",
        }),
      },
    );

    await expect(response.json()).resolves.toEqual({
      errorCode: "REQUEST_FAILED",
      message: "Channel not found",
    });
    expect(response.status).toBe(404);
  });
});
