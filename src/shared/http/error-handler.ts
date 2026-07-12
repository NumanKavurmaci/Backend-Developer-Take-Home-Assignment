import type { ErrorHandler, NotFoundHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { DomainError } from "../domain/domain-error.js";
import { ApiError, type ApiErrorStatusCode } from "./api-error.js";
import { toApiError } from "./domain-error-mapper.js";
import { getRequestId, logRequest } from "./request-observability.js";

function toStatusCode(statusCode: number | undefined): ApiErrorStatusCode {
  if (!statusCode || statusCode < 400 || statusCode > 599) {
    return 500;
  }

  return statusCode as ApiErrorStatusCode;
}

// Keeps expected failures in one JSON shape across all modules.
export const errorHandler: ErrorHandler = (error, c) => {
  if (error instanceof DomainError) {
    const apiError = toApiError(error);
    getRequestId(c);
    logRequest(c, apiError.statusCode, apiError.errorCode);

    return c.json(
      {
        errorCode: apiError.errorCode,
        message: apiError.message,
      },
      apiError.statusCode,
    );
  }

  if (error instanceof ApiError) {
    getRequestId(c);
    logRequest(c, error.statusCode, error.errorCode);

    return c.json(
      {
        errorCode: error.errorCode,
        message: error.message,
      },
      error.statusCode,
    );
  }

  if (error instanceof HTTPException) {
    const statusCode = toStatusCode(error.status);
    const errorCode =
      statusCode === 500 ? "INTERNAL_SERVER_ERROR" : "REQUEST_FAILED";
    getRequestId(c);
    logRequest(c, statusCode, errorCode);

    return c.json(
      {
        errorCode,
        message:
          statusCode === 500 ? "Unexpected server error." : error.message,
      },
      statusCode,
    );
  }

  const statusCode = 500;
  const errorCode = "INTERNAL_SERVER_ERROR";
  getRequestId(c);
  logRequest(c, statusCode, errorCode);

  return c.json(
    {
      errorCode,
      message: "Unexpected server error.",
    },
    statusCode,
  );
};

export const notFoundHandler: NotFoundHandler = (c) => {
  const errorCode = "ROUTE_NOT_FOUND";

  getRequestId(c);
  logRequest(c, 404, errorCode);

  return c.json(
    {
      errorCode,
      message: "Route not found.",
    },
    404,
  );
};
