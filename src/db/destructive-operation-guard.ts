import type { Prisma, PrismaClient } from "@prisma/client";

type QueryClient = PrismaClient | Prisma.TransactionClient;

export type DestructiveTarget = {
  databaseName: string;
  schemaName: string;
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
        "Destructive database operation refused: local targets must be the loopback saatcms/public database outside production mode.",
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
