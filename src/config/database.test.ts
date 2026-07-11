import { describe, expect, it } from "vitest";
import { validateDatabaseUrl } from "./database.js";

describe("database configuration", () => {
  it("accepts a PostgreSQL connection URL", () => {
    expect(
      validateDatabaseUrl(
        "postgresql://user:password@localhost:5432/saatcms?schema=public",
      ),
    ).toBe(
      "postgresql://user:password@localhost:5432/saatcms?schema=public",
    );
  });

  it("fails clearly when DATABASE_URL is missing", () => {
    expect(() => validateDatabaseUrl(undefined)).toThrow(
      "DATABASE_URL is required. Set it to a PostgreSQL connection URL.",
    );
  });

  it.each([
    ["not a URL", "DATABASE_URL is malformed"],
    ["file:../data/dev.db", "DATABASE_URL must use"],
    ["postgresql:///saatcms", "DATABASE_URL must include"],
    ["postgresql://localhost", "DATABASE_URL must include"],
  ])("rejects malformed database URL %s", (databaseUrl, message) => {
    expect(() => validateDatabaseUrl(databaseUrl)).toThrow(message);
  });
});

