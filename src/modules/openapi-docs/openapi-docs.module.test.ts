import { describe, expect, it } from "vitest";
import { createApp } from "../../app.js";

describe("OpenAPI contract delivery", () => {
  it.each([
    ["/openapi/mw.yaml", "SaatCMS Middleware API"],
    ["/openapi/cms.yaml", "SaatCMS CRUD API"],
  ])("serves %s from the checked-in contract", async (url, title) => {
    const response = await createApp().request(url);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(
      "application/yaml; charset=utf-8",
    );
    expect(response.headers.get("Cache-Control")).toBe(
      "public, max-age=300",
    );
    expect(body).toContain("openapi: 3.0.3");
    expect(body).toContain(`title: ${title}`);
    expect(body).toContain("version: 1.0.0");
  });
});

