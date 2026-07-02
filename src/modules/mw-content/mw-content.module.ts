import type { Hono } from "hono";
import { MwContentService } from "./mw-content.service.js";
import { MwContentController } from "./mw-content.controller.js";
import { createMwContentRoutes } from "./mw-content.route.js";

export const MwContentModule = {
  register(app: Hono) {
    const mwContentService = new MwContentService();
    const mwContentController = new MwContentController(mwContentService);

    app.route("/api/v1/mw/content", createMwContentRoutes(mwContentController));
  },
};
