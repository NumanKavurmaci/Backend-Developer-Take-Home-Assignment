import { HTTPException } from "hono/http-exception";
import type { PlaybackRequestHeaders } from "./playback-request-headers.js";

export type PlaybackHeaderValidationResponse = {
  contentId: string;
  requestContext: PlaybackRequestHeaders;
};

export class MwPlaybackService {
  async getPlaybackHeaderValidationResult(
    contentId: string | undefined,
    requestContext: PlaybackRequestHeaders,
  ): Promise<PlaybackHeaderValidationResponse> {
    const normalizedContentId = normalizeContentId(contentId);

    return {
      contentId: normalizedContentId,
      requestContext,
    };
  }
}

function normalizeContentId(contentId: string | undefined): string {
  const normalizedContentId = contentId?.trim();

  if (!normalizedContentId) {
    throw new HTTPException(400, {
      message: "contentId is required",
    });
  }

  return normalizedContentId;
}
