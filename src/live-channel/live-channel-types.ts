import type { LiveChannel } from "@prisma/client";
import type { EpgProgramRecord } from "./epg-program/epg-program-types.js";

export type LiveChannelId = string;

export type CreateLiveChannelInput = {
  id?: string;
  name: string;
  slug: string;
};

export type LiveChannelWithPrograms = LiveChannel & {
  epgPrograms: EpgProgramRecord[];
};

export type LiveChannelWithScheduleLock = LiveChannel & {
  scheduleLock: {
    channelId: string;
    version: number;
    updatedAt: Date;
  } | null;
};
