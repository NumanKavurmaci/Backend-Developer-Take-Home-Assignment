import { Hono } from "hono";
import { CmsContentController } from "./cms-content.controller.js";

export function createCmsContentRoutes(controller: CmsContentController) {
  const routes = new Hono();

  routes.post("/", (c) => controller.createContent(c));
  routes.get("/", (c) => controller.listContent(c));
  routes.get("/:id", (c) => controller.getContent(c));
  routes.patch("/:id", (c) => controller.updateContent(c));
  routes.delete("/:id", (c) => controller.deleteContent(c));

  return routes;
}
