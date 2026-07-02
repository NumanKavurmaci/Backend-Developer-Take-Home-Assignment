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
