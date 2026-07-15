import { readFile } from "node:fs/promises";
import path from "node:path";
import { swaggerUI } from "@hono/swagger-ui";
import type { Context, Hono } from "hono";

const CONTRACT_CACHE_CONTROL = "public, max-age=300";

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

export class OpenApiDocsModule {
  static register(app: Hono) {
    app.get(
      "/docs",
      swaggerUI({
        deepLinking: true,
        displayRequestDuration: true,
        filter: true,
        title: "SaatCMS API Documentation",
        urls: [
          { name: "Middleware API", url: "/openapi/mw.yaml" },
          { name: "CMS CRUD API", url: "/openapi/cms.yaml" },
        ],
      }),
    );
    app.get("/openapi/mw.yaml", (c) =>
      serveContract(c, contractFiles.middleware),
    );
    app.get("/openapi/cms.yaml", (c) => serveContract(c, contractFiles.cms));
  }
}
