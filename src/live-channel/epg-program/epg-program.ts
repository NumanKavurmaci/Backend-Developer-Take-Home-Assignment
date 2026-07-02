import type { CreateEpgProgramInput } from "./epg-program-types.js";

export class EpgProgramValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EpgProgramValidationError";
  }
}

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
    throw new EpgProgramValidationError("EPG program startTime is invalid.");
  }

  if (Number.isNaN(endTime.getTime())) {
    throw new EpgProgramValidationError("EPG program endTime is invalid.");
  }

  if (startTime >= endTime) {
    throw new EpgProgramValidationError(
      "EPG program startTime must be before endTime.",
    );
  }
}

export function assertValidEpgProgramInput(
  input: CreateEpgProgramInput,
): void {
  if (!normalizeEpgProgramChannelId(input.channelId)) {
    throw new EpgProgramValidationError("EPG program channelId is required.");
  }

  if (!normalizeEpgProgramName(input.programName)) {
    throw new EpgProgramValidationError("EPG program name is required.");
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
