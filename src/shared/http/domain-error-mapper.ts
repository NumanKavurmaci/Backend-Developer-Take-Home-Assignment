import { DomainError } from "../domain/domain-error.js";
import { ApiError, type ApiErrorStatusCode } from "./api-error.js";

const DOMAIN_ERROR_STATUS_BY_CODE: Record<string, ApiErrorStatusCode> = {
  CHANNEL_NOT_FOUND: 404,
  CONTENT_HAS_CHILDREN: 409,
  CONTENT_ID_CONFLICT: 409,
  CONTENT_NOT_FOUND: 404,
  DEVICE_NOT_SUPPORTED: 403,
  EPG_OVERLAP: 400,
  GEO_BLOCKED: 403,
  INVALID_CONTENT_GEO_BLOCK_COUNTRIES: 400,
  INVALID_CONTENT_HIERARCHY: 400,
  INVALID_CONTENT_METADATA: 400,
  INVALID_DATE_TIME_FORMAT: 400,
  INVALID_REQUEST_BODY: 400,
  INVALID_TIME_RANGE: 400,
  EPG_PROGRAM_NOT_FOUND: 404,
  EPG_WRITE_CONFLICT: 409,
  LIVE_CHANNEL_SLUG_CONFLICT: 409,
  LIVE_CHANNEL_WRITE_CONFLICT: 409,
};

export function toApiError(error: DomainError): ApiError {
  return new ApiError(
    DOMAIN_ERROR_STATUS_BY_CODE[error.errorCode] ?? 400,
    error.errorCode,
    error.message,
  );
}
