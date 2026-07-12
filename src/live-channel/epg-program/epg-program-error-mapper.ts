import { isDatabaseConstraintViolation } from "../../db/database-error.js";
import { DomainError } from "../../shared/domain/domain-error.js";

export const EPG_TIME_RANGE_CONSTRAINT = "EpgProgram_time_range_check";
export const EPG_NO_OVERLAP_CONSTRAINT = "EpgProgram_no_overlap_excl";

export function toEpgProgramDomainError(
  error: unknown,
): DomainError | undefined {
  if (isDatabaseConstraintViolation(error, EPG_NO_OVERLAP_CONSTRAINT)) {
    return new DomainError(
      "EPG_OVERLAP",
      "EPG program overlaps with an existing schedule on this channel.",
    );
  }

  if (isDatabaseConstraintViolation(error, EPG_TIME_RANGE_CONSTRAINT)) {
    return new DomainError(
      "INVALID_TIME_RANGE",
      "EPG program startTime must be before endTime.",
    );
  }

  return undefined;
}
