import {
  CONTENT_TYPE_VALUES,
  type ContentType,
} from "../shared/domain/domain-contracts.js";

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
