import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
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

    return c.json(program, 201);
  }
}

async function readJsonBody(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new HTTPException(400, {
      message: "Request body must be valid JSON",
    });
  }
}
