import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DomainError } from "../domain/domain-error.js";
import {
  parseCmsCredentials,
  readCmsSecurityOptions,
  registerCmsSecurity,
  setCmsAuditResource,
  setCmsAuditLogger,
  type CmsAuditEntry,
  type CmsSecurityOptions,
} from "./cms-security.js";
import { errorHandler } from "./error-handler.js";
import { requestObservabilityMiddleware } from "./request-observability.js";

const readerToken = "reader-secret-12345678901234567890";
const editorToken = "editor-secret-12345678901234567890";
const adminToken = "admin-secret-123456789012345678901";

const securityOptions: CmsSecurityOptions = {
  credentials: [
    { actorId: "reader-user", role: "reader", secret: readerToken },
    { actorId: "editor-user", role: "editor", secret: editorToken },
    { actorId: "admin-user", role: "admin", secret: adminToken },
  ],
  authenticationAttemptLimitPerMinute: 20,
  maxBodyBytes: 128,
  mutationsEnabled: true,
  rateLimitPerMinute: 10,
};

let restoreAuditLogger: (() => void) | undefined;

afterEach(() => {
  restoreAuditLogger?.();
  restoreAuditLogger = undefined;
});

describe("CMS security configuration", () => {
  it("parses actor, role, and secrets while preserving colons in secrets", () => {
    expect(
      parseCmsCredentials(
        "operator:editor:secret-with:colon-1234567890123456, supervisor:admin:admin-secret-12345678901234567890",
      ),
    ).toEqual([
      {
        actorId: "operator",
        role: "editor",
        secret: "secret-with:colon-1234567890123456",
      },
      {
        actorId: "supervisor",
        role: "admin",
        secret: "admin-secret-12345678901234567890",
      },
    ]);
  });

  it("rejects malformed, duplicate, and weak credentials", () => {
    expect(() => parseCmsCredentials("operator:owner:long-secret-12345678901234567890")).toThrow(
      /reader\|editor\|admin/,
    );
    expect(() => parseCmsCredentials("operator:editor:short")).toThrow(
      /at least 32/,
    );
    expect(() => parseCmsCredentials("operator:reader:reader-secret-12345678901234567890,")).toThrow(
      /empty entries/,
    );
    expect(() =>
      parseCmsCredentials(
        "operator:reader:reader-secret-12345678901234567890,operator:admin:admin-secret-123456789012345678901",
      ),
    ).toThrow(/same role/);
    expect(
      parseCmsCredentials(
        "operator:editor:first-rotated-secret-123456789012,operator:editor:second-rotated-secret-12345678901",
      ),
    ).toHaveLength(2);
    expect(() =>
      parseCmsCredentials(
        "first:reader:shared-secret-1234567890123456789,second:admin:shared-secret-1234567890123456789",
      ),
    ).toThrow(/secrets must be unique/);
  });

  it("uses bounded defaults and rejects invalid numeric settings", () => {
    expect(readCmsSecurityOptions({})).toMatchObject({
      credentials: [],
      authenticationAttemptLimitPerMinute: 300,
      maxBodyBytes: 1024 * 1024,
      mutationsEnabled: true,
      rateLimitPerMinute: 120,
    });
    expect(() =>
      readCmsSecurityOptions({ CMS_MAX_BODY_BYTES: "0" }),
    ).toThrow(/CMS_MAX_BODY_BYTES/);
    expect(() =>
      readCmsSecurityOptions({ CMS_RATE_LIMIT_PER_MINUTE: "1.5" }),
    ).toThrow(/CMS_RATE_LIMIT_PER_MINUTE/);
    expect(() =>
      readCmsSecurityOptions({ CMS_RATE_LIMIT_PER_MINUTE: "1e3" }),
    ).toThrow(/positive decimal integer/);
    expect(() =>
      readCmsSecurityOptions({ CMS_MAX_BODY_BYTES: "10485761" }),
    ).toThrow(/at most/);
    expect(() =>
      readCmsSecurityOptions({ CMS_MUTATIONS_ENABLED: "yes" }),
    ).toThrow(/CMS_MUTATIONS_ENABLED/);
  });
});

describe("CMS authentication and authorization", () => {
  it("fails closed when no API keys are configured", async () => {
    const response = await createSecurityTestApp({
      ...securityOptions,
      credentials: [],
    }).request("/api/v1/cms/content");

    await expect(response.json()).resolves.toEqual({
      errorCode: "CMS_AUTH_NOT_CONFIGURED",
      message: "CMS authentication is not configured.",
    });
    expect(response.status).toBe(503);
  });

  it("rejects missing and invalid bearer tokens", async () => {
    const app = createSecurityTestApp();
    const missing = await app.request("/api/v1/cms/content");
    const invalid = await app.request("/api/v1/cms/content", {
      headers: { Authorization: "Bearer invalid-token-123456" },
    });

    expect(missing.status).toBe(401);
    expect(invalid.status).toBe(401);
    expect(missing.headers.get("WWW-Authenticate")).toBe('Bearer realm="cms"');
    expect(invalid.headers.get("WWW-Authenticate")).toContain("invalid_token");
    await expect(missing.json()).resolves.toMatchObject({
      errorCode: "CMS_AUTHENTICATION_REQUIRED",
    });
    await expect(invalid.json()).resolves.toMatchObject({
      errorCode: "INVALID_CMS_API_KEY",
    });
  });

  it("allows readers to read but requires editors for mutations", async () => {
    const app = createSecurityTestApp();
    const read = await app.request("/api/v1/cms/content", {
      headers: bearer(readerToken),
    });
    const rejectedWrite = await app.request("/api/v1/cms/content", {
      method: "POST",
      headers: bearer(readerToken),
    });
    const acceptedWrite = await app.request("/api/v1/cms/content", {
      method: "POST",
      headers: bearer(editorToken),
    });

    expect(read.status).toBe(200);
    expect(rejectedWrite.status).toBe(403);
    expect(acceptedWrite.status).toBe(201);
  });

  it("reserves destructive channel deletion for administrators", async () => {
    const app = createSecurityTestApp();
    const editorDelete = await app.request(
      "/api/v1/cms/channels/channel-1?confirm=true",
      { method: "DELETE", headers: bearer(editorToken) },
    );
    const adminDelete = await app.request(
      "/api/v1/cms/channels/channel-1?confirm=true",
      { method: "DELETE", headers: bearer(adminToken) },
    );
    const editorEpgDelete = await app.request(
      "/api/v1/cms/channels/channel-1/epg/program-1",
      { method: "DELETE", headers: bearer(editorToken) },
    );

    expect(editorDelete.status).toBe(403);
    expect(adminDelete.status).toBe(204);
    expect(editorEpgDelete.status).toBe(204);
  });

  it("can disable mutations without disabling CMS reads", async () => {
    const app = createSecurityTestApp({
      ...securityOptions,
      mutationsEnabled: false,
    });
    const read = await app.request("/api/v1/cms/content", {
      headers: bearer(readerToken),
    });
    const write = await app.request("/api/v1/cms/content", {
      method: "POST",
      headers: bearer(editorToken),
    });

    expect(read.status).toBe(200);
    expect(write.status).toBe(503);
    await expect(write.json()).resolves.toMatchObject({
      errorCode: "CMS_MUTATIONS_DISABLED",
    });
  });

  it("limits requests per actor and reports retry timing", async () => {
    const app = createSecurityTestApp({
      ...securityOptions,
      rateLimitPerMinute: 1,
    });

    expect(
      (await app.request("/api/v1/cms/content", { headers: bearer(readerToken) }))
        .status,
    ).toBe(200);
    const limited = await app.request("/api/v1/cms/content", {
      headers: bearer(readerToken),
    });

    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("Retry-After"))).toBeGreaterThan(0);
    await expect(limited.json()).resolves.toMatchObject({
      errorCode: "CMS_RATE_LIMITED",
    });
  });

  it("rejects bodies larger than the configured maximum", async () => {
    const response = await createSecurityTestApp().request(
      "/api/v1/cms/content",
      {
        method: "POST",
        headers: {
          ...bearer(editorToken),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ value: "x".repeat(256) }),
      },
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      errorCode: "REQUEST_BODY_TOO_LARGE",
    });
  });

  it("applies the body limit before authentication", async () => {
    const response = await createSecurityTestApp().request(
      "/api/v1/cms/content",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: "x".repeat(256) }),
      },
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      errorCode: "REQUEST_BODY_TOO_LARGE",
    });
  });

  it("rate limits repeated unauthenticated attempts by client address", async () => {
    const app = createSecurityTestApp({
      ...securityOptions,
      authenticationAttemptLimitPerMinute: 1,
    });
    const headers = { "X-Real-IP": "192.0.2.10" };

    expect((await app.request("/api/v1/cms/content", { headers })).status).toBe(401);
    const limited = await app.request("/api/v1/cms/content", { headers });

    expect(limited.status).toBe(429);
    await expect(limited.json()).resolves.toMatchObject({
      errorCode: "CMS_RATE_LIMITED",
    });
  });
});

describe("CMS mutation auditing", () => {
  it("records successful and rejected mutations without payloads or tokens", async () => {
    const entries: CmsAuditEntry[] = [];
    restoreAuditLogger = setCmsAuditLogger((entry) => {
      entries.push(entry);
    });
    const app = createSecurityTestApp();

    await app.request("/api/v1/cms/content/content-1", {
      method: "PATCH",
      headers: {
        ...bearer(editorToken),
        "X-Request-Id": "req-audit-success",
      },
    });
    await app.request("/api/v1/cms/content", { method: "POST" });
    await app.request("/api/v1/cms/rejected-domain", {
      method: "POST",
      headers: bearer(editorToken),
    });

    expect(entries).toHaveLength(3);
    expect(entries[0]).toMatchObject({
      requestId: "req-audit-success",
      actorId: "editor-user",
      role: "editor",
      action: "update",
      resourceType: "content",
      resourceId: "content-1",
      status: 200,
      outcome: "succeeded",
    });
    expect(entries[1]).toMatchObject({
      actorId: "anonymous",
      action: "create",
      status: 401,
      outcome: "rejected",
      errorCode: "CMS_AUTHENTICATION_REQUIRED",
    });
    expect(entries[2]).toMatchObject({
      actorId: "editor-user",
      status: 409,
      outcome: "rejected",
      errorCode: "CONTENT_HAS_CHILDREN",
    });
    expect(JSON.stringify(entries)).not.toContain(editorToken);
    expect(JSON.stringify(entries)).not.toContain("payload");
  });

  it("records server-generated resource IDs and parent context", async () => {
    const entries: CmsAuditEntry[] = [];
    restoreAuditLogger = setCmsAuditLogger((entry) => {
      entries.push(entry);
    });

    const response = await createSecurityTestApp().request(
      "/api/v1/cms/channels/channel-1/epg",
      { method: "POST", headers: bearer(editorToken) },
    );

    expect(response.status).toBe(201);
    expect(entries[0]).toMatchObject({
      resourceType: "epg_program",
      resourceId: "created-program",
      parentResourceId: "channel-1",
      outcome: "succeeded",
    });
  });

  it("does not turn a committed success into a failure when the audit sink throws", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    restoreAuditLogger = setCmsAuditLogger(() => {
      throw new Error("audit collector unavailable");
    });

    try {
      const response = await createSecurityTestApp().request(
        "/api/v1/cms/content",
        { method: "POST", headers: bearer(editorToken) },
      );

      expect(response.status).toBe(201);
      expect(errorSpy).toHaveBeenCalledOnce();
    } finally {
      errorSpy.mockRestore();
    }
  });
});

function createSecurityTestApp(
  options: CmsSecurityOptions = securityOptions,
): Hono {
  const app = new Hono();

  app.use("*", requestObservabilityMiddleware());
  app.onError(errorHandler);
  registerCmsSecurity(app, options);
  app.get("/api/v1/cms/content", (c) => c.json({ items: [] }));
  app.post("/api/v1/cms/content", (c) => {
    setCmsAuditResource(c, "created");
    return c.json({ id: "created" }, 201);
  });
  app.patch("/api/v1/cms/content/:id", (c) => c.json({ id: c.req.param("id") }));
  app.delete("/api/v1/cms/channels/:channelId", (c) => c.body(null, 204));
  app.delete("/api/v1/cms/channels/:channelId/epg/:programId", (c) =>
    c.body(null, 204),
  );
  app.post("/api/v1/cms/channels/:channelId/epg", (c) => {
    setCmsAuditResource(c, "created-program", c.req.param("channelId"));
    return c.json({ id: "created-program" }, 201);
  });
  app.post("/api/v1/cms/rejected-domain", () => {
    throw new DomainError(
      "CONTENT_HAS_CHILDREN",
      "Content with children cannot be deleted.",
    );
  });

  return app;
}

function bearer(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}
