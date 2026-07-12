import { describe, expect, it } from "vitest";
import {
  validateCatalogLoadTarget,
  validateDestructiveDatabaseTarget,
} from "./destructive-operation-guard.js";

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

  it("accepts configurable local database names and generated test databases", () => {
    expect(
      validateDestructiveDatabaseTarget({
        NODE_ENV: "development",
        DEPLOYMENT_ENV: "local",
        DATABASE_URL:
          "postgresql://user:password@localhost:5432/customer_local?schema=public",
      }),
    ).toEqual({ databaseName: "customer_local", schemaName: "public" });

    expect(
      validateDestructiveDatabaseTarget({
        NODE_ENV: "test",
        DEPLOYMENT_ENV: "test",
        DATABASE_URL:
          "postgresql://user:password@127.0.0.1:5432/saatcms_test_1_abc?schema=public",
      }),
    ).toEqual({ databaseName: "saatcms_test_1_abc", schemaName: "public" });
  });

  it("accepts a configurable demo database with exact identity confirmation", () => {
    const environment = {
      NODE_ENV: "production",
      DEPLOYMENT_ENV: "demo",
      DATABASE_URL:
        "postgresql://user:secret@private-db/provider_generated_name?schema=public",
    };

    expect(() => validateDestructiveDatabaseTarget(environment)).toThrow(
      "DEMO_DATABASE_CONFIRMATION=private-db/provider_generated_name/public",
    );
    expect(
      validateDestructiveDatabaseTarget({
        ...environment,
        DEMO_DATABASE_CONFIRMATION:
          "private-db/provider_generated_name/public",
      }),
    ).toEqual({ databaseName: "provider_generated_name", schemaName: "public" });

    expect(() =>
      validateDestructiveDatabaseTarget({
        ...environment,
        DEMO_DATABASE_CONFIRMATION: "private-db/different_database/public",
      }),
    ).toThrow(
      "DEMO_DATABASE_CONFIRMATION=private-db/provider_generated_name/public",
    );
  });
});

describe("catalog load target guard", () => {
  it("requires a separately supplied catalog database URL", () => {
    expect(() => validateCatalogLoadTarget({
      DATABASE_URL: localUrl,
      CATALOG_DATABASE_TARGET: "local",
      NODE_ENV: "development",
    })).toThrow(/CATALOG_DATABASE_URL/);
  });

  it("accepts a guarded local catalog target", () => {
    expect(validateCatalogLoadTarget({
      CATALOG_DATABASE_URL: localUrl,
      CATALOG_DATABASE_TARGET: "local",
      NODE_ENV: "development",
    })).toEqual({
      databaseName: "saatcms",
      schemaName: "public",
      databaseUrl: localUrl,
      targetKind: "local",
    });
  });

  it("requires exact database and host identity for Render", () => {
    const renderUrl = "postgresql://user:secret@oregon-postgres.render.com/provider_db?schema=public";
    const environment = {
      CATALOG_DATABASE_URL: renderUrl,
      CATALOG_DATABASE_TARGET: "render",
    };
    expect(() => validateCatalogLoadTarget(environment)).toThrow(
      /CATALOG_EXPECTED_DATABASE=provider_db/,
    );
    expect(validateCatalogLoadTarget({
      ...environment,
      CATALOG_EXPECTED_DATABASE: "provider_db",
      CATALOG_RENDER_CONFIRMATION: "oregon-postgres.render.com/provider_db/public",
    })).toMatchObject({
      databaseName: "provider_db",
      targetKind: "render",
    });
  });
});
