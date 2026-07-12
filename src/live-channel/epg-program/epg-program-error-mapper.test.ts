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

  it("maps PostgreSQL exclusion SQLSTATE 23P01", () => {
    const error = {
      message: "PostgreSQL error 23P01: exclusion constraint violation",
    };

    expect(toEpgProgramDomainError(error)).toMatchObject({
      errorCode: "EPG_OVERLAP",
    });
  });

  it("maps check violations to invalid time range", () => {
    const error = normalizedConstraintViolation("CheckConstraintViolation");

    expect(
      toEpgProgramDomainError({ message: "PostgreSQL error 23514" }),
    ).toMatchObject({ errorCode: "INVALID_TIME_RANGE" });
    expect(toEpgProgramDomainError(error)).toMatchObject({
      errorCode: "INVALID_TIME_RANGE",
    });
  });

  it.each([
    [{ code: "P2002" }, "EPG_OVERLAP"],
    [{ message: "PostgreSQL error 23505" }, "EPG_OVERLAP"],
    [{ code: "P2003" }, "CHANNEL_NOT_FOUND"],
    [{ message: "PostgreSQL error 23503" }, "CHANNEL_NOT_FOUND"],
  ])("maps EPG integrity error %# to %s", (error, errorCode) => {
    expect(toEpgProgramDomainError(error)).toMatchObject({ errorCode });
  });

  it("leaves not-null violations as internal failures", () => {
    expect(toEpgProgramDomainError({ code: "P2011" })).toBeUndefined();
    expect(
      toEpgProgramDomainError({ message: "PostgreSQL error 23502" }),
    ).toBeUndefined();
  });

  it.each([
    new Error("connection failed"),
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
