import { execFile } from "node:child_process";
import path from "node:path";
import { loadEnvFile } from "node:process";
import { promisify } from "node:util";
import { PrismaClient } from "@prisma/client";
import {
  assertConnectedToDestructiveTarget,
  validateDestructiveDatabaseTarget,
} from "../src/db/destructive-operation-guard.js";

const execFileAsync = promisify(execFile);

async function main(): Promise<void> {
  try {
    loadEnvFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  const target = validateDestructiveDatabaseTarget();
  const prisma = new PrismaClient();

  try {
    await assertConnectedToDestructiveTarget(prisma, target);
  } finally {
    await prisma.$disconnect();
  }

  const prismaCliPath = path.resolve(
    "node_modules",
    "prisma",
    "build",
    "index.js",
  );
  await execFileAsync(
    process.execPath,
    [prismaCliPath, "migrate", "reset", "--force", "--skip-seed"],
    { cwd: process.cwd(), env: process.env },
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
