import type { Hono } from "hono";
import { CmsLiveChannelController } from "./cms-live-channel.controller.js";
import { createCmsLiveChannelRoutes } from "./cms-live-channel.route.js";
import { CmsLiveChannelService } from "./cms-live-channel.service.js";

export const CmsLiveChannelModule = {
  register(app: Hono) {
    const service = new CmsLiveChannelService();
    const controller = new CmsLiveChannelController(service);

    app.route(
      "/api/v1/cms/channels",
      createCmsLiveChannelRoutes(controller),
    );
  },
};
