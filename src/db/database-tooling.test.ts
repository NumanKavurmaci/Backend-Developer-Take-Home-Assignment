import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const rootDir = process.cwd();
const prisma = new PrismaClient();

afterAll(async () => {
  await prisma.$disconnect();
});

describe("PostgreSQL database tooling", () => {
  it("uses standard Prisma commands without SQLite dependencies", async () => {
    const packageJson = JSON.parse(
      await readFile(path.join(rootDir, "package.json"), "utf8"),
    ) as {
      scripts: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    expect(packageJson.scripts).toMatchObject({
      "db:generate": "prisma generate",
      "db:migrate": "prisma migrate dev",
      "db:migrate:deploy": "prisma migrate deploy",
      "db:reset": "prisma migrate reset",
      "db:seed": "tsx prisma/seed.ts",
      "db:check": "tsx src/db/check.ts",
    });
    expect(packageJson.dependencies).not.toHaveProperty("sql.js");
    expect(packageJson.devDependencies).not.toHaveProperty("sql.js");
    expect(packageJson.devDependencies).not.toHaveProperty("@types/sql.js");
  });

  it("contains no active SQLite setup assumptions", async () => {
    const files = await sourceFiles(["src", "scripts"]);
    const activeFiles = files.filter((file) => !file.endsWith(".test.ts"));
    const contents = await Promise.all(
      activeFiles.map((file) => readFile(file, "utf8")),
    );

    expect(contents.join("\n")).not.toMatch(
      /sql\.js|resolveSqlitePath|DATABASE_URL\.startsWith\(["']file:/i,
    );
  });

  it("db:check succeeds with the configured PostgreSQL connection", async () => {
    const result = await runNpmCommand("db:check", process.env.DATABASE_URL);

    expect(result.stdout).toContain('"database": "connected"');
  });

  it("db:migrate:deploy applies migrations without deleting existing data", async () => {
    const channelId = "channel-migrate-deploy-marker";

    await prisma.liveChannel.deleteMany({ where: { id: channelId } });
    await prisma.liveChannel.create({
      data: {
        id: channelId,
        name: "Migration Deploy Marker",
        slug: "migration-deploy-marker",
      },
    });

    try {
      await runNpmCommand("db:migrate:deploy", process.env.DATABASE_URL);

      await expect(
        prisma.liveChannel.findUnique({ where: { id: channelId } }),
      ).resolves.not.toBeNull();
    } finally {
      await prisma.liveChannel.deleteMany({ where: { id: channelId } });
    }
  }, 30_000);

  it("db:check fails with an invalid PostgreSQL connection", async () => {
    await expect(
      runNpmCommand(
        "db:check",
        "postgresql://invalid:invalid@127.0.0.1:1/missing?connect_timeout=1",
      ),
    ).rejects.toThrow();
  });
});

async function sourceFiles(relativeDirectories: string[]): Promise<string[]> {
  const results: string[] = [];

  for (const relativeDirectory of relativeDirectories) {
    const directory = path.join(rootDir, relativeDirectory);
    const entries = await readdir(directory, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        results.push(...(await sourceFiles([path.relative(rootDir, entryPath)])));
      } else if (entry.name.endsWith(".ts")) {
        results.push(entryPath);
      }
    }
  }

  return results;
}

function runNpmCommand(script: string, databaseUrl: string | undefined) {
  const npmCliPath = process.env.npm_execpath;

  if (!npmCliPath) {
    throw new Error("npm_execpath is required to test npm database commands.");
  }

  return execFileAsync(process.execPath, [npmCliPath, "run", script], {
    cwd: rootDir,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    timeout: 15_000,
  });
}
