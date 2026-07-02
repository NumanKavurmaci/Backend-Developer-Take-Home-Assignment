import type { PrismaClient } from "@prisma/client";
import { prepareEpgProgramCreateInput } from "./epg-program.js";
import type {
  CreateEpgProgramInput,
  EpgProgramRecord,
} from "./epg-program-types.js";

export async function createEpgProgram(
  prisma: PrismaClient,
  input: CreateEpgProgramInput,
): Promise<EpgProgramRecord> {
  const data = prepareEpgProgramCreateInput(input);

  return prisma.epgProgram.create({
    data: {
      id: data.id,
      channelId: data.channelId,
      programName: data.programName,
      startTime: data.startTime,
      endTime: data.endTime,
    },
  });
}
