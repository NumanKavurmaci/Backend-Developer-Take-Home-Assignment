import { Hono } from "hono";
import { MwPlaybackController } from "./mw-playback.controller.js";

export function createMwPlaybackRoutes(controller: MwPlaybackController) {
  const routes = new Hono();

  routes.get("/:contentId", (c) => controller.getPlayback(c));

  return routes;
}
