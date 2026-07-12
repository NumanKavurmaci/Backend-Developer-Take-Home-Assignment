import { ApiError } from "./api-error.js";

export function createUpdatedAtEntityTag(updatedAt: Date): string {
  return `"${updatedAt.toISOString()}"`;
}

export function readOptionalUpdatedAtEntityTag(
  value: string | undefined,
): Date | undefined {
  if (value === undefined) {
    return undefined;
  }

  const match = /^"(.+)"$/.exec(value.trim());
  const date = match ? new Date(match[1]!) : new Date(Number.NaN);

  if (!match || Number.isNaN(date.getTime()) || date.toISOString() !== match[1]) {
    throw new ApiError(
      400,
      "INVALID_IF_MATCH",
      "If-Match must be a strong ETag returned by a CMS resource response.",
    );
  }

  return date;
}

export function nextEntityUpdatedAt(currentUpdatedAt: Date): Date {
  return new Date(Math.max(Date.now(), currentUpdatedAt.getTime() + 1));
}
