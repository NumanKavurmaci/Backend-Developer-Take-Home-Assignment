import type { Context } from "hono";
import { MwPlaybackService } from "./mw-playback.service.js";
import { readPlaybackRequestHeaders } from "./playback-request-headers.js";

export class MwPlaybackController {
  constructor(private readonly mwPlaybackService: MwPlaybackService) {}

  async getPlayback(c: Context) {
    const contentId = c.req.param("contentId");
    const requestContext = readPlaybackRequestHeaders(c);

    const result = await this.mwPlaybackService.getPlayback(
      contentId,
      requestContext,
    );

    return c.json(result);
  }
}
