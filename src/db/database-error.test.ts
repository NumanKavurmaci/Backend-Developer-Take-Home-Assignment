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

  it.each([
    ["P2002", "23505"],
    ["P2003", "23503"],
    ["P2011", "23502"],
  ])("normalizes Prisma %s to SQLSTATE %s", (code, sqlState) => {
    expect(toDatabaseConstraintFailure({ code })?.sqlState).toBe(sqlState);
  });

  it("does not classify unrelated Prisma failures as constraints", () => {
    expect(toDatabaseConstraintFailure({ code: "P2024" })).toBeUndefined();
  });

  it("extracts a named constraint from the error message", () => {
    const failure = toDatabaseConstraintFailure({
      code: "P2004",
      message:
        'conflicting key value violates exclusion constraint "EpgProgram_no_overlap_excl"',
    });

    expect(failure).toEqual({
      constraintName: "EpgProgram_no_overlap_excl",
      modelName: undefined,
      sqlState: undefined,
      targetFields: undefined,
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
      modelName: undefined,
      sqlState: undefined,
      targetFields: undefined,
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
    ).toEqual({
      constraintName: undefined,
      modelName: undefined,
      sqlState: undefined,
      targetFields: undefined,
      type: undefined,
    });
  });

  it("retains Prisma model and normalized target fields", () => {
    expect(
      toDatabaseConstraintFailure({
        code: "P2002",
        meta: {
          modelName: "EpgProgram",
          target: ["channelId", "startTime", "endTime"],
        },
      }),
    ).toMatchObject({
      modelName: "EpgProgram",
      targetFields: ["channelId", "startTime", "endTime"],
    });

    expect(
      toDatabaseConstraintFailure({
        code: "P2003",
        meta: { field_name: "EpgScheduleLock_channelId_fkey (index)" },
      }),
    ).toMatchObject({
      constraintName: "EpgScheduleLock_channelId_fkey",
      targetFields: ["EpgScheduleLock_channelId_fkey"],
    });
  });

  it.each([
    ["23502", "Not-null violation"],
    ["23503", "Foreign-key violation"],
    ["23505", "Unique violation"],
    ["23P01", "Exclusion violation"],
    ["23514", "Check violation"],
  ])("recognizes PostgreSQL SQLSTATE %s without P2004", (sqlState, text) => {
    const failure = toDatabaseConstraintFailure({
      message: `${text}; PostgreSQL code: ${sqlState}`,
    });

    expect(failure?.sqlState).toBe(sqlState);
  });

  it("recognizes a named constraint without P2004", () => {
    const failure = toDatabaseConstraintFailure({
      message:
        'conflicting key violates exclusion constraint "EpgProgram_no_overlap_excl"',
    });

    expect(failure?.constraintName).toBe("EpgProgram_no_overlap_excl");
  });
});
