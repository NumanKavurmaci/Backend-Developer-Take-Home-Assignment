import type { Prisma, PrismaClient } from "@prisma/client";
import { DomainError } from "../../shared/domain/domain-error.js";
import { prepareEpgProgramCreateInput } from "./epg-program.js";
import { toEpgProgramDomainError } from "./epg-program-error-mapper.js";
import type {
  CreateEpgProgramInput,
  EpgProgramRecord,
} from "./epg-program-types.js";

type EpgProgramPrismaClient = PrismaClient | Prisma.TransactionClient;

export async function createEpgProgram(
  prisma: EpgProgramPrismaClient,
  input: CreateEpgProgramInput,
): Promise<EpgProgramRecord> {
  const data = prepareEpgProgramCreateInput(input);
  await assertNoOverlappingEpgProgram(prisma, data);

  try {
    return await prisma.epgProgram.create({
      data: {
        id: data.id,
        channelId: data.channelId,
        programName: data.programName,
        startTime: data.startTime,
        endTime: data.endTime,
      },
    });
  } catch (error) {
    throw toEpgProgramDomainError(error) ?? error;
  }
}

/**
 * Touch the channel lock row before checking overlaps.
 * This makes concurrent writes for the same channel run one after another,
 * so the second request sees the first request's inserted program.
 */
export async function createEpgProgramWithConcurrencyLock(
  prisma: PrismaClient,
  input: CreateEpgProgramInput,
): Promise<EpgProgramRecord> {
  const data = prepareEpgProgramCreateInput(input);

  return prisma.$transaction(async (transaction) => {
    await transaction.epgScheduleLock.upsert({
      where: {
        channelId: data.channelId,
      },
      update: {
        version: {
          increment: 1,
        },
      },
      create: {
        channelId: data.channelId,
      },
    });

    return createEpgProgram(transaction, data);
  });
}

export async function assertNoOverlappingEpgProgram(
  prisma: EpgProgramPrismaClient,
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
    throw new DomainError(
      "EPG_OVERLAP",
      "EPG program overlaps with an existing schedule on this channel.",
    );
  }
}
