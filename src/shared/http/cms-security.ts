import { createHash, timingSafeEqual } from "node:crypto";
import type { Context, Hono, MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { DomainError } from "../domain/domain-error.js";
import { ApiError } from "./api-error.js";
import { toApiError } from "./domain-error-mapper.js";
import {
  getRequestErrorCode,
  getRequestId,
  setRequestErrorCode,
} from "./request-observability.js";

export const CMS_ROLES = ["reader", "editor", "admin"] as const;
export type CmsRole = (typeof CMS_ROLES)[number];

export type CmsPrincipal = {
  actorId: string;
  role: CmsRole;
};

export type CmsCredential = CmsPrincipal & {
  secret: string;
};

export type CmsSecurityOptions = {
  credentials: CmsCredential[];
  authenticationAttemptLimitPerMinute: number;
  maxBodyBytes: number;
  mutationsEnabled: boolean;
  rateLimitPerMinute: number;
};

export type CmsAuditEntry = {
  event: "cms_audit";
  timestamp: string;
  requestId: string;
  actorId: string;
  role?: CmsRole;
  action: "create" | "read" | "update" | "delete";
  resourceType: "content" | "live_channel" | "epg_program" | "cms_route";
  resourceId?: string;
  parentResourceId?: string;
  method: string;
  path: string;
  status: number;
  outcome: "succeeded" | "rejected";
  errorCode?: string;
};

type CmsAuditLogger = (entry: CmsAuditEntry) => void | Promise<void>;

const principalByContext = new WeakMap<Context, CmsPrincipal>();
const auditResourceByContext = new WeakMap<
  Context,
  { resourceId: string; parentResourceId?: string }
>();
const RATE_WINDOW_MS = 60_000;
const MAX_BODY_BYTES = 10 * 1024 * 1024;
const MAX_RATE_LIMIT_PER_MINUTE = 10_000;
const MAX_AUTH_RATE_KEYS = 10_000;

let auditLogger: CmsAuditLogger = (entry) => {
  if (process.env.NODE_ENV === "test") {
    return;
  }

  console.info(JSON.stringify(entry));
};

export function registerCmsSecurity(
  app: Hono,
  options: CmsSecurityOptions = readCmsSecurityOptions(),
): void {
  app.use("/api/v1/cms/*", cmsAuditMiddleware());
  app.use(
    "/api/v1/cms/*",
    bodyLimit({
      maxSize: options.maxBodyBytes,
      onError: (c) => {
        setRequestErrorCode(c, "REQUEST_BODY_TOO_LARGE");
        return c.json(
          {
            errorCode: "REQUEST_BODY_TOO_LARGE",
            message: `Request body must not exceed ${options.maxBodyBytes} bytes.`,
          },
          413,
        );
      },
    }),
  );
  app.use(
    "/api/v1/cms/*",
    cmsRateLimitMiddleware(
      options.authenticationAttemptLimitPerMinute,
      readAuthenticationRateKey,
      MAX_AUTH_RATE_KEYS,
    ),
  );
  app.use("/api/v1/cms/*", cmsAuthenticationMiddleware(options.credentials));
  app.use(
    "/api/v1/cms/*",
    cmsRateLimitMiddleware(
      options.rateLimitPerMinute,
      (c) => getCmsPrincipal(c)?.actorId ?? "anonymous",
      options.credentials.length || 1,
    ),
  );
  app.use(
    "/api/v1/cms/*",
    cmsMutationGateMiddleware(options.mutationsEnabled),
  );
}

export function readCmsSecurityOptions(
  environment: NodeJS.ProcessEnv = process.env,
): CmsSecurityOptions {
  return {
    credentials: parseCmsCredentials(environment.CMS_API_KEYS),
    authenticationAttemptLimitPerMinute: readPositiveInteger(
      environment.CMS_AUTH_ATTEMPT_LIMIT_PER_MINUTE,
      300,
      "CMS_AUTH_ATTEMPT_LIMIT_PER_MINUTE",
      MAX_RATE_LIMIT_PER_MINUTE,
    ),
    maxBodyBytes: readPositiveInteger(
      environment.CMS_MAX_BODY_BYTES,
      1024 * 1024,
      "CMS_MAX_BODY_BYTES",
      MAX_BODY_BYTES,
    ),
    mutationsEnabled: readBoolean(
      environment.CMS_MUTATIONS_ENABLED,
      true,
      "CMS_MUTATIONS_ENABLED",
    ),
    rateLimitPerMinute: readPositiveInteger(
      environment.CMS_RATE_LIMIT_PER_MINUTE,
      120,
      "CMS_RATE_LIMIT_PER_MINUTE",
      MAX_RATE_LIMIT_PER_MINUTE,
    ),
  };
}

export function parseCmsCredentials(value: string | undefined): CmsCredential[] {
  if (value === undefined || value.trim() === "") {
    return [];
  }

  const rawEntries = value.split(",").map((entry) => entry.trim());

  if (rawEntries.some((entry) => entry === "")) {
    throw new Error("CMS_API_KEYS must not contain empty entries.");
  }

  const credentials = rawEntries.map((entry) => {
    const [actorId, rawRole, ...secretParts] = entry.split(":");
    const role = rawRole?.trim();
    const secret = secretParts.join(":").trim();

    if (!actorId?.trim() || !isCmsRole(role) || secret.length < 32) {
      throw new Error(
        "CMS_API_KEYS entries must use actorId:reader|editor|admin:secret with a secret of at least 32 characters.",
      );
    }

    return {
      actorId: actorId.trim(),
      role,
      secret,
    };
  });

  const roleByActor = new Map<string, CmsRole>();

  for (const credential of credentials) {
    const existingRole = roleByActor.get(credential.actorId);

    if (existingRole && existingRole !== credential.role) {
      throw new Error("Rotated CMS keys for one actor must use the same role.");
    }

    roleByActor.set(credential.actorId, credential.role);
  }

  if (new Set(credentials.map(({ secret }) => secret)).size !== credentials.length) {
    throw new Error("CMS_API_KEYS secrets must be unique.");
  }

  return credentials;
}

export function getCmsPrincipal(c: Context): CmsPrincipal | undefined {
  return principalByContext.get(c);
}

export function setCmsAuditResource(
  c: Context,
  resourceId: string,
  parentResourceId?: string,
): void {
  auditResourceByContext.set(c, {
    resourceId,
    ...(parentResourceId ? { parentResourceId } : {}),
  });
}

export function setCmsAuditLogger(logger: CmsAuditLogger): () => void {
  const previousLogger = auditLogger;
  auditLogger = logger;

  return () => {
    auditLogger = previousLogger;
  };
}

function cmsAuthenticationMiddleware(
  credentials: CmsCredential[],
): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.method === "OPTIONS") {
      await next();
      return;
    }

    if (credentials.length === 0) {
      throw new ApiError(
        503,
        "CMS_AUTH_NOT_CONFIGURED",
        "CMS authentication is not configured.",
      );
    }

    const token = readBearerToken(c.req.header("Authorization"));

    if (!token) {
      c.header("WWW-Authenticate", 'Bearer realm="cms"');
      throw new ApiError(
        401,
        "CMS_AUTHENTICATION_REQUIRED",
        "A CMS bearer token is required.",
      );
    }

    const credential = credentials.find(({ secret }) =>
      secretsEqual(secret, token),
    );

    if (!credential) {
      c.header("WWW-Authenticate", 'Bearer realm="cms", error="invalid_token"');
      throw new ApiError(401, "INVALID_CMS_API_KEY", "CMS bearer token is invalid.");
    }

    const requiredRole = requiredRoleForRequest(c.req.method, c.req.path);

    if (!roleSatisfies(credential.role, requiredRole)) {
      principalByContext.set(c, {
        actorId: credential.actorId,
        role: credential.role,
      });
      throw new ApiError(
        403,
        "CMS_FORBIDDEN",
        `${requiredRole} CMS access is required for this operation.`,
      );
    }

    principalByContext.set(c, {
      actorId: credential.actorId,
      role: credential.role,
    });
    await next();
  };
}

function cmsRateLimitMiddleware(
  limit: number,
  readKey: (c: Context) => string,
  maximumKeys: number,
): MiddlewareHandler {
  const usageByKey = new Map<string, { count: number; windowStartedAt: number }>();

  return async (c, next) => {
    const now = Date.now();
    const requestedKey = readKey(c);
    const key = ensureRateLimitKeyCapacity(
      usageByKey,
      requestedKey,
      now,
      maximumKeys,
    );
    const usage = usageByKey.get(key);

    if (!usage || now - usage.windowStartedAt >= RATE_WINDOW_MS) {
      usageByKey.set(key, { count: 1, windowStartedAt: now });
    } else {
      usage.count += 1;

      if (usage.count > limit) {
        const retryAfterSeconds = Math.max(
          1,
          Math.ceil((RATE_WINDOW_MS - (now - usage.windowStartedAt)) / 1000),
        );
        c.header("Retry-After", String(retryAfterSeconds));
        throw new ApiError(
          429,
          "CMS_RATE_LIMITED",
          "CMS request rate limit exceeded.",
        );
      }
    }

    await next();
  };
}

function cmsMutationGateMiddleware(enabled: boolean): MiddlewareHandler {
  return async (c, next) => {
    if (
      !enabled &&
      c.req.method !== "GET" &&
      c.req.method !== "HEAD" &&
      c.req.method !== "OPTIONS"
    ) {
      throw new ApiError(
        503,
        "CMS_MUTATIONS_DISABLED",
        "CMS mutations are temporarily disabled.",
      );
    }

    await next();
  };
}

function cmsAuditMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    let thrownError: unknown;

    try {
      await next();
    } catch (error) {
      thrownError = error;
      throw error;
    } finally {
      const status = thrownError ? statusForError(thrownError) : c.res.status || 200;
      const errorCode = readErrorCode(thrownError) ?? getRequestErrorCode(c);
      const principal = getCmsPrincipal(c);
      const resource = describeCmsResource(c.req.path);
      const auditedResource = auditResourceByContext.get(c);

      await emitAuditEntry({
        event: "cms_audit",
        timestamp: new Date().toISOString(),
        requestId: getRequestId(c),
        actorId: principal?.actorId ?? "anonymous",
        ...(principal ? { role: principal.role } : {}),
        action: actionForMethod(c.req.method),
        resourceType: resource.resourceType,
        ...(auditedResource?.resourceId || resource.resourceId
          ? { resourceId: auditedResource?.resourceId ?? resource.resourceId }
          : {}),
        ...(auditedResource?.parentResourceId
          ? { parentResourceId: auditedResource.parentResourceId }
          : {}),
        method: c.req.method,
        path: c.req.path,
        status,
        outcome: status >= 400 ? "rejected" : "succeeded",
        ...(errorCode ? { errorCode } : {}),
      });
    }
  };
}

function readPositiveInteger(
  value: string | undefined,
  fallback: number,
  name: string,
  maximum: number,
): number {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }

  const normalized = value.trim();

  if (!/^[1-9]\d*$/.test(normalized)) {
    throw new Error(`${name} must be a positive decimal integer.`);
  }

  const parsed = Number(normalized);

  if (!Number.isSafeInteger(parsed) || parsed > maximum) {
    throw new Error(`${name} must be at most ${maximum}.`);
  }

  return parsed;
}

function readBoolean(
  value: string | undefined,
  fallback: boolean,
  name: string,
): boolean {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  throw new Error(`${name} must be true or false.`);
}

function readBearerToken(authorization: string | undefined): string | undefined {
  const match = /^Bearer\s+(.+)$/i.exec(authorization?.trim() ?? "");
  return match?.[1]?.trim() || undefined;
}

function secretsEqual(expected: string, actual: string): boolean {
  const expectedBytes = Buffer.from(expected);
  const actualBytes = Buffer.from(actual);

  return (
    expectedBytes.length === actualBytes.length &&
    timingSafeEqual(expectedBytes, actualBytes)
  );
}

function isCmsRole(value: string | undefined): value is CmsRole {
  return CMS_ROLES.includes(value as CmsRole);
}

function requiredRoleForRequest(method: string, path: string): CmsRole {
  if (method === "GET" || method === "HEAD") {
    return "reader";
  }

  if (method === "DELETE" && /^\/api\/v1\/cms\/channels\/[^/]+\/?$/.test(path)) {
    return "admin";
  }

  return "editor";
}

function roleSatisfies(actual: CmsRole, required: CmsRole): boolean {
  return CMS_ROLES.indexOf(actual) >= CMS_ROLES.indexOf(required);
}

function actionForMethod(
  method: string,
): "create" | "read" | "update" | "delete" {
  if (method === "POST") {
    return "create";
  }

  if (method === "PATCH" || method === "PUT") {
    return "update";
  }

  if (method === "DELETE") {
    return "delete";
  }

  return "read";
}

function describeCmsResource(path: string): {
  resourceType: CmsAuditEntry["resourceType"];
  resourceId?: string;
} {
  const segments = path.split("/").filter(Boolean);
  const resourceName = segments[3];

  if (resourceName === "content") {
    return {
      resourceType: "content",
      ...(segments[4] ? { resourceId: segments[4] } : {}),
    };
  }

  if (resourceName === "channels") {
    if (segments[5] === "epg") {
      return {
        resourceType: "epg_program",
        ...(segments[6]
          ? { resourceId: segments[6] }
          : {}),
      };
    }

    return {
      resourceType: "live_channel",
      ...(segments[4] ? { resourceId: segments[4] } : {}),
    };
  }

  return { resourceType: "cms_route" };
}

function statusForError(error: unknown): number {
  if (error instanceof ApiError) {
    return error.statusCode;
  }

  if (error instanceof DomainError) {
    return toApiError(error).statusCode;
  }

  if (error instanceof HTTPException) {
    return error.status;
  }

  return 500;
}

function readErrorCode(error: unknown): string | undefined {
  if (error instanceof ApiError) {
    return error.errorCode;
  }

  if (error instanceof DomainError) {
    return error.errorCode;
  }

  return undefined;
}

function readAuthenticationRateKey(c: Context): string {
  const forwardedFor = c.req.header("X-Forwarded-For")
    ?.split(",")[0]
    ?.trim();
  const clientAddress =
    c.req.header("CF-Connecting-IP")?.trim() ||
    c.req.header("X-Real-IP")?.trim() ||
    forwardedFor ||
    "unknown-client";

  return createHash("sha256").update(clientAddress).digest("hex");
}

function ensureRateLimitKeyCapacity(
  usageByKey: Map<string, { count: number; windowStartedAt: number }>,
  requestedKey: string,
  now: number,
  maximumKeys: number,
): string {
  if (usageByKey.has(requestedKey) || usageByKey.size < maximumKeys) {
    return requestedKey;
  }

  for (const [key, usage] of usageByKey) {
    if (now - usage.windowStartedAt >= RATE_WINDOW_MS) {
      usageByKey.delete(key);
    }
  }

  return usageByKey.size < maximumKeys ? requestedKey : "overflow";
}

async function emitAuditEntry(entry: CmsAuditEntry): Promise<void> {
  try {
    await auditLogger(entry);
  } catch {
    // Audit emission is best-effort at this layer. A production deployment can
    // replace the sink with a durable collector; a sink outage must never make
    // a committed mutation look failed to the caller.
    try {
      console.error(
        JSON.stringify({
          event: "cms_audit_sink_error",
          requestId: entry.requestId,
          timestamp: new Date().toISOString(),
        }),
      );
    } catch {
      // Logging infrastructure must not affect the HTTP result.
    }
  }
}
