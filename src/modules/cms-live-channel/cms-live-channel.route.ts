import { Hono } from "hono";
import { CmsLiveChannelController } from "./cms-live-channel.controller.js";

export function createCmsLiveChannelRoutes(
  controller: CmsLiveChannelController,
) {
  const routes = new Hono();

  routes.post("/", (c) => controller.createChannel(c));
  routes.get("/", (c) => controller.listChannels(c));
  routes.get("/:channelId", (c) => controller.getChannel(c));
  routes.patch("/:channelId", (c) => controller.updateChannel(c));
  routes.delete("/:channelId", (c) => controller.deleteChannel(c));

  return routes;
}
