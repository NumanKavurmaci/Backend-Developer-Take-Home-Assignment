import { Hono } from "hono";
import { HealthController } from "./health.controller.js";

export function createHealthRoutes(controller = new HealthController()) {
  const routes = new Hono();

  routes.get("/", (c) => controller.getHealth(c));

  return routes;
}
