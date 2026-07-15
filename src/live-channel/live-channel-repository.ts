import type { Prisma, PrismaClient } from "@prisma/client";
import { toLiveChannelDomainError } from "./live-channel-error-mapper.js";
import {
  prepareLiveChannelCreateInput,
  prepareLiveChannelUpdateInput,
} from "./live-channel.js";
import type {
  LiveChannelCreateInput,
  LiveChannelListQuery,
  LiveChannelRecord,
  LiveChannelUpdateInput,
  PaginatedResult,
} from "../shared/domain/domain-contracts.js";
import { DomainError } from "../shared/domain/domain-error.js";
import { nextEntityUpdatedAt } from "../shared/http/entity-tag.js";

type LiveChannelPrismaClient = PrismaClient | Prisma.TransactionClient;

const liveChannelSelect = {
  id: true,
  name: true,
  slug: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.LiveChannelSelect;

type LiveChannelRow = Prisma.LiveChannelGetPayload<{
  select: typeof liveChannelSelect;
}>;

type LiveChannelWithPrograms = Prisma.LiveChannelGetPayload<{
  include: { epgPrograms: true };
}>;

type LiveChannelWithScheduleLock = Prisma.LiveChannelGetPayload<{
  include: { scheduleLock: true };
}>;

export async function createLiveChannel(
  prisma: LiveChannelPrismaClient,
  input: LiveChannelCreateInput,
): Promise<LiveChannelRecord> {
  const data = prepareLiveChannelCreateInput(input);

  try {
    const channel = await prisma.liveChannel.create({
      data: {
        id: data.id,
        name: data.name,
        slug: data.slug,
        scheduleLock: {
          create: {},
        },
      },
      select: liveChannelSelect,
    });

    return toLiveChannelRecord(channel);
  } catch (error) {
    throw toLiveChannelDomainError(error) ?? error;
  }
}

export async function getLiveChannelById(
  prisma: PrismaClient,
  channelId: string,
): Promise<LiveChannelRecord | null> {
  const channel = await prisma.liveChannel.findUnique({
    where: {
      id: channelId,
    },
    select: liveChannelSelect,
  });

  return channel ? toLiveChannelRecord(channel) : null;
}

export async function getLiveChannelBySlug(
  prisma: PrismaClient,
  slug: string,
): Promise<LiveChannelRecord | null> {
  const channel = await prisma.liveChannel.findUnique({
    where: {
      slug: slug.trim().toLowerCase(),
    },
    select: liveChannelSelect,
  });

  return channel ? toLiveChannelRecord(channel) : null;
}

export async function listLiveChannels(
  prisma: PrismaClient,
): Promise<LiveChannelRecord[]> {
  const channels = await prisma.liveChannel.findMany({
    orderBy: {
      name: "asc",
    },
    select: liveChannelSelect,
  });

  return channels.map(toLiveChannelRecord);
}

export async function listLiveChannelsPage(
  prisma: PrismaClient,
  options: LiveChannelListQuery,
): Promise<PaginatedResult<LiveChannelRecord>> {
  const where: Prisma.LiveChannelWhereInput = {
    ...(options.name
      ? { name: { contains: options.name, mode: "insensitive" } }
      : {}),
    ...(options.slug
      ? { slug: { contains: options.slug, mode: "insensitive" } }
      : {}),
  };
  const skip = (options.page - 1) * options.pageSize;
  const [channels, total] = await prisma.$transaction([
    prisma.liveChannel.findMany({
      where,
      orderBy: [{ name: "asc" }, { id: "asc" }],
      skip,
      take: options.pageSize,
      select: liveChannelSelect,
    }),
    prisma.liveChannel.count({ where }),
  ]);

  return {
    items: channels.map(toLiveChannelRecord),
    page: options.page,
    pageSize: options.pageSize,
    total,
  };
}

export async function updateLiveChannel(
  prisma: PrismaClient,
  channelId: string,
  input: LiveChannelUpdateInput,
  expectedUpdatedAt?: Date,
): Promise<LiveChannelRecord> {
  const data = prepareLiveChannelUpdateInput(input);

  try {
    return await prisma.$transaction(async (transaction) => {
      const current = await transaction.liveChannel.findUnique({
        where: { id: channelId },
        select: liveChannelSelect,
      });

      if (!current) {
        throw new DomainError("CHANNEL_NOT_FOUND", "Channel not found");
      }

      const result = await transaction.liveChannel.updateMany({
        where: {
          id: channelId,
          ...(expectedUpdatedAt ? { updatedAt: expectedUpdatedAt } : {}),
        },
        data: {
          ...data,
          updatedAt: nextEntityUpdatedAt(current.updatedAt),
        },
      });

      if (result.count === 0) {
        throw new DomainError(
          "LIVE_CHANNEL_WRITE_CONFLICT",
          "Live channel changed after it was read. Fetch the latest version and retry.",
        );
      }

      const updated = await transaction.liveChannel.findUnique({
        where: { id: channelId },
        select: liveChannelSelect,
      });

      if (!updated) {
        throw new DomainError("CHANNEL_NOT_FOUND", "Channel not found");
      }

      return toLiveChannelRecord(updated);
    });
  } catch (error) {
    if (error instanceof DomainError) {
      throw error;
    }

    throw toLiveChannelDomainError(error) ?? error;
  }
}

export async function deleteLiveChannel(
  prisma: LiveChannelPrismaClient,
  channelId: string,
): Promise<void> {
  try {
    await prisma.liveChannel.delete({
      where: { id: channelId },
    });
  } catch (error) {
    throw toLiveChannelDomainError(error) ?? error;
  }
}

export async function getLiveChannelWithPrograms(
  prisma: PrismaClient,
  channelId: string,
): Promise<LiveChannelWithPrograms | null> {
  return prisma.liveChannel.findUnique({
    where: {
      id: channelId,
    },
    include: {
      epgPrograms: {
        orderBy: {
          startTime: "asc",
        },
      },
    },
  });
}

export async function getLiveChannelWithScheduleLock(
  prisma: PrismaClient,
  channelId: string,
): Promise<LiveChannelWithScheduleLock | null> {
  return prisma.liveChannel.findUnique({
    where: {
      id: channelId,
    },
    include: {
      scheduleLock: true,
    },
  });
}

function toLiveChannelRecord(channel: LiveChannelRow): LiveChannelRecord {
  return {
    id: channel.id,
    name: channel.name,
    slug: channel.slug,
    createdAt: channel.createdAt,
    updatedAt: channel.updatedAt,
  };
}
