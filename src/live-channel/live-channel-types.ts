import type { LiveChannel } from "@prisma/client";
import type { EpgProgramRecord } from "./epg-program/epg-program-types.js";

export type LiveChannelId = string;

export type CreateLiveChannelInput = {
  id?: string;
  name: string;
  slug: string;
};

export type UpdateLiveChannelInput = {
  name?: string;
  slug?: string;
};

export type LiveChannelListOptions = {
  name?: string;
  slug?: string;
  page: number;
  pageSize: number;
};

export type LiveChannelPage = {
  items: LiveChannel[];
  page: number;
  pageSize: number;
  total: number;
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
