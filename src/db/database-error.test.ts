import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { isDatabaseConstraintViolation } from "./database-error.js";

describe("database error recognition", () => {
  it("recognizes a named Prisma database constraint violation", () => {
    const error = new Prisma.PrismaClientKnownRequestError(
      "A constraint failed on the database.",
      {
        code: "P2004",
        clientVersion: "test",
        meta: {
          database_error:
            'violates exclusion constraint "EpgProgram_no_overlap_excl"',
        },
      },
    );

    expect(
      isDatabaseConstraintViolation(error, "EpgProgram_no_overlap_excl"),
    ).toBe(true);
    expect(
      isDatabaseConstraintViolation(error, "EpgProgram_time_range_check"),
    ).toBe(false);
  });

  it("does not classify unrelated errors as constraint violations", () => {
    expect(
      isDatabaseConstraintViolation(
        new Error("EpgProgram_no_overlap_excl"),
        "EpgProgram_no_overlap_excl",
      ),
    ).toBe(false);
  });

  it("falls back safely when Prisma metadata cannot be serialized", () => {
    const circularMetadata: { self?: unknown } = {};
    circularMetadata.self = circularMetadata;
    const error = new Prisma.PrismaClientKnownRequestError(
      "EpgProgram_no_overlap_excl failed.",
      {
        code: "P2004",
        clientVersion: "test",
        meta: { database_error: circularMetadata },
      },
    );

    expect(
      isDatabaseConstraintViolation(error, "EpgProgram_no_overlap_excl"),
    ).toBe(true);
  });
});
