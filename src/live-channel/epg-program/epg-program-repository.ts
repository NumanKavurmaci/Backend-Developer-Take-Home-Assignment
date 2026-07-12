import type { Prisma, PrismaClient } from "@prisma/client";
import { DomainError } from "../../shared/domain/domain-error.js";
import { nextEntityUpdatedAt } from "../../shared/http/entity-tag.js";
import {
  normalizeEpgProgramChannelId,
  prepareEpgProgramCreateInput,
  prepareEpgProgramUpdateInput,
} from "./epg-program.js";
import { toEpgProgramDomainError } from "./epg-program-error-mapper.js";
import type {
  CreateEpgProgramInput,
  EpgProgramListOptions,
  EpgProgramPage,
  EpgProgramRecord,
  UpdateEpgProgramInput,
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

  try {
    return await prisma.$transaction(async (transaction) => {
      await acquireEpgScheduleLock(transaction, data.channelId);

      return createEpgProgram(transaction, data);
    });
  } catch (error) {
    throw toEpgProgramDomainError(error) ?? error;
  }
}

export async function assertNoOverlappingEpgProgram(
  prisma: EpgProgramPrismaClient,
  input: CreateEpgProgramInput,
  excludedProgramId?: string,
): Promise<void> {
  const data = prepareEpgProgramCreateInput(input);

  // Overlap examples:
  // existing 10:00-11:00, new 10:30-11:30 => rejected
  // existing 10:00-11:00, new 11:00-12:00 => allowed
  // existing 10:00-11:00, new 09:00-10:00 => allowed
  const overlappingProgram = await prisma.epgProgram.findFirst({
    where: {
      channelId: data.channelId,
      ...(excludedProgramId ? { id: { not: excludedProgramId } } : {}),
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

export async function getEpgProgram(
  prisma: EpgProgramPrismaClient,
  channelId: string,
  programId: string,
): Promise<EpgProgramRecord> {
  const program = await prisma.epgProgram.findFirst({
    where: {
      id: programId,
      channelId: normalizeEpgProgramChannelId(channelId),
    },
  });

  if (!program) {
    throw epgProgramNotFound();
  }

  return program;
}

export async function listEpgPrograms(
  prisma: PrismaClient,
  options: EpgProgramListOptions,
): Promise<EpgProgramPage> {
  const channelId = normalizeEpgProgramChannelId(options.channelId);
  await assertChannelExists(prisma, channelId);

  const where: Prisma.EpgProgramWhereInput = {
    channelId,
    // Return every program that intersects the half-open requested window.
    startTime: { lt: options.windowEnd },
    endTime: { gt: options.windowStart },
  };
  const skip = (options.page - 1) * options.pageSize;
  const [items, total] = await prisma.$transaction([
    prisma.epgProgram.findMany({
      where,
      orderBy: [{ startTime: "asc" }, { id: "asc" }],
      skip,
      take: options.pageSize,
    }),
    prisma.epgProgram.count({ where }),
  ]);

  return {
    items,
    page: options.page,
    pageSize: options.pageSize,
    total,
  };
}

export async function updateEpgProgramWithConcurrencyLock(
  prisma: PrismaClient,
  channelId: string,
  programId: string,
  input: UpdateEpgProgramInput,
): Promise<EpgProgramRecord> {
  const normalizedChannelId = normalizeEpgProgramChannelId(channelId);

  try {
    return await prisma.$transaction(async (transaction) => {
      await acquireEpgScheduleLock(transaction, normalizedChannelId);

      const current = await getEpgProgram(
        transaction,
        normalizedChannelId,
        programId,
      );

      if (
        input.expectedUpdatedAt &&
        current.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()
      ) {
        throw new DomainError(
          "EPG_WRITE_CONFLICT",
          "EPG program changed after it was read. Fetch the latest version and retry.",
        );
      }

      const data = prepareEpgProgramUpdateInput(current, input);
      const effectiveInput: CreateEpgProgramInput = {
        channelId: normalizedChannelId,
        programName: data.programName ?? current.programName,
        startTime: data.startTime ?? current.startTime,
        endTime: data.endTime ?? current.endTime,
      };

      await assertNoOverlappingEpgProgram(
        transaction,
        effectiveInput,
        current.id,
      );

      return transaction.epgProgram.update({
        where: { id: current.id },
        data: {
          ...data,
          updatedAt: nextEntityUpdatedAt(current.updatedAt),
        },
      });
    });
  } catch (error) {
    if (error instanceof DomainError) {
      throw error;
    }

    throw toEpgProgramDomainError(error) ?? error;
  }
}

export async function deleteEpgProgram(
  prisma: PrismaClient,
  channelId: string,
  programId: string,
): Promise<void> {
  const normalizedChannelId = normalizeEpgProgramChannelId(channelId);

  try {
    await prisma.$transaction(async (transaction) => {
      await acquireEpgScheduleLock(transaction, normalizedChannelId);
      const program = await getEpgProgram(
        transaction,
        normalizedChannelId,
        programId,
      );

      await transaction.epgProgram.delete({ where: { id: program.id } });
    });
  } catch (error) {
    if (error instanceof DomainError) {
      throw error;
    }

    throw toEpgProgramDomainError(error) ?? error;
  }
}

async function acquireEpgScheduleLock(
  prisma: Prisma.TransactionClient,
  channelId: string,
): Promise<void> {
  await prisma.epgScheduleLock.upsert({
    where: { channelId },
    update: { version: { increment: 1 } },
    create: { channelId },
  });
}

async function assertChannelExists(
  prisma: PrismaClient,
  channelId: string,
): Promise<void> {
  const channel = await prisma.liveChannel.findUnique({
    where: { id: channelId },
    select: { id: true },
  });

  if (!channel) {
    throw new DomainError("CHANNEL_NOT_FOUND", "Channel not found");
  }
}

function epgProgramNotFound(): DomainError {
  return new DomainError("EPG_PROGRAM_NOT_FOUND", "EPG program not found");
}
