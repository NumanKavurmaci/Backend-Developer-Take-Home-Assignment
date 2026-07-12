type UnknownRecord = Record<string, unknown>;

export type DatabaseConstraintFailure = {
  constraintName?: string;
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

export function isPrismaErrorCode(error: unknown, code: string): boolean {
  return readRecord(error)?.code === code;
}

export function toDatabaseConstraintFailure(
  error: unknown,
): DatabaseConstraintFailure | undefined {
  if (!isPrismaErrorCode(error, "P2004")) {
    return undefined;
  }

  const errorRecord = readRecord(error);
  const meta = readRecord(errorRecord?.meta);
  const details = [
    readString(errorRecord?.message),
    stringifyMetadata(meta?.database_error),
  ].join(" ");

  return {
    constraintName: findConstraintName(details),
    type: findConstraintType(details),
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
