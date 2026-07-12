import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../../shared/http/api-error.js";
import { errorHandler, notFoundHandler } from "../../shared/http/error-handler.js";
import { CmsLiveChannelController } from "./cms-live-channel.controller.js";
import { createCmsLiveChannelRoutes } from "./cms-live-channel.route.js";
import type { CmsLiveChannelService } from "./cms-live-channel.service.js";

type ServiceMethods = Pick<
  CmsLiveChannelService,
  | "createChannel"
  | "getChannel"
  | "listChannels"
  | "updateChannel"
  | "deleteChannel"
>;

function createTestApp(service: ServiceMethods) {
  const app = new Hono();
  app.onError(errorHandler);
  app.notFound(notFoundHandler);
  app.route(
    "/api/v1/cms/channels",
    createCmsLiveChannelRoutes(
      new CmsLiveChannelController(service as CmsLiveChannelService),
    ),
  );
  return app;
}

function createService(overrides: Partial<ServiceMethods> = {}): ServiceMethods {
  return {
    createChannel: vi.fn(),
    getChannel: vi.fn(),
    listChannels: vi.fn(),
    updateChannel: vi.fn(),
    deleteChannel: vi.fn(),
    ...overrides,
  } as ServiceMethods;
}

const channel = {
  id: "channel-news",
  name: "Saat News",
  slug: "saat-news",
  createdAt: new Date("2026-07-12T10:00:00.000Z"),
  updatedAt: new Date("2026-07-12T10:00:00.000Z"),
};

describe("CMS live channel routes", () => {
  it("creates a channel", async () => {
    const service = createService({
      createChannel: vi.fn().mockResolvedValue(channel),
    });
    const response = await createTestApp(service).request(
      "/api/v1/cms/channels",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Saat News", slug: "saat-news" }),
      },
    );

    expect(response.status).toBe(201);
    expect(response.headers.get("ETag")).toBe(
      '"2026-07-12T10:00:00.000Z"',
    );
    await expect(response.json()).resolves.toMatchObject({
      id: "channel-news",
      createdAt: "2026-07-12T10:00:00.000Z",
    });
    expect(service.createChannel).toHaveBeenCalledWith({
      name: "Saat News",
      slug: "saat-news",
    });
  });

  it("gets a channel", async () => {
    const service = createService({
      getChannel: vi.fn().mockResolvedValue(channel),
    });
    const response = await createTestApp(service).request(
      "/api/v1/cms/channels/channel-news",
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("ETag")).toBe(
      '"2026-07-12T10:00:00.000Z"',
    );
    expect(service.getChannel).toHaveBeenCalledWith("channel-news");
  });

  it("lists channels with filters and pagination", async () => {
    const listChannels = vi.fn().mockResolvedValue({
      items: [channel],
      page: 2,
      pageSize: 10,
      total: 11,
    });
    const response = await createTestApp(
      createService({ listChannels }),
    ).request(
      "/api/v1/cms/channels?name=News&slug=saat&page=2&pageSize=10",
    );

    expect(response.status).toBe(200);
    expect(listChannels).toHaveBeenCalledWith({
      name: "News",
      slug: "saat",
      page: "2",
      pageSize: "10",
    });
    await expect(response.json()).resolves.toMatchObject({
      page: 2,
      pageSize: 10,
      total: 11,
    });
  });

  it("patches a channel", async () => {
    const updateChannel = vi.fn().mockResolvedValue({
      ...channel,
      name: "Saat World News",
    });
    const response = await createTestApp(
      createService({ updateChannel }),
    ).request("/api/v1/cms/channels/channel-news", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "If-Match": '"2026-07-12T10:00:00.000Z"',
      },
      body: JSON.stringify({ name: "Saat World News" }),
    });

    expect(response.status).toBe(200);
    expect(updateChannel).toHaveBeenCalledWith(
      "channel-news",
      { name: "Saat World News" },
      '"2026-07-12T10:00:00.000Z"',
    );
    expect(response.headers.get("ETag")).toBe(
      '"2026-07-12T10:00:00.000Z"',
    );
  });

  it("requires explicit confirmation before deleting", async () => {
    const deleteChannel = vi
      .fn()
      .mockRejectedValue(
        new ApiError(
          400,
          "DELETE_CONFIRMATION_REQUIRED",
          "Set confirm=true to delete the channel, its EPG programs, and its schedule lock",
        ),
      );
    const response = await createTestApp(
      createService({ deleteChannel }),
    ).request("/api/v1/cms/channels/channel-news", { method: "DELETE" });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      errorCode: "DELETE_CONFIRMATION_REQUIRED",
    });
    expect(deleteChannel).toHaveBeenCalledWith("channel-news", undefined);
  });

  it("returns 204 after confirmed deletion", async () => {
    const deleteChannel = vi.fn().mockResolvedValue(undefined);
    const response = await createTestApp(
      createService({ deleteChannel }),
    ).request("/api/v1/cms/channels/channel-news?confirm=true", {
      method: "DELETE",
    });

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(deleteChannel).toHaveBeenCalledWith("channel-news", "true");
  });

  it("rejects invalid JSON before invoking create", async () => {
    const service = createService();
    const response = await createTestApp(service).request(
      "/api/v1/cms/channels",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{",
      },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      errorCode: "INVALID_REQUEST_BODY",
    });
    expect(service.createChannel).not.toHaveBeenCalled();
  });
});
