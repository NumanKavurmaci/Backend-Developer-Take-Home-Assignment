import { Prisma, type PrismaClient } from "@prisma/client";
import type { DestructiveTarget } from "../../src/db/destructive-operation-guard.js";
import { assertConnectedToDestructiveTarget } from "../../src/db/destructive-operation-guard.js";
import type { ArtifactContentRow } from "./artifact-types.js";
import type { CatalogCounts } from "./types.js";
import {
  streamArtifactContentRows,
  streamArtifactGeoBlockRows,
  validateCatalogArtifact,
} from "./artifact-validator.js";

export interface CatalogLoadOptions {
  artifactDirectory: string;
  batchSize: number;
  transactionTimeoutMs: number;
  hardDatabaseGuardBytes: number;
  expectedTarget: DestructiveTarget;
  afterBatch?: (details: { kind: "content" | "geo-block"; inserted: number }) => void | Promise<void>;
}

export interface CatalogLoadReport {
  inserted: CatalogCounts;
  durationMs: number;
  verificationPassed: true;
  databaseName: string;
  databaseBytes: number;
  hardDatabaseGuardBytes: number;
}

interface DatabaseSizeRow {
  databaseName: string;
  databaseBytes: bigint;
}

export async function loadCatalogArtifact(
  prisma: PrismaClient,
  options: CatalogLoadOptions,
): Promise<CatalogLoadReport> {
  const startedAt = performance.now();
  const validation = await validateCatalogArtifact(options.artifactDirectory);
  const manifest = validation.manifest;
  if (manifest.estimatedDatabaseBytes > options.hardDatabaseGuardBytes) {
    throw new Error(
      `Catalog load preflight refused: artifact estimate ${manifest.estimatedDatabaseBytes} exceeds hard guard ${options.hardDatabaseGuardBytes}.`,
    );
  }
  await assertConnectedToDestructiveTarget(prisma, options.expectedTarget);

  const result = await prisma.$transaction(
    async (transaction) => {
      const preserved = await Promise.all([
        transaction.liveChannel.count(),
        transaction.epgProgram.count(),
        transaction.epgScheduleLock.count(),
      ]);
      await transaction.contentGeoBlockCountry.deleteMany();
      await transaction.content.updateMany({ data: { parentId: null } });
      await transaction.content.deleteMany();

      let insertedContent = 0;
      let contentBatch: Prisma.ContentCreateManyInput[] = [];
      let contentBatchType: ArtifactContentRow["type"] | undefined;
      const flushContentBatch = async (): Promise<void> => {
        if (contentBatch.length === 0) return;
        insertedContent += await insertContentBatch(transaction, contentBatch);
        contentBatch = [];
        await options.afterBatch?.({ kind: "content", inserted: insertedContent });
      };
      for await (const row of streamArtifactContentRows(options.artifactDirectory)) {
        if (contentBatchType !== undefined && row.type !== contentBatchType) {
          await flushContentBatch();
        }
        contentBatchType = row.type;
        contentBatch.push(toPrismaContent(row));
        if (contentBatch.length === options.batchSize) {
          await flushContentBatch();
        }
      }
      await flushContentBatch();

      let insertedGeoBlocks = 0;
      let geoBatch: Prisma.ContentGeoBlockCountryCreateManyInput[] = [];
      for await (const row of streamArtifactGeoBlockRows(options.artifactDirectory)) {
        geoBatch.push(row);
        if (geoBatch.length === options.batchSize) {
          insertedGeoBlocks += await insertGeoBatch(transaction, geoBatch);
          geoBatch = [];
          await options.afterBatch?.({ kind: "geo-block", inserted: insertedGeoBlocks });
        }
      }
      if (geoBatch.length > 0) {
        insertedGeoBlocks += await insertGeoBatch(transaction, geoBatch);
        await options.afterBatch?.({ kind: "geo-block", inserted: insertedGeoBlocks });
      }

      const [series, seasons, episodes, movies, geoBlocks, ...preservedAfter] =
        await Promise.all([
          transaction.content.count({ where: { type: "SERIES" } }),
          transaction.content.count({ where: { type: "SEASON" } }),
          transaction.content.count({ where: { type: "EPISODE" } }),
          transaction.content.count({ where: { type: "MOVIE" } }),
          transaction.contentGeoBlockCountry.count(),
          transaction.liveChannel.count(),
          transaction.epgProgram.count(),
          transaction.epgScheduleLock.count(),
        ]);
      const actualCounts: CatalogCounts = {
        content: insertedContent,
        series,
        seasons,
        episodes,
        movies,
        geoBlocks,
        derivedSeasons: manifest.counts.derivedSeasons,
      };
      if (
        (Object.keys(actualCounts) as Array<keyof CatalogCounts>).some(
          (key) => manifest.counts[key] !== actualCounts[key],
        )
      ) {
        throw new Error(
          `Catalog load verification failed: expected ${JSON.stringify(manifest.counts)}, received ${JSON.stringify(actualCounts)}.`,
        );
      }
      if (insertedGeoBlocks !== geoBlocks || preserved.some((count, index) => count !== preservedAfter[index])) {
        throw new Error("Catalog load verification failed: geo-block or Live Channel/EPG counts changed unexpectedly.");
      }
      const database = await measureDatabaseSize(transaction);
      if (database.databaseBytes > options.hardDatabaseGuardBytes) {
        throw new Error(
          `Catalog load rolled back: actual PostgreSQL size ${database.databaseBytes} exceeds hard guard ${options.hardDatabaseGuardBytes}.`,
        );
      }
      return { counts: actualCounts, database };
    },
    { maxWait: 30_000, timeout: options.transactionTimeoutMs },
  );

  return {
    inserted: result.counts,
    durationMs: Math.round(performance.now() - startedAt),
    verificationPassed: true,
    databaseName: result.database.databaseName,
    databaseBytes: result.database.databaseBytes,
    hardDatabaseGuardBytes: options.hardDatabaseGuardBytes,
  };
}

function toPrismaContent(row: ArtifactContentRow): Prisma.ContentCreateManyInput {
  return {
    ...row,
    premieredAt: row.premieredAt === null ? null : new Date(`${row.premieredAt}T00:00:00.000Z`),
    endedAt: row.endedAt === null ? null : new Date(`${row.endedAt}T00:00:00.000Z`),
    sourceMetadata: row.sourceMetadata === null
      ? Prisma.DbNull
      : row.sourceMetadata as Prisma.InputJsonValue,
  };
}

async function insertContentBatch(
  transaction: Prisma.TransactionClient,
  rows: Prisma.ContentCreateManyInput[],
): Promise<number> {
  return (await transaction.content.createMany({ data: rows })).count;
}

async function insertGeoBatch(
  transaction: Prisma.TransactionClient,
  rows: Prisma.ContentGeoBlockCountryCreateManyInput[],
): Promise<number> {
  return (await transaction.contentGeoBlockCountry.createMany({ data: rows })).count;
}

async function measureDatabaseSize(
  transaction: Prisma.TransactionClient,
): Promise<{ databaseName: string; databaseBytes: number }> {
  const [row] = await transaction.$queryRaw<DatabaseSizeRow[]>`
    SELECT current_database() AS "databaseName",
           pg_database_size(current_database())::bigint AS "databaseBytes"
  `;
  if (row === undefined) throw new Error("PostgreSQL returned no database size.");
  const databaseBytes = Number(row.databaseBytes);
  if (!Number.isSafeInteger(databaseBytes)) {
    throw new Error(`PostgreSQL returned an unsafe database size: ${row.databaseBytes}.`);
  }
  return { databaseName: row.databaseName, databaseBytes };
}
