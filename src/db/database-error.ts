import { Prisma } from "@prisma/client";

/** Identifies a named PostgreSQL constraint violation reported by Prisma. */
export function isDatabaseConstraintViolation(
  error: unknown,
  constraintName: string,
): boolean {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== "P2004"
  ) {
    return false;
  }

  const databaseError = error.meta?.database_error;
  const details = `${error.message} ${stringifyErrorMetadata(databaseError)}`;

  return details.includes(constraintName);
}

/** Matches the normalized database error type Prisma exposes for a model. */
export function isPrismaDatabaseError(
  error: unknown,
  databaseErrorType: string,
  modelName: string,
): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2004" &&
    error.meta?.database_error === databaseErrorType &&
    error.meta?.modelName === modelName
  );
}

function stringifyErrorMetadata(metadata: unknown): string {
  if (typeof metadata === "string") {
    return metadata;
  }

  try {
    return JSON.stringify(metadata ?? "");
  } catch {
    return String(metadata ?? "");
  }
}
