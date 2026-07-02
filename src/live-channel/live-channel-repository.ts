import type { LiveChannel, PrismaClient } from "@prisma/client";
import { prepareLiveChannelCreateInput } from "./live-channel.js";
import type {
  CreateLiveChannelInput,
  LiveChannelWithPrograms,
  LiveChannelWithScheduleLock,
} from "./live-channel-types.js";

export async function createLiveChannel(
  prisma: PrismaClient,
  input: CreateLiveChannelInput,
): Promise<LiveChannel> {
  const data = prepareLiveChannelCreateInput(input);

  return prisma.liveChannel.create({
    data: {
      id: data.id,
      name: data.name,
      slug: data.slug,
      scheduleLock: {
        create: {},
      },
    },
  });
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
