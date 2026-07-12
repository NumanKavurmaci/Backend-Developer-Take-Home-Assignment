import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createEpgProgram } from "../../live-channel/epg-program/epg-program-repository.js";
import { createLiveChannel } from "../../live-channel/live-channel-repository.js";
import { clearLiveChannelTables } from "../../test/test-database.js";
import { CmsLiveChannelService } from "./cms-live-channel.service.js";

const database = new PrismaClient();
const service = new CmsLiveChannelService(database);
const independentClients: PrismaClient[] = [];

beforeEach(async () => {
  await clearLiveChannelTables(database);
});

afterAll(async () => {
  await Promise.all(independentClients.map((client) => client.$disconnect()));
  await database.$disconnect();
});

describe("CMS live channel service", () => {
  it("creates a normalized channel and its schedule lock atomically", async () => {
    const channel = await service.createChannel({
      name: "  Saat News  ",
      slug: "  SAAT-News  ",
    });

    expect(channel).toMatchObject({ name: "Saat News", slug: "saat-news" });
    await expect(
      database.epgScheduleLock.findUnique({ where: { channelId: channel.id } }),
    ).resolves.toMatchObject({ channelId: channel.id, version: 0 });
  });

  it("gets and updates a channel without exposing lock state as mutable", async () => {
    const created = await service.createChannel({
      name: "Saat News",
      slug: "saat-news",
    });

    await expect(service.getChannel(created.id)).resolves.toMatchObject({
      id: created.id,
    });
    await expect(
      service.updateChannel(created.id, {
        name: "  Saat World News  ",
        slug: "  SAAT-World-News  ",
      }),
    ).resolves.toMatchObject({
      name: "Saat World News",
      slug: "saat-world-news",
    });
    await expect(
      database.epgScheduleLock.findUnique({ where: { channelId: created.id } }),
    ).resolves.toMatchObject({ channelId: created.id });
  });

  it("filters and paginates channels in stable display-name order", async () => {
    for (const input of [
      { id: "channel-sports", name: "Saat Sports", slug: "saat-sports" },
      { id: "channel-world", name: "Saat World", slug: "saat-world" },
      { id: "channel-news", name: "Saat News", slug: "saat-news" },
      { id: "channel-other", name: "Other", slug: "other" },
    ]) {
      await createLiveChannel(database, input);
    }

    const result = await service.listChannels({
      name: " saat ",
      slug: " SAAT- ",
      page: "2",
      pageSize: "2",
    });

    expect(result).toMatchObject({ page: 2, pageSize: 2, total: 3 });
    expect(result.items.map((item) => item.id)).toEqual(["channel-world"]);
  });

  it("rejects unknown fields, empty patches, and server-controlled fields", async () => {
    await expect(
      service.createChannel({ name: "News", slug: "news", id: "client-id" }),
    ).rejects.toMatchObject({ errorCode: "UNKNOWN_REQUEST_FIELD" });
    await expect(service.updateChannel("missing", {})).rejects.toMatchObject({
      errorCode: "INVALID_REQUEST_BODY",
    });
    await expect(
      service.updateChannel("missing", { updatedAt: new Date() }),
    ).rejects.toMatchObject({ errorCode: "UNKNOWN_REQUEST_FIELD" });
  });

  it("rejects invalid channel values and pagination", async () => {
    await expect(
      service.createChannel({ name: "News", slug: "not_valid" }),
    ).rejects.toMatchObject({ errorCode: "INVALID_LIVE_CHANNEL" });
    await expect(service.listChannels({ page: "0" })).rejects.toMatchObject({
      errorCode: "INVALID_PAGINATION",
    });
    await expect(
      service.listChannels({ pageSize: "101" }),
    ).rejects.toMatchObject({ errorCode: "INVALID_PAGINATION" });
  });

  it("maps duplicate create and update slugs to a stable domain conflict", async () => {
    const first = await service.createChannel({
      name: "First",
      slug: "shared-slug",
    });
    const second = await service.createChannel({
      name: "Second",
      slug: "second",
    });

    await expect(
      service.createChannel({ name: "Duplicate", slug: " SHARED-SLUG " }),
    ).rejects.toMatchObject({ errorCode: "LIVE_CHANNEL_SLUG_CONFLICT" });
    await expect(
      service.updateChannel(second.id, { slug: first.slug }),
    ).rejects.toMatchObject({ errorCode: "LIVE_CHANNEL_SLUG_CONFLICT" });
    await expect(database.liveChannel.count()).resolves.toBe(2);
    await expect(database.epgScheduleLock.count()).resolves.toBe(2);
  });

  it("returns not found for unknown reads, updates, and confirmed deletes", async () => {
    await expect(service.getChannel("missing")).rejects.toMatchObject({
      errorCode: "CHANNEL_NOT_FOUND",
    });
    await expect(
      service.updateChannel("missing", { name: "Missing" }),
    ).rejects.toMatchObject({ errorCode: "CHANNEL_NOT_FOUND" });
    await expect(
      service.deleteChannel("missing", "true"),
    ).rejects.toMatchObject({ errorCode: "CHANNEL_NOT_FOUND" });
  });

  it("requires confirmation and cascades EPG programs and the lock on delete", async () => {
    const channel = await service.createChannel({
      name: "Delete Me",
      slug: "delete-me",
    });
    await createEpgProgram(database, {
      channelId: channel.id,
      programName: "Last Program",
      startTime: new Date("2026-07-12T18:00:00Z"),
      endTime: new Date("2026-07-12T19:00:00Z"),
    });

    await expect(
      service.deleteChannel(channel.id, undefined),
    ).rejects.toMatchObject({ errorCode: "DELETE_CONFIRMATION_REQUIRED" });
    await expect(database.liveChannel.count()).resolves.toBe(1);

    await service.deleteChannel(channel.id, "true");

    await expect(database.liveChannel.count()).resolves.toBe(0);
    await expect(database.epgProgram.count()).resolves.toBe(0);
    await expect(database.epgScheduleLock.count()).resolves.toBe(0);
  });

  it("allows only one of two competing slug updates", async () => {
    const first = await service.createChannel({ name: "First", slug: "first" });
    const second = await service.createChannel({
      name: "Second",
      slug: "second",
    });
    const firstClient = createIndependentClient();
    const secondClient = createIndependentClient();

    const results = await Promise.allSettled([
      new CmsLiveChannelService(firstClient).updateChannel(first.id, {
        slug: "winner",
      }),
      new CmsLiveChannelService(secondClient).updateChannel(second.id, {
        slug: "winner",
      }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(
      results.find((result) => result.status === "rejected"),
    ).toMatchObject({
      reason: { errorCode: "LIVE_CHANNEL_SLUG_CONFLICT" },
    });
    await expect(
      database.liveChannel.count({ where: { slug: "winner" } }),
    ).resolves.toBe(1);
  });
});

function createIndependentClient(): PrismaClient {
  const client = new PrismaClient();
  independentClients.push(client);
  return client;
}
