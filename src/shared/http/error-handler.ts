import type { ErrorHandler, NotFoundHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { DomainError } from "../domain/domain-error.js";
import type { ApiErrorStatusCode } from "./api-error.js";
import { toApiError } from "./domain-error-mapper.js";

type ApplicationError = Error & {
  errorCode?: string;
  statusCode?: number;
};

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

    return c.json(
      {
        errorCode: apiError.errorCode,
        message: apiError.message,
      },
      apiError.statusCode,
    );
  }

  if (error instanceof HTTPException) {
    const statusCode = toStatusCode(error.status);

    return c.json(
      {
        errorCode:
          statusCode === 500 ? "INTERNAL_SERVER_ERROR" : "REQUEST_FAILED",
        message:
          statusCode === 500 ? "Unexpected server error." : error.message,
      },
      statusCode,
    );
  }

  const applicationError = error as ApplicationError;

  const statusCode = toStatusCode(applicationError.statusCode);

  const errorCode =
    applicationError.errorCode ??
    (statusCode === 500 ? "INTERNAL_SERVER_ERROR" : "REQUEST_FAILED");

  const message =
    statusCode === 500
      ? "Unexpected server error."
      : applicationError.message || "Request failed.";

  return c.json({ errorCode, message }, statusCode);
};

export const notFoundHandler: NotFoundHandler = (c) =>
  c.json(
    {
      errorCode: "ROUTE_NOT_FOUND",
      message: "Route not found.",
    },
    404,
  );
