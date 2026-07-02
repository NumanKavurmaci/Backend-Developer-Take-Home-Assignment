import { Hono } from "hono";
import { HealthModule } from "./modules/health/health.module.js";
import { errorHandler, notFoundHandler } from "./shared/http/error-handler.js";

export function createApp() {
  const app = new Hono();

  app.onError(errorHandler);
  app.notFound(notFoundHandler);

  HealthModule.register(app);

  return app;
}
