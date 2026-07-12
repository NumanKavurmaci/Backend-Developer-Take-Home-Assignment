import type { EpgProgram } from "@prisma/client";

// Database/read shape returned after an EPG program has been saved.
export type EpgProgramRecord = EpgProgram;

// Create/write shape accepted before Prisma adds database-managed fields.
export type CreateEpgProgramInput = {
  id?: string;
  channelId: string;
  programName: string;
  startTime: Date;
  endTime: Date;
};

// PATCH shape. The route owns channelId, so programs cannot move channels.
export type UpdateEpgProgramInput = {
  programName?: string;
  startTime?: Date;
  endTime?: Date;
};

export type EpgProgramListOptions = {
  channelId: string;
  windowStart: Date;
  windowEnd: Date;
  page: number;
  pageSize: number;
};

export type EpgProgramPage = {
  items: EpgProgramRecord[];
  page: number;
  pageSize: number;
  total: number;
};
