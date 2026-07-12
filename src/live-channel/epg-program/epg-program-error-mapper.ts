import { toDatabaseConstraintFailure } from "../../db/database-error.js";
import { DomainError } from "../../shared/domain/domain-error.js";

export const EPG_TIME_RANGE_CONSTRAINT = "EpgProgram_time_range_check";
export const EPG_NO_OVERLAP_CONSTRAINT = "EpgProgram_no_overlap_excl";

type EpgErrorMapping = {
  constraint: string;
  prismaType?: string;
  code: string;
  message: string;
};

const EPG_ERROR_MAPPINGS: EpgErrorMapping[] = [
  {
    constraint: EPG_NO_OVERLAP_CONSTRAINT,
    prismaType: "ExclusionConstraintViolation",
    code: "EPG_OVERLAP",
    message: "EPG program overlaps with an existing schedule on this channel.",
  },
  {
    constraint: EPG_TIME_RANGE_CONSTRAINT,
    code: "INVALID_TIME_RANGE",
    message: "EPG program startTime must be before endTime.",
  },
];

export function toEpgProgramDomainError(
  error: unknown,
): DomainError | undefined {
  const failure = toDatabaseConstraintFailure(error);

  if (!failure) {
    return undefined;
  }

  for (const mapping of EPG_ERROR_MAPPINGS) {
    const matchesConstraint = failure.constraintName === mapping.constraint;
    const matchesPrismaType =
      mapping.prismaType !== undefined && failure.type === mapping.prismaType;

    if (matchesConstraint || matchesPrismaType) {
      return new DomainError(mapping.code, mapping.message);
    }
  }

  return undefined;
}
