import { toDatabaseConstraintFailure } from "../db/database-error.js";
import { DomainError } from "../shared/domain/domain-error.js";

export function toLiveChannelDomainError(
  error: unknown,
): DomainError | undefined {
  if (isPrismaNotFoundError(error)) {
    return new DomainError("CHANNEL_NOT_FOUND", "Channel not found");
  }

  const failure = toDatabaseConstraintFailure(error);

  if (!failure) {
    return undefined;
  }

  if (
    failure.constraintName === "LiveChannel_slug_key" ||
    (failure.modelName === "LiveChannel" &&
      fieldsEqual(failure.targetFields, ["slug"]))
  ) {
    return new DomainError(
      "LIVE_CHANNEL_SLUG_CONFLICT",
      "A live channel with this slug already exists",
    );
  }

  return undefined;
}

function isPrismaNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2025"
  );
}

function fieldsEqual(
  actual: string[] | undefined,
  expected: string[],
): boolean {
  return (
    actual?.length === expected.length &&
    expected.every((field, index) => actual[index] === field)
  );
}
