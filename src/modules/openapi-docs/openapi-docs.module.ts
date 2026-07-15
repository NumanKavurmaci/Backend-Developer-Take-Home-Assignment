import { readFile } from "node:fs/promises";
import path from "node:path";
import { swaggerUI } from "@hono/swagger-ui";
import type { Context, Hono } from "hono";

const CONTRACT_CACHE_CONTROL = "public, max-age=300";
const SWAGGER_UI_VERSION = "5.32.8";

const openApiDefinitions = [
  { name: "Middleware API", url: "/openapi/mw.yaml" },
  { name: "CMS CRUD API", url: "/openapi/cms.yaml" },
] as const;

const contractFiles = {
  cms: path.join(process.cwd(), "docs", "api", "cms-crud-openapi.yaml"),
  middleware: path.join(process.cwd(), "docs", "api", "mw-openapi.yaml"),
} as const;

async function serveContract(c: Context, filePath: string) {
  const contract = await readFile(filePath, "utf8");

  return c.body(contract, 200, {
    "Cache-Control": CONTRACT_CACHE_CONTROL,
    "Content-Type": "application/yaml; charset=utf-8",
  });
}

function renderSwaggerUi(assets: { css: string[]; js: string[] }) {
  const bundleScriptUrl = assets.js.find((url) =>
    url.endsWith("/swagger-ui-bundle.js"),
  );

  if (!bundleScriptUrl) {
    throw new Error("Swagger UI bundle asset is unavailable.");
  }

  const standalonePresetUrl = bundleScriptUrl.replace(
    "/swagger-ui-bundle.js",
    "/swagger-ui-standalone-preset.js",
  );

  return `
    <div id="swagger-ui"></div>
    ${assets.css.map((url) => `<link rel="stylesheet" href="${url}" />`).join("\n")}
    ${assets.js.map((url) => `<script src="${url}" crossorigin="anonymous"></script>`).join("\n")}
    <script src="${standalonePresetUrl}" crossorigin="anonymous"></script>
    <script>
      window.onload = () => {
        window.ui = SwaggerUIBundle({
          dom_id: "#swagger-ui",
          deepLinking: true,
          displayRequestDuration: true,
          filter: true,
          urls: ${JSON.stringify(openApiDefinitions)},
          "urls.primaryName": "Middleware API",
          presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
          layout: "StandaloneLayout",
        })
      }
    </script>
  `;
}

export class OpenApiDocsModule {
  static register(app: Hono) {
    app.get(
      "/docs",
      swaggerUI({
        manuallySwaggerUIHtml: renderSwaggerUi,
        title: "SaatCMS API Documentation",
        urls: [...openApiDefinitions],
        version: SWAGGER_UI_VERSION,
      }),
    );
    app.get("/openapi/mw.yaml", (c) =>
      serveContract(c, contractFiles.middleware),
    );
    app.get("/openapi/cms.yaml", (c) => serveContract(c, contractFiles.cms));
  }
}
