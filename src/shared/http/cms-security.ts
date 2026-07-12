import { timingSafeEqual } from "node:crypto";
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

type CmsCredential = CmsPrincipal & {
  secret: string;
};

export type CmsSecurityOptions = {
  credentials: CmsCredential[];
  maxBodyBytes: number;
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
  method: string;
  path: string;
  status: number;
  outcome: "succeeded" | "rejected";
  errorCode?: string;
};

type CmsAuditLogger = (entry: CmsAuditEntry) => void;

const principalByContext = new WeakMap<Context, CmsPrincipal>();
const RATE_WINDOW_MS = 60_000;

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
  app.use("/api/v1/cms/*", cmsAuthenticationMiddleware(options.credentials));
  app.use(
    "/api/v1/cms/*",
    cmsRateLimitMiddleware(options.rateLimitPerMinute),
  );
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
}

export function readCmsSecurityOptions(
  environment: NodeJS.ProcessEnv = process.env,
): CmsSecurityOptions {
  return {
    credentials: parseCmsCredentials(environment.CMS_API_KEYS),
    maxBodyBytes: readPositiveInteger(
      environment.CMS_MAX_BODY_BYTES,
      1024 * 1024,
      "CMS_MAX_BODY_BYTES",
    ),
    rateLimitPerMinute: readPositiveInteger(
      environment.CMS_RATE_LIMIT_PER_MINUTE,
      120,
      "CMS_RATE_LIMIT_PER_MINUTE",
    ),
  };
}

export function parseCmsCredentials(value: string | undefined): CmsCredential[] {
  const rawEntries = value
    ?.split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (!rawEntries?.length) {
    return [];
  }

  const credentials = rawEntries.map((entry) => {
    const [actorId, rawRole, ...secretParts] = entry.split(":");
    const role = rawRole?.trim();
    const secret = secretParts.join(":").trim();

    if (!actorId?.trim() || !isCmsRole(role) || secret.length < 16) {
      throw new Error(
        "CMS_API_KEYS entries must use actorId:reader|editor|admin:secret with a secret of at least 16 characters.",
      );
    }

    return {
      actorId: actorId.trim(),
      role,
      secret,
    };
  });

  if (new Set(credentials.map(({ actorId }) => actorId)).size !== credentials.length) {
    throw new Error("CMS_API_KEYS actor IDs must be unique.");
  }

  if (new Set(credentials.map(({ secret }) => secret)).size !== credentials.length) {
    throw new Error("CMS_API_KEYS secrets must be unique.");
  }

  return credentials;
}

export function getCmsPrincipal(c: Context): CmsPrincipal | undefined {
  return principalByContext.get(c);
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
    if (credentials.length === 0) {
      throw new ApiError(
        503,
        "CMS_AUTH_NOT_CONFIGURED",
        "CMS authentication is not configured.",
      );
    }

    const token = readBearerToken(c.req.header("Authorization"));

    if (!token) {
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

function cmsRateLimitMiddleware(limit: number): MiddlewareHandler {
  const usageByActor = new Map<string, { count: number; windowStartedAt: number }>();

  return async (c, next) => {
    const principal = getCmsPrincipal(c);

    if (!principal) {
      throw new ApiError(401, "CMS_AUTHENTICATION_REQUIRED", "CMS authentication is required.");
    }

    const now = Date.now();
    const usage = usageByActor.get(principal.actorId);

    if (!usage || now - usage.windowStartedAt >= RATE_WINDOW_MS) {
      usageByActor.set(principal.actorId, { count: 1, windowStartedAt: now });
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

      auditLogger({
        event: "cms_audit",
        timestamp: new Date().toISOString(),
        requestId: getRequestId(c),
        actorId: principal?.actorId ?? "anonymous",
        ...(principal ? { role: principal.role } : {}),
        action: actionForMethod(c.req.method),
        resourceType: resource.resourceType,
        ...(resource.resourceId ? { resourceId: resource.resourceId } : {}),
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
): number {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return parsed;
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
    const epgIndex = segments.indexOf("epg");

    if (epgIndex >= 0) {
      return {
        resourceType: "epg_program",
        ...(segments[epgIndex + 1]
          ? { resourceId: segments[epgIndex + 1] }
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
