import type { Hono } from "hono";
import { CmsContentController } from "./cms-content.controller.js";
import { createCmsContentRoutes } from "./cms-content.route.js";
import { CmsContentService } from "./cms-content.service.js";

export const CmsContentModule = {
  register(app: Hono) {
    const service = new CmsContentService();
    const controller = new CmsContentController(service);

    app.route("/api/v1/cms/content", createCmsContentRoutes(controller));
  },
};
