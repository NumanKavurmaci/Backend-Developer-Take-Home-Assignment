import { loadEnvFile } from "node:process";
import type { Prisma, PrismaClient } from "@prisma/client";
import {
  buildAdvancedCatalog,
  readAdvancedSeedConfig,
} from "./catalog/build.js";
import type { BuiltCatalog } from "./catalog/types.js";
import { seedDemoData } from "../prisma/seed.js";

const WRITE_CONFIRMATION_FLAG = "--replace-demo";
const CONTENT_BATCH_SIZE = 1_000;
const METADATA_BATCH_SIZE = 500;
const GEO_BLOCK_BATCH_SIZE = 2_000;
const DATABASE_HARD_LIMIT_BYTES = 250 * 1024 * 1024;

async function main(): Promise<void> {
  loadEnvironmentFileIfPresent();
  const argumentsList = process.argv.slice(2);
  const explicitlyRequested = argumentsList.includes(WRITE_CONFIRMATION_FLAG);
  const config = readAdvancedSeedConfig(
    argumentsList.filter((argument) => argument !== WRITE_CONFIRMATION_FLAG),
  );

  console.log(
    JSON.stringify(
      {
        phase: "catalog-build-started",
        targetContent: config.targetContent,
        maximumEstimatedDatabaseBytes: config.maxEstimatedDatabaseBytes,
        cacheDir: config.cacheDir,
        offline: config.offline,
        dryRun: config.dryRun,
      },
      null,
      2,
    ),
  );

  const catalog = await buildAdvancedCatalog(config);
  printCatalogSummary("catalog-built", catalog);

  if (config.dryRun) {
    return;
  }

  if (!explicitlyRequested) {
    throw new Error(
      `Advanced seed refused. This operation replaces demo data and must include ${WRITE_CONFIRMATION_FLAG}.`,
    );
  }

  const { prisma } = await import("../src/db/client.js");

  try {
    await seedAdvancedCatalog(prisma, catalog);
    const actualDatabaseBytes = await readDatabaseSize(prisma);

    printCatalogSummary("catalog-seeded", catalog, actualDatabaseBytes);

    if (actualDatabaseBytes > DATABASE_HARD_LIMIT_BYTES) {
      console.warn(
        `WARNING: PostgreSQL reports ${actualDatabaseBytes} bytes, above the documented 250 MiB storage budget. Re-run with a smaller --target-content value.`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

export async function seedAdvancedCatalog(
  prisma: PrismaClient,
  catalog: BuiltCatalog,
): Promise<void> {
  // The guarded demo seed first replaces all application data and preserves the
  // hand-crafted acceptance-criteria fixtures. Source fetching and validation
  // have already completed, so network errors cannot leave a half-empty DB.
  await seedDemoData(prisma);

  await prisma.$transaction(
    async (transaction) => {
      const roots = catalog.content.filter(
        (row) => row.type === "SERIES" || row.type === "MOVIE",
      );
      const seasons = catalog.content.filter((row) => row.type === "SEASON");
      const episodes = catalog.content.filter((row) => row.type === "EPISODE");

      await createContentBatches(transaction, roots);
      await createContentBatches(transaction, seasons);
      await createContentBatches(transaction, episodes);

      for (const rows of chunk(catalog.metadata, METADATA_BATCH_SIZE)) {
        await transaction.catalogMetadata.createMany({
          data: rows.map((row) => ({
            contentId: row.contentId,
            source: row.source,
            sourceId: row.sourceId,
            sourceUrl: row.sourceUrl,
            originalTitle: row.originalTitle,
            summary: row.summary,
            language: row.language,
            status: row.status,
            countryCode: row.countryCode,
            networkName: row.networkName,
            officialSiteUrl: row.officialSiteUrl,
            imageUrl: row.imageUrl,
            premieredAt: row.premieredAt,
            endedAt: row.endedAt,
            runtimeMinutes: row.runtimeMinutes,
            seasonNumber: row.seasonNumber,
            episodeNumber: row.episodeNumber,
            ratingAverage: row.ratingAverage,
            genres: row.genres,
            sourceMetadata: row.sourceMetadata as Prisma.InputJsonValue,
          })),
        });
      }

      for (const rows of chunk(catalog.geoBlocks, GEO_BLOCK_BATCH_SIZE)) {
        await transaction.contentGeoBlockCountry.createMany({ data: rows });
      }

      await transaction.catalogSeedManifest.create({
        data: {
          id: "advanced-catalog-current",
          sources: catalog.sources as unknown as Prisma.InputJsonValue,
          configuration: serializableConfiguration(catalog) as Prisma.InputJsonValue,
          counts: catalog.counts as unknown as Prisma.InputJsonValue,
          normalizedBytes: BigInt(catalog.normalizedBytes),
          estimatedDatabaseBytes: BigInt(catalog.estimatedDatabaseBytes),
        },
      });

      const [contentCount, metadataCount, manifestCount, geoBlockCount] =
        await Promise.all([
          transaction.content.count(),
          transaction.catalogMetadata.count(),
          transaction.catalogSeedManifest.count(),
          transaction.contentGeoBlockCountry.count(),
        ]);
      const expected = {
        contentCount: catalog.counts.content + 6,
        metadataCount: catalog.counts.metadata,
        manifestCount: 1,
        geoBlockCount: catalog.counts.geoBlocks + 4,
      };
      const actual = {
        contentCount,
        metadataCount,
        manifestCount,
        geoBlockCount,
      };

      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(
          `Advanced seed verification failed inside transaction: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}.`,
        );
      }
    },
    { maxWait: 30_000, timeout: 15 * 60_000 },
  );
}

async function createContentBatches(
  transaction: Prisma.TransactionClient,
  rows: BuiltCatalog["content"],
): Promise<void> {
  for (const batch of chunk(rows, CONTENT_BATCH_SIZE)) {
    await transaction.content.createMany({ data: batch });
  }
}

function serializableConfiguration(catalog: BuiltCatalog): Record<string, unknown> {
  return {
    ...catalog.configuration,
    // The cache location is machine-local and not useful as durable provenance.
    cacheDir: undefined,
  };
}

async function readDatabaseSize(prisma: PrismaClient): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ bytes: bigint }>>`
    SELECT pg_database_size(current_database())::bigint AS bytes
  `;
  const bytes = rows[0]?.bytes;

  if (bytes === undefined) {
    throw new Error("PostgreSQL did not return the database size.");
  }

  const value = Number(bytes);

  if (!Number.isSafeInteger(value)) {
    throw new Error(`Database size cannot be represented safely: ${bytes}`);
  }

  return value;
}

function printCatalogSummary(
  phase: string,
  catalog: BuiltCatalog,
  actualDatabaseBytes?: number,
): void {
  console.log(
    JSON.stringify(
      {
        phase,
        counts: catalog.counts,
        sources: catalog.sources,
        normalizedBytes: catalog.normalizedBytes,
        estimatedDatabaseBytes: catalog.estimatedDatabaseBytes,
        actualDatabaseBytes,
      },
      null,
      2,
    ),
  );
}

function chunk<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];

  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }

  return chunks;
}

function loadEnvironmentFileIfPresent(): void {
  try {
    loadEnvFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
