import type { Context } from "hono";
import { MwContentService } from "./mw-content.service.js";

export class MwContentController {
  constructor(private readonly mwContentService: MwContentService) {}

  async getResolvedContent(c: Context) {
    const contentId = c.req.param("contentId");

    const content = await this.mwContentService.getResolvedContent(contentId);

    return c.json(content);
  }
}
