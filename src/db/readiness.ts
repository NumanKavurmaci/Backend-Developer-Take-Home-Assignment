import type { Prisma, PrismaClient } from "@prisma/client";

type QueryClient = PrismaClient | Prisma.TransactionClient;

export const LATEST_EXPECTED_MIGRATION =
  "20260712220000_add_content_catalog_fields";
const REQUIRED_RELATIONS = [
  "Content",
  "ContentGeoBlockCountry",
  "LiveChannel",
  "EpgProgram",
  "EpgScheduleLock",
] as const;

export async function assertDatabaseReady(
  prisma: PrismaClient,
  timeoutMs = 2_000,
): Promise<void> {
  await prisma.$transaction(
    async (transaction) => {
      await transaction.$executeRawUnsafe(
        `SET LOCAL statement_timeout = ${Math.max(1, Math.floor(timeoutMs))}`,
      );
      await assertRelationsExist(transaction);
      await assertMigrationHistoryReady(transaction);
    },
    { timeout: timeoutMs + 1_000 },
  );
}

async function assertRelationsExist(prisma: QueryClient): Promise<void> {
  const relationNames = [...REQUIRED_RELATIONS];
  const rows = await prisma.$queryRaw<
    Array<{ relationName: string; relation: string | null }>
  >`
    SELECT name AS "relationName", to_regclass(format('%I.%I', current_schema(), name))::text AS relation
    FROM unnest(${relationNames}::text[]) AS required(name)
  `;
  const missing = rows.filter(({ relation }) => relation === null);

  if (missing.length > 0) {
    throw new Error(
      `Database schema is missing required relations: ${missing.map(({ relationName }) => relationName).join(", ")}.`,
    );
  }
}

async function assertMigrationHistoryReady(prisma: QueryClient): Promise<void> {
  const [status] = await prisma.$queryRaw<
    Array<{ expectedCompleted: boolean; invalidMigrationCount: bigint }>
  >`
    SELECT
      EXISTS (
        SELECT 1 FROM "_prisma_migrations"
        WHERE migration_name = ${LATEST_EXPECTED_MIGRATION}
          AND finished_at IS NOT NULL
          AND rolled_back_at IS NULL
      ) AS "expectedCompleted",
      COUNT(*) FILTER (
        WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL
      ) AS "invalidMigrationCount"
    FROM "_prisma_migrations"
  `;

  if (!status?.expectedCompleted || status.invalidMigrationCount > 0n) {
    throw new Error(
      "Database migration history is incomplete, failed, or rolled back.",
    );
  }
}
