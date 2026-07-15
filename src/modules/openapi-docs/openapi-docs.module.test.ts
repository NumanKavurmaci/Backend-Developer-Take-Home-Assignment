import { describe, expect, it } from "vitest";
import { createApp } from "../../app.js";

describe("OpenAPI contract delivery", () => {
  it("renders Swagger UI with both contract choices", async () => {
    const response = await createApp().request("/docs");
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/html");
    expect(body).toContain("<title>SaatCMS API Documentation</title>");
    expect(body).toContain(
      'urls: [{"name":"Middleware API","url":"/openapi/mw.yaml"},{"name":"CMS CRUD API","url":"/openapi/cms.yaml"}]',
    );
    expect(body).toContain(
      'swagger-ui-dist@5.32.8/swagger-ui-standalone-preset.js',
    );
    expect(body).toContain(
      "presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset]",
    );
    expect(body).toContain('layout: "StandaloneLayout"');
    expect(body).toContain('"urls.primaryName": "Middleware API"');
  });

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
    expect(body).toContain("  - url: /");
  });
});
