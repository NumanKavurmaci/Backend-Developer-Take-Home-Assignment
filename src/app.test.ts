import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";

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
      throw new Error("database password leaked through an error");
    });

    const response = await app.request("/boom");

    await expect(response.json()).resolves.toEqual({
      errorCode: "INTERNAL_SERVER_ERROR",
      message: "Unexpected server error.",
    });
    expect(response.status).toBe(500);
  });
});
