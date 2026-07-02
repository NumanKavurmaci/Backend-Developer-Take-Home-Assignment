import { Hono } from "hono";
import { errorHandler, notFoundHandler } from "./shared/http/error-handler.js";

import { HealthModule } from "./modules/health/health.module.js";
import { CmsEpgProgramModule } from "./modules/cms-epg-program/cms-epg-program.module.js";
import { MwContentModule } from "./modules/mw-content/mw-content.module.js";

export function createApp() {
  const app = new Hono();

  app.onError(errorHandler);
  app.notFound(notFoundHandler);

  HealthModule.register(app);
  MwContentModule.register(app);
  CmsEpgProgramModule.register(app);

  return app;
}
