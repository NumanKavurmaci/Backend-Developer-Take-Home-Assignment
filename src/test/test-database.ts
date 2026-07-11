import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import type { PrismaClient } from "@prisma/client";

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
  process.env.DATABASE_URL = await readTestDatabaseUrl();
}

export async function recreateTestDatabase(): Promise<void> {
  const databaseUrl = await readTestDatabaseUrl();
  assertUsingTestDatabase(databaseUrl);
  await resetTestDatabase(databaseUrl);
}

export async function removeTestDatabase(): Promise<void> {
  const databaseUrl = await readTestDatabaseUrl();
  assertUsingTestDatabase(databaseUrl);
  await resetTestDatabase(databaseUrl);
}

export function assertUsingTestDatabase(
  databaseUrl = process.env.DATABASE_URL,
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
  const isTestDatabase = parsedUrl.pathname === "/saatcms_test";

  if (!isPostgreSql || !isLocalHost || !isTestDatabase) {
    throw new Error(
      "Refusing to run destructive test cleanup against a non-local or non-test PostgreSQL database.",
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

async function resetTestDatabase(databaseUrl: string): Promise<void> {
  const prismaCliPath = path.join(
    rootDir,
    "node_modules",
    "prisma",
    "build",
    "index.js",
  );

  await execFileAsync(
    process.execPath,
    [prismaCliPath, "migrate", "reset", "--force", "--skip-seed"],
    {
      cwd: rootDir,
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
      },
    },
  );
}
