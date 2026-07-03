import { Hono } from "hono";
import { errorHandler, notFoundHandler } from "./shared/http/error-handler.js";

import { HealthModule } from "./modules/health/health.module.js";
import { CmsEpgProgramModule } from "./modules/cms-epg-program/cms-epg-program.module.js";
import { MwContentModule } from "./modules/mw-content/mw-content.module.js";
import { MwPlaybackModule } from "./modules/mw-playback/mw-playback.module.js";

export function createApp() {
  const app = new Hono();

  app.onError(errorHandler);
  app.notFound(notFoundHandler);

  app.get("/", (c) =>
    c.json({
      project: "SaatCMS Middleware Core",
      message: "This project was built by Numan Kavurmacı from Samsun, Türkiye.",
      author: "Numan Kavurmacı",
      location: "Samsun, Türkiye",
      signedDate: "2026-07-03",
    }),
  );

  HealthModule.register(app);
  MwContentModule.register(app);
  CmsEpgProgramModule.register(app);
  MwPlaybackModule.register(app);

  return app;
}
