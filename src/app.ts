import { Hono } from "hono";
import { errorHandler, notFoundHandler } from "./shared/http/error-handler.js";
import { requestObservabilityMiddleware } from "./shared/http/request-observability.js";
import {
  readCmsSecurityOptions,
  registerCmsSecurity,
  type CmsSecurityOptions,
} from "./shared/http/cms-security.js";

import { HealthModule } from "./modules/health/health.module.js";
import { CmsEpgProgramModule } from "./modules/cms-epg-program/cms-epg-program.module.js";
import { CmsContentModule } from "./modules/cms-content/cms-content.module.js";
import { CmsLiveChannelModule } from "./modules/cms-live-channel/cms-live-channel.module.js";
import { MwContentModule } from "./modules/mw-content/mw-content.module.js";
import { MwPlaybackModule } from "./modules/mw-playback/mw-playback.module.js";

export type CreateAppOptions = {
  cmsSecurity?: CmsSecurityOptions;
};

export function createApp(options: CreateAppOptions = {}) {
  const app = new Hono();

  app.use("*", requestObservabilityMiddleware());
  app.onError(errorHandler);
  app.notFound(notFoundHandler);
  registerCmsSecurity(app, options.cmsSecurity ?? readCmsSecurityOptions());

  app.get("/", (c) =>
    c.json({
      project: "SaatCMS Middleware Core",
      message:
        "This project was built by Numan Kavurmacı from Samsun, Türkiye.",
      author: "Numan Kavurmacı",
      location: "Samsun, Türkiye",
      signedDate: "2026-07-03",
    }),
  );

  HealthModule.register(app);
  MwContentModule.register(app);
  CmsContentModule.register(app);
  CmsLiveChannelModule.register(app);
  CmsEpgProgramModule.register(app);
  MwPlaybackModule.register(app);

  return app;
}
