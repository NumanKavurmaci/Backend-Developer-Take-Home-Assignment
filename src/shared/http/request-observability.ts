import { randomUUID } from "node:crypto";
import type { Context, MiddlewareHandler } from "hono";

type RequestContext = {
  requestId: string;
  startedAtMs: number;
  logged: boolean;
  errorCode?: string;
};

export type RequestLogEntry = {
  requestId: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  errorCode?: string;
};

type RequestLogger = (entry: RequestLogEntry) => void;

const requestContextByHonoContext = new WeakMap<Context, RequestContext>();

let requestLogger: RequestLogger = (entry) => {
  if (process.env.NODE_ENV === "test") {
    return;
  }

  console.info(JSON.stringify(entry));
};

export function requestObservabilityMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    const requestContext = ensureRequestContext(c);
    c.header("X-Request-Id", requestContext.requestId);

    await next();

    c.header("X-Request-Id", requestContext.requestId);
    logRequest(c, getResponseStatus(c), requestContext.errorCode);
  };
}

export function setRequestLogger(logger: RequestLogger): () => void {
  const previousLogger = requestLogger;
  requestLogger = logger;

  return () => {
    requestLogger = previousLogger;
  };
}

export function ensureRequestContext(c: Context): RequestContext {
  const existingContext = requestContextByHonoContext.get(c);

  if (existingContext) {
    return existingContext;
  }

  const requestId = readRequestId(c) ?? randomUUID();
  const requestContext = {
    requestId,
    startedAtMs: Date.now(),
    logged: false,
  };

  requestContextByHonoContext.set(c, requestContext);
  c.header("X-Request-Id", requestId);

  return requestContext;
}

export function getRequestId(c: Context): string {
  return ensureRequestContext(c).requestId;
}

export function logRequest(
  c: Context,
  status: number,
  errorCode?: string,
): void {
  const requestContext = ensureRequestContext(c);

  if (requestContext.logged) {
    return;
  }

  requestContext.logged = true;
  requestContext.errorCode = errorCode ?? requestContext.errorCode;
  requestLogger({
    requestId: requestContext.requestId,
    method: c.req.method,
    path: getRequestPath(c),
    status,
    durationMs: Math.max(0, Date.now() - requestContext.startedAtMs),
    ...(requestContext.errorCode ? { errorCode: requestContext.errorCode } : {}),
  });
}

export function setRequestErrorCode(c: Context, errorCode: string): void {
  ensureRequestContext(c).errorCode = errorCode;
}

export function getRequestErrorCode(c: Context): string | undefined {
  return ensureRequestContext(c).errorCode;
}

function readRequestId(c: Context): string | undefined {
  const requestId = c.req.header("X-Request-Id")?.trim();
  return requestId || undefined;
}

function getRequestPath(c: Context): string {
  try {
    return new URL(c.req.url).pathname;
  } catch {
    return c.req.path;
  }
}

function getResponseStatus(c: Context): number {
  return c.res.status || 200;
}
