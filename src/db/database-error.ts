type UnknownRecord = Record<string, unknown>;

export type DatabaseConstraintFailure = {
  constraintName?: string;
  sqlState?: string;
  type?: string;
};

const CONSTRAINT_NAME_PATTERNS = [
  /constraint\s+["'`]([A-Za-z_][A-Za-z0-9_]*)["'`]/i,
  /constraint:\s*(?:Some\()?["'`]([A-Za-z_][A-Za-z0-9_]*)["'`]/i,
  /["'`]constraint["'`]\s*:\s*["'`]([A-Za-z_][A-Za-z0-9_]*)["'`]/i,
];

const DATABASE_CONSTRAINT_TYPES = [
  "ExclusionConstraintViolation",
  "CheckConstraintViolation",
] as const;

export const POSTGRESQL_INTEGRITY_SQL_STATES = [
  "23502", // not_null_violation
  "23503", // foreign_key_violation
  "23505", // unique_violation
  "23514", // check_violation
  "23P01", // exclusion_violation
] as const;

const PRISMA_INTEGRITY_ERROR_SQL_STATES: Record<string, string> = {
  P2002: "23505",
  P2003: "23503",
  P2011: "23502",
};

export function isPrismaErrorCode(error: unknown, code: string): boolean {
  return readRecord(error)?.code === code;
}

export function toDatabaseConstraintFailure(
  error: unknown,
): DatabaseConstraintFailure | undefined {
  const errorRecord = readRecord(error);
  const meta = readRecord(errorRecord?.meta);
  const details = [
    readString(errorRecord?.name),
    readString(errorRecord?.message),
    readString(errorRecord?.stack),
    stringifyMetadata(meta),
  ].join(" ");

  const constraintName = findConstraintName(details);
  const sqlState =
    findSqlState(details) ?? findPrismaIntegritySqlState(errorRecord?.code);
  const type = findConstraintType(details);

  if (
    !isPrismaErrorCode(error, "P2004") &&
    !constraintName &&
    !sqlState &&
    !type
  ) {
    return undefined;
  }

  return {
    constraintName,
    sqlState,
    type,
  };
}

function findConstraintName(details: string): string | undefined {
  for (const pattern of CONSTRAINT_NAME_PATTERNS) {
    const constraintName = pattern.exec(details)?.[1];

    if (constraintName) {
      return constraintName;
    }
  }

  return undefined;
}

function findConstraintType(details: string): string | undefined {
  for (const constraintType of DATABASE_CONSTRAINT_TYPES) {
    if (details.includes(constraintType)) {
      return constraintType;
    }
  }

  return undefined;
}

function findSqlState(details: string): string | undefined {
  for (const sqlState of POSTGRESQL_INTEGRITY_SQL_STATES) {
    if (details.includes(sqlState)) {
      return sqlState;
    }
  }

  return undefined;
}

function findPrismaIntegritySqlState(code: unknown): string | undefined {
  return typeof code === "string"
    ? PRISMA_INTEGRITY_ERROR_SQL_STATES[code]
    : undefined;
}

function readRecord(value: unknown): UnknownRecord | undefined {
  return typeof value === "object" && value !== null
    ? (value as UnknownRecord)
    : undefined;
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function stringifyMetadata(metadata: unknown): string {
  if (typeof metadata === "string") {
    return metadata;
  }

  try {
    return JSON.stringify(metadata ?? "");
  } catch {
    return String(metadata ?? "");
  }
}
