import type { Prisma, PrismaClient } from "@prisma/client";

type QueryClient = PrismaClient | Prisma.TransactionClient;

export type DestructiveTarget = {
  databaseName: string;
  schemaName: string;
};

export type CatalogLoadTarget = DestructiveTarget & {
  databaseUrl: string;
  targetKind: "local" | "test" | "render";
};

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const TEST_DATABASE_PATTERN = /^saatcms_test(?:_[a-z0-9_]+)?$/;

export function validateDestructiveDatabaseTarget(
  environment = process.env,
): DestructiveTarget {
  const deploymentEnvironment = environment.DEPLOYMENT_ENV?.trim();
  const nodeEnvironment = environment.NODE_ENV?.trim();
  const databaseUrl = environment.DATABASE_URL?.trim();

  if (
    !deploymentEnvironment ||
    !["local", "test", "demo"].includes(deploymentEnvironment)
  ) {
    throw new Error(
      "Destructive database operation refused: DEPLOYMENT_ENV must explicitly be local, test, or demo.",
    );
  }

  if (!databaseUrl) {
    throw new Error(
      "Destructive database operation refused: DATABASE_URL is required.",
    );
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(databaseUrl);
  } catch {
    throw new Error(
      "Destructive database operation refused: DATABASE_URL is invalid.",
    );
  }

  if (!["postgres:", "postgresql:"].includes(parsedUrl.protocol)) {
    throw new Error(
      "Destructive database operation refused: PostgreSQL is required.",
    );
  }

  const databaseName = decodeURIComponent(parsedUrl.pathname.slice(1));
  const schemaName = parsedUrl.searchParams.get("schema") ?? "public";

  if (deploymentEnvironment === "local") {
    if (
      nodeEnvironment === "production" ||
      !LOOPBACK_HOSTS.has(parsedUrl.hostname) ||
      schemaName !== "public"
    ) {
      throw new Error(
        "Destructive database operation refused: local targets must use a loopback PostgreSQL host and the public schema outside production mode.",
      );
    }
  } else if (deploymentEnvironment === "test") {
    if (
      nodeEnvironment !== "test" ||
      !LOOPBACK_HOSTS.has(parsedUrl.hostname) ||
      !TEST_DATABASE_PATTERN.test(databaseName) ||
      schemaName !== "public"
    ) {
      throw new Error(
        "Destructive database operation refused: test targets must be a loopback saatcms_test* /public database in NODE_ENV=test.",
      );
    }
  } else {
    const expectedConfirmation = `${parsedUrl.hostname}/${databaseName}/${schemaName}`;
    if (
      nodeEnvironment !== "production" ||
      schemaName !== "public" ||
      environment.DEMO_DATABASE_CONFIRMATION !== expectedConfirmation
    ) {
      throw new Error(
        `Destructive database operation refused: demo seeding requires NODE_ENV=production and DEMO_DATABASE_CONFIRMATION=${expectedConfirmation}.`,
      );
    }
  }

  return { databaseName, schemaName };
}

export async function assertConnectedToDestructiveTarget(
  prisma: QueryClient,
  expected: DestructiveTarget,
): Promise<void> {
  const [actual] = await prisma.$queryRaw<
    Array<{ databaseName: string; schemaName: string }>
  >`SELECT current_database() AS "databaseName", current_schema() AS "schemaName"`;

  if (
    actual?.databaseName !== expected.databaseName ||
    actual.schemaName !== expected.schemaName
  ) {
    throw new Error(
      "Destructive database operation refused: the live database/schema does not match the guarded DATABASE_URL target.",
    );
  }
}

export function isGeneratedTestDatabaseName(databaseName: string): boolean {
  return /^saatcms_test_[a-z0-9_]+$/.test(databaseName);
}

/**
 * Catalog loading always uses a separately named URL so an application
 * DATABASE_URL cannot be destroyed accidentally by an inherited shell value.
 */
export function validateCatalogLoadTarget(
  environment = process.env,
): CatalogLoadTarget {
  const databaseUrl = environment.CATALOG_DATABASE_URL?.trim();
  const targetKind = environment.CATALOG_DATABASE_TARGET?.trim();
  if (!databaseUrl) {
    throw new Error(
      "Catalog load refused: CATALOG_DATABASE_URL must be supplied separately.",
    );
  }
  if (!targetKind || !["local", "test", "render"].includes(targetKind)) {
    throw new Error(
      "Catalog load refused: CATALOG_DATABASE_TARGET must be local, test, or render.",
    );
  }
  if (targetKind === "local" || targetKind === "test") {
    const target = validateDestructiveDatabaseTarget({
      ...environment,
      DATABASE_URL: databaseUrl,
      DEPLOYMENT_ENV: targetKind,
    });
    return { ...target, databaseUrl, targetKind };
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(databaseUrl);
  } catch {
    throw new Error("Catalog load refused: CATALOG_DATABASE_URL is invalid.");
  }
  if (!["postgres:", "postgresql:"].includes(parsedUrl.protocol)) {
    throw new Error("Catalog load refused: Render target must be PostgreSQL.");
  }
  const databaseName = decodeURIComponent(parsedUrl.pathname.slice(1));
  const schemaName = parsedUrl.searchParams.get("schema") ?? "public";
  const expectedIdentity = `${parsedUrl.hostname}/${databaseName}/${schemaName}`;
  if (
    LOOPBACK_HOSTS.has(parsedUrl.hostname) ||
    schemaName !== "public" ||
    environment.CATALOG_EXPECTED_DATABASE !== databaseName ||
    environment.CATALOG_RENDER_CONFIRMATION !== expectedIdentity
  ) {
    throw new Error(
      `Catalog load refused: Render requires CATALOG_EXPECTED_DATABASE=${databaseName} and CATALOG_RENDER_CONFIRMATION=${expectedIdentity}.`,
    );
  }
  return { databaseName, schemaName, databaseUrl, targetKind: "render" };
}
