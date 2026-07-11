import type { Hono } from "hono";
import { HealthController } from "./health.controller.js";
import { createHealthRoutes } from "./health.routes.js";

export class HealthModule {
  static register(app: Hono) {
    const controller = new HealthController();

    app.route("/health", createHealthRoutes(controller));
    app.get("/ready", (c) => controller.getReadiness(c));
  }
}
