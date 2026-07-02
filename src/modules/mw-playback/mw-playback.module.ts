import type { Hono } from "hono";
import { MwPlaybackController } from "./mw-playback.controller.js";
import { createMwPlaybackRoutes } from "./mw-playback.route.js";
import { MwPlaybackService } from "./mw-playback.service.js";

export const MwPlaybackModule = {
  register(app: Hono) {
    const mwPlaybackService = new MwPlaybackService();
    const mwPlaybackController = new MwPlaybackController(mwPlaybackService);

    app.route(
      "/api/v1/mw/playback",
      createMwPlaybackRoutes(mwPlaybackController),
    );
  },
};
