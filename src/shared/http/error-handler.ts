import type { ErrorHandler, NotFoundHandler } from "hono";

type ApplicationError = Error & {
  errorCode?: string;
  statusCode?: number;
};

type JsonErrorStatusCode =
  | 400
  | 401
  | 403
  | 404
  | 409
  | 422
  | 429
  | 500
  | 502
  | 503;

function toStatusCode(statusCode: number | undefined): JsonErrorStatusCode {
  if (!statusCode || statusCode < 400 || statusCode > 599) {
    return 500;
  }

  return statusCode as JsonErrorStatusCode;
}

// Keeps expected failures in one JSON shape across all modules.
export const errorHandler: ErrorHandler = (error, c) => {
  const applicationError = error as ApplicationError;
  const statusCode = toStatusCode(applicationError.statusCode);
  const errorCode =
    applicationError.errorCode ??
    (statusCode === 500 ? "INTERNAL_SERVER_ERROR" : "REQUEST_FAILED");
  const message =
    statusCode === 500 ? "Unexpected server error." : applicationError.message;

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
