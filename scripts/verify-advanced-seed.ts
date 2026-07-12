import { prisma } from "../src/db/client.js";

interface CountRow {
  key: string;
  count: bigint;
}

interface AdvancedCounts {
  content: number;
  series: number;
  seasons: number;
  episodes: number;
  movies: number;
  metadata: number;
  geoBlocks: number;
}

const DATABASE_HARD_LIMIT_BYTES = 250 * 1024 * 1024;

async function main(): Promise<void> {
  const manifest = await prisma.catalogSeedManifest.findUnique({
    where: { id: "advanced-catalog-current" },
  });

  if (manifest === null) {
    throw new Error(
      "Advanced catalog manifest is missing. Run npm run db:seed:advanced first.",
    );
  }

  const expected = readCounts(manifest.counts);
  const [contentRows, sourceRows, geoBlockRows, databaseSizeRows] =
    await Promise.all([
      prisma.$queryRaw<CountRow[]>`
        SELECT c."type" AS key, COUNT(*)::bigint AS count
        FROM "Content" c
        INNER JOIN "CatalogMetadata" m ON m."contentId" = c."id"
        GROUP BY c."type"
      `,
      prisma.$queryRaw<CountRow[]>`
        SELECT m."source" AS key, COUNT(*)::bigint AS count
        FROM "CatalogMetadata" m
        GROUP BY m."source"
      `,
      prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS count
        FROM "ContentGeoBlockCountry" g
        INNER JOIN "CatalogMetadata" m ON m."contentId" = g."contentId"
      `,
      prisma.$queryRaw<Array<{ bytes: bigint }>>`
        SELECT pg_database_size(current_database())::bigint AS bytes
      `,
    ]);

  const contentCounts = new Map(
    contentRows.map((row) => [row.key, toSafeNumber(row.count)]),
  );
  const sourceCounts = Object.fromEntries(
    sourceRows.map((row) => [row.key, toSafeNumber(row.count)]),
  );
  const actual: AdvancedCounts = {
    content: [...contentCounts.values()].reduce((sum, value) => sum + value, 0),
    series: contentCounts.get("SERIES") ?? 0,
    seasons: contentCounts.get("SEASON") ?? 0,
    episodes: contentCounts.get("EPISODE") ?? 0,
    movies: contentCounts.get("MOVIE") ?? 0,
    metadata: Object.values(sourceCounts).reduce(
      (sum, value) => sum + value,
      0,
    ),
    geoBlocks: toSafeNumber(geoBlockRows[0]?.count ?? 0n),
  };
  const actualDatabaseBytes = toSafeNumber(databaseSizeRows[0]?.bytes ?? 0n);

  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Advanced catalog verification failed: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}.`,
    );
  }

  if (actualDatabaseBytes > DATABASE_HARD_LIMIT_BYTES) {
    throw new Error(
      `Database uses ${actualDatabaseBytes} bytes, above the 250 MiB storage budget.`,
    );
  }

  console.log(
    JSON.stringify(
      {
        verified: true,
        counts: actual,
        sourceCounts,
        normalizedBytes: manifest.normalizedBytes.toString(),
        estimatedDatabaseBytes: manifest.estimatedDatabaseBytes.toString(),
        actualDatabaseBytes,
        storageBudgetBytes: DATABASE_HARD_LIMIT_BYTES,
        storageHeadroomBytes: DATABASE_HARD_LIMIT_BYTES - actualDatabaseBytes,
      },
      null,
      2,
    ),
  );
}

function readCounts(value: unknown): AdvancedCounts {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Advanced catalog manifest counts are invalid.");
  }

  const record = value as Record<string, unknown>;
  const keys: Array<keyof AdvancedCounts> = [
    "content",
    "series",
    "seasons",
    "episodes",
    "movies",
    "metadata",
    "geoBlocks",
  ];
  const counts = {} as AdvancedCounts;

  for (const key of keys) {
    const count = record[key];

    if (!Number.isSafeInteger(count) || (count as number) < 0) {
      throw new Error(`Advanced catalog manifest count is invalid: ${key}`);
    }

    counts[key] = count as number;
  }

  return counts;
}

function toSafeNumber(value: bigint): number {
  const number = Number(value);

  if (!Number.isSafeInteger(number)) {
    throw new Error(`Count cannot be represented safely: ${value}`);
  }

  return number;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
