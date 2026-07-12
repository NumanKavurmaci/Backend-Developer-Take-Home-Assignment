import {
  isDatabaseConstraintViolation,
  isPrismaDatabaseError,
} from "../../db/database-error.js";
import { DomainError } from "../../shared/domain/domain-error.js";

export const EPG_TIME_RANGE_CONSTRAINT = "EpgProgram_time_range_check";
export const EPG_NO_OVERLAP_CONSTRAINT = "EpgProgram_no_overlap_excl";
const EPG_PROGRAM_MODEL = "EpgProgram";

const EPG_ERROR_MAPPINGS = [
  {
    constraint: EPG_NO_OVERLAP_CONSTRAINT,
    prismaError: "ExclusionConstraintViolation",
    code: "EPG_OVERLAP",
    message: "EPG program overlaps with an existing schedule on this channel.",
  },
  {
    constraint: EPG_TIME_RANGE_CONSTRAINT,
    prismaError: "CheckConstraintViolation",
    code: "INVALID_TIME_RANGE",
    message: "EPG program startTime must be before endTime.",
  },
] as const;

export function toEpgProgramDomainError(
  error: unknown,
): DomainError | undefined {
  for (const mapping of EPG_ERROR_MAPPINGS) {
    if (matchesEpgConstraint(error, mapping)) {
      return new DomainError(mapping.code, mapping.message);
    }
  }

  return undefined;
}

function matchesEpgConstraint(
  error: unknown,
  mapping: (typeof EPG_ERROR_MAPPINGS)[number],
): boolean {
  return (
    isDatabaseConstraintViolation(error, mapping.constraint) ||
    isPrismaDatabaseError(error, mapping.prismaError, EPG_PROGRAM_MODEL)
  );
}
