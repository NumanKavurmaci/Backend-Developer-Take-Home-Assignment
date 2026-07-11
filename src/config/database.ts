import { loadEnvFile } from "node:process";

const POSTGRESQL_PROTOCOLS = new Set(["postgres:", "postgresql:"]);

export function validateDatabaseUrl(databaseUrl: string | undefined): string {
  if (!databaseUrl?.trim()) {
    throw new Error(
      "DATABASE_URL is required. Set it to a PostgreSQL connection URL.",
    );
  }

  let parsedUrl: URL;

  try {
    parsedUrl = new URL(databaseUrl);
  } catch {
    throw new Error(
      "DATABASE_URL is malformed. Expected a PostgreSQL connection URL.",
    );
  }

  if (!POSTGRESQL_PROTOCOLS.has(parsedUrl.protocol)) {
    throw new Error(
      "DATABASE_URL must use the postgresql:// or postgres:// protocol.",
    );
  }

  if (!parsedUrl.hostname || !parsedUrl.pathname.slice(1)) {
    throw new Error(
      "DATABASE_URL must include a PostgreSQL host and database name.",
    );
  }

  return databaseUrl;
}

export function readDatabaseUrl(): string {
  if (!process.env.DATABASE_URL) {
    try {
      loadEnvFile();
    } catch (error) {
      const errorCode = (error as NodeJS.ErrnoException).code;

      if (errorCode !== "ENOENT") {
        throw error;
      }
    }
  }

  return validateDatabaseUrl(process.env.DATABASE_URL);
}
