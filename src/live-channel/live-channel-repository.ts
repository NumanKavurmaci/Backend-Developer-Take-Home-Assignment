import type { LiveChannel, Prisma, PrismaClient } from "@prisma/client";
import { toLiveChannelDomainError } from "./live-channel-error-mapper.js";
import {
  prepareLiveChannelCreateInput,
  prepareLiveChannelUpdateInput,
} from "./live-channel.js";
import type {
  CreateLiveChannelInput,
  LiveChannelListOptions,
  LiveChannelPage,
  LiveChannelWithPrograms,
  LiveChannelWithScheduleLock,
  UpdateLiveChannelInput,
} from "./live-channel-types.js";

type LiveChannelPrismaClient = PrismaClient | Prisma.TransactionClient;

export async function createLiveChannel(
  prisma: LiveChannelPrismaClient,
  input: CreateLiveChannelInput,
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
  options: LiveChannelListOptions,
): Promise<LiveChannelPage> {
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
  prisma: LiveChannelPrismaClient,
  channelId: string,
  input: UpdateLiveChannelInput,
): Promise<LiveChannel> {
  const data = prepareLiveChannelUpdateInput(input);

  try {
    return await prisma.liveChannel.update({
      where: { id: channelId },
      data,
    });
  } catch (error) {
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
