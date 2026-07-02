import initSqlJs from "sql.js";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const reset = process.argv.includes("--reset");
const DATABASE_URL_ENV_LINE_PATTERN =
  /^DATABASE_URL=(?:"([^"]+)"|'([^']+)'|(.+))$/m;

// Reads DATABASE_URL without needing dotenv for this small setup script.
async function readDatabaseUrlFromEnvFile(): Promise<string | undefined> {
  const envPath = path.join(rootDir, ".env");

  if (!existsSync(envPath)) {
    return undefined;
  }

  const envText = await readFile(envPath, "utf8");
  const match = envText.match(DATABASE_URL_ENV_LINE_PATTERN);
  return match?.[1] ?? match?.[2] ?? match?.[3]?.trim();
}

// Prisma resolves SQLite file URLs from prisma/, so this mirrors that behavior.
function resolveSqlitePath(databaseUrl: string): string {
  if (!databaseUrl.startsWith("file:")) {
    throw new Error(
      "Only SQLite file: DATABASE_URL values are supported by this local setup script.",
    );
  }

  const sqlitePath = databaseUrl.slice("file:".length);
  return path.resolve(rootDir, "prisma", sqlitePath);
}

// Concatenates committed SQL migrations for the local sql.js database builder.
async function readMigrationSql(): Promise<string> {
  const migrationsDir = path.join(rootDir, "prisma", "migrations");
  const migrationDirs = (await readdir(migrationsDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  if (migrationDirs.length === 0) {
    throw new Error("No migration directories found under prisma/migrations.");
  }

  const statements = [];

  for (const migrationDir of migrationDirs) {
    const migrationPath = path.join(
      migrationsDir,
      migrationDir,
      "migration.sql",
    );
    if (existsSync(migrationPath)) {
      statements.push(await readFile(migrationPath, "utf8"));
    }
  }

  if (statements.length === 0) {
    throw new Error("No migration.sql files found under prisma/migrations.");
  }

  return statements.join("\n\n");
}

async function main() {
  const databaseUrl =
    process.env.DATABASE_URL ?? (await readDatabaseUrlFromEnvFile());

  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is missing. Copy .env.example to .env or set DATABASE_URL.",
    );
  }

  const databasePath = resolveSqlitePath(databaseUrl);

  if (existsSync(databasePath) && !reset) {
    console.log(`SQLite database already exists at ${databasePath}`);
    console.log("Use npm run db:reset to recreate it from migrations.");
    return;
  }

  if (reset) {
    await rm(databasePath, { force: true });
  }

  await mkdir(path.dirname(databasePath), { recursive: true });

  const SQL = await initSqlJs({
    locateFile: (file) =>
      path.join(rootDir, "node_modules", "sql.js", "dist", file),
  });
  const db = new SQL.Database();

  db.run("PRAGMA foreign_keys = OFF;");
  db.run(await readMigrationSql());
  db.run("PRAGMA foreign_keys = ON;");

  await writeFile(databasePath, Buffer.from(db.export()));
  db.close();

  console.log(`SQLite database created at ${databasePath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
