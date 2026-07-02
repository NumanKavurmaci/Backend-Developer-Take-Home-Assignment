import type { Hono } from "hono";
import { createHealthRoutes } from "./health.routes.js";

export class HealthModule {
  static register(app: Hono) {
    app.route("/health", createHealthRoutes());
  }
}
