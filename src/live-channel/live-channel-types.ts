import type { LiveChannel } from "@prisma/client";

export type LiveChannelId = string;

export type CreateLiveChannelInput = {
  id?: string;
  name: string;
  slug: string;
};

export type LiveChannelWithPrograms = LiveChannel & {
  epgPrograms: {
    id: string;
    channelId: string;
    programName: string;
    startTime: Date;
    endTime: Date;
    createdAt: Date;
    updatedAt: Date;
  }[];
};

export type LiveChannelWithScheduleLock = LiveChannel & {
  scheduleLock: {
    channelId: string;
    version: number;
    updatedAt: Date;
  } | null;
};
