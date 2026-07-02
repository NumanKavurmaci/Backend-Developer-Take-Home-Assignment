import type { Hono } from "hono";
import { CmsEpgProgramController } from "./cms-epg-program.controller.js";
import { createCmsEpgProgramRoutes } from "./cms-epg-program.route.js";
import { CmsEpgProgramService } from "./cms-epg-program.service.js";

// Wires the CMS EPG feature into the Hono app.
export const CmsEpgProgramModule = {
  register(app: Hono) {
    // Request flow: route -> controller -> service -> domain/repository.
    const cmsEpgProgramService = new CmsEpgProgramService();
    const cmsEpgProgramController = new CmsEpgProgramController(
      cmsEpgProgramService,
    );

    // Mounts POST /api/v1/cms/channels/:channelId/epg.
    app.route(
      "/api/v1/cms/channels",
      createCmsEpgProgramRoutes(cmsEpgProgramController),
    );
  },
};
