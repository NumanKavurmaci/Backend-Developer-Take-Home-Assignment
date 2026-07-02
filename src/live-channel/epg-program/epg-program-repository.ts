import type { PrismaClient } from "@prisma/client";
import {
  EpgProgramValidationError,
  prepareEpgProgramCreateInput,
} from "./epg-program.js";
import type {
  CreateEpgProgramInput,
  EpgProgramRecord,
} from "./epg-program-types.js";

export async function createEpgProgram(
  prisma: PrismaClient,
  input: CreateEpgProgramInput,
): Promise<EpgProgramRecord> {
  const data = prepareEpgProgramCreateInput(input);
  await assertNoOverlappingEpgProgram(prisma, data);

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

export async function assertNoOverlappingEpgProgram(
  prisma: PrismaClient,
  input: CreateEpgProgramInput,
): Promise<void> {
  const data = prepareEpgProgramCreateInput(input);

  // Overlap examples:
  // existing 10:00-11:00, new 10:30-11:30 => rejected
  // existing 10:00-11:00, new 11:00-12:00 => allowed
  // existing 10:00-11:00, new 09:00-10:00 => allowed
  const overlappingProgram = await prisma.epgProgram.findFirst({
    where: {
      channelId: data.channelId,
      startTime: {
        lt: data.endTime,
      },
      endTime: {
        gt: data.startTime,
      },
    },
    select: {
      id: true,
    },
  });

  if (overlappingProgram) {
    throw new EpgProgramValidationError(
      "EPG program overlaps with an existing schedule on this channel.",
    );
  }
}
