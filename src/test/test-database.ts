import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import type { PrismaClient } from "@prisma/client";
import { isGeneratedTestDatabaseName } from "../db/destructive-operation-guard.js";

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const envLinePattern = /^DATABASE_URL=(?:"([^"]+)"|'([^']+)'|(.+))$/m;
const execFileAsync = promisify(execFile);

export async function readTestDatabaseUrl(): Promise<string> {
  return readDatabaseUrlFromEnvFile(".env.test");
}

export async function configureTestDatabaseUrl(): Promise<void> {
  if (!process.env.NODE_ENV) {
    process.env.NODE_ENV = "test";
  }

  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = await readTestDatabaseUrl();
  }
}

export async function provisionIsolatedTestDatabase(): Promise<
  () => Promise<void>
> {
  const baseDatabaseUrl = await getTestDatabaseUrl();
  assertUsingTestDatabase(baseDatabaseUrl);
  const databaseName =
    `saatcms_test_${process.pid}_${randomUUID().replaceAll("-", "")}`.toLowerCase();
  const databaseUrl = replaceDatabaseName(baseDatabaseUrl, databaseName);
  const maintenanceUrl = replaceDatabaseName(baseDatabaseUrl, "postgres");
  const { PrismaClient } = await import("@prisma/client");
  const maintenance = new PrismaClient({
    datasources: { db: { url: maintenanceUrl } },
  });

  try {
    await maintenance.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`);
  } finally {
    await maintenance.$disconnect();
  }

  process.env.DATABASE_URL = databaseUrl;
  process.env.DEPLOYMENT_ENV = "test";

  try {
    await migrateTestDatabase(databaseUrl);
  } catch (error) {
    await dropGeneratedTestDatabase(maintenanceUrl, databaseName);
    throw error;
  }

  return async () => {
    await dropGeneratedTestDatabase(maintenanceUrl, databaseName);
  };
}

export function assertUsingTestDatabase(
  databaseUrl = process.env.DATABASE_URL,
  nodeEnvironment = process.env.NODE_ENV,
): void {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL must be set before running database tests.");
  }

  let parsedUrl: URL;

  try {
    parsedUrl = new URL(databaseUrl);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL URL.");
  }

  const isPostgreSql = ["postgres:", "postgresql:"].includes(
    parsedUrl.protocol,
  );
  const isLocalHost = ["localhost", "127.0.0.1", "::1"].includes(
    parsedUrl.hostname,
  );
  const databaseName = decodeURIComponent(parsedUrl.pathname.slice(1));
  const isTestDatabase = /^saatcms_test(?:_[a-z0-9_]+)?$/.test(databaseName);
  const isTestEnvironment = nodeEnvironment === "test";

  if (!isPostgreSql || !isLocalHost || !isTestDatabase || !isTestEnvironment) {
    throw new Error(
      "Refusing to run destructive test cleanup outside a local saatcms_test* PostgreSQL database in NODE_ENV=test.",
    );
  }
}

export async function clearContentTables(prisma: PrismaClient): Promise<void> {
  await assertConnectedToTestDatabase(prisma);

  await prisma.contentGeoBlockCountry.deleteMany();
  await prisma.content.updateMany({ data: { parentId: null } });
  await prisma.content.deleteMany();
}

export async function clearLiveChannelTables(
  prisma: PrismaClient,
): Promise<void> {
  await assertConnectedToTestDatabase(prisma);

  await prisma.epgProgram.deleteMany();
  await prisma.epgScheduleLock.deleteMany();
  await prisma.liveChannel.deleteMany();
}

export async function clearTestTables(
  prisma: PrismaClient,
  databaseUrl = process.env.DATABASE_URL,
): Promise<void> {
  await assertConnectedToTestDatabase(prisma, databaseUrl);

  await prisma.$transaction([
    prisma.epgProgram.deleteMany(),
    prisma.epgScheduleLock.deleteMany(),
    prisma.liveChannel.deleteMany(),
    prisma.contentGeoBlockCountry.deleteMany(),
    prisma.content.updateMany({ data: { parentId: null } }),
    prisma.content.deleteMany(),
  ]);
}

export async function assertConnectedToTestDatabase(
  prisma: PrismaClient,
  databaseUrl = process.env.DATABASE_URL,
): Promise<void> {
  assertUsingTestDatabase(databaseUrl);

  const parsedUrl = new URL(databaseUrl!);
  const expectedSchema = parsedUrl.searchParams.get("schema") ?? "public";
  const [connection] = await prisma.$queryRaw<
    Array<{ databaseName: string; schemaName: string }>
  >`SELECT current_database() AS "databaseName", current_schema() AS "schemaName"`;

  if (
    connection?.databaseName !==
      decodeURIComponent(parsedUrl.pathname.slice(1)) ||
    connection.schemaName !== expectedSchema
  ) {
    throw new Error(
      "Refusing destructive cleanup because the connected PostgreSQL database or schema does not match the guarded test URL.",
    );
  }
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

async function getTestDatabaseUrl(): Promise<string> {
  return process.env.DATABASE_URL ?? readTestDatabaseUrl();
}

async function migrateTestDatabase(databaseUrl: string): Promise<void> {
  const prismaCliPath = path.join(
    rootDir,
    "node_modules",
    "prisma",
    "build",
    "index.js",
  );

  await execFileAsync(process.execPath, [prismaCliPath, "migrate", "deploy"], {
    cwd: rootDir,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
    },
  });
}

function replaceDatabaseName(
  databaseUrl: string,
  databaseName: string,
): string {
  const parsedUrl = new URL(databaseUrl);
  parsedUrl.pathname = `/${databaseName}`;
  parsedUrl.searchParams.set("schema", "public");
  return parsedUrl.toString();
}

async function dropGeneratedTestDatabase(
  maintenanceUrl: string,
  databaseName: string,
): Promise<void> {
  if (!isGeneratedTestDatabaseName(databaseName)) {
    throw new Error(
      "Refusing to drop a database without the generated test prefix.",
    );
  }

  const { PrismaClient } = await import("@prisma/client");
  const maintenance = new PrismaClient({
    datasources: { db: { url: maintenanceUrl } },
  });

  try {
    await maintenance.$queryRawUnsafe(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${databaseName}' AND pid <> pg_backend_pid()`,
    );
    await maintenance.$executeRawUnsafe(
      `DROP DATABASE IF EXISTS "${databaseName}"`,
    );
  } finally {
    await maintenance.$disconnect();
  }
}
