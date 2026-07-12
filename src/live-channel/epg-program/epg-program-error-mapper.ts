import { toDatabaseConstraintFailure } from "../../db/database-error.js";
import { DomainError } from "../../shared/domain/domain-error.js";

export const EPG_TIME_RANGE_CONSTRAINT = "EpgProgram_time_range_check";
export const EPG_NO_OVERLAP_CONSTRAINT = "EpgProgram_no_overlap_excl";

type EpgErrorMapping = {
  constraint: string;
  prismaType?: string;
  sqlState?: string;
  code: string;
  message: string;
};

const EPG_ERROR_MAPPINGS: EpgErrorMapping[] = [
  {
    constraint: EPG_NO_OVERLAP_CONSTRAINT,
    prismaType: "ExclusionConstraintViolation",
    sqlState: "23P01",
    code: "EPG_OVERLAP",
    message: "EPG program overlaps with an existing schedule on this channel.",
  },
  {
    constraint: EPG_TIME_RANGE_CONSTRAINT,
    prismaType: "CheckConstraintViolation",
    sqlState: "23514",
    code: "INVALID_TIME_RANGE",
    message: "EPG program startTime must be before endTime.",
  },
  {
    constraint: "EpgProgram_channelId_fkey",
    code: "CHANNEL_NOT_FOUND",
    message: "Channel not found",
  },
  {
    constraint: "EpgScheduleLock_channelId_fkey",
    code: "CHANNEL_NOT_FOUND",
    message: "Channel not found",
  },
];

export function toEpgProgramDomainError(
  error: unknown,
): DomainError | undefined {
  const failure = toDatabaseConstraintFailure(error);

  if (!failure) {
    return undefined;
  }

  if (
    failure.constraintName === "EpgProgram_channelId_startTime_endTime_key" ||
    (failure.modelName === "EpgProgram" &&
      fieldsEqual(failure.targetFields, ["channelId", "startTime", "endTime"]))
  ) {
    return new DomainError(
      "EPG_OVERLAP",
      "EPG program overlaps with an existing schedule on this channel.",
    );
  }

  for (const mapping of EPG_ERROR_MAPPINGS) {
    const matchesConstraint = failure.constraintName === mapping.constraint;
    const matchesPrismaType =
      mapping.prismaType !== undefined && failure.type === mapping.prismaType;
    const matchesSqlState =
      mapping.sqlState !== undefined && failure.sqlState === mapping.sqlState;

    if (matchesConstraint || matchesPrismaType || matchesSqlState) {
      return new DomainError(mapping.code, mapping.message);
    }
  }

  return undefined;
}

function fieldsEqual(
  actual: string[] | undefined,
  expected: string[],
): boolean {
  return (
    actual?.length === expected.length &&
    expected.every((field, index) => actual[index] === field)
  );
}
