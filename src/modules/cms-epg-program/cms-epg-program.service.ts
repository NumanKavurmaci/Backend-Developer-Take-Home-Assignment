import { prisma } from "../../db/client.js";
import { getLiveChannelById } from "../../live-channel/live-channel-repository.js";
import { prepareEpgProgramCreateInput } from "../../live-channel/epg-program/epg-program.js";
import { createEpgProgramWithConcurrencyLock } from "../../live-channel/epg-program/epg-program-repository.js";
import { ApiError } from "../../shared/http/api-error.js";
import type {
  CreateEpgProgramInput,
  EpgProgramRecord,
} from "../../live-channel/epg-program/epg-program-types.js";

type CreateEpgProgramRequestBody = {
  programName?: unknown;
  startTime?: unknown;
  endTime?: unknown;
};

const ISO_DATE_TIME_WITH_TIMEZONE_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):(\d{2}))$/;

// Coordinates request validation, channel existence checks, and EPG persistence.
export class CmsEpgProgramService {
  async createProgram(
    channelId: string | undefined,
    body: unknown,
  ): Promise<EpgProgramRecord> {
    const createInput = await buildCreateInput(channelId, body);

    await assertChannelExists(createInput.channelId);

    return createEpgProgramWithConcurrencyLock(prisma, createInput);
  }
}

async function buildCreateInput(
  channelId: string | undefined,
  body: unknown,
): Promise<CreateEpgProgramInput> {
  if (!channelId || channelId.trim() === "") {
    throw new ApiError(400, "INVALID_REQUEST", "channelId is required");
  }

  const requestBody = readRequestBodyObject(body);

  return prepareEpgProgramCreateInput({
    channelId,
    programName: readRequiredString(requestBody.programName, "programName"),
    startTime: readRequiredDate(requestBody.startTime, "startTime"),
    endTime: readRequiredDate(requestBody.endTime, "endTime"),
  });
}

async function assertChannelExists(channelId: string): Promise<void> {
  const channel = await getLiveChannelById(prisma, channelId);

  if (!channel) {
    throw new ApiError(404, "CHANNEL_NOT_FOUND", "Channel not found");
  }
}

function readRequestBodyObject(body: unknown): CreateEpgProgramRequestBody {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ApiError(
      400,
      "INVALID_REQUEST_BODY",
      "Request body must be a JSON object",
    );
  }

  return body as CreateEpgProgramRequestBody;
}

function readRequiredString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ApiError(
      400,
      "INVALID_REQUEST_BODY",
      `${fieldName} is required`,
    );
  }

  return value;
}

function readRequiredDate(value: unknown, fieldName: string): Date {
  const rawValue = readRequiredString(value, fieldName);
  const match = ISO_DATE_TIME_WITH_TIMEZONE_PATTERN.exec(rawValue);

  if (!match || !hasValidDateTimeParts(match)) {
    throw new ApiError(
      400,
      "INVALID_DATE_TIME_FORMAT",
      `${fieldName} must be an ISO 8601 date-time string with timezone`,
    );
  }

  const date = new Date(rawValue);

  if (Number.isNaN(date.getTime())) {
    throw new ApiError(
      400,
      "INVALID_DATE_TIME_FORMAT",
      `${fieldName} must be a valid date-time string`,
    );
  }

  return date;
}

function hasValidDateTimeParts(match: RegExpExecArray): boolean {
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = match[10] ? Number(match[10]) : 0;
  const offsetMinute = match[11] ? Number(match[11]) : 0;

  if (
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 23 ||
    offsetMinute > 59
  ) {
    return false;
  }

  const calendarDate = new Date(Date.UTC(year, month - 1, day));

  return (
    calendarDate.getUTCFullYear() === year &&
    calendarDate.getUTCMonth() === month - 1 &&
    calendarDate.getUTCDate() === day
  );
}
