export type ApiErrorStatusCode =
  | 400
  | 401
  | 403
  | 404
  | 409
  | 413
  | 422
  | 429
  | 500
  | 502
  | 503;

export class ApiError extends Error {
  constructor(
    readonly statusCode: ApiErrorStatusCode,
    readonly errorCode: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
