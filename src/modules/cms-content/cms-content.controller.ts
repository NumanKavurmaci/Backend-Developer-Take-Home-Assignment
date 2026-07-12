import type { Context } from "hono";
import { ApiError } from "../../shared/http/api-error.js";
import { setCmsAuditResource } from "../../shared/http/cms-security.js";
import {
  CmsContentService,
  createContentEtag,
} from "./cms-content.service.js";

export class CmsContentController {
  constructor(private readonly cmsContentService: CmsContentService) {}

  async createContent(c: Context) {
    const content = await this.cmsContentService.createContent(
      await readJsonBody(c),
    );

    setCmsAuditResource(c, content.id);
    c.header("ETag", createContentEtag(content.updatedAt));
    return c.json(content, 201);
  }

  async getContent(c: Context) {
    const content = await this.cmsContentService.getContent(c.req.param("id"));

    c.header("ETag", createContentEtag(content.updatedAt));
    return c.json(content);
  }

  async listContent(c: Context) {
    return c.json(await this.cmsContentService.listContent(c.req.query()));
  }

  async updateContent(c: Context) {
    const content = await this.cmsContentService.updateContent(
      c.req.param("id"),
      await readJsonBody(c),
      c.req.header("If-Match"),
    );

    c.header("ETag", createContentEtag(content.updatedAt));
    return c.json(content);
  }

  async deleteContent(c: Context) {
    await this.cmsContentService.deleteContent(c.req.param("id"));
    return c.body(null, 204);
  }
}

async function readJsonBody(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new ApiError(
      400,
      "INVALID_REQUEST_BODY",
      "Request body must be valid JSON",
    );
  }
}
