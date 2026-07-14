import type { LiveChannel, Prisma, PrismaClient } from "@prisma/client";
import { toLiveChannelDomainError } from "./live-channel-error-mapper.js";
import {
  prepareLiveChannelCreateInput,
  prepareLiveChannelUpdateInput,
} from "./live-channel.js";
import type {
  LiveChannelCreateInput,
  LiveChannelListQuery,
  LiveChannelWithPrograms,
  LiveChannelWithScheduleLock,
  LiveChannelUpdateInput,
  PaginatedResult,
} from "../shared/domain/domain-contracts.js";
import { DomainError } from "../shared/domain/domain-error.js";
import { nextEntityUpdatedAt } from "../shared/http/entity-tag.js";

type LiveChannelPrismaClient = PrismaClient | Prisma.TransactionClient;

export async function createLiveChannel(
  prisma: LiveChannelPrismaClient,
  input: LiveChannelCreateInput,
): Promise<LiveChannel> {
  const data = prepareLiveChannelCreateInput(input);

  try {
    return await prisma.liveChannel.create({
      data: {
        id: data.id,
        name: data.name,
        slug: data.slug,
        scheduleLock: {
          create: {},
        },
      },
    });
  } catch (error) {
    throw toLiveChannelDomainError(error) ?? error;
  }
}

export async function getLiveChannelById(
  prisma: PrismaClient,
  channelId: string,
): Promise<LiveChannel | null> {
  return prisma.liveChannel.findUnique({
    where: {
      id: channelId,
    },
  });
}

export async function getLiveChannelBySlug(
  prisma: PrismaClient,
  slug: string,
): Promise<LiveChannel | null> {
  return prisma.liveChannel.findUnique({
    where: {
      slug: slug.trim().toLowerCase(),
    },
  });
}

export async function listLiveChannels(
  prisma: PrismaClient,
): Promise<LiveChannel[]> {
  return prisma.liveChannel.findMany({
    orderBy: {
      name: "asc",
    },
  });
}

export async function listLiveChannelsPage(
  prisma: PrismaClient,
  options: LiveChannelListQuery,
): Promise<PaginatedResult<LiveChannel>> {
  const where: Prisma.LiveChannelWhereInput = {
    ...(options.name
      ? { name: { contains: options.name, mode: "insensitive" } }
      : {}),
    ...(options.slug
      ? { slug: { contains: options.slug, mode: "insensitive" } }
      : {}),
  };
  const skip = (options.page - 1) * options.pageSize;
  const [items, total] = await prisma.$transaction([
    prisma.liveChannel.findMany({
      where,
      orderBy: [{ name: "asc" }, { id: "asc" }],
      skip,
      take: options.pageSize,
    }),
    prisma.liveChannel.count({ where }),
  ]);

  return {
    items,
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
): Promise<LiveChannel> {
  const data = prepareLiveChannelUpdateInput(input);

  try {
    return await prisma.$transaction(async (transaction) => {
      const current = await transaction.liveChannel.findUnique({
        where: { id: channelId },
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
      });

      if (!updated) {
        throw new DomainError("CHANNEL_NOT_FOUND", "Channel not found");
      }

      return updated;
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
