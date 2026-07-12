import type { Context } from "hono";
import { ApiError } from "../../shared/http/api-error.js";
import { setCmsAuditResource } from "../../shared/http/cms-security.js";
import { createUpdatedAtEntityTag } from "../../shared/http/entity-tag.js";
import { CmsEpgProgramService } from "./cms-epg-program.service.js";

// Handles HTTP details: route params, JSON parsing, status codes, and responses.
export class CmsEpgProgramController {
  constructor(private readonly cmsEpgProgramService: CmsEpgProgramService) {}

  async createProgram(c: Context) {
    const channelId = c.req.param("channelId");
    const body = await readJsonBody(c);
    const program = await this.cmsEpgProgramService.createProgram(
      channelId,
      body,
    );

    setCmsAuditResource(c, program.id, channelId);
    c.header("ETag", createUpdatedAtEntityTag(program.updatedAt));
    return c.json(program, 201);
  }

  async getProgram(c: Context) {
    const program = await this.cmsEpgProgramService.getProgram(
      c.req.param("channelId"),
      c.req.param("programId"),
    );

    c.header("ETag", createUpdatedAtEntityTag(program.updatedAt));
    return c.json(program);
  }

  async listPrograms(c: Context) {
    const page = await this.cmsEpgProgramService.listPrograms(
      c.req.param("channelId"),
      c.req.query(),
    );

    return c.json(page);
  }

  async updateProgram(c: Context) {
    const body = await readJsonBody(c);
    const program = await this.cmsEpgProgramService.updateProgram(
      c.req.param("channelId"),
      c.req.param("programId"),
      body,
      c.req.header("If-Match"),
    );

    c.header("ETag", createUpdatedAtEntityTag(program.updatedAt));
    return c.json(program);
  }

  async deleteProgram(c: Context) {
    await this.cmsEpgProgramService.deleteProgram(
      c.req.param("channelId"),
      c.req.param("programId"),
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
