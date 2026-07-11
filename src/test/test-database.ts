import initSqlJs from "sql.js";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PrismaClient } from "@prisma/client";

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const envLinePattern = /^DATABASE_URL=(?:"([^"]+)"|'([^']+)'|(.+))$/m;

export async function readTestDatabaseUrl(): Promise<string> {
  return readDatabaseUrlFromEnvFile(".env.test");
}

export async function configureTestDatabaseUrl(): Promise<void> {
  process.env.DATABASE_URL = await readTestDatabaseUrl();
}

export async function recreateTestDatabase(): Promise<void> {
  const databaseUrl = await readTestDatabaseUrl();
  assertUsingTestDatabase(databaseUrl);

  const databasePath = resolveSqlitePath(databaseUrl);
  await rm(databasePath, { force: true });
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
}

export async function removeTestDatabase(): Promise<void> {
  const databaseUrl = await readTestDatabaseUrl();
  assertUsingTestDatabase(databaseUrl);

  await rm(resolveSqlitePath(databaseUrl), { force: true });
}

export function assertUsingTestDatabase(
  databaseUrl = process.env.DATABASE_URL,
): void {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL must be set before running database tests.");
  }

  const databasePath = resolveSqlitePath(databaseUrl);
  const expectedTestPath = resolveSqlitePath("file:../data/test.db");

  if (databasePath !== expectedTestPath) {
    throw new Error(
      `Refusing to run destructive test cleanup against non-test database: ${databasePath}`,
    );
  }
}

export async function clearContentTables(prisma: PrismaClient): Promise<void> {
  assertUsingTestDatabase();

  await prisma.contentGeoBlockCountry.deleteMany();
  await prisma.content.updateMany({ data: { parentId: null } });
  await prisma.content.deleteMany();
}

export async function clearLiveChannelTables(
  prisma: PrismaClient,
): Promise<void> {
  assertUsingTestDatabase();

  await prisma.epgProgram.deleteMany();
  await prisma.epgScheduleLock.deleteMany();
  await prisma.liveChannel.deleteMany();
}

async function readDatabaseUrlFromEnvFile(fileName: string): Promise<string> {
  const envPath = path.join(rootDir, fileName);

  if (!existsSync(envPath)) {
    throw new Error(`${fileName} is missing.`);
  }

  const envText = await readFile(envPath, "utf8");
  const match = envText.match(envLinePattern);
  const databaseUrl = match?.[1] ?? match?.[2] ?? match?.[3]?.trim();

  if (!databaseUrl) {
    throw new Error(`DATABASE_URL is missing from ${fileName}.`);
  }

  return databaseUrl;
}

function resolveSqlitePath(databaseUrl: string): string {
  if (!databaseUrl.startsWith("file:")) {
    throw new Error("Only SQLite file: DATABASE_URL values are supported.");
  }

  return path.resolve(rootDir, "prisma", databaseUrl.slice("file:".length));
}

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
