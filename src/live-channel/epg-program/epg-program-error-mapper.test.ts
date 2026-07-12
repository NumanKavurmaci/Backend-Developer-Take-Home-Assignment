import { Prisma } from "@prisma/client";
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
  ])("maps %s to %s", (constraintName, errorCode) => {
    const error = constraintViolation(constraintName);

    expect(toEpgProgramDomainError(error)).toMatchObject({ errorCode });
  });

  it("does not map unrelated persistence failures", () => {
    expect(
      toEpgProgramDomainError(new Error("connection failed")),
    ).toBeUndefined();
  });

  it("maps Prisma's normalized exclusion violation for EpgProgram", () => {
    const error = normalizedConstraintViolation(
      "EpgProgram",
      "ExclusionConstraintViolation",
    );

    expect(toEpgProgramDomainError(error)).toMatchObject({
      errorCode: "EPG_OVERLAP",
    });
  });

  it("does not map an exclusion violation belonging to another model", () => {
    const error = normalizedConstraintViolation(
      "Content",
      "ExclusionConstraintViolation",
    );

    expect(toEpgProgramDomainError(error)).toBeUndefined();
  });
});

function constraintViolation(constraintName: string) {
  return new Prisma.PrismaClientKnownRequestError(
    "A constraint failed on the database.",
    {
      code: "P2004",
      clientVersion: "test",
      meta: { database_error: `violates constraint "${constraintName}"` },
    },
  );
}

function normalizedConstraintViolation(
  modelName: string,
  databaseError: string,
) {
  return new Prisma.PrismaClientKnownRequestError(
    `A constraint failed on the database: ${databaseError}`,
    {
      code: "P2004",
      clientVersion: "test",
      meta: { modelName, database_error: databaseError },
    },
  );
}
