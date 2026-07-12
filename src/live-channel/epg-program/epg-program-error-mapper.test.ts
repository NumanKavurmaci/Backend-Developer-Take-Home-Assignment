import { describe, expect, it } from "vitest";
import {
  EPG_NO_OVERLAP_CONSTRAINT,
  EPG_TIME_RANGE_CONSTRAINT,
  toEpgProgramDomainError,
} from "./epg-program-error-mapper.js";

describe("EPG program error mapper", () => {
  it.each([
    [EPG_NO_OVERLAP_CONSTRAINT, "EPG_OVERLAP"],
    [EPG_TIME_RANGE_CONSTRAINT, "INVALID_TIME_RANGE"],
  ])("maps named constraint %s to %s", (constraintName, errorCode) => {
    const error = namedConstraintViolation(constraintName);

    expect(toEpgProgramDomainError(error)).toMatchObject({ errorCode });
  });

  it("maps Prisma's normalized exclusion violation", () => {
    const error = normalizedConstraintViolation(
      "ExclusionConstraintViolation",
    );

    expect(toEpgProgramDomainError(error)).toMatchObject({
      errorCode: "EPG_OVERLAP",
    });
  });

  it("does not guess which check constraint failed", () => {
    const error = normalizedConstraintViolation("CheckConstraintViolation");

    expect(toEpgProgramDomainError(error)).toBeUndefined();
  });

  it.each([
    new Error("connection failed"),
    { code: "P2003" },
    { code: "P2024" },
    normalizedConstraintViolation("ForeignKeyConstraintViolation"),
    { code: "P2004" },
  ])("does not map unrelated persistence error %#", (error) => {
    expect(toEpgProgramDomainError(error)).toBeUndefined();
  });
});

function namedConstraintViolation(constraintName: string) {
  return {
    code: "P2004",
    message: `violates constraint "${constraintName}"`,
  };
}

function normalizedConstraintViolation(databaseError: string) {
  return {
    code: "P2004",
    meta: { database_error: databaseError },
  };
}
