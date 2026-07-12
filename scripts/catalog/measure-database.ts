import { prisma } from "../../src/db/client.js";
import { readCatalogLimits } from "./config.js";

interface SizeRow { database_name: string; database_bytes: bigint }
interface TableSizeRow { table_name: string; table_total_bytes: bigint; table_bytes: bigint; index_bytes: bigint }

export async function measureDatabase(): Promise<void> {
  const limits = readCatalogLimits();
  const [databaseRows, tableRows] = await Promise.all([
    prisma.$queryRaw<SizeRow[]>`SELECT current_database() AS database_name, pg_database_size(current_database())::bigint AS database_bytes`,
    prisma.$queryRaw<TableSizeRow[]>`SELECT schemaname || '.' || relname AS table_name, pg_total_relation_size(relid)::bigint AS table_total_bytes, pg_relation_size(relid)::bigint AS table_bytes, pg_indexes_size(relid)::bigint AS index_bytes FROM pg_catalog.pg_statio_user_tables ORDER BY pg_total_relation_size(relid) DESC, relname`,
  ]);
  const database = databaseRows[0];
  if (database === undefined) throw new Error("PostgreSQL returned no database size.");
  const databaseBytes = toSafeNumber(database.database_bytes);
  console.log(JSON.stringify({
    measuredAt: new Date().toISOString(), databaseName: database.database_name, databaseBytes,
    hardGuardBytes: limits.maxEstimatedDatabaseBytes, withinHardGuard: databaseBytes <= limits.maxEstimatedDatabaseBytes,
    headroomWithinGuardBytes: limits.maxEstimatedDatabaseBytes - databaseBytes,
    tables: tableRows.map((row) => ({ tableName: row.table_name, tableTotalBytes: toSafeNumber(row.table_total_bytes), tableBytes: toSafeNumber(row.table_bytes), indexBytes: toSafeNumber(row.index_bytes) })),
  }, null, 2));
}

function toSafeNumber(value: bigint): number { const number = Number(value); if (!Number.isSafeInteger(number)) throw new Error(`Unsafe PostgreSQL size: ${value}.`); return number; }

measureDatabase().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => prisma.$disconnect());
