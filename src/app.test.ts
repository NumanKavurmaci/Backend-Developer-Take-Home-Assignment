import { HTTPException } from "hono/http-exception";
import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { createApp } from "./app.js";
import { HealthController } from "./modules/health/health.controller.js";
import { ApiError } from "./shared/http/api-error.js";
import {
  requestObservabilityMiddleware,
  setRequestLogger,
  type RequestLogEntry,
} from "./shared/http/request-observability.js";

describe("Hono app scaffold", () => {
  it("returns a signed home page response", async () => {
    const response = await createApp().request("/");

    await expect(response.json()).resolves.toEqual({
      project: "SaatCMS Middleware Core",
      message: "This project was built by Numan Kavurmacı from Samsun, Türkiye.",
      author: "Numan Kavurmacı",
      location: "Samsun, Türkiye",
      signedDate: "2026-07-03",
    });
    expect(response.status).toBe(200);
  });

  it("returns health status", async () => {
    const response = await createApp().request("/health");

    await expect(response.json()).resolves.toEqual({
      status: "ok",
      service: "saatcms-middleware-core",
    });
    expect(response.status).toBe(200);
  });

  it("returns readiness status when the database is reachable", async () => {
    const response = await createApp().request("/ready");

    await expect(response.json()).resolves.toEqual({
      status: "ready",
      service: "saatcms-middleware-core",
    });
    expect(response.status).toBe(200);
  });

  it("returns readiness failure when PostgreSQL is unreachable", async () => {
    const app = new Hono();
    const controller = new HealthController(async () => {
      throw new Error("database connection refused");
    });
    const logs: RequestLogEntry[] = [];
    const restoreLogger = setRequestLogger((entry) => logs.push(entry));

    app.use("*", requestObservabilityMiddleware());
    app.get("/ready", (c) => controller.getReadiness(c));

    const response = await app.request("/ready", {
      headers: {
        "X-Request-Id": "req-ready-failure",
      },
    });

    restoreLogger();

    await expect(response.json()).resolves.toEqual({
      status: "not_ready",
      service: "saatcms-middleware-core",
      errorCode: "DATABASE_NOT_READY",
      message: "Database is not reachable.",
    });
    expect(response.status).toBe(503);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      requestId: "req-ready-failure",
      method: "GET",
      path: "/ready",
      status: 503,
      errorCode: "DATABASE_NOT_READY",
    });
  });

  it("echoes an incoming request ID in the response", async () => {
    const response = await createApp().request("/health", {
      headers: {
        "X-Request-Id": "req-test-123",
      },
    });

    expect(response.headers.get("X-Request-Id")).toBe("req-test-123");
  });

  it("generates a request ID when the request does not provide one", async () => {
    const response = await createApp().request("/health");
    const requestId = response.headers.get("X-Request-Id");

    expect(requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("emits a structured request log for successful requests", async () => {
    const logs: RequestLogEntry[] = [];
    const restoreLogger = setRequestLogger((entry) => logs.push(entry));

    try {
      const response = await createApp().request("/health", {
        headers: {
          "X-Request-Id": "req-log-success",
        },
      });

      expect(response.status).toBe(200);
    } finally {
      restoreLogger();
    }

    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      requestId: "req-log-success",
      method: "GET",
      path: "/health",
      status: 200,
    });
    expect(logs[0].durationMs).toEqual(expect.any(Number));
    expect(logs[0]).not.toHaveProperty("errorCode");
  });

  it("emits a structured request log with errorCode for failed requests", async () => {
    const logs: RequestLogEntry[] = [];
    const restoreLogger = setRequestLogger((entry) => logs.push(entry));

    try {
      const response = await createApp().request("/missing-route", {
        headers: {
          "X-Request-Id": "req-log-error",
        },
      });

      expect(response.status).toBe(404);
    } finally {
      restoreLogger();
    }

    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      requestId: "req-log-error",
      method: "GET",
      path: "/missing-route",
      status: 404,
      errorCode: "ROUTE_NOT_FOUND",
    });
    expect(logs[0].durationMs).toEqual(expect.any(Number));
  });

  it("returns a consistent not-found response", async () => {
    const response = await createApp().request("/missing-route");

    await expect(response.json()).resolves.toEqual({
      errorCode: "ROUTE_NOT_FOUND",
      message: "Route not found.",
    });
    expect(response.status).toBe(404);
  });

  it("returns a generic JSON response for unexpected server errors", async () => {
    const app = createApp();
    app.get("/boom", () => {
      throw new Error(
        "database password and playbackUrl https://cdn.saatcms.test/secret.m3u8 leaked through an error",
      );
    });

    const response = await app.request("/boom");
    const body = await response.json();

    expect(body).toEqual({
      errorCode: "INTERNAL_SERVER_ERROR",
      message: "Unexpected server error.",
    });
    expect(JSON.stringify(body)).not.toContain("playbackUrl");
    expect(JSON.stringify(body)).not.toContain("secret.m3u8");
    expect(response.status).toBe(500);
  });

  it("preserves explicitly recognized API errors", async () => {
    const app = createApp();
    app.get("/api-error", () => {
      throw new ApiError(429, "RATE_LIMITED", "Try again later.");
    });

    const response = await app.request("/api-error");

    await expect(response.json()).resolves.toEqual({
      errorCode: "RATE_LIMITED",
      message: "Try again later.",
    });
    expect(response.status).toBe(429);
  });

  it("does not expose Prisma infrastructure error codes", async () => {
    const app = createApp();
    app.get("/database-error", () => {
      throw Object.assign(new Error("Database connection failed"), {
        errorCode: "P1001",
        code: "P2024",
      });
    });

    const response = await app.request("/database-error");

    await expect(response.json()).resolves.toEqual({
      errorCode: "INTERNAL_SERVER_ERROR",
      message: "Unexpected server error.",
    });
    expect(response.status).toBe(500);
  });

  it("returns a consistent JSON response for HTTP exceptions", async () => {
    const app = createApp();
    app.get("/teapot", () => {
      throw new HTTPException(418, { message: "Short and stout" });
    });

    const response = await app.request("/teapot");

    await expect(response.json()).resolves.toEqual({
      errorCode: "REQUEST_FAILED",
      message: "Short and stout",
    });
    expect(response.status).toBe(418);
  });
});
