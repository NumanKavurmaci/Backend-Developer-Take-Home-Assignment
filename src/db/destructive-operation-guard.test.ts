import { describe, expect, it } from "vitest";
import { validateDestructiveDatabaseTarget } from "./destructive-operation-guard.js";

const localUrl =
  "postgresql://user:password@localhost:5432/saatcms?schema=public";

describe("destructive database operation guard", () => {
  it.each([
    [{ NODE_ENV: "production", DATABASE_URL: localUrl }, "DEPLOYMENT_ENV"],
    [
      { NODE_ENV: "test", DEPLOYMENT_ENV: "tset", DATABASE_URL: localUrl },
      "DEPLOYMENT_ENV",
    ],
    [
      {
        NODE_ENV: "production",
        DEPLOYMENT_ENV: "production",
        DATABASE_URL:
          "postgresql://user:secret@db.example/saatcms?schema=public",
      },
      "DEPLOYMENT_ENV",
    ],
    [
      {
        NODE_ENV: "development",
        DEPLOYMENT_ENV: "local",
        DATABASE_URL:
          "postgresql://user:secret@db.example/saatcms?schema=public",
      },
      "loopback",
    ],
  ])(
    "rejects unsafe configuration before a client is needed: %#",
    (environment, message) => {
      expect(() => validateDestructiveDatabaseTarget(environment)).toThrow(
        message,
      );
    },
  );

  it("accepts the exact local and generated test allowlists", () => {
    expect(
      validateDestructiveDatabaseTarget({
        NODE_ENV: "development",
        DEPLOYMENT_ENV: "local",
        DATABASE_URL: localUrl,
      }),
    ).toEqual({ databaseName: "saatcms", schemaName: "public" });

    expect(
      validateDestructiveDatabaseTarget({
        NODE_ENV: "test",
        DEPLOYMENT_ENV: "test",
        DATABASE_URL:
          "postgresql://user:password@127.0.0.1:5432/saatcms_test_1_abc?schema=public",
      }),
    ).toEqual({ databaseName: "saatcms_test_1_abc", schemaName: "public" });
  });

  it("requires production demo confirmation tied to database identity", () => {
    const environment = {
      NODE_ENV: "production",
      DEPLOYMENT_ENV: "demo",
      DATABASE_URL: "postgresql://user:secret@private-db/saatcms?schema=public",
    };

    expect(() => validateDestructiveDatabaseTarget(environment)).toThrow(
      "DEMO_DATABASE_CONFIRMATION=private-db/saatcms/public",
    );
    expect(
      validateDestructiveDatabaseTarget({
        ...environment,
        DEMO_DATABASE_CONFIRMATION: "private-db/saatcms/public",
      }),
    ).toEqual({ databaseName: "saatcms", schemaName: "public" });
  });
});
