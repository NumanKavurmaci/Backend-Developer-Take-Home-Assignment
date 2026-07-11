import type { Context } from "hono";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import {
  logRequest,
  requestObservabilityMiddleware,
  setRequestLogger,
  type RequestLogEntry,
} from "./request-observability.js";

describe("request observability", () => {
  it("writes structured logs with the default logger outside tests", async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const app = new Hono();
    let logLine: string | undefined;

    app.use("*", requestObservabilityMiddleware());
    app.get("/observed", (c) => c.text("ok"));

    try {
      process.env.NODE_ENV = "development";

      await app.request("/observed", {
        headers: {
          "X-Request-Id": "req-default-logger",
        },
      });

      logLine = infoSpy.mock.calls[0]?.[0];
    } finally {
      if (originalNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = originalNodeEnv;
      }

      infoSpy.mockRestore();
    }

    expect(logLine).toBeDefined();
    expect(JSON.parse(logLine ?? "")).toMatchObject({
      requestId: "req-default-logger",
      method: "GET",
      path: "/observed",
      status: 200,
    });
  });

  it("falls back to Hono's request path when the raw URL cannot be parsed", () => {
    const logs: RequestLogEntry[] = [];
    const restoreLogger = setRequestLogger((entry) => logs.push(entry));
    const context = {
      req: {
        method: "GET",
        path: "/fallback-path",
        get url() {
          throw new Error("URL unavailable");
        },
        header: () => "req-fallback-path",
      },
      header: vi.fn(),
      res: {
        status: 200,
      },
    } as unknown as Context;

    try {
      logRequest(context, 200);
    } finally {
      restoreLogger();
    }

    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      requestId: "req-fallback-path",
      method: "GET",
      path: "/fallback-path",
      status: 200,
    });
  });
});
