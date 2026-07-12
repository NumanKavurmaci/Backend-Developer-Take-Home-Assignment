import type { Context } from "hono";
import { ApiError } from "../../shared/http/api-error.js";
import { setCmsAuditResource } from "../../shared/http/cms-security.js";
import { createUpdatedAtEntityTag } from "../../shared/http/entity-tag.js";
import { CmsLiveChannelService } from "./cms-live-channel.service.js";

export class CmsLiveChannelController {
  constructor(private readonly service: CmsLiveChannelService) {}

  async createChannel(c: Context) {
    const channel = await this.service.createChannel(await readJsonBody(c));
    setCmsAuditResource(c, channel.id);
    c.header("ETag", createUpdatedAtEntityTag(channel.updatedAt));
    return c.json(channel, 201);
  }

  async getChannel(c: Context) {
    const channel = await this.service.getChannel(c.req.param("channelId"));
    c.header("ETag", createUpdatedAtEntityTag(channel.updatedAt));
    return c.json(channel);
  }

  async listChannels(c: Context) {
    return c.json(
      await this.service.listChannels({
        name: c.req.query("name"),
        slug: c.req.query("slug"),
        page: c.req.query("page"),
        pageSize: c.req.query("pageSize"),
      }),
    );
  }

  async updateChannel(c: Context) {
    const channel = await this.service.updateChannel(
      c.req.param("channelId"),
      await readJsonBody(c),
      c.req.header("If-Match"),
    );
    c.header("ETag", createUpdatedAtEntityTag(channel.updatedAt));
    return c.json(channel);
  }

  async deleteChannel(c: Context) {
    await this.service.deleteChannel(
      c.req.param("channelId"),
      c.req.query("confirm"),
    );
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
