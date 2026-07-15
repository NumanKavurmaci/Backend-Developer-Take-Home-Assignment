import { readFile } from "node:fs/promises";
import path from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { createApp } from "../../app.js";
import type { CmsSecurityOptions } from "../../shared/http/cms-security.js";

const cmsSecurityDisabled: CmsSecurityOptions = {
  credentials: [],
  authenticationAttemptLimitPerMinute: 10,
  maxBodyBytes: 1_024,
  mutationsEnabled: true,
  rateLimitPerMinute: 10,
};

const expectedDefinitions = [
  { name: "Middleware API", url: "/openapi/mw.yaml" },
  { name: "CMS CRUD API", url: "/openapi/cms.yaml" },
] as const;

type SwaggerUiConfig = {
  dom_id: string;
  deepLinking: boolean;
  displayRequestDuration: boolean;
  filter: boolean;
  urls: Array<{ name: string; url: string }>;
  "urls.primaryName": string;
  presets: unknown[];
  layout: string;
};

describe("OpenAPI documentation integration", () => {
  it("executes a valid Swagger bootstrap with a loadable primary definition", async () => {
    const app = createApp({ cmsSecurity: cmsSecurityDisabled });
    const response = await app.request("/docs");
    const html = await response.text();
    const bootstrapScript = extractBootstrapScript(html);
    const capturedConfigs: SwaggerUiConfig[] = [];
    const apisPreset = { name: "apis" };
    const standalonePreset = { name: "standalone" };
    const swaggerUiBundle = Object.assign(
      (config: SwaggerUiConfig) => {
        capturedConfigs.push(config);
        return { config };
      },
      { presets: { apis: apisPreset } },
    );
    const sandboxWindow: { onload?: () => void; ui?: unknown } = {};

    runInNewContext(bootstrapScript, {
      SwaggerUIBundle: swaggerUiBundle,
      SwaggerUIStandalonePreset: standalonePreset,
      window: sandboxWindow,
    });

    expect(response.status).toBe(200);
    expect(sandboxWindow.onload).toEqual(expect.any(Function));

    sandboxWindow.onload?.();

    expect(capturedConfigs).toHaveLength(1);
    const [config] = capturedConfigs;
    expect(config.dom_id).toBe("#swagger-ui");
    expect(config.deepLinking).toBe(true);
    expect(config.displayRequestDuration).toBe(true);
    expect(config.filter).toBe(true);
    expect([...config.urls]).toEqual(expectedDefinitions);
    expect(config["urls.primaryName"]).toBe("Middleware API");
    expect(config.urls.map(({ name }) => name)).toContain(
      config["urls.primaryName"],
    );
    expect(config.layout).toBe("StandaloneLayout");
    expect(config.presets).toHaveLength(2);
    expect(config.presets[0]).toBe(apisPreset);
    expect(config.presets[1]).toBe(standalonePreset);

    for (const definition of config.urls) {
      const contractResponse = await app.request(definition.url);
      expect(contractResponse.status).toBe(200);
      await expect(contractResponse.text()).resolves.toContain(
        "openapi: 3.0.3",
      );
    }
  });

  it("loads version-pinned Swagger assets in dependency order", async () => {
    const response = await createApp({
      cmsSecurity: cmsSecurityDisabled,
    }).request("/docs");
    const html = await response.text();

    expect(extractExternalAssets(html)).toEqual([
      "https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.32.8/swagger-ui.css",
      "https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.32.8/swagger-ui-bundle.js",
      "https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.32.8/swagger-ui-standalone-preset.js",
    ]);
  });

  it.each([
    ["middleware", "/openapi/mw.yaml", "mw-openapi.yaml"],
    ["cms", "/openapi/cms.yaml", "cms-crud-openapi.yaml"],
  ])(
    "serves the exact checked-in %s contract with production headers",
    async (name, url, fileName) => {
      const app = createApp({ cmsSecurity: cmsSecurityDisabled });
      const requestId = `docs-integration-${name}`;
      const [response, checkedInContract] = await Promise.all([
        app.request(url, { headers: { "X-Request-Id": requestId } }),
        readFile(path.join(process.cwd(), "docs", "api", fileName), "utf8"),
      ]);

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe(
        "application/yaml; charset=utf-8",
      );
      expect(response.headers.get("Cache-Control")).toBe(
        "public, max-age=300",
      );
      expect(response.headers.get("X-Request-Id")).toBe(requestId);
      await expect(response.text()).resolves.toBe(checkedInContract);
    },
  );

  it("keeps documentation public when CMS authentication is unavailable", async () => {
    const app = createApp({ cmsSecurity: cmsSecurityDisabled });
    const [docsResponse, contractResponse, cmsResponse] = await Promise.all([
      app.request("/docs"),
      app.request("/openapi/cms.yaml"),
      app.request("/api/v1/cms/content"),
    ]);

    expect(docsResponse.status).toBe(200);
    expect(contractResponse.status).toBe(200);
    expect(cmsResponse.status).toBe(503);
    await expect(cmsResponse.json()).resolves.toEqual({
      errorCode: "CMS_AUTH_NOT_CONFIGURED",
      message: "CMS authentication is not configured.",
    });
  });

  it("uses the application not-found contract for unknown OpenAPI routes", async () => {
    const response = await createApp({
      cmsSecurity: cmsSecurityDisabled,
    }).request("/openapi/unknown.yaml");

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      errorCode: "ROUTE_NOT_FOUND",
      message: "Route not found.",
    });
  });
});

function extractBootstrapScript(html: string): string {
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
    .map((match) => match[1].trim())
    .filter((script) => script.includes("SwaggerUIBundle({"));

  if (scripts.length !== 1) {
    throw new Error(`Expected one Swagger bootstrap script, found ${scripts.length}.`);
  }

  return scripts[0];
}

function extractExternalAssets(html: string): string[] {
  return [
    ...html.matchAll(
      /<(?:link|script)[^>]+(?:href|src)="([^"]+)"[^>]*>/g,
    ),
  ].map((match) => match[1]);
}
