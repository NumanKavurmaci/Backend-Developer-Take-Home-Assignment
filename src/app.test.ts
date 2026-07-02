import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";

describe("Hono app scaffold", () => {
  it("returns health status", async () => {
    const response = await createApp().request("/health");

    await expect(response.json()).resolves.toEqual({
      status: "ok",
      service: "saatcms-middleware-core",
    });
    expect(response.status).toBe(200);
  });

  it("returns a consistent not-found response", async () => {
    const response = await createApp().request("/missing-route");

    await expect(response.json()).resolves.toEqual({
      errorCode: "ROUTE_NOT_FOUND",
      message: "Route not found.",
    });
    expect(response.status).toBe(404);
  });
});
