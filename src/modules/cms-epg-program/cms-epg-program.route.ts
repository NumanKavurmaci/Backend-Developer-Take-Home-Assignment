import { Hono } from "hono";
import { CmsEpgProgramController } from "./cms-epg-program.controller.js";

// Owns CMS EPG URL mapping and delegates request handling to the controller.
export function createCmsEpgProgramRoutes(
  controller: CmsEpgProgramController,
) {
  const routes = new Hono();

  routes.post("/:channelId/epg", (c) => controller.createProgram(c));

  return routes;
}
