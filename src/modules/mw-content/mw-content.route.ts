import { Hono } from "hono";
import { MwContentController } from "./mw-content.controller.js";

export function createMwContentRoutes(controller: MwContentController) {
  const routes = new Hono();

  routes.get("/:contentId", (c) => controller.getResolvedContent(c));

  return routes;
}
