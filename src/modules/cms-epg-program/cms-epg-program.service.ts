import { HTTPException } from "hono/http-exception";
import { prisma } from "../../db/client.js";
import { getLiveChannelById } from "../../live-channel/live-channel-repository.js";
import {
  EpgProgramValidationError,
  prepareEpgProgramCreateInput,
} from "../../live-channel/epg-program/epg-program.js";
import { createEpgProgram } from "../../live-channel/epg-program/epg-program-repository.js";
import type {
  CreateEpgProgramInput,
  EpgProgramRecord,
} from "../../live-channel/epg-program/epg-program-types.js";

type CreateEpgProgramRequestBody = {
  programName?: unknown;
  startTime?: unknown;
  endTime?: unknown;
};

// Coordinates request validation, channel existence checks, and EPG persistence.
export class CmsEpgProgramService {
  async createProgram(
    channelId: string | undefined,
    body: unknown,
  ): Promise<EpgProgramRecord> {
    const createInput = await buildCreateInput(channelId, body);

    await assertChannelExists(createInput.channelId);

    return mapEpgProgramValidationError(() =>
      createEpgProgram(prisma, createInput),
    );
  }
}

async function buildCreateInput(
  channelId: string | undefined,
  body: unknown,
): Promise<CreateEpgProgramInput> {
  if (!channelId || channelId.trim() === "") {
    throw new HTTPException(400, {
      message: "channelId is required",
    });
  }

  const requestBody = readRequestBodyObject(body);

  return mapEpgProgramValidationError(() =>
    prepareEpgProgramCreateInput({
      channelId,
      programName: readRequiredString(requestBody.programName, "programName"),
      startTime: readRequiredDate(requestBody.startTime, "startTime"),
      endTime: readRequiredDate(requestBody.endTime, "endTime"),
    }),
  );
}

async function assertChannelExists(channelId: string): Promise<void> {
  const channel = await getLiveChannelById(prisma, channelId);

  if (!channel) {
    throw new HTTPException(404, {
      message: "Channel not found",
    });
  }
}

function readRequestBodyObject(body: unknown): CreateEpgProgramRequestBody {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HTTPException(400, {
      message: "Request body must be a JSON object",
    });
  }

  return body as CreateEpgProgramRequestBody;
}

async function mapEpgProgramValidationError<T>(
  callback: () => T | Promise<T>,
): Promise<T> {
  try {
    return await callback();
  } catch (error) {
    if (error instanceof EpgProgramValidationError) {
      throw new HTTPException(400, {
        message: error.message,
      });
    }

    throw error;
  }
}

function readRequiredString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new HTTPException(400, {
      message: `${fieldName} is required`,
    });
  }

  return value;
}

function readRequiredDate(value: unknown, fieldName: string): Date {
  const rawValue = readRequiredString(value, fieldName);
  const date = new Date(rawValue);

  if (Number.isNaN(date.getTime())) {
    throw new HTTPException(400, {
      message: `${fieldName} must be a valid date-time string`,
    });
  }

  return date;
}
