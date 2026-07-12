import type {
  CreateEpgProgramInput,
  UpdateEpgProgramInput,
} from "./epg-program-types.js";
import { DomainError } from "../../shared/domain/domain-error.js";

export function normalizeEpgProgramName(programName: string): string {
  return programName.trim();
}

export function normalizeEpgProgramChannelId(channelId: string): string {
  return channelId.trim();
}

export function assertValidEpgProgramTimeRange(
  startTime: Date,
  endTime: Date,
): void {
  if (Number.isNaN(startTime.getTime())) {
    throw new DomainError(
      "INVALID_DATE_TIME_FORMAT",
      "EPG program startTime is invalid.",
    );
  }

  if (Number.isNaN(endTime.getTime())) {
    throw new DomainError(
      "INVALID_DATE_TIME_FORMAT",
      "EPG program endTime is invalid.",
    );
  }

  if (startTime >= endTime) {
    throw new DomainError(
      "INVALID_TIME_RANGE",
      "EPG program startTime must be before endTime.",
    );
  }
}

export function assertValidEpgProgramInput(input: CreateEpgProgramInput): void {
  if (!normalizeEpgProgramChannelId(input.channelId)) {
    throw new DomainError(
      "INVALID_REQUEST_BODY",
      "EPG program channelId is required.",
    );
  }

  if (!normalizeEpgProgramName(input.programName)) {
    throw new DomainError(
      "INVALID_REQUEST_BODY",
      "EPG program name is required.",
    );
  }

  assertValidEpgProgramTimeRange(input.startTime, input.endTime);
}

export function prepareEpgProgramCreateInput(
  input: CreateEpgProgramInput,
): CreateEpgProgramInput {
  assertValidEpgProgramInput(input);

  return {
    id: input.id,
    channelId: normalizeEpgProgramChannelId(input.channelId),
    programName: normalizeEpgProgramName(input.programName),
    startTime: input.startTime,
    endTime: input.endTime,
  };
}

export function prepareEpgProgramUpdateInput(
  current: CreateEpgProgramInput,
  input: UpdateEpgProgramInput,
): UpdateEpgProgramInput {
  const programName =
    input.programName === undefined
      ? current.programName
      : normalizeEpgProgramName(input.programName);
  const startTime = input.startTime ?? current.startTime;
  const endTime = input.endTime ?? current.endTime;

  assertValidEpgProgramInput({
    channelId: current.channelId,
    programName,
    startTime,
    endTime,
  });

  return {
    ...(input.programName !== undefined ? { programName } : {}),
    ...(input.startTime !== undefined ? { startTime } : {}),
    ...(input.endTime !== undefined ? { endTime } : {}),
  };
}
