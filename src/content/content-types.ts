export const CONTENT_TYPES = {
  SERIES: "SERIES",
  SEASON: "SEASON",
  EPISODE: "EPISODE",
  MOVIE: "MOVIE",
} as const;

export type ContentType = (typeof CONTENT_TYPES)[keyof typeof CONTENT_TYPES];

export const CONTENT_TYPE_VALUES = Object.values(CONTENT_TYPES);

export function isContentType(value: string): value is ContentType {
  return CONTENT_TYPE_VALUES.includes(value as ContentType);
}

export function assertContentType(value: string): asserts value is ContentType {
  if (!isContentType(value)) {
    throw new Error(
      `Invalid content type "${value}". Allowed values: ${CONTENT_TYPE_VALUES.join(", ")}.`,
    );
  }
}
