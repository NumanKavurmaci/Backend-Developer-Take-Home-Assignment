import { describe, expect, it } from "vitest";
import {
  isPrismaErrorCode,
  toDatabaseConstraintFailure,
} from "./database-error.js";

describe("database error recognition", () => {
  it("recognizes Prisma errors structurally", () => {
    const error = { code: "P2004" };

    expect(isPrismaErrorCode(error, "P2004")).toBe(true);
    expect(isPrismaErrorCode(error, "P2002")).toBe(false);
  });

  it.each(["P2002", "P2003", "P2024"])(
    "does not classify %s as a database constraint failure",
    (code) => {
      expect(toDatabaseConstraintFailure({ code })).toBeUndefined();
    },
  );

  it("extracts a named constraint from the error message", () => {
    const failure = toDatabaseConstraintFailure({
      code: "P2004",
      message:
        'conflicting key value violates exclusion constraint "EpgProgram_no_overlap_excl"',
    });

    expect(failure).toEqual({
      constraintName: "EpgProgram_no_overlap_excl",
      type: undefined,
    });
  });

  it("extracts a named constraint from Prisma metadata", () => {
    const failure = toDatabaseConstraintFailure({
      code: "P2004",
      meta: {
        database_error:
          'violates check constraint "EpgProgram_time_range_check"',
      },
    });

    expect(failure?.constraintName).toBe("EpgProgram_time_range_check");
  });

  it("extracts a constraint name from structured metadata", () => {
    const failure = toDatabaseConstraintFailure({
      code: "P2004",
      meta: {
        database_error: { constraint: "EpgProgram_no_overlap_excl" },
      },
    });

    expect(failure?.constraintName).toBe("EpgProgram_no_overlap_excl");
  });

  it("extracts Prisma's normalized constraint type", () => {
    const failure = toDatabaseConstraintFailure({
      code: "P2004",
      meta: { database_error: "ExclusionConstraintViolation" },
    });

    expect(failure?.type).toBe("ExclusionConstraintViolation");
  });

  it("does not invent details for an unknown P2004 error", () => {
    expect(toDatabaseConstraintFailure({ code: "P2004" })).toEqual({
      constraintName: undefined,
      type: undefined,
    });
  });

  it("handles malformed and circular metadata safely", () => {
    const circularMetadata: { self?: unknown } = {};
    circularMetadata.self = circularMetadata;

    expect(() =>
      toDatabaseConstraintFailure({
        code: "P2004",
        meta: { database_error: circularMetadata },
      }),
    ).not.toThrow();
    expect(
      toDatabaseConstraintFailure({ code: "P2004", meta: "invalid" }),
    ).toEqual({ constraintName: undefined, type: undefined });
  });
});
