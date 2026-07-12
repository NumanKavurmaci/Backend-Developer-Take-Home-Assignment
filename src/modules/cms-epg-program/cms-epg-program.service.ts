import { prisma } from "../../db/client.js";
import {
  assertValidEpgProgramTimeRange,
  prepareEpgProgramCreateInput,
} from "../../live-channel/epg-program/epg-program.js";
import {
  createEpgProgramWithConcurrencyLock,
  deleteEpgProgram,
  getEpgProgram,
  listEpgPrograms,
  updateEpgProgramWithConcurrencyLock,
} from "../../live-channel/epg-program/epg-program-repository.js";
import type {
  CreateEpgProgramInput,
  EpgProgramPage,
  EpgProgramRecord,
  UpdateEpgProgramInput,
} from "../../live-channel/epg-program/epg-program-types.js";
import { ApiError } from "../../shared/http/api-error.js";
import { readOptionalUpdatedAtEntityTag } from "../../shared/http/entity-tag.js";

type RequestObject = Record<string, unknown>;

const CREATE_FIELDS = ["programName", "startTime", "endTime"] as const;
const UPDATE_FIELDS = CREATE_FIELDS;
const LIST_FIELDS = ["windowStart", "windowEnd", "page", "pageSize"] as const;
const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

const ISO_DATE_TIME_WITH_TIMEZONE_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):(\d{2}))$/;

// Coordinates request validation, route ownership, and EPG persistence.
export class CmsEpgProgramService {
  async createProgram(
    channelId: string | undefined,
    body: unknown,
  ): Promise<EpgProgramRecord> {
    const createInput = buildCreateInput(channelId, body);

    return createEpgProgramWithConcurrencyLock(prisma, createInput);
  }

  async getProgram(
    channelId: string | undefined,
    programId: string | undefined,
  ): Promise<EpgProgramRecord> {
    return getEpgProgram(
      prisma,
      readRequiredRouteId(channelId, "channelId"),
      readRequiredRouteId(programId, "programId"),
    );
  }

  async listPrograms(
    channelId: string | undefined,
    query: unknown,
  ): Promise<EpgProgramPage> {
    const normalizedChannelId = readRequiredRouteId(channelId, "channelId");
    const requestQuery = readRequestObject(query, "Query parameters");
    assertAllowedFields(requestQuery, LIST_FIELDS);

    const windowStart = readRequiredDate(
      requestQuery.windowStart,
      "windowStart",
    );
    const windowEnd = readRequiredDate(requestQuery.windowEnd, "windowEnd");
    assertValidEpgProgramTimeRange(windowStart, windowEnd);

    return listEpgPrograms(prisma, {
      channelId: normalizedChannelId,
      windowStart,
      windowEnd,
      page: readPositiveInteger(requestQuery.page, "page", DEFAULT_PAGE),
      pageSize: readPositiveInteger(
        requestQuery.pageSize,
        "pageSize",
        DEFAULT_PAGE_SIZE,
        MAX_PAGE_SIZE,
      ),
    });
  }

  async updateProgram(
    channelId: string | undefined,
    programId: string | undefined,
    body: unknown,
    ifMatch?: string,
  ): Promise<EpgProgramRecord> {
    const requestBody = readRequestObject(body, "Request body");
    assertAllowedFields(requestBody, UPDATE_FIELDS);

    if (Object.keys(requestBody).length === 0) {
      throw new ApiError(
        400,
        "INVALID_REQUEST_BODY",
        "PATCH request body must include at least one mutable field",
      );
    }

    const input: UpdateEpgProgramInput = {
      ...(hasOwn(requestBody, "programName")
        ? {
            programName: readRequiredString(
              requestBody.programName,
              "programName",
            ),
          }
        : {}),
      ...(hasOwn(requestBody, "startTime")
        ? {
            startTime: readRequiredDate(requestBody.startTime, "startTime"),
          }
        : {}),
      ...(hasOwn(requestBody, "endTime")
        ? { endTime: readRequiredDate(requestBody.endTime, "endTime") }
        : {}),
      expectedUpdatedAt: readOptionalUpdatedAtEntityTag(ifMatch),
    };

    return updateEpgProgramWithConcurrencyLock(
      prisma,
      readRequiredRouteId(channelId, "channelId"),
      readRequiredRouteId(programId, "programId"),
      input,
    );
  }

  async deleteProgram(
    channelId: string | undefined,
    programId: string | undefined,
  ): Promise<void> {
    await deleteEpgProgram(
      prisma,
      readRequiredRouteId(channelId, "channelId"),
      readRequiredRouteId(programId, "programId"),
    );
  }
}

function buildCreateInput(
  channelId: string | undefined,
  body: unknown,
): CreateEpgProgramInput {
  const normalizedChannelId = readRequiredRouteId(channelId, "channelId");
  const requestBody = readRequestObject(body, "Request body");
  assertAllowedFields(requestBody, CREATE_FIELDS);

  return prepareEpgProgramCreateInput({
    channelId: normalizedChannelId,
    programName: readRequiredString(requestBody.programName, "programName"),
    startTime: readRequiredDate(requestBody.startTime, "startTime"),
    endTime: readRequiredDate(requestBody.endTime, "endTime"),
  });
}

function readRequiredRouteId(
  value: string | undefined,
  fieldName: string,
): string {
  if (!value || value.trim() === "") {
    throw new ApiError(400, "INVALID_REQUEST", `${fieldName} is required`);
  }

  return value.trim();
}

function readRequestObject(body: unknown, label: string): RequestObject {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ApiError(
      400,
      "INVALID_REQUEST_BODY",
      `${label} must be a JSON object`,
    );
  }

  return body as RequestObject;
}

function assertAllowedFields(
  body: RequestObject,
  allowedFields: readonly string[],
): void {
  const unknownFields = Object.keys(body).filter(
    (field) => !allowedFields.includes(field),
  );

  if (unknownFields.length > 0) {
    throw new ApiError(
      400,
      "UNKNOWN_FIELDS",
      `Unknown field${unknownFields.length === 1 ? "" : "s"}: ${unknownFields
        .sort()
        .join(", ")}`,
    );
  }
}

function readRequiredString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ApiError(400, "INVALID_REQUEST_BODY", `${fieldName} is required`);
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

function readPositiveInteger(
  value: unknown,
  fieldName: string,
  defaultValue: number,
  maximum?: number,
): number {
  if (value === undefined) {
    return defaultValue;
  }

  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
    throw new ApiError(
      400,
      "INVALID_PAGINATION",
      `${fieldName} must be a positive integer`,
    );
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new ApiError(
      400,
      "INVALID_PAGINATION",
      `${fieldName} must be a positive integer`,
    );
  }

  if (maximum !== undefined && parsed > maximum) {
    throw new ApiError(
      400,
      "INVALID_PAGINATION",
      `${fieldName} must be at most ${maximum}`,
    );
  }

  return parsed;
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

function hasOwn(body: RequestObject, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, field);
}
