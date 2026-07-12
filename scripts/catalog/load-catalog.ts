import { loadEnvFile } from "node:process";
import { PrismaClient } from "@prisma/client";
import { validateCatalogLoadTarget } from "../../src/db/destructive-operation-guard.js";
import { readCatalogLoaderConfiguration } from "./catalog-loader-config.js";
import { loadCatalogArtifact } from "./catalog-loader.js";

async function main(): Promise<void> {
  loadEnvironmentFileIfPresent();
  const configuration = readCatalogLoaderConfiguration();
  const target = validateCatalogLoadTarget();
  const prisma = new PrismaClient({ datasources: { db: { url: target.databaseUrl } } });
  try {
    const report = await loadCatalogArtifact(prisma, {
      ...configuration,
      expectedTarget: target,
      afterBatch: ({ kind, inserted }) => {
        process.stderr.write(`[catalog-load] ${kind} inserted=${inserted}\n`);
      },
    });
    console.log(JSON.stringify({ loaded: true, target: target.targetKind, ...report }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

function loadEnvironmentFileIfPresent(): void {
  try {
    loadEnvFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Catalog load failed.");
  process.exitCode = 1;
});
